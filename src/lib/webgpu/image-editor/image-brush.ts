// src/lib/webgpu/image-editor/image-brush.ts

import type { BrushOptions } from './image-editor-types';
import { BrushMode } from './image-editor-types';
import brushShaderCode from './shaders/brush.wgsl?raw';
import blurShaderCode  from './shaders/blur.wgsl?raw';

export class ImageBrush {
  private device!: GPUDevice;
  private brushUniform!: GPUBuffer;
  private paintPipeline!: GPURenderPipeline;   // additive paint
  private erasePipeline!: GPURenderPipeline;   // subtractive erase
  private blurComputePipeline!: GPUComputePipeline;
  private blurUniform!: GPUBuffer;

  init(device: GPUDevice): void {
    this.device = device;

    const brushModule = device.createShaderModule({ code: brushShaderCode });
    const blurModule  = device.createShaderModule({ code: blurShaderCode });

    this.brushUniform = device.createBuffer({
      size: 32,  // 8 × f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.blurUniform = device.createBuffer({
      size: 16,  // 2 × u32 + padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Paint pipeline — additive blend
    this.paintPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: brushModule, entryPoint: 'vsMain' },
      fragment: {
        module: brushModule, entryPoint: 'fsPaint',
        targets: [{
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one',       dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Erase pipeline — subtractive: dst = dst × (1 - src.a)
    this.erasePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: brushModule, entryPoint: 'vsMain' },
      fragment: {
        module: brushModule, entryPoint: 'fsPaint',
        targets: [{
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Blur compute pipeline
    this.blurComputePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: blurModule, entryPoint: 'blurMain' },
    });
  }

  /** Applies a single brush stroke to the given target texture. */
  stroke(opts: BrushOptions, targetTex: GPUTexture, blurTempTex?: GPUTexture): void {
    const { mode, x, y, radius, softness } = opts;

    if (mode === BrushMode.Blur) {
      if (!blurTempTex) return;
      this._applyBlur(targetTex, blurTempTex, x, y, radius, softness);
      return;
    }

    const isErase = mode === BrushMode.ErasePaint || mode === BrushMode.MaskImage;
    const value   = isErase ? 0.0 : 1.0;

    // Write brush uniform
    const u = new Float32Array([x, y, radius, softness, value, 0, 0, 0]);
    this.device.queue.writeBuffer(this.brushUniform, 0, u);

    const pipeline   = isErase ? this.erasePipeline : this.paintPipeline;
    const bindGroup  = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.brushUniform } }],
    });

    const view    = targetTex.createView();
    const encoder = this.device.createCommandEncoder();
    const pass    = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        loadOp:  'load',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private _applyBlur(
    targetTex: GPUTexture, tempTex: GPUTexture,
    cx: number, cy: number, radius: number, _softness: number,
  ): void {
    const { width, height } = targetTex;
    const blurRadius = Math.max(1, Math.round(radius / 4));

    const writeBlurUniform = (r: number, horizontal: number) => {
      const u = new Uint32Array([r, horizontal, 0, 0]);
      this.device.queue.writeBuffer(this.blurUniform, 0, u);
    };

    const encoder = this.device.createCommandEncoder();
    // Copy target → temp so we can read from it
    encoder.copyTextureToTexture(
      { texture: targetTex }, { texture: tempTex }, [width, height, 1],
    );
    this.device.queue.submit([encoder.finish()]);

    // H pass: temp → target
    writeBlurUniform(blurRadius, 1);
    this._dispatchBlur(tempTex, targetTex, width, height);

    // V pass: copy target→temp, then blur temp→target
    const enc2 = this.device.createCommandEncoder();
    enc2.copyTextureToTexture({ texture: targetTex }, { texture: tempTex }, [width, height, 1]);
    this.device.queue.submit([enc2.finish()]);

    writeBlurUniform(blurRadius, 0);
    this._dispatchBlur(tempTex, targetTex, width, height);
  }

  private _dispatchBlur(
    inTex: GPUTexture, outTex: GPUTexture, w: number, h: number,
  ): void {
    const bg = this.device.createBindGroup({
      layout: this.blurComputePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.blurUniform } },
        { binding: 1, resource: inTex.createView()  },
        { binding: 2, resource: outTex.createView() },
      ],
    });
    const enc  = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.blurComputePipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  destroy(): void {
    this.brushUniform.destroy();
    this.blurUniform.destroy();
  }
}
