// src/components/simulations/cppn/cppn-controller.ts
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { generateShader, computeWeightLayout, packWeights, migrateWeightsFromXYR, legacyWeightCount, removeInputColumn, Z_DIM, MAX_INPUTS, ACTIVATION_IDS, type WeightLayout } from './cppn-codegen';
import { normalizeConfig, DEFAULT_MOTION, DEFAULT_INPUTS, type CPPNConfig, type CPPNPreset, type LayerConfig, type LegacyCPPNConfig, type MotionLadder, type WeightDistribution } from './cppn-types';
import { parse, tryParse, type Ast, type ParseError } from './cppn-expr/parser';
import { compile, MAX_OPS, type Program } from './cppn-expr/compile';
import { measureRange, type Range } from './cppn-expr/range';

export type { CPPNConfig, CPPNPreset, LayerConfig, WeightDistribution, MotionLadder };
export type { Activation, DistributionType } from './cppn-types';

// Params uniform: [resX, resY, time, scale, z0..z15, acts0.xyzw, acts1.xyzw, view.xyzw,
//   numInputs, exprTime, normFlag, pad, pointer.xyzw, norm[4].xyzw] = 56 × 4 = 224 bytes
export const PARAMS_FLOATS = 4 + Z_DIM + 8 + 4 + 4 + 4 + 16;
const PARAMS_BYTES  = PARAMS_FLOATS * 4;
const ACTS_OFFSET   = 4 + Z_DIM;
const VIEW_OFFSET   = ACTS_OFFSET + 8;
const INPUTS_OFFSET = VIEW_OFFSET + 4;     // numInputs (u32), exprTime, normFlag (u32), view centre y low bits
const POINTER_OFFSET = INPUTS_OFFSET + 4;
const NORM_OFFSET   = POINTER_OFFSET + 4;  // 4 × vec4f: (mid, half) pairs, two inputs per vec4
const PIPELINE_CACHE = 6;   // built pipelines kept per page (one per recent layer-width combination)

/** The expression clock wraps every 60 s: t = 2π · (clock mod 60) / 60. */
export const EXPR_PERIOD_S = 60;

export type InputCompileResult =
  | { ok: true; range: Range }
  | { ok: false; error: ParseError };

/** f32 runs out of relative precision around here: deeper zooms go blocky. */
export const MAX_ZOOM = 1e4;
export const MIN_ZOOM = 0.02;

// ── PRNG (mulberry32) ─────────────────────────────────────────────
import { makePRNG } from '../../../lib/webgpu/prng';
import { trackShaderError } from '../../../lib/analytics';
export { makePRNG };

function boxMuller(rand: () => number): number {
  const u1 = rand() || 1e-10;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rand());
}

// ── Weight generation ─────────────────────────────────────────────
function makeSampler(dist: WeightDistribution, rand: () => number): (fanIn: number, fanOut: number) => number {
  return function sample(fanIn: number, fanOut: number): number {
    switch (dist.type) {
      case 'normal':  return boxMuller(rand) * (dist.sigma ?? 1.0);
      case 'uniform': { const a = dist.a ?? 1.0; return rand() * 2 * a - a; }
      case 'glorot':  {
        const g = (dist.scale ?? 1.0) * Math.sqrt(6 / (fanIn + fanOut));
        return rand() * 2 * g - g;
      }
      case 'sparse': {
        if (rand() < (dist.sparsity ?? 0.8)) return 0;
        return (rand() < 0.5 ? -1 : 1) * (dist.magnitude ?? 2.0);
      }
    }
  };
}

export function generateWeights(
  layout: WeightLayout,
  config: CPPNConfig,
  seed: number,
): Float32Array {
  const rand    = makePRNG(seed);
  const weights = new Float32Array(layout.totalCount);
  const sample  = makeSampler(config.distribution, rand);
  const { layers } = config;

  const w0 = layers[0].width;
  // The first three input columns (x, y, r) and everything after draw from
  // the stream in the pre-expression order, so a seed still gives the same
  // image for a three-input preset; the five extra columns come last.
  for (let k = 0; k < 3; k++) for (let i = 0; i < w0; i++) weights[layout.wInOffset + k * w0 + i] = sample(1, w0);
  for (let i = 0; i < Z_DIM * w0; i++) weights[layout.wzOffset + i] = sample(Z_DIM, w0);

  for (let li = 0; li < layers.length - 1; li++) {
    const fanIn  = layers[li].width;
    const fanOut = layers[li + 1].width;
    for (let i = 0; i < fanIn * fanOut; i++) {
      weights[layout.hiddenWeightOffsets[li] + i] = sample(fanIn, fanOut);
    }
    for (let i = 0; i < fanOut; i++) {
      weights[layout.hiddenBiasOffsets[li] + i] = (rand() * 2 - 1) / Math.sqrt(fanIn);
    }
  }

  const lastW = layers[layers.length - 1].width;
  for (let i = 0; i < lastW * 3; i++) {
    weights[layout.outWeightOffset + i] = sample(lastW, 3);
  }
  for (let k = 3; k < MAX_INPUTS; k++) for (let i = 0; i < w0; i++) weights[layout.wInOffset + k * w0 + i] = sample(1, w0);
  return weights;
}

