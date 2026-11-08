// src/lib/sim-page/boids-phone-tabs.ts
// The Audio and Image tabs of the boids phone card. Each has two sizes:
//   full  — the desktop panel's own tab (buildAudioTab / buildImagePanelSection),
//           so every control and saved state is the same on every device;
//   strip — a short monitor over the bottom of the canvas: what the signal is
//           doing, plus the handful of controls worth having in reach
//           (source, strength; image enable, show, strength, blur, threshold).
//           Mapped-parameter rows are read-only there.

import type { BoidsController } from '../../components/simulations/boids/boids-controller';
import { BAND_COLORS, PARAM_META, drawAudioViz, type AudioReactor, type BandKey } from '../../components/simulations/boids/boids-audio';
import { buildAudioTab, type AudioUpdaterMaps } from '../../components/simulations/boids/panel/audio-tab';
import { pillStyle } from '../../components/simulations/boids/panel/panel-styles';
import { buildImagePanelSection } from '../webgpu/image-editor/image-panel-section';
import { openImageEditorOverlay } from '../webgpu/image-editor/image-editor-overlay';
import type { ScrubTab, ScrubTabSize } from './scrub-panel';
import type { ImageForceMode } from '../../components/simulations/boids/boids-image-force';

export function boidsPhoneTabs(
  ctrl: BoidsController,
  reactor: AudioReactor,
  getBaseParams: () => Record<string, number>,
  viewport: HTMLElement,
): ScrubTab[] {
  return [
    { name: 'Audio', build: (c: HTMLElement, size: ScrubTabSize) =>
        size === 'full' ? audioFull(c, ctrl, reactor, getBaseParams) : audioStrip(c, ctrl, reactor, getBaseParams) },
    { name: 'Image', build: (c: HTMLElement, size: ScrubTabSize) =>
        size === 'full' ? imageFull(c, ctrl, viewport) : imageStrip(c, ctrl) },
  ];
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function range(min: number, max: number, step: number, value: number, onInput: (v: number) => void, fmt: (v: number) => string): { row: HTMLElement; input: HTMLInputElement; val: HTMLElement } {
  const row = el('div', 'pm-row');
  const input = el('input');
  input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
  const val = el('span', 'pm-val', fmt(value));
  input.addEventListener('input', () => { const v = parseFloat(input.value); onInput(v); val.textContent = fmt(v); });
  row.append(input, val);
  return { row, input, val };
}

// ── Audio ─────────────────────────────────────────────────────────────────

function audioFull(container: HTMLElement, ctrl: BoidsController, reactor: AudioReactor, getBaseParams: () => Record<string, number>): () => void {
  const updMaps: AudioUpdaterMaps = {
    paramIndicators: new Map(), cellUpdaters: new Map(), totalUpdaters: new Map(),
    traceUpdaters: new Map(), matrixTraceUpdaters: new Map(),
  };
  const disconnects: Array<() => void> = [];
  container.classList.add('pm-full');
  const viz = buildAudioTab(container, reactor, updMaps, (fn) => disconnects.push(fn));
  viz.start();
  // Same pump the desktop panel runs for its Audio tab (cells, traces, drawers, row sparklines).
  let raf = 0;
  const pump = () => {
    if (reactor.isActive()) {
      const base = getBaseParams();
      const params = ctrl.params as unknown as Record<string, number>;
      const snapshot = reactor.analyze();
      for (const m of reactor.mappings) {
        if (!m.enabled) continue;
        const key = `${String(m.param)}::${m.band}`;
        const sig = Math.min(1, snapshot[m.band] * (m.gain ?? 1));
        updMaps.cellUpdaters.get(key)?.(sig);
        updMaps.traceUpdaters.get(key)?.(sig);
      }
      for (const [param, u] of updMaps.totalUpdaters) u(snapshot, base[param] ?? params[param] ?? 0, params[param] ?? 0);
      for (const [param, u] of updMaps.matrixTraceUpdaters) {
        const meta = PARAM_META[param];
        if (!meta) continue;
        const r = meta.max - meta.min;
        u(r > 0 ? Math.max(0, Math.min(1, ((params[param] ?? 0) - meta.min) / r)) : 0);
      }
    }
    raf = requestAnimationFrame(pump);
  };
  pump();
  return () => { cancelAnimationFrame(raf); viz.stop(); for (const fn of disconnects) fn(); };
}

function audioStrip(container: HTMLElement, ctrl: BoidsController, reactor: AudioReactor, getBaseParams: () => Record<string, number>): () => void {
  container.classList.add('pm-strip');

  // Source row: the same two pills as the desktop tab, plus the status dot.
  const src = el('div', 'pm-row');
  const mic = el('button', '', 'Microphone');
  const sys = el('button', '', 'System Audio');
  const dot = el('span', 'pm-dot');
  const err = el('div', 'pm-err');
  src.append(mic, sys, dot);
  const paint = () => {
    const on = reactor.status === 'active';
    mic.style.cssText = pillStyle(on && reactor.activeSourceKind === 'microphone');
    sys.style.cssText = pillStyle(on && reactor.activeSourceKind === 'system');
    dot.classList.toggle('on', on);
    dot.classList.toggle('err', reactor.status === 'error');
    err.textContent = reactor.status === 'error' ? reactor.lastError : '';
    err.hidden = !err.textContent;
  };
  const toggle = async (kind: 'microphone' | 'system') => {
    if (reactor.isActive() && reactor.activeSourceKind === kind) reactor.stop();
    else { reactor.stop(); try { await reactor.start(kind); } catch { /* reactor.lastError */ } }
    paint();
  };
  mic.addEventListener('click', () => void toggle('microphone'));
  sys.addEventListener('click', () => void toggle('system'));

  const strength = range(0, 2, 0.01, reactor.globalStrength, (v) => { reactor.globalStrength = v; reactor.saveGlobal(); }, (v) => v.toFixed(2));
  strength.row.prepend(el('span', 'pm-lbl', 'Strength'));

  const spec = el('canvas', 'pm-spec');
  // Band levels (the spectrum above is by frequency, so volume needs its own meter).
  const meters = el('div', 'pm-meters');
  const meterFill = new Map<BandKey, HTMLElement>();
  for (const [k, label] of [['bass', 'bass'], ['mid', 'mid'], ['presence', 'pres'], ['hi', 'hi'], ['volume', 'vol']] as const) {
    const m = el('div'); const lbl = el('span', '', label); lbl.style.color = BAND_COLORS[k];
    const bar = el('div', 'pm-bar'); const fill = el('i'); fill.style.background = BAND_COLORS[k]; bar.appendChild(fill);
    m.append(lbl, bar); meters.appendChild(m); meterFill.set(k, fill);
  }

  // One live row per mapped parameter: base tick, modulation fill, delta. Read-only.
  const live = el('div', 'pm-live');
  const rows = new Map<string, { bar: HTMLElement; fill: HTMLElement; tick: HTMLElement; delta: HTMLElement; color: string }>();
  let sig = '';
  const rebuildRows = () => {
    const wanted = new Map<string, string>();
    for (const m of reactor.mappings) if (m.enabled && PARAM_META[String(m.param)] && !wanted.has(String(m.param))) wanted.set(String(m.param), BAND_COLORS[m.band]);
    const next = [...wanted.entries()].map(([p, c]) => p + c).join('|');
    if (next === sig) return;
    sig = next;
    live.innerHTML = ''; rows.clear();
    if (!wanted.size) { live.appendChild(el('div', 'pm-empty', 'No mappings. Expand ⤢ to add some.')); return; }
    for (const [p, color] of wanted) {
      const name = el('span', 'pm-name', PARAM_META[p].label);
      const bar = el('div', 'pm-bar'); const fill = el('i'); const tick = el('b'); bar.append(fill, tick);
      const delta = el('span', 'pm-delta'); delta.style.color = color; fill.style.background = color;
      live.append(name, bar, delta);
      rows.set(p, { bar, fill, tick, delta, color });
    }
  };

  container.append(src, err, strength.row, spec, meters, live);
  paint();

  const dpr = window.devicePixelRatio || 1;
  let raf = 0, last = 0;
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    if (t - last < 40) return;           // ~25 fps is plenty for meters
    last = t;
    const w = spec.clientWidth, h = spec.clientHeight;
    if (w && (spec.width !== Math.round(w * dpr) || spec.height !== Math.round(h * dpr))) { spec.width = Math.round(w * dpr); spec.height = Math.round(h * dpr); }
    rebuildRows();
    if (reactor.isActive()) {
      drawAudioViz(spec, reactor);
      const snap = reactor.analyze();
      for (const [k, f] of meterFill) f.style.setProperty('--v', `${(Math.min(1, snap[k]) * 100).toFixed(1)}%`);
    } else {
      spec.getContext('2d')?.clearRect(0, 0, spec.width, spec.height);
      for (const f of meterFill.values()) f.style.setProperty('--v', '0%');
    }
    const base = getBaseParams();
    const cur = ctrl.params as unknown as Record<string, number>;
    for (const [p, r] of rows) {
      const meta = PARAM_META[p];
      const span = meta.max - meta.min || 1;
      const b = Math.max(0, Math.min(1, ((base[p] ?? cur[p] ?? 0) - meta.min) / span));
      const c = Math.max(0, Math.min(1, ((cur[p] ?? 0) - meta.min) / span));
      r.tick.style.left = `${(b * 100).toFixed(2)}%`;
      r.fill.style.left = `${(Math.min(b, c) * 100).toFixed(2)}%`;
      r.fill.style.width = `${(Math.abs(c - b) * 100).toFixed(2)}%`;
      const d = (cur[p] ?? 0) - (base[p] ?? cur[p] ?? 0);
      r.delta.textContent = reactor.isActive() ? `${d >= 0 ? '+' : ''}${d.toFixed(Math.abs(span) < 1 ? 3 : 2)}` : '';
    }
    if ((reactor.status === 'active') !== dot.classList.contains('on')) paint();
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}

// ── Image ─────────────────────────────────────────────────────────────────

function imageFull(container: HTMLElement, ctrl: BoidsController, viewport: HTMLElement): () => void {
  container.classList.add('pm-full');
  return buildImagePanelSection(container, ctrl.imageProcessor, {
    onOpenEditor: () => openImageEditorOverlay(ctrl.imageProcessor, {
      onClose: () => { /* overlay closed */ },
      onRebindGroups: () => ctrl.rebuildBoidsBindGroups(),
      onSetForceMode: (m) => ctrl.imageForce.setForceMode(m as ImageForceMode),
    }, viewport),
    onRebindGroups: () => ctrl.rebuildBoidsBindGroups(),
    webcam: ctrl.webcam,
    imageForce: ctrl.imageForce as unknown as Parameters<typeof buildImagePanelSection>[2]['imageForce'],
  });
}

function imageStrip(container: HTMLElement, ctrl: BoidsController): () => void {
  container.classList.add('pm-strip', 'pm-image');
  const proc = ctrl.imageProcessor;
  const force = ctrl.imageForce;

  // Left: the image as the processor sees it (same thumbnail blit as the desktop tab).
  const thumbWrap = el('div', 'pm-thumb');
  const thumb = el('canvas');
  const stamp = el('span', 'pm-stamp');
  thumbWrap.append(thumb, stamp);
  const tctx = thumb.getContext('webgpu') as GPUCanvasContext | null;

  // Right: status and the quick controls.
  const side = el('div', 'pm-side');
  const head = el('div', 'pm-row pm-head');
  const title = el('span', 'pm-lbl', 'Image force');
  const dot = el('span', 'pm-dot');
  head.append(title, dot);
  const checks = el('div', 'pm-row pm-checks');
  const mk = (label: string, checked: boolean, on: (v: boolean) => void) => {
    const l = el('label'); const i = el('input'); i.type = 'checkbox'; i.checked = checked;
    i.addEventListener('change', () => on(i.checked)); l.append(i, document.createTextNode(label)); return l;
  };
  checks.append(
    mk('Force', force.getEnabled(), (v) => force.setEnabled(v)),
    mk('Show image', force.showOverlay, (v) => force.setShowOverlay(v)),
  );
  const strength = range(0, 10, 0.05, force.getStrength(), (v) => force.setStrength(v), (v) => v.toFixed(2));
  strength.row.prepend(el('span', 'pm-lbl', 'Strength'));
  const blur = range(0, 10, 0.5, proc.params.blurRadius, (v) => proc.setBlurRadius(v), (v) => v.toFixed(1));
  blur.row.prepend(el('span', 'pm-lbl', 'Blur'));
  const thresh = range(0, 1, 0.01, proc.params.threshold, (v) => proc.setThreshold(v), (v) => v.toFixed(2));
  thresh.row.prepend(el('span', 'pm-lbl', 'Threshold'));
  const note = el('div', 'pm-empty');
  side.append(head, checks, strength.row, blur.row, thresh.row, note);
  container.append(thumbWrap, side);

  const MODES = ['Attract', 'Repel', 'Grad flow', 'Grad edge', 'Threshold', 'SDF'];
  const dpr = window.devicePixelRatio || 1;
  let sized = false;
  let raf = 0, last = 0;
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    if (t - last < 250) return;
    last = t;
    // The preview is a blit of the canvas-sized processed texture. Its box
    // keeps exactly that aspect and is fitted inside 40% of the strip width
    // by 190px tall, so it only ever shrinks, never stretches.
    const ar = proc.canvasHeight / Math.max(1, proc.canvasWidth);
    const maxW = container.clientWidth * 0.4, maxH = 190;
    let bw = maxW, bh = bw * ar;
    if (bh > maxH) { bh = maxH; bw = bh / ar; }
    bw = Math.round(bw); bh = Math.round(bh);
    if (bw > 0 && (thumbWrap.clientWidth !== bw || thumbWrap.clientHeight !== bh)) {
      thumbWrap.style.width = `${bw}px`; thumbWrap.style.height = `${bh}px`;
      thumb.width = Math.round(bw * dpr); thumb.height = Math.round(bh * dpr);
      if (tctx && !sized) { proc.setThumbnailContext(tctx); sized = true; }
    }
    const cam = ctrl.webcam.status === 'active';
    const has = proc.hasImage || proc.hasPaint;
    dot.classList.toggle('on', force.isActive());
    dot.classList.toggle('err', ctrl.webcam.status === 'error');
    stamp.textContent = [cam ? 'webcam' : proc.hasImage ? 'image' : proc.hasPaint ? 'paint' : '', MODES[force.getForceMode()] ?? '', cam && ctrl.webcam.mirrored ? 'mirror' : '']
      .filter(Boolean).join(' · ').toUpperCase();
    note.textContent = ctrl.webcam.status === 'error' ? ctrl.webcam.lastError
      : !has ? 'No image. Expand ⤢ to start the camera or load one.' : '';
    note.hidden = !note.textContent;
    if (has) proc.renderThumbnail();
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
