// src/components/simulations/boids/boids-image-force.ts

import type { ImageProcessor } from '../../../lib/webgpu/image-editor/image-processor';
import { ProcessingMode } from '../../../lib/webgpu/image-editor/image-editor-types';

export type ImageForceMode = typeof ProcessingMode[keyof typeof ProcessingMode];

export class BoidsImageForce {
  private device!: GPUDevice;
  private processor!: ImageProcessor;
  private dummyTexture!: GPUTexture;

  private _strength   = 0.5;
  private _forceMode: ImageForceMode = ProcessingMode.LuminanceAttract;
  private _invert     = false;
  private _enabled    = true;

  init(device: GPUDevice, processor: ImageProcessor): void {
    this.device    = device;
    this.processor = processor;
    // 1×1 black texture for when no image is loaded
    this.dummyTexture = device.createTexture({
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
  }

  buildBindGroupEntries(): GPUBindGroupEntry[] {
    const tex = this.processor.hasImage || this.processor.hasPaint
      ? this.processor.getOutputTexture()
      : this.dummyTexture;
    return [
      { binding: 7, resource: tex.createView() },
      { binding: 8, resource: this.processor.getOutputSampler() },
    ];
  }

  getExtraParams(): { imageStrength: number; imageForceMode: number; imageInvert: number } {
    const active = this._enabled && (this.processor.hasImage || this.processor.hasPaint);
    return {
      imageStrength:  active ? this._strength : 0.0,
      imageForceMode: this._forceMode,
      imageInvert:    this._invert ? 1 : 0,
    };
  }

  setStrength(v: number):          void { this._strength  = v; }
  setForceMode(m: ImageForceMode): void { this._forceMode = m; }
  setInvert(v: boolean):           void { this._invert    = v; }
  setEnabled(v: boolean):          void { this._enabled   = v; }

  isActive(): boolean {
    return this._enabled && (this.processor.hasImage || this.processor.hasPaint);
  }

  destroy(): void {
    this.dummyTexture.destroy();
  }
}
