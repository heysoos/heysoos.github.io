// src/components/simulations/nca/nca-controller.ts
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import {
  computeWeightLayout, generateComputeShader, generateRenderShader, generateWeights,
} from './nca-codegen';
import {
  DEFAULT_NCA_CONFIG,
  type NCAConfig, type NCAPreset, type NCAWeightLayout, type BrushOptions,
} from './nca-types';

// Uniform buffer: 12 x f32/u32 = 48 bytes
const UNIFORMS_COUNT = 12;
const UNIFORMS_BYTES = UNIFORMS_COUNT * 4;

// Preallocated staging buffer — reused every frame, no GC pressure
const uniformStaging = new ArrayBuffer(UNIFORMS_BYTES);
const uniformF32 = new Float32Array(uniformStaging);
const uniformU32 = new Uint32Array(uniformStaging);

export class NCAController {
  private gpu: WebGPUContext | null = null;
  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private stateA!: GPUBuffer;
  private stateB!: GPUBuffer;
  private weightBuffer!: GPUBuffer;
  private uniformBuffer!: GPUBuffer;
  private computeBindGroups!: GPUBindGroup[]; // [0] = A→B, [1] = B→A
  private renderBindGroups!: GPUBindGroup[];  // [0] reads A, [1] reads B
  private layout!: NCAWeightLayout;
  private frameIndex = 0;
  private pingPong = 0; // 0 or 1
  private running = false;
  private animId = 0;
  brushOpts: BrushOptions = { mode: 'damage', shape: 'circle', size: 20, strength: 1.0 };
  private brushActive = false;
  private lastBrushX = -1;
  private lastBrushY = -1;
  private currentWeights: Float32Array | null = null;
  private canvas!: HTMLCanvasElement;

  config: NCAConfig = { ...DEFAULT_NCA_CONFIG };

  // ── Init ──────────────────────────────────────────────────────────

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      this.canvas = canvas;
      this.gpu = await initWebGPU(canvas);
      if (!this.gpu) return false;
      this.layout = computeWeightLayout(this.config);
      this.createBuffers();
      this.uniformBuffer = this.gpu.device.createBuffer({
        size: UNIFORMS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.seedGrid();
      const weights = generateWeights(this.config, Date.now());
      this.currentWeights = weights;
      this.gpu.device.queue.writeBuffer(this.weightBuffer, 0, weights);
      await this.buildPipelines();
      this.updateUniforms();
      this.applyCanvasStyle();
      this.setupBrushEvents();
      return true;
    } catch (e) {
      console.error('NCAController init error:', e);
      return false;
    }
  }

