// src/components/simulations/field-boids/field-boids-controller.ts
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { resizeCanvasToDisplaySize } from '../../../lib/webgpu/utils';
import {
  DEFAULT_FIELD_BOIDS_PARAMS,
  type FieldBoidsParams,
  type FieldBoidsPreset,
} from './field-boids-types';

export type { FieldBoidsParams, FieldBoidsPreset };

export const MAX_PARTICLES = 2_000_000;

export class FieldBoidsController {
  private gpu: WebGPUContext | null = null;
  private running = false;
  private animId = 0;
  private lastFrameTime = 0;
  maxFps = Infinity;
  tickCount = 0;

  params: FieldBoidsParams = { ...DEFAULT_FIELD_BOIDS_PARAMS };

  /** Longest side of the field texture, in texels. */
  maxFieldSize = 1024;

  /** Page background, re-read when [data-theme] flips. Warm-ember default. */
  private bgColor = { r: 0.039, g: 0.031, b: 0.016, a: 1 };
  /** Accent colour used to tint the field / points. Warm-ember default. */
  private accent = { r: 0.88, g: 0.63, b: 0.25 };
  private themeObserver: MutationObserver | null = null;

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      this.gpu = await initWebGPU(canvas);
      if (!this.gpu) return false;
      this.readTheme();
      this.initThemeObserver();
      return true;
    } catch (e) {
      console.error('FieldBoidsController init error:', e);
      return false;
    }
  }

  loadPreset(preset: FieldBoidsPreset): void {
    Object.assign(this.params, preset.params);
  }

  capturePreset(name: string): FieldBoidsPreset {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return { id, name, params: { ...this.params } };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animId);
    clearTimeout(this.animId);
  }

  reset(): void {
    // Filled in by Task 2 (re-randomise particles, clear field)
  }

  private tick = (): void => {
    if (!this.running || !this.gpu) return;
    if (Number.isFinite(this.maxFps)) {
      const now = performance.now();
      if (now - this.lastFrameTime < (1000 / this.maxFps) - 1) {
        this.animId = requestAnimationFrame(this.tick);
        return;
      }
      this.lastFrameTime = now;
    }
    const { device, context, canvas } = this.gpu;
    resizeCanvasToDisplaySize(canvas);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: this.bgColor,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
    device.queue.submit([encoder.finish()]);

    void device.queue.onSubmittedWorkDone().then(() => {
      if (!this.running) return;
      this.tickCount++;
      if (!Number.isFinite(this.maxFps)) {
        this.animId = requestAnimationFrame(this.tick);
      } else {
        this.animId = window.setTimeout(this.tick, 0) as unknown as number;
      }
    });
  };

  // ── Theme ──────────────────────────────────────────────────────────
  private readTheme(): void {
    if (typeof document === 'undefined') return;
    const css = getComputedStyle(document.documentElement);
    const bg = parseHex(css.getPropertyValue('--bg-primary'));
    const ac = parseHex(css.getPropertyValue('--accent'));
    if (bg) this.bgColor = { ...bg, a: 1 };
    if (ac) this.accent = ac;
  }

  private initThemeObserver(): void {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    this.themeObserver = new MutationObserver(() => this.readTheme());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
}

function parseHex(raw: string): { r: number; g: number; b: number } | null {
  let hex = raw.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255,
  };
}
