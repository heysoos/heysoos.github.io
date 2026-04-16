// src/lib/webgpu/image-editor/image-processor.ts

import type { ImageTransform, ProcessingParams, BrushOptions } from './image-editor-types';
import { ProcessingMode, BrushMode } from './image-editor-types';
import { ImageBrush } from './image-brush';
import compositeCode     from './shaders/composite.wgsl?raw';
import blurCode          from './shaders/blur.wgsl?raw';
import modeLuminanceCode from './shaders/mode-luminance.wgsl?raw';
import modeGradientCode  from './shaders/mode-gradient.wgsl?raw';
import modeThresholdCode from './shaders/mode-threshold.wgsl?raw';
import modeSdfCode       from './shaders/mode-sdf.wgsl?raw';

const TEX_USAGE_COMPUTE_IN  = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
const TEX_USAGE_COMPUTE_OUT = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
const TEX_USAGE_RENDER_TGT  = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING;

export class ImageProcessor {
  private device!: GPUDevice;
  private brush!: ImageBrush;
  private sampler!: GPUSampler;

  // Texture stack
  private sourceTexture!:      GPUTexture;
  private imageMaskTexture!:   GPUTexture;  // all-ones by default
  private paintCanvasTexture!: GPUTexture;  // zeros by default
  private compositedTexture!:  GPUTexture;
  private blurTempTexture!:    GPUTexture;
  private processedTexture!:   GPUTexture;
  private sdfPingTexture!:     GPUTexture;  // rgba16float ping for JFA
  private sdfPongTexture!:     GPUTexture;  // rgba16float pong for JFA

  // Pipelines
  private compositePipeline!:     GPUComputePipeline;
  private blurPipeline!:          GPUComputePipeline;
  private modeLuminancePipeline!: GPUComputePipeline;
  private modeGradientPipeline!:  GPUComputePipeline;
  private modeThresholdPipeline!: GPUComputePipeline;
  private sdfSeedPipeline!:       GPUComputePipeline;
  private sdfJumpPipeline!:       GPUComputePipeline;
  private sdfFinalizePipeline!:   GPUComputePipeline;

  // Uniforms
  private transformUniform!: GPUBuffer;  // 16 bytes (4 × f32)
  private blurUniform!:      GPUBuffer;  // 16 bytes
  private modeUniform!:      GPUBuffer;  // 16 bytes
  private sdfUniform!:       GPUBuffer;  // 16 bytes

  // State
  private width  = 1;
  private height = 1;
  imageWidth  = 1;
  imageHeight = 1;
  hasPaint = false;
  hasImage = false;

  transform: ImageTransform = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
  params: ProcessingParams = {
    mode: ProcessingMode.LuminanceAttract,
    blurRadius: 0,
    threshold:  0.5,
    invert:     false,
  };

  // Thumbnail / preview support
  private thumbnailContext: GPUCanvasContext | null = null;
  private previewContext:   GPUCanvasContext | null = null;
  private blitPipeline: GPURenderPipeline | null = null;

