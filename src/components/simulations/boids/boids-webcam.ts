// src/components/simulations/boids/boids-webcam.ts

import type { ImageProcessor } from '../../../lib/webgpu/image-editor/image-processor';
import { ProcessingMode, type ProcessingParams } from '../../../lib/webgpu/image-editor/image-editor-types';

export class BoidsWebcam {
  status: 'idle' | 'active' | 'error' = 'idle';
  lastError = '';
  targetFps = 30;
  mirrored  = true;

  params: ProcessingParams = {
    mode:       ProcessingMode.GradientAttract,
    blurRadius: 0,
    threshold:  0.5,
    invert:     false,
  };

  availableCameras: MediaDeviceInfo[] = [];
  activeCameraId: string | null = null;

  private video:       HTMLVideoElement | null = null;
  private stream:      MediaStream | null = null;
  private lastFrameTime = 0;

  // Canvas used to draw a horizontally-flipped frame when mirrored = true
  // Created lazily on first use to avoid document access at class instantiation time
  private mirrorCanvas: HTMLCanvasElement | null = null;
  private mirrorCtx:   CanvasRenderingContext2D | null = null;

  async enumerateCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.availableCameras = devices.filter(d => d.kind === 'videoinput');
    return this.availableCameras;
  }

  async start(cameraId?: string): Promise<void> {
    this.lastError = '';
    this.stop();
    try {
      await this.enumerateCameras();
      const id = cameraId ?? this.activeCameraId ?? undefined;
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id } } : true,
      });
      const track = this.stream.getVideoTracks()[0];
      this.activeCameraId = track.getSettings().deviceId ?? null;
      this.video = document.createElement('video');
      this.video.srcObject  = this.stream;
      this.video.playsInline = true;
      this.video.muted      = true;
      await this.video.play();
      track.addEventListener('ended', () => {
        this.lastError = 'Camera disconnected';
        this.stop();
        this.status = 'error';
      });
      this.status = 'active';
      this.lastFrameTime = 0;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.stop();
      this.status = 'error';
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video  = null;
    if (this.status !== 'error') this.status = 'idle';
  }

  tick(processor: ImageProcessor): void {
    if (!this.video || this.status !== 'active') return;
    const now = performance.now();
    if (now - this.lastFrameTime < 1000 / this.targetFps) return;
    this.lastFrameTime = now;
    processor.writeVideoFrame(this._getFrameSource());
  }

  private _getFrameSource(): HTMLVideoElement | HTMLCanvasElement {
    if (!this.mirrored || !this.video) return this.video!;
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (!this.mirrorCanvas) {
      this.mirrorCanvas = document.createElement('canvas');
      this.mirrorCtx = this.mirrorCanvas.getContext('2d');
    }
    if (this.mirrorCanvas.width  !== w) this.mirrorCanvas.width  = w;
    if (this.mirrorCanvas.height !== h) this.mirrorCanvas.height = h;
    const ctx = this.mirrorCtx!;
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, -w, 0);
    ctx.restore();
    return this.mirrorCanvas;
  }

  destroy(): void {
    this.stop();
    this.status = 'idle';
  }
}
