// src/components/simulations/field-boids/field-boids-controller.ts
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { resizeCanvasToDisplaySize } from '../../../lib/webgpu/utils';
import commonSrc from './field-common.wgsl?raw';
import depositSrc from './field-deposit.wgsl?raw';
import viewSrc from './field-view.wgsl?raw';
import {
  DEFAULT_FIELD_BOIDS_PARAMS,
  type FieldBoidsParams,
  type FieldBoidsPreset,
} from './field-boids-types';

export type { FieldBoidsParams, FieldBoidsPreset };

export const MAX_PARTICLES = 2_000_000;
const PARAMS_BYTES = 128;
const FIELD_FORMAT: GPUTextureFormat = 'rgba16float';

export class FieldBoidsController {
  private gpu: WebGPUContext | null = null;
  private running = false;
  private animId = 0;
  private lastFrameTime = 0;
  private frame = 0;
  maxFps = Infinity;
  tickCount = 0;

  params: FieldBoidsParams = { ...DEFAULT_FIELD_BOIDS_PARAMS };
  /** Longest side of the field texture, in texels. Applied on next resize. */
  maxFieldSize = 1024;

  private bgColor = { r: 0.039, g: 0.031, b: 0.016, a: 1 };
  private accent = { r: 0.88, g: 0.63, b: 0.25 };
  private themeObserver: MutationObserver | null = null;
  private mouseX = 0;
  private mouseY = 0;
  private mouseActive = false;

  // GPU resources
  private uniformBuffer!: GPUBuffer;
  private particleBuffers: GPUBuffer[] = [];
  private sampler!: GPUSampler;
  private fieldTextures: GPUTexture[] = [];
  private fieldFullViews: GPUTextureView[] = [];       // all mips
  private fieldLevelViews: GPUTextureView[][] = [];    // [tex][level]
  private fieldW = 0;
  private fieldH = 0;
  private mipCount = 1;
  private writeIdx = 0;   // field written this frame; 1 - writeIdx is last frame's

  private depositPipeline!: GPURenderPipeline;
  private depositBindGroups: GPUBindGroup[] = [];      // [particle buffer]
  private viewLayout!: GPUBindGroupLayout;
  private decayPipeline!: GPURenderPipeline;
  private downsamplePipeline!: GPURenderPipeline;
  private fieldPipeline!: GPURenderPipeline;
  private pointPipeline!: GPURenderPipeline;
  private levelBindGroups: GPUBindGroup[][] = [];      // [tex][level] — single-level view
  private fullBindGroups: GPUBindGroup[][] = [];       // [tex][particle buffer] — full view

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      this.gpu = await initWebGPU(canvas);
      if (!this.gpu) return false;
      const { device } = this.gpu;
      this.readTheme();
      this.initThemeObserver();

