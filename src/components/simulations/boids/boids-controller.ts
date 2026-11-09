import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { createBuffer, createUniformBuffer } from '../../../lib/webgpu/utils';
import { rng } from '../../../lib/webgpu/prng';
import shaderCode from './boids.wgsl?raw';
import gridShaderCode from './boids-grid.wgsl?raw';
import { TrailRenderer } from './trail-renderer';
import { ImageProcessor } from '../../../lib/webgpu/image-editor/image-processor';
import { BoidsImageForce } from './boids-image-force';
import { BoidsWebcam } from './boids-webcam';

const MAX_PARTICLES = 500000;

const MAX_GRID_DIM = 64;
const MAX_GRID_SIZE = MAX_GRID_DIM * MAX_GRID_DIM; // 4096 — buffer allocation size only

// Quad billboard (-1..1), 6 vertices = 2 triangles. Scaled by params.size in vertex shader.
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;
const MAX_POINTERS = 4;
/** Into [-1, 1). */
const wrap1 = (v: number): number => v - 2 * Math.floor((v + 1) / 2);
/** Shortest offset on the [-1, 1) torus. */
const wrapD = (d: number): number => d - 2 * Math.round(d / 2);

const QUAD_VERTS = new Float32Array([
  -1.0, -1.0,
   1.0, -1.0,
  -1.0,  1.0,
  -1.0,  1.0,
   1.0, -1.0,
   1.0,  1.0,
]);

export interface BoidsParams {
  dt: number;
  numParticles: number;
  attractionRadius: number;
  repulsionRadius: number;
  attraction: number;
  repulsion: number;
  alignment: number;
  friction: number;
  maxSpeed: number;
  mouseRadius: number;
  coneAngle: number;
  size: number;
  shapeId: number;
  colorR: number;
  colorG: number;
  colorB: number;
  opacity: number;
  opacityMode: number;
  noise?: number;
}

const DEFAULT_PARAMS: BoidsParams = {
  dt: 0.016,
  numParticles: 200,
  attractionRadius: 0.2,
  repulsionRadius: 0.05,
  attraction: 0.3,
  repulsion: 1.5,
  alignment: 0.1,
  friction: 2.0,
  maxSpeed: 0.22,
  mouseRadius: 0.15,
  coneAngle: -0.5,
  size: 0.02,
  shapeId: 0,
  colorR: 0.88,
  colorG: 0.63,
  colorB: 0.25,
  opacity: 1.0,
  opacityMode: 0,
  noise: 0.0,
};

interface PointerState {
  sx: number; sy: number;           // screen NDC
  x: number; y: number;             // world
  clientX: number; clientY: number;
  type: string;
  pan: boolean;                     // desktop pan drag (space / alt / middle)
  engaged: boolean;                 // drives the force (touch on the page waits for a move)
}

export class BoidsController {
  private gpu: WebGPUContext | null = null;

  // Boids update + render pipelines (user-editable via reloadShader)
  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private boidsBindGroupLayout!: GPUBindGroupLayout;
  private boidsBindGroups!: GPUBindGroup[];
  private renderParamsBindGroup!: GPUBindGroup;

  // Grid infrastructure pipelines (non-editable, created once)
  private clearGridPipeline!: GPUComputePipeline;
  private gridAssignPipeline!: GPUComputePipeline;
  private prefixSumPipeline!: GPUComputePipeline;
  private scatterPipeline!: GPUComputePipeline;
  private scatterDataPipeline!: GPUComputePipeline;
  private gridBindGroupLayout!: GPUBindGroupLayout;
  private gridBindGroups!: GPUBindGroup[]; // [frame%2] — reads from A or B

  // Particle double-buffers
  private particleBuffers!: GPUBuffer[];

  // Grid buffers
  private particleCellIDsBuffer!: GPUBuffer;
  private cellCountsBuffer!: GPUBuffer;
  private cellOffsetsBuffer!: GPUBuffer;
  private cellScatterIdxBuffer!: GPUBuffer;
  private sortedIndicesBuffer!: GPUBuffer;
  private sortedParticlesBuffer!: GPUBuffer;

  // Shared uniform/obstacle/vertex buffers
  private uniformBuffer!: GPUBuffer;
  private obstacleBuffer!: GPUBuffer;
  private vertexBuffer!: GPUBuffer;

