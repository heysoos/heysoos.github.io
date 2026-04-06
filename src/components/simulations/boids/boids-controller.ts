import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { createBuffer, createUniformBuffer, resizeCanvasToDisplaySize } from '../../../lib/webgpu/utils';
import shaderCode from './boids.wgsl?raw';
import { TrailRenderer } from './trail-renderer';

const MAX_PARTICLES = 2000;

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
  outerRadius: number;
  innerRadius: number;
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
}

const DEFAULT_PARAMS: BoidsParams = {
  dt: 0.016,
  numParticles: 200,
  outerRadius: 0.2,
  innerRadius: 0.05,
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
};

export class BoidsController {
  private gpu: WebGPUContext | null = null;
  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private bindGroupLayout!: GPUBindGroupLayout;
  private particleBuffers!: GPUBuffer[];
  private uniformBuffer!: GPUBuffer;
  private vertexBuffer!: GPUBuffer;
  private bindGroups!: GPUBindGroup[];
  private frame = 0;
  private running = false;
  private animId = 0;
  private mouseX = 0;
  private mouseY = 0;
  private mouseActive = false;
  private renderParamsBindGroup!: GPUBindGroup;
  private trailRenderer = new TrailRenderer();
  private prevCanvasWidth = 0;
  private prevCanvasHeight = 0;

  params: BoidsParams = { ...DEFAULT_PARAMS };
  trailsEnabled = false;
  trailDecay = 0.92;
  readonly shaderSource = shaderCode;

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      this.gpu = await initWebGPU(canvas);
      if (!this.gpu) return false;

      const { device } = this.gpu;

      this.uniformBuffer = createUniformBuffer(device, 96);

      const initialData = new Float32Array(MAX_PARTICLES * 4);
      for (let i = 0; i < MAX_PARTICLES; i++) {
        initialData[i * 4 + 0] = (Math.random() - 0.5) * 2;
        initialData[i * 4 + 1] = (Math.random() - 0.5) * 2;
        initialData[i * 4 + 2] = (Math.random() - 0.5) * 0.1;
        initialData[i * 4 + 3] = (Math.random() - 0.5) * 0.1;
      }

      const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX;
      this.particleBuffers = [
        createBuffer(device, initialData, usage),
        createBuffer(device, initialData, usage),
      ];

      this.vertexBuffer = createBuffer(device, QUAD_VERTS, GPUBufferUsage.VERTEX);

      this.bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
      });

      this.bindGroups = [
        device.createBindGroup({
          layout: this.bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer } },
            { binding: 1, resource: { buffer: this.particleBuffers[0] } },
            { binding: 2, resource: { buffer: this.particleBuffers[1] } },
          ],
        }),
        device.createBindGroup({
          layout: this.bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer } },
            { binding: 1, resource: { buffer: this.particleBuffers[1] } },
            { binding: 2, resource: { buffer: this.particleBuffers[0] } },
          ],
        }),
      ];

      const shaderModule = device.createShaderModule({ code: shaderCode });
      this._createPipelines(shaderModule);
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

      return true;
    } catch (e) {
      console.error('BoidsController init error:', e);
      return false;
    }
  }

  private _createPipelines(module: GPUShaderModule): void {
    const { device, format } = this.gpu!;

    this.computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
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

  async reloadShader(code: string): Promise<{ success: boolean; errors: GPUCompilationMessage[] }> {
    if (!this.gpu) return { success: false, errors: [] };
    const { device } = this.gpu;
    const module = device.createShaderModule({ code });
    const info = await module.compilationInfo();
    const errors = Array.from(info.messages).filter(m => m.type === 'error');
    if (errors.length > 0) return { success: false, errors };
    this._createPipelines(module);
    return { success: true, errors: [] };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.animId);
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

  private tick = () => {
    if (!this.running || !this.gpu) return;
    const { device, context, canvas } = this.gpu;

    const resized = resizeCanvasToDisplaySize(canvas);
    if (resized || canvas.width !== this.prevCanvasWidth || canvas.height !== this.prevCanvasHeight) {
      this.trailRenderer.resize(device, canvas.width, canvas.height);
      this.prevCanvasWidth = canvas.width;
      this.prevCanvasHeight = canvas.height;
    }

    const aspect = canvas.width > 0 && canvas.height > 0
      ? canvas.width / canvas.height : 1.0;

    const uniformArray = new ArrayBuffer(96);
    const v = new DataView(uniformArray);
    v.setFloat32( 0, this.params.dt,                   true);
    v.setFloat32( 4, this.params.outerRadius,          true);
    v.setFloat32( 8, this.params.innerRadius,          true);
    v.setFloat32(12, this.params.attraction,           true);
    v.setFloat32(16, this.params.repulsion,            true);
    v.setFloat32(20, this.params.alignment,            true);
    v.setFloat32(24, this.params.friction,             true);
    v.setFloat32(28, this.params.maxSpeed,             true);
    v.setUint32 (32, this.params.numParticles,         true);
    v.setFloat32(36, this.mouseX,                      true);
    v.setFloat32(40, this.mouseY,                      true);
    v.setFloat32(44, this.mouseActive ? 1.0 : 0.0,     true);
    v.setFloat32(48, this.params.mouseRadius,          true);
    v.setFloat32(52, this.params.coneAngle,            true);
    v.setFloat32(56, aspect,                           true);
    v.setFloat32(60, this.params.size,                 true);
    v.setUint32 (64, this.params.shapeId,              true);
    v.setFloat32(68, this.params.colorR,               true);
    v.setFloat32(72, this.params.colorG,               true);
    v.setFloat32(76, this.params.colorB,               true);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniformArray);

    // Compute pass
    const computeEncoder = device.createCommandEncoder();
    const computePass = computeEncoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.bindGroups[this.frame % 2]);
    computePass.dispatchWorkgroups(Math.ceil(this.params.numParticles / 64));
    computePass.end();
    device.queue.submit([computeEncoder.finish()]);

    // Render pass (delegated to TrailRenderer for compositing)
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
        renderPass.draw(6, this.params.numParticles);
        renderPass.end();
      },
    );

    this.frame++;
    this.animId = requestAnimationFrame(this.tick);
  };
}