      this.uniformBuffer = device.createBuffer({
        size: PARAMS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.sampler = device.createSampler({
        magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
        addressModeU: 'repeat', addressModeV: 'repeat',
      });
      for (let i = 0; i < 2; i++) {
        this.particleBuffers.push(device.createBuffer({
          size: MAX_PARTICLES * 16,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }));
      }
      this.createPipelines(device);
      resizeCanvasToDisplaySize(canvas);
      this.createFieldTextures(device, canvas.width || 1, canvas.height || 1);
      this.reset();

      canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        this.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        this.mouseActive = true;
      });
      canvas.addEventListener('mouseleave', () => { this.mouseActive = false; });
      return true;
    } catch (e) {
      console.error('FieldBoidsController init error:', e);
      return false;
    }
  }

  // ── Pipelines ──────────────────────────────────────────────────────
  private createPipelines(device: GPUDevice): void {
    const { format } = this.gpu!;
    const additive: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    };

    // Deposit
    const depositModule = device.createShaderModule({ code: commonSrc + depositSrc });
    this.depositPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: depositModule, entryPoint: 'depositVert' },
      fragment: {
        module: depositModule, entryPoint: 'depositFrag',
        targets: [{ format: FIELD_FORMAT, blend: additive }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.depositBindGroups = this.particleBuffers.map(buf => device.createBindGroup({
      layout: this.depositPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: buf } },
      ],
    }));

    // View passes share one explicit layout so bind groups can be reused
    const viewModule = device.createShaderModule({ code: commonSrc + viewSrc });
    this.viewLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const viewPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.viewLayout] });
    const quad = (entry: string, target: GPUColorTargetState): GPURenderPipeline =>
      device.createRenderPipeline({
        layout: viewPipelineLayout,
        vertex: { module: viewModule, entryPoint: 'quadVert' },
        fragment: { module: viewModule, entryPoint: entry, targets: [target] },
        primitive: { topology: 'triangle-list' },
      });
    this.decayPipeline      = quad('decayFrag',      { format: FIELD_FORMAT });
    this.downsamplePipeline = quad('downsampleFrag', { format: FIELD_FORMAT });
    this.fieldPipeline      = quad('fieldFrag',      { format });
    this.pointPipeline = device.createRenderPipeline({
      layout: viewPipelineLayout,
      vertex: { module: viewModule, entryPoint: 'pointVert' },
      fragment: { module: viewModule, entryPoint: 'pointFrag', targets: [{ format, blend: additive }] },
      primitive: { topology: 'point-list' },
    });
  }

  // ── Field textures ────────────────────────────────────────────────
  private createFieldTextures(device: GPUDevice, canvasW: number, canvasH: number): void {
    this.fieldTextures.forEach(t => t.destroy());
    const longest = Math.max(canvasW, canvasH);
    const scale = this.maxFieldSize / longest;
    this.fieldW = Math.max(16, Math.round(canvasW * scale));
    this.fieldH = Math.max(16, Math.round(canvasH * scale));
    this.mipCount = Math.floor(Math.log2(Math.max(this.fieldW, this.fieldH))) + 1;

    this.fieldTextures = [0, 1].map(() => device.createTexture({
      size: [this.fieldW, this.fieldH],
      format: FIELD_FORMAT,
      mipLevelCount: this.mipCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    }));
    this.fieldFullViews = this.fieldTextures.map(t => t.createView());
    this.fieldLevelViews = this.fieldTextures.map(t =>
      Array.from({ length: this.mipCount }, (_, l) =>
        t.createView({ baseMipLevel: l, mipLevelCount: 1 })));

    const mk = (texView: GPUTextureView, particles: GPUBuffer) => device.createBindGroup({
      layout: this.viewLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: texView },
        { binding: 3, resource: { buffer: particles } },
      ],
    });
    this.levelBindGroups = this.fieldLevelViews.map(views => views.map(v => mk(v, this.particleBuffers[0])));
    this.fullBindGroups = this.fieldFullViews.map(v => this.particleBuffers.map(b => mk(v, b)));
    this.onFieldTexturesCreated(device);
  }

  /** Hook for the compute pass (Task 3) to rebuild its bind groups. */
  protected onFieldTexturesCreated(_device: GPUDevice): void {}

  // ── Presets ───────────────────────────────────────────────────────
  loadPreset(preset: FieldBoidsPreset): void {
    Object.assign(this.params, preset.params);
  }

  capturePreset(name: string): FieldBoidsPreset {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return { id, name, params: { ...this.params } };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────
  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animId);
    clearTimeout(this.animId);
  }

  reset(): void {
    if (!this.gpu) return;
    const { device } = this.gpu;
    const data = new Float32Array(MAX_PARTICLES * 4);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      data[i * 4 + 0] = (Math.random() - 0.5) * 2;
      data[i * 4 + 1] = (Math.random() - 0.5) * 2;
      data[i * 4 + 2] = (Math.random() - 0.5) * 0.1;
      data[i * 4 + 3] = (Math.random() - 0.5) * 0.1;
    }
    device.queue.writeBuffer(this.particleBuffers[0], 0, data);
    device.queue.writeBuffer(this.particleBuffers[1], 0, data);
    this.frame = 0;
  }

  // ── Uniforms ──────────────────────────────────────────────────────
  private packUniforms(aspect: number): ArrayBuffer {
    const buf = new ArrayBuffer(PARAMS_BYTES);
    const v = new DataView(buf);
    const p = this.params;
    v.setFloat32(0,   p.dt, true);
    v.setFloat32(4,   p.attractionRadius, true);
    v.setFloat32(8,   p.repulsionRadius, true);
    v.setFloat32(12,  p.attraction, true);
    v.setFloat32(16,  p.repulsion, true);
    v.setFloat32(20,  p.alignment, true);
    v.setFloat32(24,  p.friction, true);
    v.setFloat32(28,  p.maxSpeed, true);
    v.setUint32(32,   Math.min(p.numParticles, MAX_PARTICLES), true);
    v.setFloat32(36,  this.mouseX, true);
    v.setFloat32(40,  this.mouseY, true);
    v.setFloat32(44,  this.mouseActive ? 1 : 0, true);
    v.setFloat32(48,  p.mouseRadius, true);
    v.setFloat32(52,  p.coneAngle, true);
    v.setFloat32(56,  aspect, true);
    v.setUint32(60,   this.frame, true);
    v.setFloat32(64,  p.noise, true);
    v.setFloat32(68,  p.memory, true);
    v.setFloat32(72,  Math.max(0.5, p.splatSize), true);
    v.setUint32(76,   p.viewMode, true);
    v.setFloat32(80,  p.exposure, true);
    v.setFloat32(84,  this.fieldW, true);
    v.setFloat32(88,  this.fieldH, true);
    v.setFloat32(92,  this.mipCount - 1, true);
    v.setFloat32(96,  this.accent.r, true);
    v.setFloat32(100, this.accent.g, true);
    v.setFloat32(104, this.accent.b, true);
    v.setFloat32(108, this.bgColor.r, true);
    v.setFloat32(112, this.bgColor.g, true);
    v.setFloat32(116, this.bgColor.b, true);
    v.setFloat32(120, p.pointAlpha, true);
    return buf;
  }

  // ── Frame ─────────────────────────────────────────────────────────
  private tick = (): void => {
    if (!this.running || !this.gpu) return;
    if (Number.isFinite(this.maxFps)) {
      const now = performance.now();
      if (now - this.lastFrameTime < (1000 / this.maxFps) - 1) {
        this.animId = requestAnimationFrame(this.tick);
        return;
      }
      this.lastFrameTime = now;
    }
    const { device, context, canvas } = this.gpu;
    if (resizeCanvasToDisplaySize(canvas)) {
      this.createFieldTextures(device, canvas.width, canvas.height);
    }
    const aspect = canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 1;
    device.queue.writeBuffer(this.uniformBuffer, 0, this.packUniforms(aspect));

    const N = Math.min(this.params.numParticles, MAX_PARTICLES);
    const readIdx = this.frame % 2;          // particle buffer holding current state
    const encoder = device.createCommandEncoder();

    this.runDecay(encoder);
    this.runDeposit(encoder, readIdx, N);
    this.runMips(encoder);
    this.runCompute(encoder, readIdx, N);
    this.runDisplay(encoder, context, readIdx, N);

    device.queue.submit([encoder.finish()]);
    this.frame++;
    this.writeIdx = 1 - this.writeIdx;

    void device.queue.onSubmittedWorkDone().then(() => {
      if (!this.running) return;
      this.tickCount++;
      if (!Number.isFinite(this.maxFps)) {
        this.animId = requestAnimationFrame(this.tick);
      } else {
        this.animId = window.setTimeout(this.tick, 0) as unknown as number;
      }
    });
  };

  /** Task 4 fills this in. With memory = 0 the deposit pass clears instead. */
  protected runDecay(_encoder: GPUCommandEncoder): void {}

  /** Task 3 fills this in. */
  protected runCompute(_encoder: GPUCommandEncoder, _readIdx: number, _N: number): void {}

  private runDeposit(encoder: GPUCommandEncoder, readIdx: number, N: number): void {
    const decayed = this.params.memory > 0;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.fieldLevelViews[this.writeIdx][0],
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: decayed ? 'load' : 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.depositPipeline);
    pass.setBindGroup(0, this.depositBindGroups[readIdx]);
    pass.draw(6, N);
    pass.end();
  }

  private runMips(encoder: GPUCommandEncoder): void {
    for (let l = 1; l < this.mipCount; l++) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.fieldLevelViews[this.writeIdx][l],
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this.downsamplePipeline);
      pass.setBindGroup(0, this.levelBindGroups[this.writeIdx][l - 1]);
      pass.draw(6);
      pass.end();
    }
  }

  private runDisplay(encoder: GPUCommandEncoder, context: GPUCanvasContext, readIdx: number, N: number): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: this.bgColor,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    if (this.params.viewMode === 2) {
      pass.setPipeline(this.pointPipeline);
      pass.setBindGroup(0, this.fullBindGroups[this.writeIdx][readIdx]);
      pass.draw(N);
    } else {
      pass.setPipeline(this.fieldPipeline);
      pass.setBindGroup(0, this.fullBindGroups[this.writeIdx][readIdx]);
      pass.draw(6);
    }
    pass.end();
  }

  // ── Theme ─────────────────────────────────────────────────────────
  private readTheme(): void {
    if (typeof document === 'undefined') return;
    const css = getComputedStyle(document.documentElement);
    const bg = parseHex(css.getPropertyValue('--bg-primary'));
    const ac = parseHex(css.getPropertyValue('--accent'));
    if (bg) this.bgColor = { ...bg, a: 1 };
    if (ac) this.accent = ac;
  }

  private initThemeObserver(): void {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    this.themeObserver = new MutationObserver(() => this.readTheme());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
}

function parseHex(raw: string): { r: number; g: number; b: number } | null {
  let hex = raw.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255,
  };
}