  private frame = 0;
  private running = false;
  private animId = 0;
  private lastFrameTime = 0;
  maxFps = Infinity;
  tickCount = 0;
  onFrameComplete: ((timestampMs: number) => void) | null = null;
  private mouseX = 0;
  private mouseY = 0;
  private mouseActive = false;
  /** Pointer movement (world units) accumulated since the last frame, consumed by _packUniforms. */
  private mouseDX = 0;
  private mouseDY = 0;
  private pointers = new Map<number, PointerState>();
  /** Two-finger gesture (pinch zoom + pan) in progress: last midpoint / distance in screen NDC. */
  private gesture: { mx: number; my: number; d: number } | null = null;
  private spaceHeld = false;
  /** View: zoom about the world point (viewCx, viewCy), which sits at screen centre. */
  viewZoom = 1;
  viewCx = 0;
  viewCy = 0;
  /** Zoom by `factor` keeping the world point under screen (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const z0 = this.viewZoom;
    const z1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z0 * factor));
    if (z1 === z0) return;
    const wx = this.viewCx + sx / z0, wy = this.viewCy + sy / z0;
    this.viewZoom = z1;
    this.viewCx = wrap1(wx - sx / z1);
    this.viewCy = wrap1(wy - sy / z1);
  }
  /** Pan by a screen-NDC offset (periodic). */
  panBy(dsx: number, dsy: number): void {
    this.viewCx = wrap1(this.viewCx - dsx / this.viewZoom);
    this.viewCy = wrap1(this.viewCy - dsy / this.viewZoom);
  }
  resetView(): void { this.viewZoom = 1; this.viewCx = 0; this.viewCy = 0; }
  /** Force radius on screen, in CSS px (mouseRadius is a fraction of half the height). */
  pointerRadiusPx(): number {
    const c = this.gpu?.canvas;
    return (c ? c.clientHeight : 0) * 0.5 * this.params.mouseRadius;
  }
  /** Page hook for touch feedback: called whenever the force pointer set changes. */
  onPointers?: (pts: Array<{ id: number; clientX: number; clientY: number; strength: number; type: string }>) => void;
  private trailRenderer = new TrailRenderer();

  /** Page background color used for trail decay target + no-trails swapchain
   *  clear. Re-read whenever [data-theme] flips on <html>. Defaults to the
   *  warm-ember --bg-primary (#0a0804) so SSR / non-DOM contexts have a value. */
  private bgColor: { r: number; g: number; b: number; a: number } = { r: 0.039, g: 0.031, b: 0.016, a: 1 };
  /** True when bgColor is light enough that additive blending would wash to
   *  white. Drives the boid render pipeline's blend mode. */
  private _isLight = false;
  private _themeObserver: MutationObserver | null = null;
  readonly imageProcessor = new ImageProcessor();
  readonly imageForce     = new BoidsImageForce();
  readonly webcam         = new BoidsWebcam();
  private overlayPipeline: GPURenderPipeline | null = null;
  private overlayBindGroup: GPUBindGroup | null = null;
  private prevCanvasWidth = 0;
  private prevCanvasHeight = 0;

  params: BoidsParams = { ...DEFAULT_PARAMS };
  trailsEnabled = false;
  trailDecay = 0.92;
  /** The original boids.wgsl — immutable fallback for presets with no custom shader. */
  readonly defaultShaderSource = shaderCode;
  /** The shader currently loaded (or last loaded via preset). Updated by reloadShader. */
  shaderSource = shaderCode;
  /**
   * Workgroup size declared by the active boids shader's @workgroup_size — kept
   * in sync with shaderSource so dispatchWorkgroups gets `ceil(N / size)`. If a
   * user-loaded shader uses a different value than the default, this prevents
   * over- or under-dispatching the compute pass.
   */
  private boidsWorkgroupSize = 64;

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      this.gpu = await initWebGPU(canvas);
      if (!this.gpu) return false;

      const { device } = this.gpu;

      // ── Uniform / obstacle / vertex buffers ──────────────────────────
      this.uniformBuffer = createUniformBuffer(device, 144);
      // 16 × vec4f (256 bytes) + u32 count (4) + vec3u padding (12) = 272 bytes
      this.obstacleBuffer = createUniformBuffer(device, 272);

      // ── Particle buffers ──────────────────────────────────────────────
      const initialData = new Float32Array(MAX_PARTICLES * 4);
      for (let i = 0; i < MAX_PARTICLES; i++) {
        initialData[i * 4 + 0] = (Math.random() - 0.5) * 2;
        initialData[i * 4 + 1] = (Math.random() - 0.5) * 2;
        initialData[i * 4 + 2] = (Math.random() - 0.5) * 0.1;
        initialData[i * 4 + 3] = (Math.random() - 0.5) * 0.1;
      }
      const particleUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;
      this.particleBuffers = [
        createBuffer(device, initialData, particleUsage),
        createBuffer(device, initialData, particleUsage),
      ];

      this.vertexBuffer = createBuffer(device, QUAD_VERTS, GPUBufferUsage.VERTEX);