// ── Default config ────────────────────────────────────────────────
function defaultConfig(): CPPNConfig {
  return {
    zDim: Z_DIM,
    layers: [
      { width: 32, activation: 'tanh' },
      { width: 32, activation: 'sin'  },
      { width: 32, activation: 'tanh' },
    ],
    distribution: { type: 'normal', sigma: 1.0 },
    scale: 1.0,
    zScale: 1,
    motion: { ...DEFAULT_MOTION },
    inputs: [...DEFAULT_INPUTS],
    normalizeInputs: true,
  };
}

// ── Controller ────────────────────────────────────────────────────
/** GPU frame time above which the loop keeps only one frame in flight. */
const SLOW_FRAME_MS = 20;
/** Floor for the adaptive backing-size multiplier. */
const MIN_RENDER_SCALE = 0.5;

export class CPPNController {
  private gpu:           WebGPUContext | null = null;
  private pipeline:      GPURenderPipeline | null = null;
  private paramsBuffer!: GPUBuffer;
  private weightBuffer:  GPUBuffer | null = null;
  private progBuffer:    GPUBuffer | null = null;
  private bindGroup!:    GPUBindGroup;
  // ── Expression inputs: one bytecode program per slot (cppn-expr/) ──
  private programs: Array<Program | null> = Array.from({ length: MAX_INPUTS }, () => null);
  private inputResults: InputCompileResult[] = [];
  private norms = new Float32Array(16);        // (mid, half) per slot, two slots per vec4
  /** Integrated expression clock in seconds; pauses with ⏸, resets with ↺ and the minimap double-tap. */
  exprClock = 0;
  /** Pointer position in world space (same space as x, y); holds its last value. */
  readonly pointer: [number, number] = [0, 0];
  private layout!:        WeightLayout;
  private compiledArch   = ''; // architecture key the current pipeline was built for
  /** Built pipelines by architecture key (LRU): scrubbing back to a width is a bind, not a compile. */
  private pipelines = new Map<string, GPURenderPipeline>();
  /** Compiles in flight by key; a stale one finishes (WebGPU cannot cancel) but never blocks the newest. */
  private compiling = new Map<string, Promise<GPURenderPipeline>>();
  private busy = false;
  private get compilesInFlight(): number { return this.compiling.size; }
  /** Fires with true when a shader compile starts and false when the queue drains (for a spinner). */
  onBusy: ((busy: boolean) => void) | null = null;
  private running   = false;
  private paused    = false;   // ⏸: motion frozen, frames still drawn (zoom/pan/edits stay live)
  private animId    = 0;
  private usingRaf  = true;
  /** Smoothed submit → GPU-done time of drawn frames, ms. */
  private gpuMs = 0;
  /** Backing-size multiplier the loop lowers when frames are slow. */
  renderScale = 1;
  /** Let the loop trade resolution for frame time (heavy presets on phones). */
  adaptiveResolution = true;
  private lastScaleCheck = 0;
  maxFps    = Infinity;
  tickCount = 0;
  private animate   = true;
  private startTime = performance.now();
  // Latent motion is integrated, not evaluated at wall-clock time: each band
  // advances its phase by 2π·freq·dt per frame, so changing speed/spread only
  // changes the rate from now on instead of rotating the phase by 2π·Δf·t.
  private bandPhase = new Float64Array(4);
  private lastTick = 0;
  /** While true (a finger is down) the oscillation is frozen. */
  private motionHeld = false;

  // ── View: window of the coordinate plane shown on screen ──
  viewCx = 0;
  viewCy = 0;
  viewZoom = 1;
  onViewChange: (() => void) | null = null;

  // ── Latent offset: a point added to the oscillating z, steered by a
  // one-finger drag along two random orthonormal 16-D directions. The
  // basis is derived from the seed so a preset always feels the same. ──
  readonly latentOffset = new Float32Array(Z_DIM);
  private latentU = new Float32Array(Z_DIM);
  private latentV = new Float32Array(Z_DIM);
  private basisSeed = -1;
  private dimOffsets    = new Float32Array(Z_DIM);
  private currentWeights = new Float32Array(0);

