// src/components/simulations/field-boids/field-boids-controller.ts
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { resizeCanvasToDisplaySize } from '../../../lib/webgpu/utils';
import { rng } from '../../../lib/webgpu/prng';
import commonSrc from './field-common.wgsl?raw';
import depositSrc from './field-deposit.wgsl?raw';
import viewSrc from './field-view.wgsl?raw';
import postSrc from './field-post.wgsl?raw';
import computeSrc from './field-boids.wgsl?raw';
import {
  DEFAULT_FIELD_BOIDS_PARAMS,
  type FieldBoidsParams,
  type FieldBoidsPreset,
} from './field-boids-types';

export type { FieldBoidsParams, FieldBoidsPreset };

export const MAX_PARTICLES = 2_000_000;
const PARAMS_BYTES = 320;
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;
const wrap1 = (v: number): number => v - Math.floor((v + 1) * 0.5) * 2;
const MAX_POINTERS = 4;
const FIELD_FORMAT: GPUTextureFormat = 'rgba16float';

export class FieldBoidsController {
  private gpu: WebGPUContext | null = null;
  private running = false;
  /** Physics off, display on: zoom, pan and Look changes still redraw. */
  paused = false;
  private animId = 0;
  private lastFrameTime = 0;
  private frame = 0;
  private inFlight = 0;   // submitted-but-unfinished frames; capped so CPU and GPU overlap
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
  /** Active fingers / mouse on the canvas, NDC. Velocity is an EMA of the
   *  per-frame motion (NDC per second), updated in packUniforms. */
  private pointers = new Map<number, { x: number; y: number; px: number; py: number; vx: number; vy: number; strength: number; type: string; clientX: number; clientY: number; sx: number; sy: number; pan: boolean }>();
  /** Two-finger gesture (pinch zoom + pan) in progress: last midpoint / distance in screen NDC. */
  private gesture: { mx: number; my: number; d: number } | null = null;
  private spaceHeld = false;
  /** View: zoom about a world-space centre. 1 = the whole torus; pans wrap. */
  viewZoom = 1;
  viewCx = 0;
  viewCy = 0;
  /** Zoom by `factor` keeping the world point under screen NDC (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const z0 = this.viewZoom;
    const z1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z0 * factor));
    if (z1 === z0) return;
    const wx = this.viewCx + sx / z0, wy = this.viewCy + sy / z0;
    this.viewZoom = z1;
    this.viewCx = wrap1(wx - sx / z1);
    this.viewCy = wrap1(wy - sy / z1);
  }
  /** Pan by a screen-NDC delta (the content follows the pointer). */
  panBy(dsx: number, dsy: number): void {
    this.viewCx = wrap1(this.viewCx - dsx / this.viewZoom);
    this.viewCy = wrap1(this.viewCy - dsy / this.viewZoom);
  }
  resetView(): void { this.viewZoom = 1; this.viewCx = 0; this.viewCy = 0; }
  /** Force radius in canvas CSS px (mouseRadius is in NDC, y in [-1, 1]). */
  pointerRadiusPx(): number {
    const c = this.gpu?.canvas;
    return (c ? c.clientHeight : 0) * 0.5 * this.params.mouseRadius;
  }
  /** Page hook for touch feedback: called whenever the pointer set changes. */
  onPointers?: (pts: Array<{ id: number; clientX: number; clientY: number; strength: number; type: string }>) => void;
  /** Unit direction gravity pulls toward, screen space with y up. Straight
   *  down unless a tilt sensor steers it. Not a preset param. */
  private gravityX = 0;
  private gravityY = -1;
  /** Gravity acceleration. A device setting (phone tilt companion), not a
   *  preset param: presets never carry it and Randomize never touches it. */
  gravity = 0;

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
  // Display: field → linear colour into a canvas-sized accumulation target, then tonemap.
  private postLayout!: GPUBindGroupLayout;
  private basePipeline!: GPURenderPipeline;
  private postPipeline!: GPURenderPipeline;
  private accumTextures: GPUTexture[] = [];
  private accumViews: GPUTextureView[] = [];
  private baseBindGroups: GPUBindGroup[][] = [];       // [field tex][prev accum]
  private postBindGroups: GPUBindGroup[] = [];         // [accum]
  private accumIdx = 0;
  private levelBindGroups: GPUBindGroup[][] = [];      // [tex][level] — single-level view
  private fullBindGroups: GPUBindGroup[][] = [];       // [tex][particle buffer] — full view
  private computePipeline!: GPUComputePipeline;
  private computeBindGroups: GPUBindGroup[][] = [];    // [field tex][read particle buffer]

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

