import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { createBuffer, createUniformBuffer } from '../../../lib/webgpu/utils';
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
  private mouseX = 0;
  private mouseY = 0;
  private mouseActive = false;
  private trailRenderer = new TrailRenderer();
  readonly imageProcessor = new ImageProcessor();
  readonly imageForce     = new BoidsImageForce();
  readonly webcam         = new BoidsWebcam();
  private overlayPipeline: GPURenderPipeline | null = null;
  private overlayBindGroup: GPUBindGroup | null = null;
  private prevCanvasWidth = 0;
  private prevCanvasHeight = 0;
  private _roW = 0;
  private _roH = 0;

  params: BoidsParams = { ...DEFAULT_PARAMS };
  trailsEnabled = false;
  trailDecay = 0.92;
  /** The original boids.wgsl — immutable fallback for presets with no custom shader. */
  readonly defaultShaderSource = shaderCode;
  /** The shader currently loaded (or last loaded via preset). Updated by reloadShader. */
  shaderSource = shaderCode;

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      this.gpu = await initWebGPU(canvas);
      if (!this.gpu) return false;

      const { device } = this.gpu;

      // ── Uniform / obstacle / vertex buffers ──────────────────────────
      this.uniformBuffer = createUniformBuffer(device, 112);
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
      const particleUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX;
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

      // ── Boids update + render pipelines ──────────────────────────────
      const boidsModule = device.createShaderModule({ code: shaderCode });
      this._createBoidsPipelines(boidsModule);

      this.trailRenderer.init(device, this.gpu!.format, canvas.width || 1, canvas.height || 1);
      this.prevCanvasWidth = canvas.width;
      this.prevCanvasHeight = canvas.height;

      canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        this.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        this.mouseActive = true;
      });
      canvas.addEventListener('mouseleave', () => { this.mouseActive = false; });

      // ResizeObserver keeps _roW/_roH up to date so _preFrameSetup never reads clientWidth.
      const canvasRO = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const dpr = window.devicePixelRatio || 1;
        this._roW = Math.floor(entry.contentRect.width  * dpr);
        this._roH = Math.floor(entry.contentRect.height * dpr);
      });
      canvasRO.observe(canvas);

      return true;
    } catch (e) {
      console.error('BoidsController init error:', e);
      return false;
    }
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
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
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
      };

      device.pushErrorScope('validation');
      const module = device.createShaderModule({ code });
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

  reset() {
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

  private _packUniforms(aspect: number): ArrayBuffer {
    const buf = new ArrayBuffer(112);
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
    v.setFloat32(48, this.params.mouseRadius,           true);
    v.setFloat32(52, this.params.coneAngle,             true);
    v.setFloat32(56, aspect,                            true);
    v.setFloat32(60, this.params.size,                  true);
    v.setUint32 (64, this.params.shapeId,               true);
    v.setFloat32(68, this.params.colorR,                true);
    v.setFloat32(72, this.params.colorG,                true);
    v.setFloat32(76, this.params.colorB,                true);
    v.setFloat32(80, this.params.opacity,               true);
    v.setUint32 (84, this.params.opacityMode,           true);
    const gridDim = Math.max(4, Math.min(MAX_GRID_DIM, Math.floor(2.0 / this.params.attractionRadius)));
    v.setUint32 (88, gridDim,                           true);
    v.setUint32 (92, this.frame,                        true);
    const imgParams = this.imageForce.getExtraParams();
    v.setFloat32(96,  imgParams.imageStrength,          true);
    v.setUint32 (100, imgParams.imageForceMode,         true);
    v.setUint32 (104, imgParams.imageInvert,            true);
    v.setFloat32(108, this.params.noise ?? 0.0,         true);
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
    // Apply pending resize from ResizeObserver — no layout-forcing clientWidth read in the rAF loop.
    const tw = this._roW, th = this._roH;
    if (tw > 0 && th > 0 && (canvas.width !== tw || canvas.height !== th)) {
      canvas.width  = tw;
      canvas.height = th;
    }
    const resized = canvas.width !== this.prevCanvasWidth || canvas.height !== this.prevCanvasHeight;
    if (resized) {
      this.trailRenderer.resize(device, canvas.width, canvas.height);
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
    computePass.dispatchWorkgroups(Math.ceil(gridSize / 256));

    // Pass 2: gridAssign
    computePass.setPipeline(this.gridAssignPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(Math.ceil(N / 256));

    // Pass 3: prefixSum
    computePass.setPipeline(this.prefixSumPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(1);

    // Pass 4: scatter
    computePass.setPipeline(this.scatterPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(Math.ceil(N / 256));

    // Pass 5: scatterData — copy particle data into cell-sorted order
    computePass.setPipeline(this.scatterDataPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(Math.ceil(N / 256));

    // Pass 6: boids update
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.boidsBindGroups[this.frame % 2]);
    computePass.dispatchWorkgroups(Math.ceil(N / 256));

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
      (encoder, targetView, loadOp) => {
        const renderPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: targetView,
            clearValue: { r: 0.039, g: 0.031, b: 0.016, a: 1 },
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
    const gridDim = Math.max(4, Math.min(MAX_GRID_DIM, Math.floor(2.0 / this.params.attractionRadius)));
    const gridSize = gridDim * gridDim;

    this._runComputePasses(device, N, gridDim, gridSize);
    this._renderFrame(device, context, N);

    this.frame++;
    void device.queue.onSubmittedWorkDone().then(() => {
      if (!this.running) return;
      this.tickCount++;
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
  }
}
