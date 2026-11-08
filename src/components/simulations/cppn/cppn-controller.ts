// src/components/simulations/cppn/cppn-controller.ts
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { generateShader, computeWeightLayout, packWeights, Z_DIM, type WeightLayout } from './cppn-codegen';
import type { CPPNConfig, CPPNPreset, LayerConfig, WeightDistribution, ZBand } from './cppn-types';

export type { CPPNConfig, CPPNPreset, LayerConfig, WeightDistribution, ZBand };
export type { Activation, DistributionType } from './cppn-types';

// Params uniform: [resX, resY, time, scale, z0..z15] = 20 f32 = 80 bytes
const PARAMS_FLOATS = 4 + Z_DIM;
const PARAMS_BYTES  = PARAMS_FLOATS * 4;

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
export function generateWeights(
  layout: WeightLayout,
  config: CPPNConfig,
  seed: number,
): Float32Array {
  const rand    = makePRNG(seed);
  const weights = new Float32Array(layout.totalCount);
  const dist    = config.distribution;
  const { layers } = config;

  function sample(fanIn: number, fanOut: number): number {
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
  }

  const w0 = layers[0].width;
  for (let i = 0; i < w0; i++) weights[layout.wxOffset + i] = sample(1, w0);
  for (let i = 0; i < w0; i++) weights[layout.wyOffset + i] = sample(1, w0);
  for (let i = 0; i < w0; i++) weights[layout.wrOffset + i] = sample(1, w0);
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
    numBands: 4,
    zBands: [
      { freq: 0.2, amplitude: 1.0, phase: 0.0 },
      { freq: 0.5, amplitude: 0.8, phase: 1.0 },
      { freq: 0.9, amplitude: 0.6, phase: 2.1 },
      { freq: 1.5, amplitude: 0.4, phase: 3.7 },
    ],
    scale: 1.0,
  };
}

// ── Controller ────────────────────────────────────────────────────
export class CPPNController {
  private gpu:           WebGPUContext | null = null;
  private pipeline:      GPURenderPipeline | null = null;
  private paramsBuffer!: GPUBuffer;
  private weightBuffer:  GPUBuffer | null = null;
  private bindGroup!:    GPUBindGroup;
  private layout!:        WeightLayout;
  private compiledArch   = ''; // architecture key the current pipeline was built for
  private running   = false;
  private animId    = 0;
  private usingRaf  = true;
  maxFps    = Infinity;
  tickCount = 0;
  private animate   = true;
  private startTime = performance.now();
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
      this.randomizeDimOffsets();
      this.layout = computeWeightLayout(this.config);
      this.currentWeights = generateWeights(this.layout, this.config, this.seed);
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
  private archKey(): string {
    return this.config.layers.map(l => `${l.width}:${l.activation}`).join(',');
  }

  private async _ensurePipeline(): Promise<void> {
    if (!this.gpu) return;
    const key = this.archKey();
    if (this.pipeline && key === this.compiledArch) return;
    const { device, format } = this.gpu;

    const code   = generateShader(this.config, this.layout);
    const module = device.createShaderModule({ code });
    const info   = await module.getCompilationInfo();
    const errs   = info.messages.filter(m => m.type === 'error');
    if (errs.length) {
      throw new Error('CPPN shader error: ' + errs.map(e => e.message).join('\n'));
    }

    this.pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex:   { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
    });
    this.compiledArch = key;
    this._rebuildBindGroup();
  }

  private _rebuildBindGroup(): void {
    if (!this.gpu || !this.pipeline || !this.weightBuffer) return;
    this.bindGroup = this.gpu.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this.weightBuffer } },
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
    this.config = { ...this.config, layers };
    this.layout = computeWeightLayout(this.config);
    this.currentWeights = generateWeights(this.layout, this.config, this.seed);
    await this._ensurePipeline();
    this._uploadWeights();
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

  // ── Z bands ───────────────────────────────────────────────────
  setZBand(index: number, patch: Partial<ZBand>): void {
    const bands = this.config.zBands.map((b, i) => i === index ? { ...b, ...patch } : b);
    this.config = { ...this.config, zBands: bands };
  }

  setNumBands(n: number): void {
    const bands: ZBand[] = Array.from({ length: n }, (_, i) =>
      this.config.zBands[i] ?? { freq: 0.2 * (i + 1), amplitude: 1.0, phase: 0 }
    );
    this.config = { ...this.config, numBands: n, zBands: bands };
  }

  randomizeDimOffsets(): void {
    const rand = makePRNG(Date.now() & 0xffffffff);
    for (let i = 0; i < Z_DIM; i++) this.dimOffsets[i] = rand() * 2 * Math.PI;
  }

  setAnimate(on: boolean): void { this.animate = on; }
  get isAnimating(): boolean { return this.animate; }

  /** Audio hookup: call each frame with FFT band energy */
  setZBandAmplitude(bandIndex: number, amplitude: number): void {
    this.setZBand(bandIndex, { amplitude });
  }

  // ── Presets ───────────────────────────────────────────────────
  async loadPreset(preset: CPPNPreset): Promise<void> {
    await this.setState(preset.config, preset.seed, preset.weights);
  }

  /**
   * Replace config + seed (+ optional exact weights) in one step. Recompiles
   * only if the architecture changed; otherwise just uploads weights. When
   * `weights` is absent or the wrong length they are regenerated from seed.
   */
  async setState(config: CPPNConfig, seed: number, weights?: ArrayLike<number>): Promise<void> {
    this.config = JSON.parse(JSON.stringify(config));
    this.seed   = seed >>> 0;
    this.layout = computeWeightLayout(this.config);
    this.currentWeights = weights && weights.length === this.layout.totalCount
      ? Float32Array.from(weights)
      : generateWeights(this.layout, this.config, this.seed);
    await this._ensurePipeline();
    this._uploadWeights();
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
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────
  start(): void {
    if (this.running) return;
    this.running  = true;
    this.startTime = performance.now();
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.usingRaf) cancelAnimationFrame(this.animId);
    else clearTimeout(this.animId);
  }

  reset(): void {
    this.randomizeDimOffsets();
    this.randomizeWeights(Date.now() & 0xffffffff);
  }

  // ── Render loop ───────────────────────────────────────────────
  private computeZ(t: number): Float32Array {
    const z = new Float32Array(Z_DIM);
    const { zBands, numBands } = this.config;
    const dimsPerBand = Math.ceil(Z_DIM / numBands);
    for (let d = 0; d < Z_DIM; d++) {
      const b    = Math.min(Math.floor(d / dimsPerBand), numBands - 1);
      const band = zBands[b];
      if (!band) continue;
      z[d] = band.amplitude * Math.sin(
        2 * Math.PI * band.freq * t + band.phase + this.dimOffsets[d]
      );
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
    const frameStart = performance.now();
    const { device, context, canvas } = this.gpu;
    this._resizeCanvas(canvas);

    const t = this.animate ? (performance.now() - this.startTime) / 1000 : 0;
    const z = this.computeZ(t);

    const params = new Float32Array(PARAMS_FLOATS);
    params[0] = canvas.width;
    params[1] = canvas.height;
    params[2] = t;
    params[3] = this.config.scale;
    params.set(z, 4);
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