      // Pointer events cover mouse and touch alike: a finger drag drives the
      // force and lifting it (or a cancelled touch when the page scrolls)
      // releases it. mouseleave alone left the force stuck on after a tap.
      // Several fingers at once; each is captured so a drag that leaves the
      // canvas keeps steering. Pressure (where the digitiser reports it)
      // scales the force: a light touch gathers gently, a press pulls hard.
      // Force pointers only: pan pointers and two-finger gestures drive the view, not the sim.
      const emit = () => this.onPointers?.(this.gesture ? [] : [...this.pointers].filter(([, p]) => !p.pan).map(([id, p]) => ({ id, clientX: p.clientX, clientY: p.clientY, strength: p.strength, type: p.type })));
      const toScreen = (e: PointerEvent): [number, number] => {
        const rect = canvas.getBoundingClientRect();
        return [((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1)];
      };
      const toWorld = (sx: number, sy: number): [number, number] =>
        [wrap1(this.viewCx + sx / this.viewZoom), wrap1(this.viewCy + sy / this.viewZoom)];
      const touches = () => [...this.pointers.values()].filter(p => p.type !== 'mouse');
      const gestureFrom = (a: { sx: number; sy: number }, b: { sx: number; sy: number }) =>
        ({ mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2, d: Math.max(1e-3, Math.hypot(a.sx - b.sx, a.sy - b.sy)) });
      const setPointer = (e: PointerEvent) => {
        if (e.type === 'pointermove' && !this.pointers.has(e.pointerId)) return;   // hover without a button
        if (e.type === 'pointerdown' && this.pointers.size >= MAX_POINTERS) return;
        const [sx, sy] = toScreen(e);
        const cur = this.pointers.get(e.pointerId);
        if (!cur) {
          const [x, y] = toWorld(sx, sy);
          // Space, alt (Photoshop-style) or the middle button turns a mouse drag into a pan.
          const pan = e.pointerType === 'mouse' && (this.spaceHeld || e.altKey || e.button === 1);
          this.pointers.set(e.pointerId, { x, y, px: x, py: y, vx: 0, vy: 0, strength: 1, type: e.pointerType, clientX: e.clientX, clientY: e.clientY, sx, sy, pan });
          try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
          if (pan) e.preventDefault();
          const t = touches();
          if (t.length >= 2) { this.gesture = gestureFrom(t[0], t[1]); this.mouseActive = false; }
          emit();
          return;
        }
        if (cur.pan) {                                   // desktop pan
          this.panBy(sx - cur.sx, sy - cur.sy);
          cur.sx = sx; cur.sy = sy; cur.clientX = e.clientX; cur.clientY = e.clientY;
          return;
        }
        cur.sx = sx; cur.sy = sy; cur.clientX = e.clientX; cur.clientY = e.clientY;
        if (this.gesture) {                              // pinch zoom + two-finger pan
          const t = touches();
          if (t.length >= 2) {
            const g = gestureFrom(t[0], t[1]);
            this.zoomAt(g.d / this.gesture.d, g.mx, g.my);
            this.panBy(g.mx - this.gesture.mx, g.my - this.gesture.my);
            this.gesture = g;
          }
          return;
        }
        const [x, y] = toWorld(sx, sy);
        cur.x = x; cur.y = y;
        this.mouseX = x; this.mouseY = y; this.mouseActive = true;
        emit();
      };
      const clearPointer = (e: PointerEvent) => {
        if (!this.pointers.delete(e.pointerId)) return;
        const t = touches();
        if (this.gesture && t.length < 2) {
          // Back to one finger: it resumes as a force without a velocity jump.
          this.gesture = null;
          for (const p of t) { const [x, y] = toWorld(p.sx, p.sy); p.x = p.px = x; p.y = p.py = y; p.vx = p.vy = 0; }
        }
        this.mouseActive = !this.gesture && [...this.pointers.values()].some(p => !p.pan);
        emit();
      };
      // Wheel zooms about the cursor; space held makes a drag pan (see setPointer).
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const [sx, sy] = toScreen(e as unknown as PointerEvent);
        this.zoomAt(Math.exp(-e.deltaY * 0.0015), sx, sy);
      }, { passive: false });
      const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      // Space is a modifier here, never a page scroll or a button press.
      window.addEventListener('keydown', (e) => {
        if (e.code !== 'Space' || isTyping(e.target)) return;
        e.preventDefault();
        if (e.repeat) return;
        this.spaceHeld = true; canvas.style.cursor = 'grab';
      });
      window.addEventListener('keyup', (e) => {
        if (e.code !== 'Space' || isTyping(e.target)) return;
        e.preventDefault();
        this.spaceHeld = false; canvas.style.cursor = '';
      });
      canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
      canvas.addEventListener('pointerdown', setPointer);
      canvas.addEventListener('pointermove', setPointer);
      canvas.addEventListener('pointerup', clearPointer);
      canvas.addEventListener('pointercancel', clearPointer);
      canvas.addEventListener('lostpointercapture', clearPointer);
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
    // Points draw additively into the accumulation target, so they tonemap
    // and long-expose like the field view.
    this.pointPipeline = device.createRenderPipeline({
      layout: viewPipelineLayout,
      vertex: { module: viewModule, entryPoint: 'pointVert' },
      fragment: { module: viewModule, entryPoint: 'pointFrag', targets: [{ format: FIELD_FORMAT, blend: additive }] },
      primitive: { topology: 'triangle-list' },
    });

    const postModule = device.createShaderModule({ code: commonSrc + postSrc });
    this.postLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
    const postPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.postLayout] });
    const postQuad = (entry: string, target: GPUColorTargetState): GPURenderPipeline =>
      device.createRenderPipeline({
        layout: postPipelineLayout,
        vertex: { module: postModule, entryPoint: 'postQuadVert' },
        fragment: { module: postModule, entryPoint: entry, targets: [target] },
        primitive: { topology: 'triangle-list' },
      });
    this.basePipeline = postQuad('baseFrag', { format: FIELD_FORMAT });
    this.postPipeline = postQuad('postFrag', { format });

    const computeModule = device.createShaderModule({ code: commonSrc + computeSrc });
    this.computePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: computeModule, entryPoint: 'computeMain' },
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

    // Accumulation targets at canvas resolution (the field is capped at maxFieldSize).
    this.accumTextures.forEach(t => t.destroy());
    this.accumTextures = [0, 1].map(() => device.createTexture({
      size: [Math.max(1, canvasW), Math.max(1, canvasH)],
      format: FIELD_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    }));
    this.accumViews = this.accumTextures.map(t => t.createView());
    const mkPost = (fieldView: GPUTextureView, accumView: GPUTextureView) => device.createBindGroup({
      layout: this.postLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: fieldView },
        { binding: 3, resource: accumView },
      ],
    });
    this.baseBindGroups = this.fieldFullViews.map(fv => this.accumViews.map(av => mkPost(fv, av)));
    this.postBindGroups = this.accumViews.map(av => mkPost(this.fieldFullViews[0], av));
    this.onFieldTexturesCreated(device);
  }

  private onFieldTexturesCreated(device: GPUDevice): void {
    this.computeBindGroups = this.fieldFullViews.map(view =>
      [0, 1].map(readIdx => device.createBindGroup({
        layout: this.computePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.particleBuffers[readIdx] } },
          { binding: 2, resource: { buffer: this.particleBuffers[1 - readIdx] } },
          { binding: 3, resource: view },
          { binding: 4, resource: this.sampler },
        ],
      })));
  }

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
    this.paused = false;
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  /** The play/pause button: freeze the particles but keep rendering so the
   *  view and the Look controls stay live. stop() is the full halt. */
  pause(): void {
    this.paused = true;
    if (!this.running) { this.running = true; this.tick(); }
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    cancelAnimationFrame(this.animId);
    clearTimeout(this.animId);
  }

  /** New random particles. A seed makes the start reproducible (/admin/og). */
  reset(seed?: number): void {
    if (!this.gpu) return;
    const { device } = this.gpu;
    const rand = rng(seed);
    const data = new Float32Array(MAX_PARTICLES * 4);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      data[i * 4 + 0] = (rand() - 0.5) * 2;
      data[i * 4 + 1] = (rand() - 0.5) * 2;
      data[i * 4 + 2] = (rand() - 0.5) * 0.1;
      data[i * 4 + 3] = (rand() - 0.5) * 0.1;
    }
    device.queue.writeBuffer(this.particleBuffers[0], 0, data);
    device.queue.writeBuffer(this.particleBuffers[1], 0, data);

    const encoder = device.createCommandEncoder();
    for (const views of this.fieldLevelViews) {
      for (const view of views) {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }],
        });
        pass.end();
      }
    }
    device.queue.submit([encoder.finish()]);

    this.frame = 0;
    this.writeIdx = 0;
  }

  /** Steer gravity. (0, 0) is accepted and means no pull this frame. */
  setGravityDirection(x: number, y: number): void {
    const len = Math.hypot(x, y);
    if (len > 1e-6 && len > 1) { x /= len; y /= len; }
    this.gravityX = x;
    this.gravityY = y;
  }

  /** Back to straight down. */
  resetGravityDirection(): void { this.gravityX = 0; this.gravityY = -1; }

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
    v.setFloat32(68,  Math.min(p.memory, 0.999), true);
    v.setFloat32(72,  Math.max(0.5, p.splatSize), true);
    v.setUint32(76,   p.viewMode, true);
    v.setFloat32(80,  p.exposure, true);
    v.setFloat32(84,  this.fieldW, true);
    v.setFloat32(88,  this.fieldH, true);
    v.setFloat32(92,  this.mipCount - 1, true);
    // Palette 0 tint: a custom colour when the preset carries one, else the theme accent.
    const tint = (p.tint ?? -1) >= 0
      ? { r: ((p.tint >> 16) & 255) / 255, g: ((p.tint >> 8) & 255) / 255, b: (p.tint & 255) / 255 }
      : this.accent;
    v.setFloat32(96,  tint.r, true);
    v.setFloat32(100, tint.g, true);
    v.setFloat32(104, tint.b, true);
    v.setFloat32(108, this.bgColor.r, true);
    v.setFloat32(112, this.bgColor.g, true);
    v.setFloat32(116, this.bgColor.b, true);
    v.setFloat32(120, p.pointAlpha, true);
    v.setFloat32(124, this.gravity, true);
    v.setFloat32(128, this.gravityX, true);
    v.setFloat32(132, this.gravityY, true);
    v.setFloat32(136, p.bloom ?? 0, true);
    v.setFloat32(140, Math.min(p.longExposure ?? 0, 0.995), true);
    v.setUint32(144,  p.curve ?? 3, true);
    v.setUint32(148,  p.tonemap ?? 2, true);
    v.setUint32(152,  p.palette ?? 0, true);
    const canvas = this.gpu?.canvas;
    const dpr = (canvas && canvas.width > 0 && canvas.clientWidth > 0) ? canvas.width / canvas.clientWidth : 1;
    v.setFloat32(156, Math.max(0.5, (p.pointSize ?? 2) * dpr), true);
    v.setFloat32(160, canvas?.width ?? 1, true);
    // Pointers: position + pressure, then the per-step displacement (this
    // frame's motion spread over the substeps, lightly smoothed), so the
    // shader can move carried particles exactly with the finger.
    let slot = 0;
    const steps = Math.max(1, p.stepsPerFrame);
    for (const pt of this.pointers.values()) {
      if (slot >= MAX_POINTERS) break;
      if (pt.pan || this.gesture) continue;               // view gestures are not forces
      pt.vx = 0.5 * pt.vx + 0.5 * (wrap1(pt.x - pt.px) / steps);
      pt.vy = 0.5 * pt.vy + 0.5 * (wrap1(pt.y - pt.py) / steps);
      pt.px = pt.x; pt.py = pt.y;
      const o = 176 + slot * 32;
      v.setFloat32(o, pt.x, true); v.setFloat32(o + 4, pt.y, true); v.setFloat32(o + 8, pt.strength, true);
      v.setFloat32(o + 16, pt.vx, true); v.setFloat32(o + 20, pt.vy, true);
      slot++;
    }
    v.setFloat32(304, this.viewZoom, true);
    v.setFloat32(308, this.viewCx, true);
    v.setFloat32(312, this.viewCy, true);
    v.setFloat32(164, canvas?.height ?? 1, true);
    v.setUint32(168,  p.pointShape ?? 0, true);
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
      this.createFieldTextures(device, canvas.width || 1, canvas.height || 1);
    }
    const aspect = canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 1;
    const N = Math.min(this.params.numParticles, MAX_PARTICLES);
    const steps = this.paused ? 0 : Math.max(1, Math.min(30, Math.round(this.params.stepsPerFrame)));

    if (this.paused) {
      // Redraw the last state: the field written by the last step lives in the
      // other slot (writeIdx already flipped) and its particles in (frame-1)%2.
      device.queue.writeBuffer(this.uniformBuffer, 0, this.packUniforms(aspect));
      const encoder = device.createCommandEncoder();
      this.writeIdx = 1 - this.writeIdx;
      this.runDisplay(encoder, context, (this.frame + 1) % 2, N);
      this.writeIdx = 1 - this.writeIdx;
      device.queue.submit([encoder.finish()]);
    }

    // One submit per sim step so each step sees its own `tick` uniform (noise seed).
    // Only the last step renders to the swapchain.
    for (let s = 0; s < steps; s++) {
      device.queue.writeBuffer(this.uniformBuffer, 0, this.packUniforms(aspect));
      const readIdx = this.frame % 2;          // particle buffer holding current state
      const encoder = device.createCommandEncoder();
      this.runDecay(encoder);
      this.runDeposit(encoder, readIdx, N);
      this.runMips(encoder);
      this.runCompute(encoder, readIdx, N);
      if (s === steps - 1) this.runDisplay(encoder, context, readIdx, N);
      device.queue.submit([encoder.finish()]);
      this.frame++;
      this.writeIdx = 1 - this.writeIdx;
    }
    this.tickCount++;

    // Let up to two frames be in flight: the CPU encodes frame n+1 while the GPU
    // runs frame n. Only when we get two ahead do we wait for the GPU.
    this.inFlight++;
    const done = device.queue.onSubmittedWorkDone().then(() => { this.inFlight--; });
    const schedule = (): void => {
      if (!this.running) return;
      if (!Number.isFinite(this.maxFps)) {
        this.animId = requestAnimationFrame(this.tick);
      } else {
        this.animId = window.setTimeout(this.tick, 0) as unknown as number;
      }
    };
    if (this.inFlight >= 2) void done.then(schedule); else schedule();
  };

  // ── Stills (/admin/og) ────────────────────────────────────────────
  /**
   * Reproducible still, part 1: exact backing size, seeded particles, then
   * `steps - 1` sim steps (the last `exposureSteps` of them also run the
   * display pass so long exposure has history). Must not be running.
   * Finish with drawStill() and copy the canvas in the same task.
   */
  async prepareStill(opts: { width: number; height: number; seed: number; steps: number; viewZoom?: number; viewCx?: number; viewCy?: number; onProgress?: (done: number, total: number) => void }): Promise<void> {
    if (!this.gpu) return;
    const { device, canvas } = this.gpu;
    this.stop();
    canvas.width = opts.width;
    canvas.height = opts.height;
    this.createFieldTextures(device, opts.width, opts.height);
    this.viewZoom = opts.viewZoom ?? 1;
    this.viewCx = opts.viewCx ?? 0;
    this.viewCy = opts.viewCy ?? 0;
    this.mouseActive = false;
    this.pointers.clear();
    this.reset(opts.seed);
    this.accumIdx = 0;
    const total = Math.max(1, Math.round(opts.steps));
    const exposureFrom = total - 1 - 120;
    for (let s = 0; s < total - 1; s++) {
      this._stillStep(s >= exposureFrom);
      if (s % 32 === 31) { await device.queue.onSubmittedWorkDone(); opts.onProgress?.(s + 1, total); }
    }
    await device.queue.onSubmittedWorkDone();
  }

  /** Reproducible still, part 2: the final step plus display, synchronously. */
  drawStill(): void { this._stillStep(true); }

  private _stillStep(display: boolean): void {
    const { device, context, canvas } = this.gpu!;
    const aspect = canvas.width / canvas.height;
    const N = Math.min(this.params.numParticles, MAX_PARTICLES);
    device.queue.writeBuffer(this.uniformBuffer, 0, this.packUniforms(aspect));
    const readIdx = this.frame % 2;
    const encoder = device.createCommandEncoder();
    this.runDecay(encoder);
    this.runDeposit(encoder, readIdx, N);
    this.runMips(encoder);
    this.runCompute(encoder, readIdx, N);
    if (display) this.runDisplay(encoder, context, readIdx, N);
    device.queue.submit([encoder.finish()]);
    this.frame++;
    this.writeIdx = 1 - this.writeIdx;
  }

  /** B = A × memory. Skipped when memory is 0: the deposit pass clears instead. */
  private runDecay(encoder: GPUCommandEncoder): void {
    if (this.params.memory <= 0) return;
    const prev = 1 - this.writeIdx;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.fieldLevelViews[this.writeIdx][0],
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.decayPipeline);
    pass.setBindGroup(0, this.fullBindGroups[prev][0]);
    pass.draw(6);
    pass.end();
  }

  private runCompute(encoder: GPUCommandEncoder, readIdx: number, N: number): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.computePipeline);
    pass.setBindGroup(0, this.computeBindGroups[this.writeIdx][readIdx]);
    pass.dispatchWorkgroups(Math.ceil(N / 64));
    pass.end();
  }

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
    pass.setPipeline(this.depositPipeline);   // 4 instances per particle: splat + wrapped copies
    pass.setBindGroup(0, this.depositBindGroups[readIdx]);
    pass.draw(6, N * 4);
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
    const prev = this.accumIdx;
    const cur = 1 - prev;
    this.accumIdx = cur;

    // 1. Field → linear colour, blended with the previous accumulation frame.
    const base = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.accumViews[cur],
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    base.setPipeline(this.basePipeline);
    base.setBindGroup(0, this.baseBindGroups[this.writeIdx][prev]);
    base.draw(6);
    base.end();

    // 2. Points mode: additive points on top of the (empty or long-exposed) base.
    if (this.params.viewMode === 2) {
      const pts = encoder.beginRenderPass({
        colorAttachments: [{ view: this.accumViews[cur], loadOp: 'load', storeOp: 'store' }],
      });
      pts.setPipeline(this.pointPipeline);
      pts.setBindGroup(0, this.fullBindGroups[this.writeIdx][1 - readIdx]);
      pts.draw(6, N);
      pts.end();
    }

    // 3. Tonemap to the swapchain.
    const post = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: this.bgColor,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    post.setPipeline(this.postPipeline);
    post.setBindGroup(0, this.postBindGroups[cur]);
    post.draw(6);
    post.end();
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
