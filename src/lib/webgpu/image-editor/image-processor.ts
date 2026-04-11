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
const TEX_USAGE_RENDER_TGT  = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

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
  private sdfPingTexture!:     GPUTexture;  // rgba32float for JFA

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

  // Thumbnail support
  private thumbnailContext: GPUCanvasContext | null = null;
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

    this.sourceTexture?.destroy();
    this.imageMaskTexture?.destroy();
    this.paintCanvasTexture?.destroy();
    this.compositedTexture?.destroy();
    this.blurTempTexture?.destroy();
    this.processedTexture?.destroy();
    this.sdfPingTexture?.destroy();

    this.sourceTexture      = make(TEX_USAGE_COMPUTE_IN);
    this.imageMaskTexture   = make(TEX_USAGE_RENDER_TGT);
    this.paintCanvasTexture = make(TEX_USAGE_RENDER_TGT);
    this.compositedTexture  = make(TEX_USAGE_COMPUTE_OUT);
    this.blurTempTexture    = make(TEX_USAGE_COMPUTE_OUT);
    this.processedTexture   = make(TEX_USAGE_COMPUTE_OUT);
    this.sdfPingTexture     = make(
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      'rgba32float',
    );
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

  getOutputTexture(): GPUTexture  { return this.processedTexture; }
  getOutputSampler(): GPUSampler  { return this.sampler; }

  setThumbnailContext(ctx: GPUCanvasContext): void {
    this.thumbnailContext = ctx;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device: this.device, format, alphaMode: 'premultiplied' });
    this._buildBlitPipeline(format);
    this.renderThumbnail();
  }

  renderThumbnail(): void {
    if (!this.thumbnailContext || !this.blitPipeline) return;
    const swapChainTexture = this.thumbnailContext.getCurrentTexture();
    const bg = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.processedTexture.createView() },
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
      // threshold_bits: store float bit-pattern as uint
      const tmp = new Float32Array([this.params.threshold]);
      dv.setUint32(4, new Uint32Array(tmp.buffer)[0], true);
      device.queue.writeBuffer(this.sdfUniform, 0, buf);
    };

    const makeSDFBG = (pipeline: GPUComputePipeline) => device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sdfUniform } },
        { binding: 1, resource: this.compositedTexture.createView() },
        { binding: 2, resource: this.sdfPingTexture.createView() },
        { binding: 3, resource: this.processedTexture.createView() },
      ],
    });

    // Seed pass
    writeStep(0);
    const e1 = device.createCommandEncoder();
    const p1 = e1.beginComputePass();
    p1.setPipeline(this.sdfSeedPipeline);
    p1.setBindGroup(0, makeSDFBG(this.sdfSeedPipeline));
    p1.dispatchWorkgroups(wg(w), wg(h));
    p1.end();
    device.queue.submit([e1.finish()]);

    // JFA passes
    const maxDim = Math.max(w, h);
    let step = Math.pow(2, Math.ceil(Math.log2(maxDim)));
    while (step >= 1) {
      writeStep(Math.round(step));
      const e = device.createCommandEncoder();
      const p = e.beginComputePass();
      p.setPipeline(this.sdfJumpPipeline);
      p.setBindGroup(0, makeSDFBG(this.sdfJumpPipeline));
      p.dispatchWorkgroups(wg(w), wg(h));
      p.end();
      device.queue.submit([e.finish()]);
      step /= 2;
    }

    // Finalize pass
    const e3 = device.createCommandEncoder();
    const p3 = e3.beginComputePass();
    p3.setPipeline(this.sdfFinalizePipeline);
    p3.setBindGroup(0, makeSDFBG(this.sdfFinalizePipeline));
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
      this.compositedTexture, this.blurTempTexture, this.processedTexture, this.sdfPingTexture,
    ]) t?.destroy();
  }
}
