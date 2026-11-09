// src/lib/og/og-render.ts
// Reproducible stills from the real sims, for the favicon and the link-preview
// images (/admin/og). A recipe is a stack of layers; each layer is one sim at
// one preset, started from a seed and stepped a fixed number of times, so the
// same recipe always gives (very nearly) the same picture. Float blending on
// the GPU can differ in the last bit between runs; the composition does not.

import { CPPNController } from '../../components/simulations/cppn/cppn-controller';
import { FieldBoidsController } from '../../components/simulations/field-boids/field-boids-controller';
import { DEFAULT_FIELD_BOIDS_PARAMS } from '../../components/simulations/field-boids/field-boids-types';
import { BoidsController } from '../../components/simulations/boids/boids-controller';
import { NCAController } from '../../components/simulations/nca/nca-controller';
import { applyBoidsPreset } from '../sim-page/boids-preset-apply';
import { CPPN_PRESETS } from '../../data/cppn-presets';
import { FIELD_BOIDS_PRESETS } from '../../data/field-boids-presets';
import { BOIDS_PRESETS } from '../../data/boids-presets';
import { NCA_PRESETS } from '../../data/nca-presets';

export type Sim = 'cppn' | 'field-boids' | 'boids' | 'nca';
export type Blend = 'normal' | 'mask' | 'multiply' | 'screen' | 'lighter';

export interface Layer {
  sim: Sim;
  preset: string;
  /** Particle / grid seed; for CPPN the motion (phase-offset) seed. */
  seed: number;
  /** Sim steps before the capture (boids, field-boids, nca). */
  steps?: number;
  /** CPPN: seconds of latent motion from phase 0. */
  time?: number;
  /** CPPN: regenerate the preset's weights from this seed instead of using the stored ones. */
  weightSeed?: number;
  zoom?: number;
  /** NCA: output pixels per grid cell. The grid is sized to the image (the rule is local, so any size works). Default 3. */
  cell?: number;
  cx?: number;
  cy?: number;
  /** How this layer combines with the stack below it. `mask`: its brightness × gain becomes the stack's alpha. */
  blend?: Blend;
  gain?: number;
  opacity?: number;
  /** Param overrides on top of the preset (boids, field-boids). */
  params?: Record<string, number>;
}

export interface Recipe {
  id: string;
  layers: Layer[];
  /** Icons: crop shape. */
  shape?: 'square' | 'circle' | 'squircle';
  /** `theme` fills the page background behind the stack (default); `transparent` keeps masked-out areas see-through. */
  bg?: 'theme' | 'transparent';
  /** Cards: draw the site name and page title over the image. */
  title?: boolean;
}

export const PRESET_IDS: Record<Sim, Array<{ id: string; name: string }>> = {
  cppn: CPPN_PRESETS.map(p => ({ id: p.id, name: p.name })),
  'field-boids': FIELD_BOIDS_PRESETS.map(p => ({ id: p.id, name: p.name })),
  boids: BOIDS_PRESETS.map(p => ({ id: p.id, name: p.name })),
  nca: NCA_PRESETS.map(p => ({ id: p.id, name: p.name })),
};

export type Progress = (msg: string) => void;
type AnyCtrl = CPPNController | FieldBoidsController | BoidsController | NCAController;

export class OgRenderer {
  private ctrls = new Map<Sim, Promise<{ ctrl: AnyCtrl; canvas: HTMLCanvasElement } | null>>();
  private chain: Promise<unknown> = Promise.resolve();

