// src/components/simulations/cppn/cppn-controller.ts
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { generateShader, computeWeightLayout, packWeights, migrateWeightsFromXYR, legacyWeightCount, Z_DIM, MAX_INPUTS, ACTIVATION_IDS, type WeightLayout } from './cppn-codegen';
import { normalizeConfig, DEFAULT_MOTION, DEFAULT_INPUTS, type CPPNConfig, type CPPNPreset, type LayerConfig, type LegacyCPPNConfig, type MotionLadder, type WeightDistribution } from './cppn-types';
import { tryParse, type ParseError } from './cppn-expr/parser';
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
const INPUTS_OFFSET = VIEW_OFFSET + 4;     // numInputs (u32), exprTime, normFlag (u32), pad
const POINTER_OFFSET = INPUTS_OFFSET + 4;
const NORM_OFFSET   = POINTER_OFFSET + 4;  // 4 × vec4f: (mid, half) pairs, two inputs per vec4

/** The expression clock wraps every 60 s: t = 2π · (clock mod 60) / 60. */
export const EXPR_PERIOD_S = 60;

export type InputCompileResult =
  | { ok: true; range: Range }
  | { ok: false; error: ParseError };

/** f32 runs out of relative precision around here: deeper zooms go blocky. */
export const MAX_ZOOM = 1e4;
export const MIN_ZOOM = 0.02;

// ── PRNG (mulberry32) ─────────────────────────────────────────────
export function makePRNG(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
    motion: { ...DEFAULT_MOTION },
    inputs: [...DEFAULT_INPUTS],
    normalizeInputs: false,
  };
}

