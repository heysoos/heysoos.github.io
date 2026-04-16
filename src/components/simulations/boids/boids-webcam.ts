// src/components/simulations/boids/boids-webcam.ts

import type { ImageProcessor } from '../../../lib/webgpu/image-editor/image-processor';

export class BoidsWebcam {
  status: 'idle' | 'active' | 'error' = 'idle';
  lastError = '';
  targetFps = 30;
  mirrored  = true;

  availableCameras: MediaDeviceInfo[] = [];
  activeCameraId: string | null = null;

  private video:       HTMLVideoElement | null = null;
  private stream:      MediaStream | null = null;
  private lastFrameTime = 0;

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
    // Pass the video element directly; flipping is handled by the composite shader
    // via a negative scaleX transform — no CPU canvas draw needed.
    processor.writeVideoFrame(this.video, this.mirrored);
  }

  destroy(): void {
    this.stop();
    this.status = 'idle';
  }
}