  private get(sim: Sim) {
    let p = this.ctrls.get(sim);
    if (!p) {
      p = (async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctrl: AnyCtrl =
          sim === 'cppn' ? new CPPNController()
          : sim === 'field-boids' ? new FieldBoidsController()
          : sim === 'boids' ? new BoidsController()
          : new NCAController();
        const ok = await ctrl.init(canvas);
        return ok ? { ctrl, canvas } : null;
      })();
      this.ctrls.set(sim, p);
    }
    return p;
  }

  /** Renders run one at a time (the sims share one GPU device and their own canvases). */
  render(recipe: Recipe, width: number, height: number, onProgress?: Progress): Promise<HTMLCanvasElement> {
    const run = this.chain.then(() => this._render(recipe, width, height, onProgress));
    this.chain = run.catch(() => {});
    return run;
  }

  private async _render(recipe: Recipe, width: number, height: number, onProgress?: Progress): Promise<HTMLCanvasElement> {
    const stack = make2d(width, height);
    const sctx = stack.getContext('2d')!;
    for (const [li, layer] of recipe.layers.entries()) {
      onProgress?.(`layer ${li + 1}/${recipe.layers.length} ${layer.sim}`);
      const img = await this.renderLayer(layer, width, height, (d, t) =>
        onProgress?.(`layer ${li + 1}/${recipe.layers.length} ${layer.sim} · step ${d}/${t}`));
      sctx.save();
      sctx.globalAlpha = layer.opacity ?? 1;
      const blend = layer.blend ?? 'normal';
      if (blend === 'mask') {
        sctx.globalCompositeOperation = 'destination-in';
        sctx.drawImage(lumaToAlpha(img, layer.gain ?? 1.5), 0, 0);
      } else {
        sctx.globalCompositeOperation = blend === 'normal' ? 'source-over' : blend;
        sctx.drawImage(img, 0, 0);
      }
      sctx.restore();
    }
    if ((recipe.bg ?? 'theme') === 'theme') {
      sctx.save();
      sctx.globalCompositeOperation = 'destination-over';
      sctx.fillStyle = themeColor('--bg-primary', '#0a0804');
      sctx.fillRect(0, 0, width, height);
      sctx.restore();
    }
    if (!recipe.shape || recipe.shape === 'square') return stack;
    const out = make2d(width, height);
    const o = out.getContext('2d')!;
    o.beginPath();
    if (recipe.shape === 'circle') o.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
    else o.roundRect(0, 0, width, height, Math.min(width, height) * 0.22);
    o.clip();
    o.drawImage(stack, 0, 0);
    return out;
  }

  private async renderLayer(layer: Layer, width: number, height: number, onSteps?: (done: number, total: number) => void): Promise<HTMLCanvasElement> {
    const got = await this.get(layer.sim);
    if (!got) throw new Error(`WebGPU init failed for ${layer.sim}`);
    const { ctrl, canvas } = got;
    const out = make2d(width, height);
    const o = out.getContext('2d')!;

    if (ctrl instanceof CPPNController) {
      const p = CPPN_PRESETS.find(x => x.id === layer.preset);
      if (!p) throw new Error(`No CPPN preset "${layer.preset}"`);
      if (layer.weightSeed !== undefined) await ctrl.setState(p.config, layer.weightSeed);
      else await ctrl.setState(p.config, p.seed, p.weights);
      ctrl.viewZoom = layer.zoom ?? 1;
      ctrl.viewCx = layer.cx ?? 0;
      ctrl.viewCy = layer.cy ?? 0;
      ctrl.resetLatent();
      ctrl.renderStill({ width, height, time: layer.time ?? 0, motionSeed: layer.seed });
      o.drawImage(canvas, 0, 0);
      return out;
    }

    if (ctrl instanceof FieldBoidsController) {
      const p = FIELD_BOIDS_PRESETS.find(x => x.id === layer.preset);
      if (!p) throw new Error(`No field-boids preset "${layer.preset}"`);
      ctrl.params = { ...DEFAULT_FIELD_BOIDS_PARAMS, ...p.params, ...(layer.params ?? {}) };
      ctrl.gravity = 0;
      await ctrl.prepareStill({ width, height, seed: layer.seed, steps: layer.steps ?? 600, viewZoom: layer.zoom, viewCx: layer.cx, viewCy: layer.cy, onProgress: onSteps });
      ctrl.drawStill();
      o.drawImage(canvas, 0, 0);
      return out;
    }

    if (ctrl instanceof BoidsController) {
      const p = BOIDS_PRESETS.find(x => x.id === layer.preset);
      if (!p) throw new Error(`No boids preset "${layer.preset}"`);
      await applyBoidsPreset(ctrl, p);
      Object.assign(ctrl.params, layer.params ?? {});
      await ctrl.prepareStill({ width, height, seed: layer.seed, steps: layer.steps ?? 600, viewZoom: layer.zoom, viewCx: layer.cx, viewCy: layer.cy, onProgress: onSteps });
      ctrl.drawStill();
      o.drawImage(canvas, 0, 0);
      return out;
    }

    // NCA: run on a grid sized to the output (`cell` px per cell), then scale it to cover.
    const p = NCA_PRESETS.find(x => x.id === layer.preset);
    if (!p) throw new Error(`No NCA preset "${layer.preset}"`);
    const zoom = layer.zoom ?? 1;
    const cell = Math.max(1, layer.cell ?? 3) * zoom;
    const gridWidth = Math.max(16, Math.ceil(width / cell));
    const gridHeight = Math.max(16, Math.ceil(height / cell));
    await ctrl.loadPreset({ ...p, config: { ...p.config, gridWidth, gridHeight } } as typeof p);
    await ctrl.prepareStill({ seed: layer.seed, steps: layer.steps ?? 600, onProgress: onSteps });
    ctrl.drawStill();
    const s = Math.max(width / canvas.width, height / canvas.height);
    const dw = canvas.width * s, dh = canvas.height * s;
    o.imageSmoothingQuality = 'high';
    o.drawImage(canvas, (width - dw) / 2, (height - dh) / 2, dw, dh);
    return out;
  }
}