// ── Controller ────────────────────────────────────────────────────
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
  private compileChain: Promise<void> = Promise.resolve();
  private compilesInFlight = 0;
  /** Fires with true when a shader compile starts and false when the queue drains (for a spinner). */
  onBusy: ((busy: boolean) => void) | null = null;
  private running   = false;
  private paused    = false;   // ⏸: motion frozen, frames still drawn (zoom/pan/edits stay live)
  private animId    = 0;
  private usingRaf  = true;
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
      await this._ensurePipeline();
      this._uploadWeights();
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
    if (this.pipeline && key === this.compiledArch && this.compilesInFlight === 0) return Promise.resolve();
    // Serialize compiles so a scrub that changes the architecture several
    // times in a row builds pipelines in order and binds the last one.
    this.compilesInFlight++;
    if (this.compilesInFlight === 1) this.onBusy?.(true);
    const run = this.compileChain.then(() => this._compileFor(key));
    this.compileChain = run.catch(() => {});
    return run.finally(() => {
      this.compilesInFlight--;
      if (this.compilesInFlight === 0) this.onBusy?.(false);
    });
  }

  private async _compileFor(key: string): Promise<void> {
    if (!this.gpu || key === this.compiledArch) return;
    if (key !== this.archKey()) return;   // superseded while queued
    const { device, format } = this.gpu;
    const code   = generateShader(this.config, this.layout);
    const module = device.createShaderModule({ code });
    const info   = await module.getCompilationInfo();
    const errs   = info.messages.filter(m => m.type === 'error');
    if (errs.length) {
      throw new Error('CPPN shader error: ' + errs.map(e => e.message).join(', '));
    }
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex:   { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
    });
    if (key !== this.archKey()) return;   // a newer architecture arrived meanwhile
    this.pipeline = pipeline;
    this.compiledArch = key;
    this._rebuildBindGroup();
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
   * measured; a slot that fails to parse keeps its previous program (the
   * canvas never goes black mid-keystroke) and reports the error.
   */
  setInputs(exprs: string[]): InputCompileResult[] {
    const prevCount = this.config.inputs.length;
    const list = exprs.slice(0, MAX_INPUTS);
    if (list.length === 0) list.push('x');
    const results: InputCompileResult[] = [];
    list.forEach((src, i) => {
      const parsed = tryParse(src);
      if ('error' in parsed) { results.push({ ok: false, error: parsed.error }); return; }
      try {
        const prog = compile(parsed.ast);
        const range = measureRange(prog, parsed.ast);
        this.programs[i] = prog;
        this.norms[i * 2] = range.mid;
        this.norms[i * 2 + 1] = range.half;
        results.push({ ok: true, range });
      } catch (e) {
        const err = e as ParseError;
        results.push({ ok: false, error: { msg: err.msg ?? String(e), pos: err.pos ?? 0 } });
      }
    });
    this.config = { ...this.config, inputs: [...list] };
    this.inputResults = results;
    this._uploadPrograms();
    if (list.length > prevCount) this._fillNewInputColumns(prevCount, list.length);
    return results;
  }

  /** Last compile result per input slot. */
  get inputStatus(): readonly InputCompileResult[] { return this.inputResults; }

  setNormalize(on: boolean): void { this.config = { ...this.config, normalizeInputs: on }; }

  private _uploadPrograms(): void {
    if (!this.gpu || !this.progBuffer) return;
    const buf = new Float32Array(MAX_INPUTS * MAX_OPS * 4);
    this.programs.forEach((p, i) => { if (p) buf.set(p.ops, i * MAX_OPS * 4); });
    this.gpu.device.queue.writeBuffer(this.progBuffer, 0, buf);
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
    for (let d = 0; d < Z_DIM; d++) {
      const b   = Math.min(Math.floor(d / dimsPerBand), bands - 1);
      const amp = m.depth * Math.pow(m.falloff, b);
      z[d] = amp * Math.sin(this.bandPhase[b] + this.dimOffsets[d]) + this.latentOffset[d];
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
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width  = w;
      canvas.height = h;
    }
  }

  private tick = (): void => {
    if (!this.running || !this.gpu || !this.pipeline || !this.bindGroup) return;
    // While a recompile is pending the weight buffer already holds the new
    // layout, which the old pipeline would misread: present nothing new and
    // the canvas keeps the last good frame until the pipeline is bound.
    if (this.compiledArch !== this.archKey()) {
      this.usingRaf = true;
      this.animId = requestAnimationFrame(this.tick);
      return;
    }
    const frameStart = performance.now();
    const { device, context, canvas } = this.gpu;
    this._resizeCanvas(canvas);

    const now = performance.now();
    const dt = this.lastTick ? Math.min(0.1, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    if (this.animate && !this.motionHeld && !this.paused) this.advanceMotion(dt);
    if (!this.paused) this.exprClock += dt;
    const t = (now - this.startTime) / 1000;
    const z = this.computeZ();

    const params = new Float32Array(PARAMS_FLOATS);
    params[0] = canvas.width;
    params[1] = canvas.height;
    params[2] = t;
    params[3] = this.config.scale;
    params.set(z, 4);
    const acts = new Uint32Array(params.buffer, ACTS_OFFSET * 4, 8);
    this.config.layers.slice(0, 8).forEach((l, i) => { acts[i] = Math.max(0, ACTIVATION_IDS.indexOf(l.activation)); });
    params[VIEW_OFFSET] = this.viewCx;
    params[VIEW_OFFSET + 1] = this.viewCy;
    params[VIEW_OFFSET + 2] = this.viewZoom;
    const u32 = new Uint32Array(params.buffer, INPUTS_OFFSET * 4, 4);
    u32[0] = this.config.inputs.length;
    params[INPUTS_OFFSET + 1] = 2 * Math.PI * ((this.exprClock % EXPR_PERIOD_S) / EXPR_PERIOD_S);
    u32[2] = this.config.normalizeInputs ? 1 : 0;
    params[POINTER_OFFSET] = this.pointer[0];
    params[POINTER_OFFSET + 1] = this.pointer[1];
    params.set(this.norms, NORM_OFFSET);
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
    this.tickCount++;
    if (Number.isFinite(this.maxFps)) {
      // Capped mode: wait for the GPU so the cap measures real frame time.
      this.usingRaf = false;
      void device.queue.onSubmittedWorkDone().then(() => {
        if (!this.running) return;
        const remaining = Math.max(0, 1000 / this.maxFps - (performance.now() - frameStart));
        this.animId = window.setTimeout(this.tick, remaining) as unknown as number;
      });
    } else {
      // Unlimited: let the browser pipeline CPU and GPU work. Waiting on a
      // GPU fence here quantised the frame rate to vsync divisors.
      this.usingRaf = true;
      this.animId = requestAnimationFrame(this.tick);
    }
  };
}
