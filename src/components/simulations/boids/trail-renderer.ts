import trailShader from './trail.wgsl?raw';

export class TrailRenderer {
  private fadePipeline!: GPURenderPipeline;
  private blitPipeline!: GPURenderPipeline;
  private sampler!: GPUSampler;
  private decayBuffer!: GPUBuffer;
  private trailTextures: GPUTexture[] = [];
  private trailViews: GPUTextureView[] = [];
  private fadeBindGroups: GPUBindGroup[] = [];
  private blitBindGroups: GPUBindGroup[] = [];
  private readIdx = 0;
  private writeIdx = 1;

  init(device: GPUDevice, format: GPUTextureFormat, width: number, height: number): void {
    const module = device.createShaderModule({ code: trailShader });

    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    this.decayBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.fadePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'quadVert' },
      fragment: {
        module,
        entryPoint: 'fadeFrag',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.blitPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'quadVert' },
      fragment: {
        module,
        entryPoint: 'blitFrag',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this._createTextures(device, width, height);
  }

  private _createTextures(device: GPUDevice, width: number, height: number): void {
    this.trailTextures.forEach(t => t.destroy());

    const desc: GPUTextureDescriptor = {
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    };
    this.trailTextures = [device.createTexture(desc), device.createTexture(desc)];
    this.trailViews = this.trailTextures.map(t => t.createView());

    this.fadeBindGroups = [0, 1].map(i =>
      device.createBindGroup({
        layout: this.fadePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: this.trailViews[i] },
          { binding: 2, resource: { buffer: this.decayBuffer } },
        ],
      })
    );

    this.blitBindGroups = [0, 1].map(i =>
      device.createBindGroup({
        layout: this.blitPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: this.trailViews[i] },
        ],
      })
    );

    this.readIdx = 0;
    this.writeIdx = 1;
  }

  resize(device: GPUDevice, width: number, height: number): void {
    this._createTextures(device, width, height);
  }

  /**
   * Orchestrates one composited frame.
   *
   * When trailsEnabled:
   *   1. Fade pass: trailTex[read] * decayFactor → trailTex[write]
   *   2. Particle pass: particlePassFn adds boids onto trailTex[write] (loadOp: 'load')
   *   3. Blit pass: trailTex[write] → swapchain
   *
   * When !trailsEnabled:
   *   particlePassFn renders directly to swapchain (loadOp: 'clear'), no trail cost.
   */
  render(
    device: GPUDevice,
    context: GPUCanvasContext,
    decayFactor: number,
    trailsEnabled: boolean,
    particlePassFn: (encoder: GPUCommandEncoder, targetView: GPUTextureView, loadOp: GPULoadOp) => void,
  ): void {
    if (!trailsEnabled) {
      const encoder = device.createCommandEncoder();
      particlePassFn(encoder, context.getCurrentTexture().createView(), 'clear');
      device.queue.submit([encoder.finish()]);
      return;
    }

    device.queue.writeBuffer(this.decayBuffer, 0, new Float32Array([decayFactor]));

    const encoder = device.createCommandEncoder();

    // 1. Fade: read → write
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.trailViews[this.writeIdx],
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setPipeline(this.fadePipeline);
      pass.setBindGroup(0, this.fadeBindGroups[this.readIdx]);
      pass.draw(6);
      pass.end();
    }

    // 2. Particle pass onto trail write texture
    particlePassFn(encoder, this.trailViews[this.writeIdx], 'load');

    // 3. Blit write → swapchain
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setPipeline(this.blitPipeline);
      pass.setBindGroup(0, this.blitBindGroups[this.writeIdx]);
      pass.draw(6);
      pass.end();
    }

    device.queue.submit([encoder.finish()]);

    // Swap ping-pong indices
    this.readIdx = this.writeIdx;
    this.writeIdx = 1 - this.writeIdx;
  }

  destroy(): void {
    this.trailTextures.forEach(t => t.destroy());
  }
}