// ── 2D helpers ──────────────────────────────────────────────────────
export function make2d(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function themeColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function lumaToAlpha(src: HTMLCanvasElement, gain: number): HTMLCanvasElement {
  const c = make2d(src.width, src.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = Math.min(255, Math.round(255 * Math.min(1, l * gain)));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Downscale by repeated halving (much cleaner than one big drawImage step). */
export function downscale(src: HTMLCanvasElement, size: number, opaqueBg?: string): HTMLCanvasElement {
  let cur = src;
  while (cur.width / 2 >= size) {
    const next = make2d(Math.round(cur.width / 2), Math.round(cur.height / 2));
    const ctx = next.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  const out = make2d(size, size);
  const ctx = out.getContext('2d')!;
  if (opaqueBg) { ctx.fillStyle = opaqueBg; ctx.fillRect(0, 0, size, size); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, size, size);
  return out;
}

/** Card overlay: a soft scrim bottom-left with the site name and the page title. */
export function drawTitle(canvas: HTMLCanvasElement, site: string, title: string): HTMLCanvasElement {
  const out = make2d(canvas.width, canvas.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  const W = out.width, H = out.height;
  const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  const pad = Math.round(W * 0.05);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = themeColor('--accent', '#e8a04a');
  ctx.font = `500 ${Math.round(H * 0.045)}px ${font}`;
  ctx.letterSpacing = `${Math.round(H * 0.006)}px`;
  ctx.fillText(site.toUpperCase(), pad, H - pad - Math.round(H * 0.105));
  ctx.letterSpacing = '0px';
  ctx.fillStyle = '#f4efe6';
  ctx.font = `600 ${Math.round(H * 0.09)}px ${font}`;
  ctx.fillText(title, pad, H - pad);
  return out;
}

/** PNG-in-ICO: modern browsers and Windows accept PNG payloads. */
export async function encodeIco(images: HTMLCanvasElement[]): Promise<Uint8Array> {
  const pngs = await Promise.all(images.map(c => new Promise<Uint8Array>((res, rej) =>
    c.toBlob(b => b ? b.arrayBuffer().then(a => res(new Uint8Array(a)), rej) : rej(new Error('toBlob failed')), 'image/png'))));
  const header = 6 + 16 * pngs.length;
  const total = header + pngs.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  const v = new DataView(buf.buffer);
  v.setUint16(0, 0, true); v.setUint16(2, 1, true); v.setUint16(4, pngs.length, true);
  let off = header;
  pngs.forEach((p, i) => {
    const e = 6 + 16 * i, s = images[i].width;
    buf[e] = s >= 256 ? 0 : s; buf[e + 1] = s >= 256 ? 0 : s;
    v.setUint16(e + 4, 1, true); v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, p.length, true); v.setUint32(e + 12, off, true);
    buf.set(p, off); off += p.length;
  });
  return buf;
}
