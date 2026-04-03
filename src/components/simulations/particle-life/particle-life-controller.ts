import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { createBuffer, createUniformBuffer, resizeCanvasToDisplaySize } from '../../../lib/webgpu/utils';
import shaderCode from './particle-life.wgsl?raw';

const NUM_PARTICLES = 1000;
const NUM_SPECIES = 6;

const QUAD_VERTS = new Float32Array([
  -1, -1,  1, -1,  -1, 1,
  -1,  1,  1, -1,   1, 1,
]);

export class ParticleLifeController {
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

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    this.gpu = await initWebGPU(canvas);
    if (!this.gpu) return false;

    const { device, format } = this.gpu;
    const shaderModule = device.createShaderModule({ code: shaderCode });

    this.uniformBuffer = createUniformBuffer(device, 16);

    const initialData = new Float32Array(NUM_PARTICLES * 6);
    for (let i = 0; i < NUM_PARTICLES; i++) {
      initialData[i * 6 + 0] = (Math.random() - 0.5) * 1.8;
      initialData[i * 6 + 1] = (Math.random() - 0.5) * 1.8;
      initialData[i * 6 + 2] = 0;
      initialData[i * 6 + 3] = 0;
      initialData[i * 6 + 4] = Math.floor(Math.random() * NUM_SPECIES);
      initialData[i * 6 + 5] = 0;
    }

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX;
    this.particleBuffers = [
      createBuffer(device, initialData, usage),
      createBuffer(device, initialData, usage),
    ];

    this.vertexBuffer = createBuffer(device, QUAD_VERTS, GPUBufferUsage.VERTEX);

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
            arrayStride: 6 * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
              { shaderLocation: 2, offset: 16, format: 'float32' },
            ],
          },
          {
            arrayStride: 2 * 4,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 3, offset: 0, format: 'float32x2' },
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

    return true;
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
    const data = new Float32Array(NUM_PARTICLES * 6);
    for (let i = 0; i < NUM_PARTICLES; i++) {
      data[i * 6 + 0] = (Math.random() - 0.5) * 1.8;
      data[i * 6 + 1] = (Math.random() - 0.5) * 1.8;
      data[i * 6 + 4] = Math.floor(Math.random() * NUM_SPECIES);
    }
    device.queue.writeBuffer(this.particleBuffers[0], 0, data);
    device.queue.writeBuffer(this.particleBuffers[1], 0, data);
    this.frame = 0;
  }

  private tick = () => {
    if (!this.running || !this.gpu) return;
    const { device, context, canvas } = this.gpu;

    resizeCanvasToDisplaySize(canvas);

    const uniformData = new Float32Array([1.0, NUM_PARTICLES, NUM_SPECIES, 0.98]);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    const encoder = device.createCommandEncoder();

    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.bindGroups[this.frame % 2]);
    computePass.dispatchWorkgroups(Math.ceil(NUM_PARTICLES / 64));
    computePass.end();

    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.039, g: 0.031, b: 0.016, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setVertexBuffer(0, this.particleBuffers[(this.frame + 1) % 2]);
    renderPass.setVertexBuffer(1, this.vertexBuffer);
    renderPass.draw(6, NUM_PARTICLES);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    this.frame++;
    this.animId = requestAnimationFrame(this.tick);
  };
}
