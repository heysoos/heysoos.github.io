import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { resizeCanvasToDisplaySize } from '../../../lib/webgpu/utils';
import shaderCode from './nca.wgsl?raw';

export class NCAController {
  private gpu: WebGPUContext | null = null;
  private pipeline!: GPURenderPipeline;
  private running = false;
  private animId = 0;

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    this.gpu = await initWebGPU(canvas);
    if (!this.gpu) return false;
    const { device, format } = this.gpu;
    const module = device.createShaderModule({ code: shaderCode });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
    });
    return true;
  }

  start() { if (this.running) return; this.running = true; this.tick(); }
  stop() { this.running = false; cancelAnimationFrame(this.animId); }
  reset() { /* stub */ }

  private tick = () => {
    if (!this.running || !this.gpu) return;
    const { device, context, canvas } = this.gpu;
    resizeCanvasToDisplaySize(canvas);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);
    this.animId = requestAnimationFrame(this.tick);
  };
}