  private createBuffers(): void {
    const { device } = this.gpu!;
    const { gridWidth: W, gridHeight: H, channels } = this.config;
    const stateSize = W * H * channels * 4; // f32
    const weightSize = this.layout.totalCount * 4;

    const stateUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    this.stateA = device.createBuffer({ size: stateSize, usage: stateUsage });
    this.stateB = device.createBuffer({ size: stateSize, usage: stateUsage });
    this.weightBuffer = device.createBuffer({
      size: Math.max(weightSize, 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  private seedGrid(): void {
    const { device } = this.gpu!;
    const { gridWidth: W, gridHeight: H, channels, seedMode } = this.config;
    const data = new Float32Array(W * H * channels);
    if (seedMode === 'random') {
      for (let i = 0; i < data.length; i++) data[i] = Math.random();
    } else if (seedMode === 'center') {
      const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
      const r = Math.min(W, H) / 16;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d < r) {
            const base = (y * W + x) * channels;
            for (let c = 0; c < channels; c++) data[base + c] = Math.random();
          }
        }
      }
    }
    // 'blank' → all zeros (already)
    device.queue.writeBuffer(this.stateA, 0, data);
    device.queue.writeBuffer(this.stateB, 0, data);
  }

  private async buildPipelines(): Promise<void> {
    const { device, format } = this.gpu!;

    // Compute pipeline
    const computeModule = device.createShaderModule({ code: generateComputeShader(this.config) });
    this.computePipeline = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: computeModule, entryPoint: 'main' },
    });

    // Render pipeline
    const renderModule = device.createShaderModule({ code: generateRenderShader(this.config) });
    this.renderPipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs' },
      fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
    });

    this.buildBindGroups();
  }

  private buildBindGroups(): void {
    const { device } = this.gpu!;
    const cl = this.computePipeline.getBindGroupLayout(0);
    const rl = this.renderPipeline.getBindGroupLayout(0);

    const makeCompute = (src: GPUBuffer, dst: GPUBuffer) =>
      device.createBindGroup({
        layout: cl,
        entries: [
          { binding: 0, resource: { buffer: src } },
          { binding: 1, resource: { buffer: dst } },
          { binding: 2, resource: { buffer: this.weightBuffer } },
          { binding: 3, resource: { buffer: this.uniformBuffer } },
        ],
      });

    const makeRender = (buf: GPUBuffer) =>
      device.createBindGroup({
        layout: rl,
        entries: [
          { binding: 0, resource: { buffer: buf } },
          { binding: 1, resource: { buffer: this.uniformBuffer } },
        ],
      });

    this.computeBindGroups = [makeCompute(this.stateA, this.stateB), makeCompute(this.stateB, this.stateA)];
    this.renderBindGroups  = [makeRender(this.stateA), makeRender(this.stateB)];
  }

  private updateUniforms(): void {
    const { fireRate, dt, gridWidth, gridHeight, channelR, channelG, channelB, normalizeDisplay } = this.config;
    uniformF32[0] = fireRate;
    uniformF32[1] = dt;
    uniformU32[2] = this.frameIndex;
    uniformU32[3] = gridWidth;
    uniformU32[4] = gridHeight;
    uniformU32[5] = channelR;
    uniformU32[6] = channelG;
    uniformU32[7] = channelB;
    uniformU32[8] = normalizeDisplay ? 1 : 0;
    this.gpu!.device.queue.writeBuffer(this.uniformBuffer, 0, uniformStaging);
  }

  private applyCanvasStyle(): void {
    const { gridWidth: W, gridHeight: H } = this.config;
    // Scale up to fill the viewport while preserving AR — inline styles override
    // the gallery page's `.sim-viewport canvas { width:100%; height:100% }` rule.
    const parent = this.canvas.parentElement;
    const vw = parent ? parent.clientWidth  : window.innerWidth;
    const vh = parent ? parent.clientHeight : window.innerHeight;
    const scale = Math.min(vw / W, vh / H);
    this.canvas.style.width  = `${Math.round(W * scale)}px`;
    this.canvas.style.height = `${Math.round(H * scale)}px`;
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '50%';
    this.canvas.style.left = '50%';
    this.canvas.style.transform = 'translate(-50%, -50%)';
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.style.maxWidth = 'none';
    this.canvas.style.maxHeight = 'none';
  }

  // ── Public API ────────────────────────────────────────────────────

  start(): void { if (this.running) return; this.running = true; this.tick(); }
  stop():  void { this.running = false; cancelAnimationFrame(this.animId); }
  reset(): void { this.frameIndex = 0; this.pingPong = 0; this.seedGrid(); }

  private tick = (): void => {
    if (!this.running || !this.gpu) return;
    const { device, context } = this.gpu;
    const { gridWidth: W, gridHeight: H } = this.config;

    // Set canvas to exact grid size and override CSS stretching
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width  = W;
      this.canvas.height = H;
      this.applyCanvasStyle();
    }

    // Write uniforms ONCE per frame (not per step) — avoids CPU→GPU sync inside the loop
    this.updateUniforms();

    const encoder = device.createCommandEncoder();

    // Encode all stepsPerFrame compute passes in one go — no intermediate submits
    for (let s = 0; s < this.config.stepsPerFrame; s++) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.computePipeline);
      pass.setBindGroup(0, this.computeBindGroups[this.pingPong]);
      pass.dispatchWorkgroups(Math.ceil(W / 16), Math.ceil(H / 16));
      pass.end();
      this.pingPong ^= 1;
    }
    this.frameIndex += this.config.stepsPerFrame;

    // Render pass — read from the most recently written buffer
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroups[this.pingPong]);
    renderPass.draw(6);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    this.animId = requestAnimationFrame(this.tick);
  };

  async recompile(config: NCAConfig): Promise<void> {
    const wasRunning = this.running;
    this.stop();
    this.config = { ...config };
    this.layout = computeWeightLayout(config);
    // Recreate state buffers only if grid size changed
    const { gridWidth: W, gridHeight: H, channels } = config;
    const stateSize = W * H * channels * 4;
    if (this.stateA.size !== stateSize) {
      this.stateA.destroy();
      this.stateB.destroy();
      this.createBuffers();
      this.seedGrid();
      // Re-upload weights after buffer recreation (createBuffers creates a fresh empty weight buffer)
      if (this.currentWeights) {
        const needed = this.layout.totalCount * 4;
        const w = this.currentWeights.byteLength === needed
          ? this.currentWeights
          : generateWeights(this.config, Date.now());
        this.currentWeights = w;
        this.gpu!.device.queue.writeBuffer(this.weightBuffer, 0, w);
      }
    }
    await this.buildPipelines();
    this.updateUniforms();
    if (wasRunning) this.start();
  }

  loadPreset(preset: NCAPreset): void {
    const prev = this.config;
    const next = preset.config;
    const archChanged =
      prev.channels !== next.channels ||
      prev.hidden !== next.hidden ||
      prev.activation !== next.activation ||
      prev.filters.identity !== next.filters.identity ||
      prev.filters.sobelX !== next.filters.sobelX ||
      prev.filters.sobelY !== next.filters.sobelY ||
      prev.filters.laplacian !== next.filters.laplacian ||
      prev.gridWidth !== next.gridWidth ||
      prev.gridHeight !== next.gridHeight;

    this.config = { ...next };
    this.layout = computeWeightLayout(next);

    // Write weights immediately
    const w = new Float32Array(preset.weights);
    if (this.weightBuffer.size < w.byteLength) {
      this.weightBuffer.destroy();
      this.weightBuffer = this.gpu!.device.createBuffer({
        size: w.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }
    this.gpu!.device.queue.writeBuffer(this.weightBuffer, 0, w);
    this.currentWeights = w;

    if (archChanged) {
      void this.recompile(next).then(() => {
        this.gpu!.device.queue.writeBuffer(this.weightBuffer, 0, w); // re-write after recompile
      });
    } else {
      this.updateUniforms();
    }
  }

  randomInit(): void {
    const weights = generateWeights(this.config, Date.now());
    this.currentWeights = weights;
    const needed = weights.byteLength;
    if (this.weightBuffer.size < needed) {
      this.weightBuffer.destroy();
      this.weightBuffer = this.gpu!.device.createBuffer({
        size: needed,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.buildBindGroups();
    }
    this.gpu!.device.queue.writeBuffer(this.weightBuffer, 0, weights);
    this.reset();
  }

  setParams(partial: Partial<NCAConfig>): void {
    const archKeys: (keyof NCAConfig)[] = ['channels', 'hidden', 'activation', 'gridWidth', 'gridHeight'];
    const filterKeys = ['identity', 'sobelX', 'sobelY', 'laplacian'] as const;

    const needsRecompile =
      archKeys.some(k => k in partial && (partial as any)[k] !== (this.config as any)[k]) ||
      (partial.filters !== undefined &&
        filterKeys.some(k => partial.filters![k] !== this.config.filters[k]));

    Object.assign(this.config, partial);
    if (partial.filters) this.config.filters = { ...this.config.filters, ...partial.filters };

    if (needsRecompile) {
      void this.recompile(this.config);
    } else {
      this.updateUniforms();
    }
  }

  getCurrentWeights(): Float32Array | null {
    return this.currentWeights;
  }

  brush(gx: number, gy: number, opts: BrushOptions): void {
    if (!this.gpu) return;
    const { device } = this.gpu;
    const { gridWidth: W, gridHeight: H, channels } = this.config;
    const r = Math.floor(opts.size / 2);
    const cell = new Float32Array(channels);

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (opts.shape === 'circle' && dx * dx + dy * dy > r * r) continue;
        const x = ((gx + dx) % W + W) % W;
        const y = ((gy + dy) % H + H) % H;
        const idx = (y * W + x) * channels;
        if (opts.mode === 'damage') {
          cell.fill(0);
        } else {
          for (let c = 0; c < channels; c++) cell[c] = Math.random() * opts.strength;
        }
        // Write to both buffers so the next read is consistent
        device.queue.writeBuffer(this.stateA, idx * 4, cell);
        device.queue.writeBuffer(this.stateB, idx * 4, cell);
      }
    }
  }

  private setupBrushEvents(): void {
    const toGrid = (e: MouseEvent): [number, number] => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.config.gridWidth  / rect.width;
      const scaleY = this.config.gridHeight / rect.height;
      return [
        Math.floor((e.clientX - rect.left) * scaleX),
        Math.floor((e.clientY - rect.top)  * scaleY),
      ];
    };

    this.canvas.addEventListener('mousedown', (e) => {
      this.brushActive = true;
      const [x, y] = toGrid(e);
      this.lastBrushX = x; this.lastBrushY = y;
      this.brush(x, y, this.brushOpts);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.brushActive) return;
      const [x, y] = toGrid(e);
      if (x === this.lastBrushX && y === this.lastBrushY) return;
      this.lastBrushX = x; this.lastBrushY = y;
      this.brush(x, y, this.brushOpts);
    });

    window.addEventListener('mouseup', () => { this.brushActive = false; });

    // Rescale canvas when the viewport is resized
    const ro = new ResizeObserver(() => this.applyCanvasStyle());
    ro.observe(this.canvas.parentElement ?? document.body);
  }
}
