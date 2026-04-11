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
      this.gpu.device.queue.writeBuffer(this.weightBuffer, 0, weights);
      await this.buildPipelines();
      this.updateUniforms();
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
    const u = new ArrayBuffer(UNIFORMS_BYTES);
    const f = new Float32Array(u);
    const i = new Uint32Array(u);
    f[0] = fireRate;
    f[1] = dt;
    i[2] = this.frameIndex;
    i[3] = gridWidth;
    i[4] = gridHeight;
    i[5] = channelR;
    i[6] = channelG;
    i[7] = channelB;
    i[8] = normalizeDisplay ? 1 : 0;
    this.gpu!.device.queue.writeBuffer(this.uniformBuffer, 0, u);
  }

  // ── Public API ────────────────────────────────────────────────────

  start(): void { if (this.running) return; this.running = true; this.tick(); }
  stop():  void { this.running = false; cancelAnimationFrame(this.animId); }
  reset(): void { this.frameIndex = 0; this.pingPong = 0; this.seedGrid(); }

  private tick = (): void => {
    if (!this.running || !this.gpu) return;
    const { device, context } = this.gpu;
    const { gridWidth: W, gridHeight: H } = this.config;

    // Resize canvas to grid size (pixelated CSS scaling handles display)
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width  = W;
      this.canvas.height = H;
    }

    const encoder = device.createCommandEncoder();

    // Run stepsPerFrame compute passes (ping-pong)
    for (let s = 0; s < this.config.stepsPerFrame; s++) {
      // Update frameIndex uniform before each step
      const iu = new Uint32Array([this.frameIndex]);
      device.queue.writeBuffer(this.uniformBuffer, 8, iu); // offset 8 = frameIndex (u32 at index 2)

      const pass = encoder.beginComputePass();
      pass.setPipeline(this.computePipeline);
      pass.setBindGroup(0, this.computeBindGroups[this.pingPong]);
      pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
      pass.end();

      this.pingPong ^= 1;
      this.frameIndex++;
    }

    // Render pass — read from the most recently written buffer
    const readBuf = this.pingPong; // after ping-pong flips, pingPong points to the last output
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroups[readBuf]);
    renderPass.draw(6);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    this.animId = requestAnimationFrame(this.tick);
  };

  // placeholder — implemented in Task 5
  async recompile(_config: NCAConfig): Promise<void> {}
  loadPreset(_preset: NCAPreset): void {}
  randomInit(): void {}
  setParams(_partial: Partial<NCAConfig>): void {}

  // placeholder — implemented in Task 6
  brush(_x: number, _y: number, _opts: BrushOptions): void {}
  private setupBrushEvents(): void {}
}
