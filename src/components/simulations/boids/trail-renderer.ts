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
  private format: GPUTextureFormat = 'bgra8unorm';

  init(device: GPUDevice, format: GPUTextureFormat, width: number, height: number): void {
    this.format = format;
    const module = device.createShaderModule({ code: trailShader });

    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    // 16 bytes: vec4f(bgColor.r, bgColor.g, bgColor.b, decayFactor) — matches
    // the `params: vec4f` uniform in trail.wgsl. Updated each frame in render().
    this.decayBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.fadePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'quadVert' },
      fragment: {
        module,
        entryPoint: 'fadeFrag',
        targets: [{ format: this.format }],
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
      format: this.format,
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

  /** Clear both ping-pong trail textures to bgColor. Use after init/resize so
   *  the fade shader doesn't have to spend ~100 frames converging the
   *  uninitialised (effectively-black) texture memory toward the current bg.
   *  Without this, switching to a light theme on first load shows a black flash
   *  that slowly fades to cream. */
  primeBg(device: GPUDevice, bgColor: GPUColor): void {
    const encoder = device.createCommandEncoder();
    for (const view of this.trailViews) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: bgColor,
        }],
      });
      pass.end();
    }
    device.queue.submit([encoder.finish()]);
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
    bgColor: GPUColor,
    particlePassFn: (encoder: GPUCommandEncoder, targetView: GPUTextureView, loadOp: GPULoadOp) => void,
  ): void {
    if (!trailsEnabled) {
      const encoder = device.createCommandEncoder();
      particlePassFn(encoder, context.getCurrentTexture().createView(), 'clear');
      device.queue.submit([encoder.finish()]);
      return;
    }

    // Pack into params: vec4f { rgb = bgColor, a = decay } — see trail.wgsl.
    const bg = bgColor as GPUColorDict;
    device.queue.writeBuffer(
      this.decayBuffer, 0,
      new Float32Array([bg.r, bg.g, bg.b, decayFactor]),
    );

    const encoder = device.createCommandEncoder();

    // 1. Fade: read → write
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.trailViews[this.writeIdx],
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: bgColor,
        }],
      });
      pass.setPipeline(this.fadePipeline);
      pass.setBindGroup(0, this.fadeBindGroups[this.readIdx]);
      pass.draw(6);
      pass.end();
    }

    // 2. Particle pass onto trail write texture
    particlePassFn(encoder, this.trailViews[this.writeIdx], 'load');

    // 3. Blit write → swapchain. The blit shader is opaque, so this clear value
    //    is never visible, but kept consistent.
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: bgColor,
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