  config: CPPNConfig = defaultConfig();
  seed: number = Date.now() & 0xffffffff;
  // Cap on the longest canvas dimension; 0 = unlimited. The fragment shader
  // costs thousands of MACs per pixel, so phones get a much smaller default.
  maxResolution = CPPNController.defaultMaxResolution();

  static defaultMaxResolution(): number {
    if (typeof window === 'undefined') return 960;
    const phone = window.matchMedia('(pointer: coarse)').matches
               || window.matchMedia('(max-width: 768px)').matches;
    return phone ? 320 : 960;
  }

  // ── Init ──────────────────────────────────────────────────────
  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      this.gpu = await initWebGPU(canvas);
      if (!this.gpu) return false;
      this.paramsBuffer = this.gpu.device.createBuffer({
        size: PARAMS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.progBuffer = this.gpu.device.createBuffer({
        size: MAX_INPUTS * MAX_OPS * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.randomizeDimOffsets();
      this.layout = computeWeightLayout(this.config);
      this.currentWeights = generateWeights(this.layout, this.config, this.seed);
      this.setInputs(this.config.inputs);
      this._uploadWeights();
      // No compile here: every page loads a preset right after init, and that
      // setState / loadPreset compiles the real architecture once. tick() waits
      // for the pipeline; start() compiles the defaults only if nothing else has.
      return true;
    } catch (e) {
      console.error('CPPNController init error:', e);
      return false;
    }
  }

  // ── Compile — only when layer widths/activations change ──────
  // Weights live in a storage buffer, so randomize / distribution changes
  // are a buffer write, not a recompile.
  // Activations live in the uniform, so only widths (and count) define a pipeline.
  private archKey(): string {
    return this.config.layers.map(l => l.width).join(',');
  }

  private _ensurePipeline(): Promise<void> {
    if (!this.gpu) return Promise.resolve();
    const key = this.archKey();
    if (this.pipeline && key === this.compiledArch) { this._setBusy(); return Promise.resolve(); }
    const cached = this.pipelines.get(key);
    if (cached) { this._bindPipeline(key, cached); this._setBusy(); return Promise.resolve(); }
    // No queue: the newest architecture compiles at once, alongside any stale
    // compile still in flight, and only the one matching archKey() is bound.
    let job = this.compiling.get(key);
    if (!job) {
      job = this._compile(key);
      this.compiling.set(key, job);
      const done = () => { this.compiling.delete(key); this._setBusy(); };
      job.then(done, done);
    }
    this._setBusy();
    return job.then(pipeline => { if (key === this.archKey()) this._bindPipeline(key, pipeline); this._setBusy(); });
  }

  /** Busy = the current architecture is not bound yet and is compiling. */
  private _setBusy(): void {
    const b = this.compiledArch !== this.archKey() && this.compiling.has(this.archKey());
    if (b !== this.busy) { this.busy = b; this.onBusy?.(b); }
  }

  private _bindPipeline(key: string, pipeline: GPURenderPipeline): void {
    this.pipeline = pipeline;
    this.compiledArch = key;
    this._rebuildBindGroup();
  }

  private async _compile(key: string): Promise<GPURenderPipeline> {
    const { device, format } = this.gpu!;
    const code   = generateShader(this.config, this.layout);   // sync: the config this key was taken from
    const module = device.createShaderModule({ code });
    let pipeline: GPURenderPipeline;
    try {
      pipeline = await device.createRenderPipelineAsync({
        layout: 'auto',
        vertex:   { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
      });
    } catch (e) {
      // only now pay for the compilation messages, to report the real error
      const info = await module.getCompilationInfo();
      const errs = info.messages.filter(m => m.type === 'error');
      const msg  = errs.length ? errs.map(m => m.message).join(', ') : String(e);
      trackShaderError('CPPN: ' + (errs[0]?.message ?? msg));
      throw new Error('CPPN shader error: ' + msg);
    }
    this.pipelines.delete(key);
    this.pipelines.set(key, pipeline);
    while (this.pipelines.size > PIPELINE_CACHE) this.pipelines.delete(this.pipelines.keys().next().value!);
    return pipeline;
  }

  private _rebuildBindGroup(): void {
    if (!this.gpu || !this.pipeline || !this.weightBuffer || !this.progBuffer) return;
    this.bindGroup = this.gpu.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this.weightBuffer } },
        { binding: 2, resource: { buffer: this.progBuffer } },
      ],
    });
  }

  /** Pack currentWeights into slot order and write them to the GPU. Grows the buffer if needed. */
  private _uploadWeights(): void {
    if (!this.gpu) return;
    const { device } = this.gpu;
    const packed = packWeights(this.config, this.layout, this.currentWeights);
    if (!this.weightBuffer || this.weightBuffer.size < packed.byteLength) {
      this.weightBuffer?.destroy();
      this.weightBuffer = device.createBuffer({
        size: Math.max(16, packed.byteLength),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this._rebuildBindGroup();
    }
    device.queue.writeBuffer(this.weightBuffer, 0, packed);
    this.gpuDataVersion++;
  }

  // ── Architecture — recompute layout, rerandomize, recompile ──
  async setLayers(layers: LayerConfig[]): Promise<void> {
    this.config = { ...this.config, layers: layers.map(l => ({ ...l })) };
    this.layout = computeWeightLayout(this.config);
    this.currentWeights = generateWeights(this.layout, this.config, this.seed);
    this._uploadWeights();
    await this._ensurePipeline();
  }

  /** Weight count of the current (or a given) architecture: the per-pixel cost. */
  paramCount(layers: LayerConfig[] = this.config.layers): number {
    return computeWeightLayout({ ...this.config, layers }).totalCount;
  }

  // ── Weights — regenerate from the current seed and upload (no recompile) ──
  /** Changing the distribution re-derives weights from the same seed, so it applies live. */
  setDistribution(dist: WeightDistribution): void {
    this.config = { ...this.config, distribution: dist };
    this.currentWeights = generateWeights(this.layout, this.config, this.seed);
    this._uploadWeights();
  }

  randomizeWeights(seed?: number): void {
    if (seed !== undefined) this.seed = seed >>> 0;
    this.currentWeights = generateWeights(this.layout, this.config, this.seed);
    this._uploadWeights();
  }

  setSeed(seed: number): void { this.randomizeWeights(seed); }

  // ── Scale (uniform write only) ────────────────────────────────
  setScale(scale: number): void { this.config = { ...this.config, scale }; }

  // ── Expression inputs — compile to bytecode, upload; never a recompile ──
  /**
   * Replace the input expressions. Each is parsed, compiled and range-
   * measured. A slot that fails to compile keeps its previous program *and*
   * its previous source in `config.inputs` (so the canvas never goes black
   * mid-keystroke and a broken draft never reaches presets or undo); the
   * error is reported for the UI. A brand-new slot that never compiled
   * falls back to `x`.
   */
  setInputs(exprs: string[]): InputCompileResult[] {
    const prev = this.config.inputs;
    const list = exprs.slice(0, MAX_INPUTS);
    if (list.length === 0) list.push('x');
    const results: InputCompileResult[] = [];
    const kept: string[] = [];
    list.forEach((src, i) => {
      const parsed = tryParse(src);
      let error: ParseError | null = 'error' in parsed ? parsed.error : null;
      if (!error) {
        try {
          const ast = (parsed as { ast: Ast }).ast;
          const prog = compile(ast);
          const range = measureRange(prog, ast);
          this.programs[i] = prog;
          this.norms[i * 2] = range.mid;
          this.norms[i * 2 + 1] = range.half;
          results.push({ ok: true, range });
          kept.push(src);
          return;
        } catch (e) {
          const err = e as ParseError;
          error = { msg: err.msg ?? String(e), pos: err.pos ?? 0 };
        }
      }
      results.push({ ok: false, error });
      if (i < prev.length && this.programs[i]) kept.push(prev[i]);
      else {
        // never compiled: fall back to x so the slot is deterministic
        const xAst = parse('x');
        const fallback = compile(xAst);
        const range = measureRange(fallback, xAst);
        this.programs[i] = fallback;
        this.norms[i * 2] = range.mid; this.norms[i * 2 + 1] = range.half;
        kept.push('x');
      }
    });
    for (let i = list.length; i < MAX_INPUTS; i++) this.programs[i] = null;
    this.config = { ...this.config, inputs: kept };
    this.inputResults = results;
    this._uploadPrograms();
    if (list.length > prev.length) this._fillNewInputColumns(prev.length, list.length);
    return results;
  }

  /** Remove input slot `i`: later slots, their programs and their weight columns move down. */
  removeInput(i: number): InputCompileResult[] {
    const list = this.config.inputs;
    if (list.length <= 1 || i < 0 || i >= list.length) return this.inputResults;
    if (this.layout) {
      removeInputColumn(this.currentWeights, this.layout, this.config.layers[0].width, i);
      this._uploadWeights();
    }
    return this.setInputs(list.filter((_, j) => j !== i));
  }

  /** Last compile result per input slot. */
  get inputStatus(): readonly InputCompileResult[] { return this.inputResults; }

  setNormalize(on: boolean): void { this.config = { ...this.config, normalizeInputs: on }; }

  private _uploadPrograms(): void {
    if (!this.gpu || !this.progBuffer) return;
    const buf = new Float32Array(MAX_INPUTS * MAX_OPS * 4);
    this.programs.forEach((p, i) => { if (p) buf.set(p.ops, i * MAX_OPS * 4); });
    this.gpu.device.queue.writeBuffer(this.progBuffer, 0, buf);
    this.gpuDataVersion++;
  }

  /**
   * Exact (preset) weights carry zeros in the unused input columns; when the
   * input count grows, an all-zero new column would feed the network nothing.
   * Fill such columns from the seed with the current distribution. Columns
   * that already hold values are never touched.
   */
  private _fillNewInputColumns(from: number, to: number): void {
    if (!this.layout) return;
    const w0 = this.config.layers[0].width;
    let changed = false;
    for (let k = from; k < to; k++) {
      const off = this.layout.wInOffset + k * w0;
      let allZero = true;
      for (let i = 0; i < w0; i++) if (this.currentWeights[off + i] !== 0) { allZero = false; break; }
      if (!allZero) continue;
      const sample = makeSampler(this.config.distribution, makePRNG((this.seed ^ (0xa11ce + k)) >>> 0));
      for (let i = 0; i < w0; i++) this.currentWeights[off + i] = sample(1, w0);
      changed = true;
    }
    if (changed) this._uploadWeights();
  }

  // ── Pointer (px, py inputs) ───────────────────────────────────
  /** Screen NDC (x right, y down, −1..1) → world space, like the shader's cx, cy. */
  setPointerNdc(sx: number, sy: number): void {
    const [ex, ey] = this.viewExtent();
    this.pointer[0] = this.viewCx + sx * ex;
    this.pointer[1] = this.viewCy + sy * ey;
  }
  /** Hover and single-pointer moves feed px/py; the value holds on leave. */
  bindPointer(target: HTMLElement): () => void {
    const onMove = (e: PointerEvent) => {
      const r = target.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      this.setPointerNdc(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    };
    target.addEventListener('pointermove', onMove, { passive: true });
    target.addEventListener('pointerdown', onMove, { passive: true });
    return () => { target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerdown', onMove); };
  }

  // ── Motion ladder ─────────────────────────────────────────────
  setMotion(patch: Partial<MotionLadder>): void {
    this.config = { ...this.config, motion: { ...this.config.motion, ...patch } };
  }

  randomizeDimOffsets(): void {
    const rand = makePRNG(Date.now() & 0xffffffff);
    for (let i = 0; i < Z_DIM; i++) this.dimOffsets[i] = rand() * 2 * Math.PI;
  }

  setAnimate(on: boolean): void { this.animate = on; }
  /** Freeze/resume the oscillation (a finger is down on the canvas). */
  holdMotion(on: boolean): void { this.motionHeld = on; }

  /** Half-extent of the window in world units: (aspect·scale, scale) / zoom. */
  private viewExtent(): [number, number] {
    const c = this.gpu?.canvas;
    const aspect = c && c.height > 0 ? c.width / c.height : 1;
    return [aspect * this.config.scale / this.viewZoom, this.config.scale / this.viewZoom];
  }
  /** Zoom by `factor` keeping the world point under screen NDC (sx, sy) fixed. sy is down, like fragPos. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const z1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.viewZoom * factor));
    const [ex0, ey0] = this.viewExtent();
    const wx = this.viewCx + sx * ex0, wy = this.viewCy + sy * ey0;
    this.viewZoom = z1;
    const [ex1, ey1] = this.viewExtent();
    this.viewCx = wx - sx * ex1;
    this.viewCy = wy - sy * ey1;
    this.onViewChange?.();
  }
  /** Pan by a screen delta in NDC units (dsx, dsy down). */
  panBy(dsx: number, dsy: number): void {
    const [ex, ey] = this.viewExtent();
    this.viewCx -= dsx * ex;
    this.viewCy -= dsy * ey;
    this.onViewChange?.();
  }
  resetView(): void { this.viewCx = 0; this.viewCy = 0; this.viewZoom = 1; this.onViewChange?.(); }

  private ensureLatentBasis(): void {
    if (this.basisSeed === this.seed) return;
    this.basisSeed = this.seed;
    const rand = makePRNG((this.seed ^ 0x9e3779b9) >>> 0);
    const u = this.latentU, v = this.latentV;
    for (let i = 0; i < Z_DIM; i++) { u[i] = boxMuller(rand); v[i] = boxMuller(rand); }
    const norm = (a: Float32Array) => { let s = 0; for (const x of a) s += x * x; s = Math.sqrt(s) || 1; for (let i = 0; i < a.length; i++) a[i] /= s; };
    norm(u);
    let d = 0; for (let i = 0; i < Z_DIM; i++) d += u[i] * v[i];
    for (let i = 0; i < Z_DIM; i++) v[i] -= d * u[i];       // Gram–Schmidt
    norm(v);
  }
  /** Move the latent point by du along u and dv along v (screen-relative units). */
  nudgeLatent(du: number, dv: number): void {
    this.ensureLatentBasis();
    for (let i = 0; i < Z_DIM; i++) this.latentOffset[i] += du * this.latentU[i] + dv * this.latentV[i];
  }
  resetLatent(): void { this.latentOffset.fill(0); this.exprClock = 0; }
  get isAnimating(): boolean { return this.animate; }

  // ── Presets ───────────────────────────────────────────────────
  async loadPreset(preset: CPPNPreset): Promise<void> {
    await this.setState(preset.config, preset.seed, preset.weights);
  }

  /**
   * Replace config + seed (+ optional exact weights) in one step. Recompiles
   * only if the architecture changed; otherwise just uploads weights. When
   * `weights` is absent or the wrong length they are regenerated from seed.
   */
  async setState(config: CPPNConfig | LegacyCPPNConfig, seed: number, weights?: ArrayLike<number>): Promise<void> {
    this.config = normalizeConfig(config);
    this.seed   = seed >>> 0;
    this.layout = computeWeightLayout(this.config);
    this.currentWeights = weights && weights.length === this.layout.totalCount
      ? Float32Array.from(weights)
      : weights && weights.length === legacyWeightCount(this.config)
        ? migrateWeightsFromXYR(weights, this.config)     // pre-expression preset: x, y, r columns only
        : generateWeights(this.layout, this.config, this.seed);
    this.setInputs(this.config.inputs);
    this._uploadWeights();
    await this._ensurePipeline();
  }

  get weights(): Float32Array { return this.currentWeights; }

  capturePreset(name: string): CPPNPreset {
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return {
      id,
      name,
      config:  JSON.parse(JSON.stringify(this.config)),
      weights: Array.from(this.currentWeights),
      seed:    this.seed,
      inputs:  [...this.config.inputs],
      normalizeInputs: this.config.normalizeInputs,
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────
  /** Freeze the latent motion but keep rendering: the view, weights and
   *  architecture all stay editable while paused. */
  pause(): void { this.paused = true; }

  start(): void {
    this.paused = false;
    if (this.running) return;
    this.running  = true;
    this.startTime = performance.now();
    this.lastTick = 0;
    if (!this.pipeline && this.compilesInFlight === 0) {
      // Fallback for a caller that starts without ever loading a preset: give
      // a preset load a moment to claim the first compile, then build defaults.
      window.setTimeout(() => { if (!this.pipeline && this.compilesInFlight === 0 && this.gpu) void this._ensurePipeline(); }, 300);
    }
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.usingRaf) cancelAnimationFrame(this.animId);
    else clearTimeout(this.animId);
  }

  reset(): void {
    this.randomizeDimOffsets();
    this.exprClock = 0;
    this.randomizeWeights(Date.now() & 0xffffffff);
  }

  // ── Render loop ───────────────────────────────────────────────
  private advanceMotion(dt: number): void {
    const m = this.config.motion;
    for (let b = 0; b < 4; b++) {
      this.bandPhase[b] = (this.bandPhase[b] + 2 * Math.PI * m.speed * Math.pow(m.spread, b) * dt) % (2 * Math.PI);
    }
  }

  private computeZ(): Float32Array {
    const z = new Float32Array(Z_DIM);
    const m = this.config.motion;
    const bands = Math.max(1, Math.min(4, Math.round(m.bands)));
    const dimsPerBand = Math.ceil(Z_DIM / bands);
    const zs = this.config.zScale ?? 1;
    for (let d = 0; d < Z_DIM; d++) {
      const b   = Math.min(Math.floor(d / dimsPerBand), bands - 1);
      const amp = m.depth * Math.pow(m.falloff, b);
      z[d] = (amp * Math.sin(this.bandPhase[b] + this.dimOffsets[d]) + this.latentOffset[d]) * zs;
    }
    return z;
  }

  // Compute the capped backing size first and assign only when it changes.
  // Writing canvas.width/height reallocates the swapchain, so doing it
  // every frame (display size, then capped size) was two reallocations per tick.
  private _resizeCanvas(canvas: HTMLCanvasElement): void {
    const dpr = window.devicePixelRatio || 1;
    let w = Math.floor(canvas.clientWidth  * dpr);
    let h = Math.floor(canvas.clientHeight * dpr);
    if (this.maxResolution > 0) {
      const longest = Math.max(w, h);
      if (longest > this.maxResolution) {
        const scale = this.maxResolution / longest;
        w = Math.floor(w * scale);
        h = Math.floor(h * scale);
      }
    }
    // after the cap: on phones the cap already binds, so scaling before it did nothing
    if (this.renderScale < 1) { w = Math.max(1, Math.floor(w * this.renderScale)); h = Math.max(1, Math.floor(h * this.renderScale)); }
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width  = w;
      canvas.height = h;
    }
  }

  private tick = (): void => {
    if (!this.running || !this.gpu) return;
    if (!this.pipeline || !this.bindGroup) {   // first compile still pending: keep the loop alive
      this.usingRaf = true;
      this.animId = requestAnimationFrame(this.tick);
      return;
    }
    // While a recompile is pending the weight buffer already holds the new
    // layout, which the old pipeline would misread: present nothing new and
    // the canvas keeps the last good frame until the pipeline is bound.
    if (this.compiledArch !== this.archKey()) {
      this.usingRaf = true;
      this.animId = requestAnimationFrame(this.tick);
      return;
    }
    const frameStart = performance.now();
    const { device, canvas } = this.gpu;
    this._resizeCanvas(canvas);

    const now = performance.now();
    const dt = this.lastTick ? Math.min(0.1, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    if (this.animate && !this.motionHeld && !this.paused) this.advanceMotion(dt);
    if (!this.paused) this.exprClock += dt;   // expression time (t), pauses with ⏸
    // Draw only when the frame would differ: the canvas keeps showing the last
    // one. Everything the image depends on is in the uniforms or a buffer upload.
    const params = this._packParams((now - this.startTime) / 1000);
    let drew = false;
    if (this._frameChanged(params)) {
      this._submit(params);
      this.tickCount++;   // frames actually drawn: the fps readout drops to 0 when idle
      drew = true;
      const sent = performance.now();
      void device.queue.onSubmittedWorkDone().then(() => {
        const ms = performance.now() - sent;
        this.gpuMs = this.gpuMs ? this.gpuMs * 0.8 + ms * 0.2 : ms;
      });
      this._adaptScale(now);
    }
    if (Number.isFinite(this.maxFps)) {
      // Capped mode: wait for the GPU so the cap measures real frame time.
      this.usingRaf = false;
      void device.queue.onSubmittedWorkDone().then(() => {
        if (!this.running) return;
        const remaining = Math.max(0, 1000 / this.maxFps - (performance.now() - frameStart));
        this.animId = window.setTimeout(this.tick, remaining) as unknown as number;
      });
    } else if (drew && this.gpuMs > SLOW_FRAME_MS) {
      // Slow shader: one frame in flight at a time. Queuing a new heavy frame
      // every rAF keeps the GPU saturated, and the page's own compositing
      // (panel, scrolling, the capsule) waits behind it — the UI then runs at
      // the shader's frame rate. Waiting for the GPU before the next rAF
      // leaves it gaps to composite the UI in.
      this.usingRaf = false;
      void device.queue.onSubmittedWorkDone().then(() => {
        if (!this.running) return;
        this.usingRaf = true;
        this.animId = requestAnimationFrame(this.tick);
      });
    } else {
      // Fast shader: let the browser pipeline CPU and GPU work. Waiting on a
      // GPU fence here quantised the frame rate to vsync divisors.
      this.usingRaf = true;
      this.animId = requestAnimationFrame(this.tick);
    }
  };

  /** Lower the backing resolution while frames take longer than ~30 fps
   *  allows, raise it back when they are cheap again. Stepped and spaced out
   *  (a resize reallocates the swapchain), with a gap between the two
   *  thresholds so it does not oscillate. */
  private _adaptScale(now: number): void {
    if (now - this.lastScaleCheck < 600) return;
    this.lastScaleCheck = now;
    if (!this.adaptiveResolution) { this.renderScale = 1; return; }
    if (this.gpuMs > 30 && this.renderScale > MIN_RENDER_SCALE) {
      this.renderScale = Math.max(MIN_RENDER_SCALE, this.renderScale * 0.8);
    } else if (this.gpuMs < 12 && this.renderScale < 1) {
      this.renderScale = Math.min(1, this.renderScale * 1.15);
    }
  }

  /**
   * Reproducible still for /admin/og: an exact backing size, per-dimension
   * phase offsets from `motionSeed`, and the latent motion evaluated at
   * `time` seconds from phase 0. Draws synchronously, so the caller can copy
   * the canvas in the same task. Call after loadPreset/setState has resolved.
   */
  renderStill(opts: { width: number; height: number; time?: number; motionSeed?: number }): void {
    if (!this.gpu || !this.pipeline || !this.bindGroup) return;
    const { canvas } = this.gpu;
    if (canvas.width !== opts.width) canvas.width = opts.width;
    if (canvas.height !== opts.height) canvas.height = opts.height;
    const rand = makePRNG((opts.motionSeed ?? 0) >>> 0);
    for (let i = 0; i < Z_DIM; i++) this.dimOffsets[i] = rand() * 2 * Math.PI;
    const m = this.config.motion;
    const time = opts.time ?? 0;
    for (let b = 0; b < 4; b++) {
      this.bandPhase[b] = (2 * Math.PI * m.speed * Math.pow(m.spread, b) * time) % (2 * Math.PI);
    }
    this._draw(time);
    this.invalidate();   // the loop's next frame must not be skipped as "unchanged"
  }

  private _draw(t: number): void { this._submit(this._packParams(t)); }

  /** Bumped on every weight / program upload; part of the "did anything change" check. */
  private gpuDataVersion = 0;
  private lastFrame: Float32Array | null = null;
  private lastFrameKey = '';
  private lastBindGroup: GPUBindGroup | null = null;

  private _frameChanged(params: Float32Array): boolean {
    // the expression clock and pointer matter only to inputs that read them
    const usesT = this.config.inputs.some(src => /\bt\b/.test(src));
    const usesP = this.config.inputs.some(src => /\b(px|py)\b/.test(src));
    const cmp = params.slice();
    cmp[2] = 0;                                              // wall time: not read by the shader
    if (!usesT) cmp[INPUTS_OFFSET + 1] = 0;
    if (!usesP) { cmp[POINTER_OFFSET] = 0; cmp[POINTER_OFFSET + 1] = 0; }
    const key = `${this.gpuDataVersion}`;
    const same = this.lastFrame !== null && key === this.lastFrameKey && this.bindGroup === this.lastBindGroup
      && cmp.length === this.lastFrame.length && cmp.every((v, i) => Object.is(v, this.lastFrame![i]));
    if (same) return false;
    this.lastFrame = cmp; this.lastFrameKey = key; this.lastBindGroup = this.bindGroup;
    return true;
  }

  /** Force the next tick to draw (e.g. the canvas was cleared from outside). */
  invalidate(): void { this.lastFrame = null; }

  private _packParams(t: number): Float32Array {
    const { canvas } = this.gpu!;
    const z = this.computeZ();

    const params = new Float32Array(PARAMS_FLOATS);
    params[0] = canvas.width;
    params[1] = canvas.height;
    params[2] = t;
    params[3] = this.config.scale;
    params.set(z, 4);
    const acts = new Uint32Array(params.buffer, ACTS_OFFSET * 4, 8);
    this.config.layers.slice(0, 8).forEach((l, i) => { acts[i] = Math.max(0, ACTIVATION_IDS.indexOf(l.activation)); });
    // The centre goes up as hi + lo f32 pairs (x: view.x + view.w, y: view.y + viewLoY):
    // a single f32 centre snaps by one ulp at a time, which deep in a zoom
    // shifts the whole image by several pixels at once while panning.
    const hx = Math.fround(this.viewCx), hy = Math.fround(this.viewCy);
    params[VIEW_OFFSET] = hx;
    params[VIEW_OFFSET + 1] = hy;
    params[VIEW_OFFSET + 2] = this.viewZoom;
    params[VIEW_OFFSET + 3] = this.viewCx - hx;
    params[INPUTS_OFFSET + 3] = this.viewCy - hy;
    const u32 = new Uint32Array(params.buffer, INPUTS_OFFSET * 4, 4);
    u32[0] = this.config.inputs.length;
    params[INPUTS_OFFSET + 1] = 2 * Math.PI * ((this.exprClock % EXPR_PERIOD_S) / EXPR_PERIOD_S);
    u32[2] = this.config.normalizeInputs ? 1 : 0;
    params[POINTER_OFFSET] = this.pointer[0];
    params[POINTER_OFFSET + 1] = this.pointer[1];
    params.set(this.norms, NORM_OFFSET);
    return params;
  }

  private _submit(params: Float32Array): void {
    const { device, context } = this.gpu!;
    device.queue.writeBuffer(this.paramsBuffer, 0, params);

    const encoder = device.createCommandEncoder();
    const pass    = encoder.beginRenderPass({
      colorAttachments: [{
        view:       context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp:     'clear',
        storeOp:    'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
}