      // ── Grid buffers ──────────────────────────────────────────────────
      const gridStorageUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
      this.particleCellIDsBuffer = device.createBuffer({
        size: MAX_PARTICLES * 4,
        usage: gridStorageUsage,
      });
      this.cellCountsBuffer = device.createBuffer({
        size: MAX_GRID_SIZE * 4,
        usage: gridStorageUsage,
      });
      this.cellOffsetsBuffer = device.createBuffer({
        size: MAX_GRID_SIZE * 4,
        usage: gridStorageUsage,
      });
      this.cellScatterIdxBuffer = device.createBuffer({
        size: MAX_GRID_SIZE * 4,
        usage: gridStorageUsage,
      });
      this.sortedIndicesBuffer = device.createBuffer({
        size: MAX_PARTICLES * 4,
        usage: gridStorageUsage,
      });
      this.sortedParticlesBuffer = device.createBuffer({
        size: MAX_PARTICLES * 16,  // Particle = vec2f pos + vec2f vel = 16 bytes
        usage: gridStorageUsage,
      });

      // ── Grid pipeline setup ───────────────────────────────────────────
      const gridModule = device.createShaderModule({ code: gridShaderCode });

      this.gridBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
      });

      const gridPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [this.gridBindGroupLayout],
      });

      this.clearGridPipeline = device.createComputePipeline({
        layout: gridPipelineLayout,
        compute: { module: gridModule, entryPoint: 'clearGrid' },
      });
      this.gridAssignPipeline = device.createComputePipeline({
        layout: gridPipelineLayout,
        compute: { module: gridModule, entryPoint: 'gridAssign' },
      });
      this.prefixSumPipeline = device.createComputePipeline({
        layout: gridPipelineLayout,
        compute: { module: gridModule, entryPoint: 'prefixSum' },
      });
      this.scatterPipeline = device.createComputePipeline({
        layout: gridPipelineLayout,
        compute: { module: gridModule, entryPoint: 'scatter' },
      });
      this.scatterDataPipeline = device.createComputePipeline({
        layout: gridPipelineLayout,
        compute: { module: gridModule, entryPoint: 'scatterData' },
      });

      // Grid bind groups — one per ping-pong frame (reads from A or B)
      this.gridBindGroups = this._buildBindGroupPair(
        this.gridBindGroupLayout,
        [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.particleBuffers[0] } }, // read A
          { binding: 2, resource: { buffer: this.particleCellIDsBuffer } },
          { binding: 3, resource: { buffer: this.cellCountsBuffer } },
          { binding: 4, resource: { buffer: this.cellOffsetsBuffer } },
          { binding: 5, resource: { buffer: this.cellScatterIdxBuffer } },
          { binding: 6, resource: { buffer: this.sortedIndicesBuffer } },
          { binding: 7, resource: { buffer: this.sortedParticlesBuffer } },
        ],
        [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.particleBuffers[1] } }, // read B
          { binding: 2, resource: { buffer: this.particleCellIDsBuffer } },
          { binding: 3, resource: { buffer: this.cellCountsBuffer } },
          { binding: 4, resource: { buffer: this.cellOffsetsBuffer } },
          { binding: 5, resource: { buffer: this.cellScatterIdxBuffer } },
          { binding: 6, resource: { buffer: this.sortedIndicesBuffer } },
          { binding: 7, resource: { buffer: this.sortedParticlesBuffer } },
        ],
      );

      // ── Image processor + force must be ready before bind groups ─────
      this.imageProcessor.init(device);
      this.imageForce.init(device, this.imageProcessor);
      this._buildOverlayPipeline(this.gpu.format);

      // ── Read bg color BEFORE building the boids render pipeline ──────
      // The blend mode picked by _createBoidsPipelines depends on _isLight, so
      // bg has to be known first. Additive blending only looks right against a
      // dark bg (washes to white on cream); standard alpha blend is used in
      // light mode. _initThemeObserver runs after pipeline build so an early
      // theme flip can call back into the rebuild path safely.
      this._readBgColor();

      // ── Boids update + render pipelines ──────────────────────────────
      this.boidsWorkgroupSize = this._parseWorkgroupSize(shaderCode);
      const boidsModule = device.createShaderModule({ code: shaderCode });
      this._createBoidsPipelines(boidsModule);

      this.trailRenderer.init(device, this.gpu!.format, canvas.width || 1, canvas.height || 1);
      this.trailRenderer.primeBg(device, this.bgColor);
      this.prevCanvasWidth = canvas.width;
      this.prevCanvasHeight = canvas.height;

      this._initThemeObserver();

      this.bindPointer(canvas);

      // ResizeObserver writes canvas dimensions directly — no layout reads in the GPU rAF loop.
      const canvasRO = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(entry.contentRect.width  * dpr);
        const h = Math.floor(entry.contentRect.height * dpr);
        if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
          canvas.width  = w;
          canvas.height = h;
        }
      });
      canvasRO.observe(canvas);

      return true;
    } catch (e) {
      console.error('BoidsController init error:', e);
      return false;
    }
  }

  /** Extract the first arg of `@workgroup_size(N, ...)` from a WGSL source. */
  private _parseWorkgroupSize(code: string): number {
    const m = code.match(/@workgroup_size\s*\(\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 64;
  }

  private _createBoidsPipelines(module: GPUShaderModule): void {
    const { device, format } = this.gpu!;

    this.boidsBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      ],
    });

    const forceEntriesPipelines = this.imageForce.buildBindGroupEntries();
    this.boidsBindGroups = this._buildBindGroupPair(
      this.boidsBindGroupLayout,
      [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffers[0] } },
        { binding: 2, resource: { buffer: this.particleBuffers[1] } },
        { binding: 3, resource: { buffer: this.obstacleBuffer } },
        { binding: 4, resource: { buffer: this.cellOffsetsBuffer } },
        { binding: 5, resource: { buffer: this.cellCountsBuffer } },
        { binding: 6, resource: { buffer: this.sortedParticlesBuffer } },
        ...forceEntriesPipelines,
      ],
      [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffers[1] } },
        { binding: 2, resource: { buffer: this.particleBuffers[0] } },
        { binding: 3, resource: { buffer: this.obstacleBuffer } },
        { binding: 4, resource: { buffer: this.cellOffsetsBuffer } },
        { binding: 5, resource: { buffer: this.cellCountsBuffer } },
        { binding: 6, resource: { buffer: this.sortedParticlesBuffer } },
        ...forceEntriesPipelines,
      ],
    );

    const boidsPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.boidsBindGroupLayout],
    });

    this.computePipeline = device.createComputePipeline({
      layout: boidsPipelineLayout,
      compute: { module, entryPoint: 'computeMain' },
    });

    this.renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 4 * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
            ],
          },
          {
            arrayStride: 4 * 2,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 2, offset: 0, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fragmentMain',
        targets: [{
          format,
          // Additive on dark bg gives the glowing-particle look; on light bg it
          // sums boid colors with the bg and clamps to white. Switch to standard
          // alpha blending in light mode so boid colors read against cream.
          blend: this._isLight
            ? {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
              }
            : {
                color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one',       dstFactor: 'one', operation: 'add' },
              },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.renderParamsBindGroup = device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  async reloadShader(code: string): Promise<{ success: boolean; error: string }> {
    if (!this.gpu) return { success: false, error: 'GPU not initialized' };
    try {
      const { device } = this.gpu;

      // Snapshot current pipeline state for atomic rollback on failure
      const snapshot = {
        computePipeline:       this.computePipeline,
        renderPipeline:        this.renderPipeline,
        boidsBindGroupLayout:  this.boidsBindGroupLayout,
        boidsBindGroups:       this.boidsBindGroups,
        renderParamsBindGroup: this.renderParamsBindGroup,
        boidsWorkgroupSize:    this.boidsWorkgroupSize,
      };

      device.pushErrorScope('validation');
      const module = device.createShaderModule({ code });
      this.boidsWorkgroupSize = this._parseWorkgroupSize(code);
      this._createBoidsPipelines(module);
      const gpuError = await device.popErrorScope();

      if (gpuError) {
        Object.assign(this, snapshot);
        return { success: false, error: gpuError.message };
      }

      this.shaderSource = code;
      return { success: true, error: '' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.animId);
    clearTimeout(this.animId);
  }

  /** New random particles. A seed makes the start reproducible (/admin/og). */
  reset(seed?: number) {
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
    this.frame = 0;
  }

  // ── Stills (/admin/og) ────────────────────────────────────────────
  /**
   * Reproducible still, part 1: exact backing size, seeded particles, then
   * `steps - 1` frames (the last 300 also render, so trails build up).
   * Must not be running. Finish with drawStill() and copy the canvas in the
   * same task.
   */
  async prepareStill(opts: { width: number; height: number; seed: number; steps: number; viewZoom?: number; viewCx?: number; viewCy?: number; onProgress?: (done: number, total: number) => void }): Promise<void> {
    if (!this.gpu) return;
    const { device, canvas } = this.gpu;
    this.stop();
    canvas.width = opts.width;
    canvas.height = opts.height;
    this._preFrameSetup();                       // resizes trail + image targets
    this.trailRenderer.primeBg(device, this.bgColor);
    this.viewZoom = opts.viewZoom ?? 1;
    this.viewCx = opts.viewCx ?? 0;
    this.viewCy = opts.viewCy ?? 0;
    this.mouseActive = false;
    this.reset(opts.seed);
    const total = Math.max(1, Math.round(opts.steps));
    for (let s = 0; s < total - 1; s++) {
      this._stillStep(s >= total - 1 - 300);
      if (s % 32 === 31) { await device.queue.onSubmittedWorkDone(); opts.onProgress?.(s + 1, total); }
    }
    await device.queue.onSubmittedWorkDone();
  }

  /** Reproducible still, part 2: the final frame, synchronously. */
  drawStill(): void { this._stillStep(true); }

  private _stillStep(render: boolean): void {
    const { device, context, aspect } = this._preFrameSetup();
    device.queue.writeBuffer(this.uniformBuffer, 0, this._packUniforms(aspect));
    const N = this.params.numParticles;
    const gridDim = Math.max(4, Math.min(MAX_GRID_DIM, Math.floor(2.0 / Math.max(this.params.attractionRadius, this.params.repulsionRadius))));
    this._runComputePasses(device, N, gridDim, gridDim * gridDim);
    if (render) this._renderFrame(device, context, N);
    this.frame++;
  }

  setObstacles(rects: Float32Array, count: number): void {
    if (!this.gpu) return;
    // Buffer layout: 16 × vec4f (256 bytes) + u32 count (4) + vec3u pad (12) = 272 bytes
    const buf = new ArrayBuffer(272);
    const floats = new Float32Array(buf);
    const uints  = new Uint32Array(buf);
    floats.set(rects.subarray(0, count * 4), 0);  // rects at offset 0
    uints[64] = count;                             // count at byte offset 256
    this.gpu.device.queue.writeBuffer(this.obstacleBuffer, 0, buf);
  }

  /**
   * Listen for pointer input on `target` and feed the mouse force, drag-to-carry
   * and (with `view`) the zoom/pan gestures. init binds the canvas with the
   * defaults: hover attracts, a press attracts and carries, a touch does the
   * same from the moment it lands, two fingers pinch-zoom and pan, the wheel
   * zooms about the cursor, and space / alt / middle button turn a mouse drag
   * into a pan. The background sim binds `window` with hover and view off: a
   * mouse acts only while a button is held, touch only once a drag survived
   * the browser's scroll decision (body is touch-action: pan-y pinch-zoom),
   * and nothing is preventDefault-ed so clicks and scrolling keep working.
   * Mouse position and carry are in world space; the force radius is scaled
   * in _packUniforms so it stays constant on screen.
   */
  bindPointer(target: HTMLElement | Window, opts: { hover?: boolean; view?: boolean } = {}): void {
    const canvas = this.gpu?.canvas;
    if (!canvas) return;
    const hover = opts.hover ?? true;
    const view = opts.view ?? true;
    const toScreen = (e: { clientX: number; clientY: number }): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1)];
    };
    const toWorld = (sx: number, sy: number): [number, number] =>
      [wrap1(this.viewCx + sx / this.viewZoom), wrap1(this.viewCy + sy / this.viewZoom)];
    const touches = () => [...this.pointers.values()].filter(p => p.type !== 'mouse');
    const gestureFrom = (a: { sx: number; sy: number }, b: { sx: number; sy: number }) =>
      ({ mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2, d: Math.max(1e-3, Math.hypot(a.sx - b.sx, a.sy - b.sy)) });
    const emit = () => this.onPointers?.(this.gesture ? [] : [...this.pointers].filter(([, p]) => !p.pan && p.engaged)
      .map(([id, p]) => ({ id, clientX: p.clientX, clientY: p.clientY, strength: 1, type: p.type })));
    const engage = (p: PointerState, x: number, y: number) => {
      p.engaged = true; p.x = x; p.y = y;
      this.mouseX = x; this.mouseY = y;
      this.mouseDX = 0; this.mouseDY = 0;
      this.mouseActive = true;
    };
    const onDown = (e: PointerEvent) => {
      if (!view && !e.isPrimary) return;
      if (this.pointers.size >= MAX_POINTERS || this.pointers.has(e.pointerId)) return;
      const [sx, sy] = toScreen(e);
      const [x, y] = toWorld(sx, sy);
      const pan = view && e.pointerType === 'mouse' && (this.spaceHeld || e.altKey || e.button === 1);
      const p: PointerState = { sx, sy, x, y, clientX: e.clientX, clientY: e.clientY, type: e.pointerType, pan, engaged: false };
      this.pointers.set(e.pointerId, p);
      if (view) {
        try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
        if (pan) e.preventDefault();
        const t = touches();
        if (t.length >= 2) { this.gesture = gestureFrom(t[0], t[1]); this.mouseActive = false; emit(); return; }
      }
      // On the page (no view) a touch waits for a move: a vertical swipe gets pointercancel instead.
      if (!pan && (view || e.pointerType !== 'touch')) engage(p, x, y);
      emit();
    };
    const onMove = (e: PointerEvent) => {
      const [sx, sy] = toScreen(e);
      const cur = this.pointers.get(e.pointerId);
      if (!cur) {
        // Hover (mouse, no button): attracts, never carries.
        if (hover && e.pointerType === 'mouse' && this.pointers.size === 0) {
          const [x, y] = toWorld(sx, sy);
          this.mouseX = x; this.mouseY = y; this.mouseActive = true;
        }
        return;
      }
      if (cur.pan) {
        this.panBy(sx - cur.sx, sy - cur.sy);
        cur.sx = sx; cur.sy = sy; cur.clientX = e.clientX; cur.clientY = e.clientY;
        return;
      }
      cur.sx = sx; cur.sy = sy; cur.clientX = e.clientX; cur.clientY = e.clientY;
      if (this.gesture) {
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
      if (!cur.engaged) { engage(cur, x, y); emit(); return; }
      if (this.mouseActive) {
        // Movement between frames accumulates; _packUniforms consumes it.
        this.mouseDX += wrapD(x - this.mouseX);
        this.mouseDY += wrapD(y - this.mouseY);
      }
      cur.x = x; cur.y = y;
      this.mouseX = x; this.mouseY = y; this.mouseActive = true;
      emit();
    };
    const onUp = (e: PointerEvent) => {
      if (!this.pointers.delete(e.pointerId)) return;
      const t = touches();
      if (this.gesture && t.length < 2) {
        // Back to one finger: it resumes as a force.
        this.gesture = null;
        for (const p of t) { const [x, y] = toWorld(p.sx, p.sy); p.x = x; p.y = y; p.engaged = true; }
      }
      const rem = this.gesture ? undefined : [...this.pointers.values()].find(p => !p.pan && p.engaged);
      if (rem) { this.mouseX = rem.x; this.mouseY = rem.y; this.mouseActive = true; }
      else this.mouseActive = false;
      this.mouseDX = 0; this.mouseDY = 0;
      emit();
    };
    const onLeave = () => { if (this.pointers.size === 0) this.mouseActive = false; };
    const onBlur = () => { this.pointers.clear(); this.gesture = null; this.mouseActive = false; this.mouseDX = 0; this.mouseDY = 0; emit(); };
    target.addEventListener('pointerdown', onDown as EventListener);
    target.addEventListener('pointermove', onMove as EventListener);
    target.addEventListener('pointerup', onUp as EventListener);
    target.addEventListener('pointercancel', onUp as EventListener);
    if (target === window) target.addEventListener('blur', onBlur);
    else target.addEventListener('pointerleave', onLeave);
    if (!view) return;
    canvas.addEventListener('lostpointercapture', onUp as EventListener);
    // Wheel zooms about the cursor; space held makes a drag pan (see onDown).
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = toScreen(e);
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
  }

  private _packUniforms(aspect: number): ArrayBuffer {
    const buf = new ArrayBuffer(144);
    const v   = new DataView(buf);
    v.setFloat32( 0, this.params.dt,                   true);
    v.setFloat32( 4, this.params.attractionRadius,      true);
    v.setFloat32( 8, this.params.repulsionRadius,       true);
    v.setFloat32(12, this.params.attraction,            true);
    v.setFloat32(16, this.params.repulsion,             true);
    v.setFloat32(20, this.params.alignment,             true);
    v.setFloat32(24, this.params.friction,              true);
    v.setFloat32(28, this.params.maxSpeed,              true);
    v.setUint32 (32, this.params.numParticles,          true);
    v.setFloat32(36, this.mouseX,                       true);
    v.setFloat32(40, this.mouseY,                       true);
    v.setFloat32(44, this.mouseActive ? 1.0 : 0.0,      true);
    v.setFloat32(48, this.params.mouseRadius / this.viewZoom, true);   // world radius: constant on screen
    v.setFloat32(52, this.params.coneAngle,             true);
    v.setFloat32(56, aspect,                            true);
    v.setFloat32(60, this.params.size,                  true);
    v.setUint32 (64, this.params.shapeId,               true);
    v.setFloat32(68, this.params.colorR,                true);
    v.setFloat32(72, this.params.colorG,                true);
    v.setFloat32(76, this.params.colorB,                true);
    v.setFloat32(80, this.params.opacity,               true);
    v.setUint32 (84, this.params.opacityMode,           true);
    const gridDim = Math.max(4, Math.min(MAX_GRID_DIM, Math.floor(2.0 / Math.max(this.params.attractionRadius, this.params.repulsionRadius))));
    v.setUint32 (88, gridDim,                           true);
    v.setUint32 (92, this.frame,                        true);
    const imgParams = this.imageForce.getExtraParams();
    v.setFloat32(96,  imgParams.imageStrength,          true);
    v.setUint32 (100, imgParams.imageForceMode,         true);
    v.setUint32 (104, imgParams.imageInvert,            true);
    v.setFloat32(108, this.params.noise ?? 0.0,         true);
    v.setFloat32(112, this.mouseDX,                     true);
    v.setFloat32(116, this.mouseDY,                     true);
    this.mouseDX = 0;
    this.mouseDY = 0;
    v.setFloat32(128, this.viewZoom,                    true);
    v.setFloat32(132, this.viewCx,                      true);
    v.setFloat32(136, this.viewCy,                      true);
    return buf;
  }

  private _buildBindGroupPair(
    layout:   GPUBindGroupLayout,
    entriesA: GPUBindGroupEntry[],
    entriesB: GPUBindGroupEntry[],
  ): GPUBindGroup[] {
    const { device } = this.gpu!;
    return [
      device.createBindGroup({ layout, entries: entriesA }),
      device.createBindGroup({ layout, entries: entriesB }),
    ];
  }

  private _preFrameSetup(): { device: GPUDevice; context: GPUCanvasContext; canvas: HTMLCanvasElement; aspect: number } {
    const { device, context, canvas } = this.gpu!;
    // canvas dimensions are managed by the ResizeObserver in init() — no DOM reads here.
    const resized = canvas.width !== this.prevCanvasWidth || canvas.height !== this.prevCanvasHeight;
    if (resized) {
      this.trailRenderer.resize(device, canvas.width, canvas.height);
      this.trailRenderer.primeBg(device, this.bgColor);
      this.imageProcessor.resize(canvas.width, canvas.height);
      this.rebuildBoidsBindGroups();  // processedTexture was re-allocated; refresh bind group
      this.overlayBindGroup = null;   // compositedTexture was re-allocated; rebuild on next use
      this.prevCanvasWidth  = canvas.width;
      this.prevCanvasHeight = canvas.height;
    }
    if (this.webcam.status === 'active') {
      this.webcam.tick(this.imageProcessor);
    }
    const aspect = canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 1.0;
    return { device, context, canvas, aspect };
  }

  private _runComputePasses(device: GPUDevice, N: number, gridDim: number, gridSize: number): void {
    const gridBG = this.gridBindGroups[this.frame % 2];
    const computeEncoder = device.createCommandEncoder();
    const computePass    = computeEncoder.beginComputePass();

    // Pass 1: clearGrid — only clear active cells (gridDim×gridDim)
    computePass.setPipeline(this.clearGridPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(Math.ceil(gridSize / 64));

    // Pass 2: gridAssign
    computePass.setPipeline(this.gridAssignPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(Math.ceil(N / 64));

    // Pass 3: prefixSum
    computePass.setPipeline(this.prefixSumPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(1);

    // Pass 4: scatter
    computePass.setPipeline(this.scatterPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(Math.ceil(N / 64));

    // Pass 5: scatterData — copy particle data into cell-sorted order
    computePass.setPipeline(this.scatterDataPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(Math.ceil(N / 64));

    // Pass 6: boids update — dispatch sized to whatever @workgroup_size the
    // currently-loaded shader declared (default 64; user shaders may differ).
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.boidsBindGroups[this.frame % 2]);
    computePass.dispatchWorkgroups(Math.ceil(N / this.boidsWorkgroupSize));

    computePass.end();
    device.queue.submit([computeEncoder.finish()]);
  }

  private _renderFrame(device: GPUDevice, context: GPUCanvasContext, N: number): void {
    // ── Render pass ───────────────────────────────────────────────────
    this.trailRenderer.render(
      device,
      context,
      this.trailDecay,
      this.trailsEnabled,
      this.bgColor,
      (encoder, targetView, loadOp) => {
        const renderPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: targetView,
            clearValue: this.bgColor,
            loadOp,
            storeOp: 'store',
          }],
        });
        renderPass.setPipeline(this.renderPipeline);
        renderPass.setBindGroup(0, this.renderParamsBindGroup);
        renderPass.setVertexBuffer(0, this.particleBuffers[(this.frame + 1) % 2]);
        renderPass.setVertexBuffer(1, this.vertexBuffer);
        renderPass.draw(6, N);
        renderPass.end();
      },
    );

    // ── Image overlay ─────────────────────────────────────────────────
    if (this.imageForce.isActive() && this.imageForce.showOverlay && this.overlayPipeline) {
      if (!this.overlayBindGroup) {
        this.overlayBindGroup = device.createBindGroup({
          layout: this.overlayPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.imageProcessor.getOutputSampler() },
            { binding: 1, resource: this.imageProcessor.getCompositedTexture().createView() },
          ],
        });
      }
      const enc  = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view:    context.getCurrentTexture().createView(),
          loadOp:  'load',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this.overlayPipeline);
      pass.setBindGroup(0, this.overlayBindGroup);
      pass.draw(6);
      pass.end();
      device.queue.submit([enc.finish()]);
    }
  }

  private tick = () => {
    if (!this.running || !this.gpu) return;

    // Capped mode: use RAF as the heartbeat, skip GPU work if called too early
    if (Number.isFinite(this.maxFps)) {
      const now = performance.now();
      if (now - this.lastFrameTime < (1000 / this.maxFps) - 1) {
        this.animId = requestAnimationFrame(this.tick);
        return;
      }
      this.lastFrameTime = now;
    }

    const { device, context, aspect } = this._preFrameSetup();
    device.queue.writeBuffer(this.uniformBuffer, 0, this._packUniforms(aspect));

    const N       = this.params.numParticles;
    const gridDim = Math.max(4, Math.min(MAX_GRID_DIM, Math.floor(2.0 / Math.max(this.params.attractionRadius, this.params.repulsionRadius))));
    const gridSize = gridDim * gridDim;

    this._runComputePasses(device, N, gridDim, gridSize);
    this._renderFrame(device, context, N);

    this.frame++;
    void device.queue.onSubmittedWorkDone().then(() => {
      if (!this.running) return;
      this.tickCount++;
      this.onFrameComplete?.(performance.now());
      if (!Number.isFinite(this.maxFps)) {
        // Display rate (checked): RAF → vsync-locked to display Hz
        this.animId = requestAnimationFrame(this.tick);
      } else {
        // Slider mode (unchecked): setTimeout(0) → can exceed display Hz
        this.animId = window.setTimeout(this.tick, 0) as unknown as number;
      }
    });
  };

  private _buildOverlayPipeline(format: GPUTextureFormat): void {
    const { device } = this.gpu!;
    const wgsl = /* wgsl */`
      @group(0) @binding(0) var s: sampler;
      @group(0) @binding(1) var t: texture_2d<f32>;
      struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> V {
        var pos = array<vec2f,6>(
          vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),
          vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
        let p = pos[i];
        return V(vec4f(p,0,1), p * vec2f(0.5,-0.5) + vec2f(0.5));
      }
      @fragment fn fs(v: V) -> @location(0) vec4f {
        let c = textureSample(t, s, v.uv);
        return vec4f(c.rgb, c.a * 0.45);
      }
    `;
    const mod = device.createShaderModule({ code: wgsl });
    this.overlayPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }]},
      primitive: { topology: 'triangle-list' },
    });
  }

  rebuildBoidsBindGroups(): void {
    if (!this.gpu || !this.boidsBindGroupLayout) return;
    const { device } = this.gpu;
    // Only rebuild bind groups — do NOT recreate pipelines or recompile shaders.
    // Previously this called _createBoidsPipelines(shaderSource) which silently
    // replaced the active preset shader with the default boids.wgsl on every
    // canvas resize, changing physics and breaking webcam force consistency.
    const forceEntries = this.imageForce.buildBindGroupEntries();
    this.boidsBindGroups = this._buildBindGroupPair(
      this.boidsBindGroupLayout,
      [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffers[0] } },
        { binding: 2, resource: { buffer: this.particleBuffers[1] } },
        { binding: 3, resource: { buffer: this.obstacleBuffer } },
        { binding: 4, resource: { buffer: this.cellOffsetsBuffer } },
        { binding: 5, resource: { buffer: this.cellCountsBuffer } },
        { binding: 6, resource: { buffer: this.sortedParticlesBuffer } },
        ...forceEntries,
      ],
      [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffers[1] } },
        { binding: 2, resource: { buffer: this.particleBuffers[0] } },
        { binding: 3, resource: { buffer: this.obstacleBuffer } },
        { binding: 4, resource: { buffer: this.cellOffsetsBuffer } },
        { binding: 5, resource: { buffer: this.cellCountsBuffer } },
        { binding: 6, resource: { buffer: this.sortedParticlesBuffer } },
        ...forceEntries,
      ],
    );
  }

  destroy(): void {
    this.webcam.destroy();
    this.imageProcessor.destroy();
    this.imageForce.destroy();
    this._themeObserver?.disconnect();
    this._themeObserver = null;
  }

  /** Read --bg-primary off <html> and convert hex to 0..1 RGB. Falls back to
   *  the current bgColor if the CSS var is empty or malformed (SSR / unknown
   *  contexts). bgra8unorm framebuffers are linear, so simple /255 matches the
   *  prior hardcoded clear value (#0a0804 → 0.039, 0.031, 0.016).
   *
   *  When the light/dark mode flips, also rebuilds the boids render pipeline
   *  (to swap blend mode: additive ↔ alpha) and re-primes the trail textures
   *  so a fresh-mounted controller doesn't fade in from black. */
  private _readBgColor(): void {
    if (typeof document === 'undefined') return;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim();
    let hex = raw.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return;
    this.bgColor = {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: 1,
    };
    // Lightness: simple sum-of-channels threshold. The cream theme sits around
    // 2.85; the darkest dark theme sits around 0.07. Anything above 1.5 needs
    // the alpha-blend path.
    const nextIsLight = (this.bgColor.r + this.bgColor.g + this.bgColor.b) > 1.5;
    if (nextIsLight !== this._isLight) {
      this._isLight = nextIsLight;
      if (this.gpu) {
        const module = this.gpu.device.createShaderModule({ code: this.shaderSource });
        this._createBoidsPipelines(module);
      }
    }
  }

  private _initThemeObserver(): void {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    this._themeObserver = new MutationObserver(() => this._readBgColor());
    this._themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }
}
