import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { createBuffer, createUniformBuffer, resizeCanvasToDisplaySize } from '../../../lib/webgpu/utils';
import shaderCode from './boids.wgsl?raw';

const NUM_PARTICLES = 1500;
const TRIANGLE_SIZE = 0.006;
const TRIANGLE_VERTS = new Float32Array([
  0.0, TRIANGLE_SIZE,
  -TRIANGLE_SIZE * 0.5, -TRIANGLE_SIZE * 0.5,
  TRIANGLE_SIZE * 0.5, -TRIANGLE_SIZE * 0.5,
]);

export interface BoidsParams {
  separationDistance: number;
  alignmentDistance: number;
  cohesionDistance: number;
  separationScale: number;
  alignmentScale: number;
  cohesionScale: number;
  mouseRadius: number;
}

const DEFAULT_PARAMS: BoidsParams = {
  separationDistance: 0.03,
  alignmentDistance: 0.06,
  cohesionDistance: 0.08,
  separationScale: 0.05,
  alignmentScale: 0.04,
  cohesionScale: 0.03,
  mouseRadius: 0.15,
};

export class BoidsController {
  private gpu: WebGPUContext | null = null;
  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
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
  params: BoidsParams = { ...DEFAULT_PARAMS };

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
    this.gpu = await initWebGPU(canvas);
    if (!this.gpu) return false;

    const { device, format } = this.gpu;

    const shaderModule = device.createShaderModule({ code: shaderCode });

    this.uniformBuffer = createUniformBuffer(device, 48);

    const initialData = new Float32Array(NUM_PARTICLES * 4);
    for (let i = 0; i < NUM_PARTICLES; i++) {
      initialData[i * 4 + 0] = (Math.random() - 0.5) * 2;
      initialData[i * 4 + 1] = (Math.random() - 0.5) * 2;
      initialData[i * 4 + 2] = (Math.random() - 0.5) * 0.01;
      initialData[i * 4 + 3] = (Math.random() - 0.5) * 0.01;
    }

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX;
    this.particleBuffers = [
      createBuffer(device, initialData, usage),
      createBuffer(device, initialData, usage),
    ];

    this.vertexBuffer = createBuffer(device, TRIANGLE_VERTS, GPUBufferUsage.VERTEX);

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    this.computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'computeMain' },
    });

    this.bindGroups = [
      device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.particleBuffers[0] } },
          { binding: 2, resource: { buffer: this.particleBuffers[1] } },
        ],
      }),
      device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.particleBuffers[1] } },
          { binding: 2, resource: { buffer: this.particleBuffers[0] } },
        ],
      }),
    ];

    this.renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
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
        module: shaderModule,
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
    const data = new Float32Array(NUM_PARTICLES * 4);
    for (let i = 0; i < NUM_PARTICLES; i++) {
      data[i * 4 + 0] = (Math.random() - 0.5) * 2;
      data[i * 4 + 1] = (Math.random() - 0.5) * 2;
      data[i * 4 + 2] = (Math.random() - 0.5) * 0.01;
      data[i * 4 + 3] = (Math.random() - 0.5) * 0.01;
    }
    device.queue.writeBuffer(this.particleBuffers[0], 0, data);
    device.queue.writeBuffer(this.particleBuffers[1], 0, data);
    this.frame = 0;
  }

  private tick = () => {
    if (!this.running || !this.gpu) return;
    const { device, context, canvas } = this.gpu;

    resizeCanvasToDisplaySize(canvas);

    const uniformData = new Float32Array([
      1.0,
      this.params.separationDistance,
      this.params.alignmentDistance,
      this.params.cohesionDistance,
      this.params.separationScale,
      this.params.alignmentScale,
      this.params.cohesionScale,
      NUM_PARTICLES,
      this.mouseX,
      this.mouseY,
      this.mouseActive ? 1.0 : 0.0,
      this.params.mouseRadius,
    ]);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    const encoder = device.createCommandEncoder();

    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.bindGroups[this.frame % 2]);
    computePass.dispatchWorkgroups(Math.ceil(NUM_PARTICLES / 64));
    computePass.end();

    const textureView = context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.039, g: 0.031, b: 0.016, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setVertexBuffer(0, this.particleBuffers[(this.frame + 1) % 2]);
    renderPass.setVertexBuffer(1, this.vertexBuffer);
    renderPass.draw(3, NUM_PARTICLES);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    this.frame++;
    this.animId = requestAnimationFrame(this.tick);
  };
}