  init(device: GPUDevice): void {
    this.device  = device;
    this.brush   = new ImageBrush();
    this.brush.init(device);
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

    // Uniforms
    this.transformUniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.blurUniform      = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.modeUniform      = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sdfUniform       = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Pipelines
    const make = (code: string, entry: string) => device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code }), entryPoint: entry },
    });
    this.compositePipeline     = make(compositeCode,     'compositeMain');
    this.blurPipeline          = make(blurCode,          'blurMain');
    this.modeLuminancePipeline = make(modeLuminanceCode, 'modeMain');
    this.modeGradientPipeline  = make(modeGradientCode,  'modeMain');
    this.modeThresholdPipeline = make(modeThresholdCode, 'modeMain');
    this.sdfSeedPipeline       = make(modeSdfCode,       'sdfSeed');
    this.sdfJumpPipeline       = make(modeSdfCode,       'sdfJump');
    this.sdfFinalizePipeline   = make(modeSdfCode,       'sdfFinalize');

    this._allocateTextures(1, 1);
    this._clearMaskToOnes();
    this._triggerReprocess();
  }

  private _allocateTextures(w: number, h: number): void {
    const d = this.device;
    const make = (usage: number, format: GPUTextureFormat = 'rgba8unorm') =>
      d.createTexture({ size: [w, h, 1], format, usage });

    // sourceTexture dimensions follow the image/webcam resolution, not the canvas size.
    // Only create a 1×1 placeholder on first init; loadImage / writeVideoFrame / clearImage manage it after that.
    if (!this.sourceTexture) {
      this.sourceTexture = d.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: TEX_USAGE_COMPUTE_IN });
    }

    this.imageMaskTexture?.destroy();
    this.paintCanvasTexture?.destroy();
    this.compositedTexture?.destroy();
    this.blurTempTexture?.destroy();
    this.processedTexture?.destroy();
    this.sdfPingTexture?.destroy();
    this.sdfPongTexture?.destroy();

    this.imageMaskTexture   = make(TEX_USAGE_RENDER_TGT);
    this.paintCanvasTexture = make(TEX_USAGE_RENDER_TGT);
    this.compositedTexture  = make(TEX_USAGE_COMPUTE_OUT);
    this.blurTempTexture    = make(TEX_USAGE_COMPUTE_OUT);
    this.processedTexture   = make(TEX_USAGE_COMPUTE_OUT);
    // rgba16float: filterable (sampleType:'float'), supports TEXTURE_BINDING for
    // textureLoad and STORAGE_BINDING for write — no extensions needed.
    const sdfUsage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    this.sdfPingTexture = make(sdfUsage, 'rgba16float');
    this.sdfPongTexture = make(sdfUsage, 'rgba16float');
    this.width  = w;
    this.height = h;
  }

  private _clearMaskToOnes(): void {
    // Render a white fullscreen quad into imageMaskTexture
    const enc  = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view:       this.imageMaskTexture.createView(),
        loadOp:     'clear',
        clearValue: { r: 1, g: 1, b: 1, a: 1 },
        storeOp:    'store',
      }],
    });
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  loadImage(bitmap: ImageBitmap): void {
    const { device } = this;
    this.imageWidth  = bitmap.width;
    this.imageHeight = bitmap.height;
    this.hasImage    = true;

    // Re-allocate sourceTexture at image resolution
    this.sourceTexture.destroy();
    this.sourceTexture = device.createTexture({
      size: [bitmap.width, bitmap.height, 1],
      format: 'rgba8unorm',
      usage: TEX_USAGE_COMPUTE_IN | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: this.sourceTexture },
      [bitmap.width, bitmap.height],
    );

    // Default transform: contain
    this._applyContainTransform();
    this._triggerReprocess();
  }

  clearImage(): void {
    this.hasImage = false;
    this.sourceTexture.destroy();
    this.sourceTexture = this.device.createTexture({
      size: [1, 1, 1], format: 'rgba8unorm', usage: TEX_USAGE_COMPUTE_IN,
    });
    this._clearMaskToOnes();
    this.transform = { offsetX: 0, offsetY: 0, scaleX: this.width, scaleY: this.height };
    this._triggerReprocess();
  }

  resetPaint(): void {
    const enc  = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.paintCanvasTexture.createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store',
      }],
    });
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.hasPaint = false;
    this._triggerReprocess();
  }

  setTransform(t: ImageTransform): void {
    this.transform = t;
    this._triggerReprocess();
  }

  setMode(mode: ProcessingMode): void   { this.params.mode = mode; this._triggerReprocess(); }
  setBlurRadius(r: number): void        { this.params.blurRadius = r; this._triggerReprocess(); }
  setThreshold(v: number): void         { this.params.threshold = v; this._triggerReprocess(); }
  setInvert(v: boolean): void           { this.params.invert = v; this._triggerReprocess(); }

  brushStroke(opts: BrushOptions): void {
    const target = opts.mode === BrushMode.MaskImage
      ? this.imageMaskTexture
      : this.paintCanvasTexture;
    this.brush.stroke(opts, target, this.blurTempTexture);
    if (opts.mode !== BrushMode.MaskImage) this.hasPaint = true;
    this._triggerReprocess();
  }

  resize(w: number, h: number): void {
    if (w === this.width && h === this.height) return;
    // Preserve paint by reading it out — not in scope, just reallocate
    this._allocateTextures(w, h);
    this._clearMaskToOnes();
    if (this.hasImage) this._applyContainTransform();
    this._triggerReprocess();
  }

  getOutputTexture(): GPUTexture     { return this.processedTexture; }
  getCompositedTexture(): GPUTexture { return this.compositedTexture; }
  getOutputSampler(): GPUSampler     { return this.sampler; }
  get canvasWidth():  number         { return this.width;  }
  get canvasHeight(): number         { return this.height; }

  writeVideoFrame(source: HTMLVideoElement | HTMLCanvasElement): void {
    // Skip if video not ready yet
    if (source instanceof HTMLVideoElement && source.readyState < 2 /* HAVE_CURRENT_DATA */) return;

    const { device } = this;
    const w = source instanceof HTMLVideoElement ? source.videoWidth  : (source as HTMLCanvasElement).width;
    const h = source instanceof HTMLVideoElement ? source.videoHeight : (source as HTMLCanvasElement).height;
    if (w === 0 || h === 0) return;

    // Reallocate sourceTexture only when dimensions change (once on start, rare after)
    if (!this.hasImage || this.imageWidth !== w || this.imageHeight !== h) {
      this.sourceTexture.destroy();
      this.sourceTexture = device.createTexture({
        size: [w, h, 1],
        format: 'rgba8unorm',
        usage: TEX_USAGE_COMPUTE_IN | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.imageWidth  = w;
      this.imageHeight = h;
      this.hasImage    = true;
      this._applyContainTransform();
    }

    try {
      device.queue.copyExternalImageToTexture(
        { source: source as HTMLVideoElement | HTMLCanvasElement, flipY: false },
        { texture: this.sourceTexture },
        [w, h],
      );
    } catch (e) {
      console.warn('[ImageProcessor] copyExternalImageToTexture failed, frame skipped:', e);
      return;
    }

    this._triggerReprocess();
  }

  setThumbnailContext(ctx: GPUCanvasContext): void {
    this.thumbnailContext = ctx;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device: this.device, format, alphaMode: 'premultiplied' });
    this._buildBlitPipeline(format);
    this.renderThumbnail();
  }

  renderThumbnail(): void {
    this._blitToContext(this.thumbnailContext, this.processedTexture);
  }

  setPreviewContext(ctx: GPUCanvasContext): void {
    this.previewContext = ctx;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device: this.device, format, alphaMode: 'premultiplied' });
    if (!this.blitPipeline) this._buildBlitPipeline(format);
  }

  clearPreviewContext(): void {
    this.previewContext = null;
  }

  renderPreview(showForce: boolean): void {
    const tex = showForce ? this.processedTexture : this.compositedTexture;
    this._blitToContext(this.previewContext, tex);
  }

  private _blitToContext(ctx: GPUCanvasContext | null, texture: GPUTexture): void {
    if (!ctx || !this.blitPipeline) return;
    const swapChainTexture = ctx.getCurrentTexture();
    const bg = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: texture.createView() },
      ],
    });
    const enc  = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: swapChainTexture.createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
      }],
    });
    pass.setPipeline(this.blitPipeline);
    pass.setBindGroup(0, bg);
    pass.draw(6);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  private _buildBlitPipeline(format: GPUTextureFormat): void {
    const blitWGSL = /* wgsl */`
      @group(0) @binding(0) var s: sampler;
      @group(0) @binding(1) var t: texture_2d<f32>;
      struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> V {
        var pos = array<vec2f,6>(
          vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),
          vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
        return V(vec4f(pos[i],0,1), pos[i]*0.5+0.5);
      }
      @fragment fn fs(v: V) -> @location(0) vec4f {
        return textureSample(t, s, vec2f(v.uv.x, 1.0 - v.uv.y));
      }
    `;
    const mod = this.device.createShaderModule({ code: blitWGSL });
    this.blitPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  private _applyContainTransform(): void {
    const imgAspect    = this.imageWidth / this.imageHeight;
    const canvasAspect = this.width / this.height;
    let iw: number, ih: number;
    if (imgAspect > canvasAspect) {
      iw = this.width;  ih = iw / imgAspect;
    } else {
      ih = this.height; iw = ih * imgAspect;
    }
    this.transform = {
      offsetX: (this.width  - iw) / 2,
      offsetY: (this.height - ih) / 2,
      scaleX: iw, scaleY: ih,
    };
  }

  private _triggerReprocess(): void {
    const { device, width, height } = this;
    const enc = device.createCommandEncoder();
    const wg  = (n: number) => Math.ceil(n / 8);

    // ── Pass 1: Composite ──────────────────────────────────────────────
    const tf = new Float32Array([
      this.transform.offsetX, this.transform.offsetY,
      this.transform.scaleX,  this.transform.scaleY,
    ]);
    device.queue.writeBuffer(this.transformUniform, 0, tf);

    const compositeBG = device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.transformUniform } },
        { binding: 1, resource: this.sourceTexture.createView() },
        { binding: 2, resource: this.imageMaskTexture.createView() },
        { binding: 3, resource: this.paintCanvasTexture.createView() },
        { binding: 4, resource: this.compositedTexture.createView() },
      ],
    });
    const compositePass = enc.beginComputePass();
    compositePass.setPipeline(this.compositePipeline);
    compositePass.setBindGroup(0, compositeBG);
    compositePass.dispatchWorkgroups(wg(width), wg(height));
    compositePass.end();
    device.queue.submit([enc.finish()]);

    // ── Pass 2: Optional blur ─────────────────────────────────────────
    if (this.params.blurRadius > 0) {
      const r = Math.round(this.params.blurRadius);
      const makeBlurBG = (inT: GPUTexture, outT: GPUTexture, horiz: number) => {
        device.queue.writeBuffer(this.blurUniform, 0, new Uint32Array([r, horiz, 0, 0]));
        return device.createBindGroup({
          layout: this.blurPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.blurUniform } },
            { binding: 1, resource: inT.createView() },
            { binding: 2, resource: outT.createView() },
          ],
        });
      };
      const e1 = device.createCommandEncoder();
      const p1 = e1.beginComputePass();
      p1.setPipeline(this.blurPipeline);
      p1.setBindGroup(0, makeBlurBG(this.compositedTexture, this.blurTempTexture, 1));
      p1.dispatchWorkgroups(wg(width), wg(height));
      p1.end();
      device.queue.submit([e1.finish()]);

      const e2 = device.createCommandEncoder();
      const p2 = e2.beginComputePass();
      p2.setPipeline(this.blurPipeline);
      p2.setBindGroup(0, makeBlurBG(this.blurTempTexture, this.compositedTexture, 0));
      p2.dispatchWorkgroups(wg(width), wg(height));
      p2.end();
      device.queue.submit([e2.finish()]);
    }

    // ── Pass 3: Mode pass ─────────────────────────────────────────────
    const mode = this.params.mode;

    if (mode === ProcessingMode.SDF) {
      this._runSdfPipeline(width, height);
    } else {
      const pipeline = mode <= 1 ? this.modeLuminancePipeline
        : mode <= 3 ? this.modeGradientPipeline
        : this.modeThresholdPipeline;

      const modeData = new ArrayBuffer(16);
      const mv = new DataView(modeData);
      mv.setUint32(0, mode, true);
      mv.setFloat32(8, this.params.threshold, true); // threshold_bits at byte 8
      device.queue.writeBuffer(this.modeUniform, 0, modeData);

      const modeBG = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.modeUniform } },
          { binding: 1, resource: this.compositedTexture.createView() },
          { binding: 2, resource: this.processedTexture.createView() },
        ],
      });
      const e3 = device.createCommandEncoder();
      const p3 = e3.beginComputePass();
      p3.setPipeline(pipeline);
      p3.setBindGroup(0, modeBG);
      p3.dispatchWorkgroups(wg(width), wg(height));
      p3.end();
      device.queue.submit([e3.finish()]);
    }

    this.renderThumbnail();
  }

  private _runSdfPipeline(w: number, h: number): void {
    const { device } = this;
    const wg = (n: number) => Math.ceil(n / 8);

    const writeStep = (step: number) => {
      const buf = new ArrayBuffer(16);
      const dv  = new DataView(buf);
      dv.setUint32(0, step, true);
      const tmp = new Float32Array([this.params.threshold]);
      dv.setUint32(4, new Uint32Array(tmp.buffer)[0], true);
      device.queue.writeBuffer(this.sdfUniform, 0, buf);
    };

    // Each pipeline has a different auto-layout (only the bindings it actually uses).
    // sdfSeed:     uses bindings 0, 1, 3        (no srcTex/2, no outTex/4)
    // sdfJump:     uses bindings 0, 2, 3        (no inTex/1, no outTex/4)
    // sdfFinalize: uses bindings 0, 1, 2, 4     (no dstTex/3)

    const makeSeedBG = (dst: GPUTexture) => device.createBindGroup({
      layout: this.sdfSeedPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sdfUniform } },
        { binding: 1, resource: this.compositedTexture.createView() },
        { binding: 3, resource: dst.createView() },
      ],
    });

    const makeJumpBG = (src: GPUTexture, dst: GPUTexture) => device.createBindGroup({
      layout: this.sdfJumpPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sdfUniform } },
        { binding: 2, resource: src.createView() },
        { binding: 3, resource: dst.createView() },
      ],
    });

    const makeFinalizeBG = (src: GPUTexture) => device.createBindGroup({
      layout: this.sdfFinalizePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sdfUniform } },
        { binding: 1, resource: this.compositedTexture.createView() },
        { binding: 2, resource: src.createView() },
        { binding: 4, resource: this.processedTexture.createView() },
      ],
    });

    // Pass 1: seed — write into ping
    writeStep(0);
    const e1 = device.createCommandEncoder();
    const p1 = e1.beginComputePass();
    p1.setPipeline(this.sdfSeedPipeline);
    p1.setBindGroup(0, makeSeedBG(this.sdfPingTexture));
    p1.dispatchWorkgroups(wg(w), wg(h));
    p1.end();
    device.queue.submit([e1.finish()]);

    // Pass 2 (repeated): JFA — alternate ping/pong as src/dst
    const maxDim = Math.max(w, h);
    let step = Math.pow(2, Math.ceil(Math.log2(maxDim)));
    let src = this.sdfPingTexture;
    let dst = this.sdfPongTexture;
    while (step >= 1) {
      writeStep(Math.round(step));
      const e = device.createCommandEncoder();
      const p = e.beginComputePass();
      p.setPipeline(this.sdfJumpPipeline);
      p.setBindGroup(0, makeJumpBG(src, dst));
      p.dispatchWorkgroups(wg(w), wg(h));
      p.end();
      device.queue.submit([e.finish()]);
      [src, dst] = [dst, src];  // swap: last dst becomes new src
      step /= 2;
    }
    // src now points to the texture last written by the final JFA pass

    // Pass 3: finalize — read from src (last JFA output), write to processedTexture
    const e3 = device.createCommandEncoder();
    const p3 = e3.beginComputePass();
    p3.setPipeline(this.sdfFinalizePipeline);
    p3.setBindGroup(0, makeFinalizeBG(src));
    p3.dispatchWorkgroups(wg(w), wg(h));
    p3.end();
    device.queue.submit([e3.finish()]);
  }

  destroy(): void {
    this.brush.destroy();
    this.transformUniform.destroy();
    this.blurUniform.destroy();
    this.modeUniform.destroy();
    this.sdfUniform.destroy();
    for (const t of [
      this.sourceTexture, this.imageMaskTexture, this.paintCanvasTexture,
      this.compositedTexture, this.blurTempTexture, this.processedTexture,
      this.sdfPingTexture, this.sdfPongTexture,
    ]) t?.destroy();
  }
}
