// src/components/simulations/boids/panel/xy-pad.ts
//
// Interactive 2D XY pad control for the boids simulation panel.
// Each pad controls two simulation parameters via drag, with an optional
// canvas-based audio-reactive trace overlay.

import type { BandSnapshot, AudioMapping } from '../boids-audio';
import type { BoidsController } from '../boids-controller';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface XYPadDef {
  paramKey: string;
  label:    string;
  iconId:   string;  // SVG symbol href (e.g. "ic-attract")
  min:      number;
  max:      number;
  scale:    'linear' | 'log';
}

interface TracePoint {
  x:        number;   // normalized [0,1]
  y:        number;   // normalized [0,1]
  bandAmps: { bass: number; mid: number; presence: number; hi: number };
  mag:      number;
  ts:       number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNorm(v: number, def: XYPadDef): number {
  if (def.scale === 'log') {
    return (Math.log(Math.max(v, def.min)) - Math.log(def.min)) /
           (Math.log(def.max) - Math.log(def.min));
  }
  return (v - def.min) / (def.max - def.min);
}

function fromNorm(t: number, def: XYPadDef): number {
  t = Math.max(0, Math.min(1, t));
  if (def.scale === 'log') {
    return Math.exp(Math.log(def.min) + t * (Math.log(def.max) - Math.log(def.min)));
  }
  return def.min + t * (def.max - def.min);
}

function fmt3sig(v: number): string {
  return parseFloat(v.toPrecision(3)).toString();
}

// Band colors for audio trace
const BAND_HEX = {
  bass:     { r: 0xc0, g: 0x80, b: 0x30 },  // #c08030
  mid:      { r: 0x30, g: 0xa0, b: 0xb8 },  // #30a0b8
  hi:       { r: 0xb0, g: 0x30, b: 0x60 },  // #b03060 (presence+hi combined)
};

function blendColor(bandAmps: TracePoint['bandAmps']): string {
  const bass     = bandAmps.bass;
  const mid      = bandAmps.mid;
  const high     = bandAmps.presence + bandAmps.hi;
  const total    = bass + mid + high;

  if (total < 1e-6) return 'rgb(128,128,128)';

  const wb = bass   / total;
  const wm = mid    / total;
  const wh = high   / total;

  const r = Math.round(wb * BAND_HEX.bass.r + wm * BAND_HEX.mid.r + wh * BAND_HEX.hi.r);
  const g = Math.round(wb * BAND_HEX.bass.g + wm * BAND_HEX.mid.g + wh * BAND_HEX.hi.g);
  const b = Math.round(wb * BAND_HEX.bass.b + wm * BAND_HEX.mid.b + wh * BAND_HEX.hi.b);

  return `rgb(${r},${g},${b})`;
}

// ── DOM builder ───────────────────────────────────────────────────────────────

function makeSvgIcon(iconId: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.style.color = 'currentColor';
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${iconId}`);
  svg.appendChild(use);
  return svg;
}

function makeChip(def: XYPadDef, position: 'top-left' | 'bottom-right'): HTMLElement {
  const chip = document.createElement('div');
  chip.className = `axis-chip ${position === 'top-left' ? 'chip-y-label' : 'chip-x-label'}`;
  chip.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:3px',
    'position:absolute',
    'z-index:1',
    'pointer-events:none',
    'background:rgba(10,8,4,0.82)',
    'backdrop-filter:blur(4px)',
    '-webkit-backdrop-filter:blur(4px)',
    position === 'top-left'
      ? 'top:4px;left:4px'
      : 'bottom:4px;right:4px',
  ].join(';');

  chip.appendChild(makeSvgIcon(def.iconId));
  const span = document.createElement('span');
  span.textContent = def.label;
  chip.appendChild(span);
  return chip;
}

// ── buildXYPad ────────────────────────────────────────────────────────────────

export function buildXYPad(
  container: HTMLElement,
  xDef: XYPadDef,
  yDef: XYPadDef,
  controller: BoidsController,
): { el: HTMLElement; updateTrace(snapshot: BandSnapshot, mappings: AudioMapping[]): void } {

  const params = controller.params as Record<string, number>;

  // ── Surface ──────────────────────────────────────────────────────────────────
  const surf = document.createElement('div');
  surf.className = 'pad-surf';
  surf.style.cssText = 'position:relative;aspect-ratio:1;cursor:crosshair;';

  // ── Canvas overlay ───────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.className = 'pad-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;z-index:0;width:100%;height:100%;';
  surf.appendChild(canvas);
  const ctx2d = canvas.getContext('2d');

  // ── Dot ──────────────────────────────────────────────────────────────────────
  const dot = document.createElement('div');
  dot.className = 'pad-dot';
  dot.style.cssText = [
    'position:absolute',
    'z-index:2',
    'width:9px',
    'height:9px',
    'border-radius:50%',
    'background:var(--accent)',
    'box-shadow:0 0 7px var(--accent-glow),0 0 0 1.5px var(--bg-surface)',
    'transform:translate(-50%,50%)',
    'pointer-events:none',
  ].join(';');
  surf.appendChild(dot);

  // ── Axis chips ───────────────────────────────────────────────────────────────
  surf.appendChild(makeChip(yDef, 'top-left'));
  surf.appendChild(makeChip(xDef, 'bottom-right'));

  // ── Value readouts ───────────────────────────────────────────────────────────
  const valX = document.createElement('div');
  valX.className = 'val-x';
  valX.style.cssText = 'position:absolute;z-index:3;left:50%;transform:translateX(-50%);top:2px;pointer-events:none;';
  surf.appendChild(valX);

  const valY = document.createElement('div');
  valY.className = 'val-y';
  valY.style.cssText = 'position:absolute;z-index:3;top:50%;transform:translateY(-50%);right:2px;pointer-events:none;';
  surf.appendChild(valY);

  // ── Position update ──────────────────────────────────────────────────────────
  function redraw(): void {
    const nx = toNorm(params[xDef.paramKey], xDef);
    const ny = toNorm(params[yDef.paramKey], yDef);
    // x: 0→left, 1→right; y: 0→bottom, 1→top (inverted in CSS y-axis)
    dot.style.left   = `${nx * 100}%`;
    dot.style.bottom = `${ny * 100}%`;
    valX.textContent = fmt3sig(params[xDef.paramKey]);
    valY.textContent = fmt3sig(params[yDef.paramKey]);
  }
  redraw();

  // ── Drag logic ───────────────────────────────────────────────────────────────
  let dragging = false;

  function applyPointer(clientX: number, clientY: number): void {
    const rect = surf.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    params[xDef.paramKey] = fromNorm(nx, xDef);
    params[yDef.paramKey] = fromNorm(1 - ny, yDef);  // flip: top = high y
    redraw();
  }

  function onMouseMove(e: MouseEvent): void {
    if (!dragging) return;
    applyPointer(e.clientX, e.clientY);
  }

  function onMouseUp(): void {
    dragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  surf.addEventListener('mousedown', (e: MouseEvent) => {
    dragging = true;
    applyPointer(e.clientX, e.clientY);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  });

  // Touch support
  function onTouchMove(e: TouchEvent): void {
    if (!dragging) return;
    const t = e.touches[0];
    if (t) applyPointer(t.clientX, t.clientY);
    e.preventDefault();
  }

  function onTouchEnd(): void {
    dragging = false;
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);
  }

  surf.addEventListener('touchstart', (e: TouchEvent) => {
    dragging = true;
    const t = e.touches[0];
    if (t) applyPointer(t.clientX, t.clientY);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    e.preventDefault();
  }, { passive: false });

  // ── Audio trace state ────────────────────────────────────────────────────────
  const history: TracePoint[] = [];
  const TRACE_WINDOW_MS = 6500;

  // Resize canvas to match display size
  function syncCanvasSize(): void {
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }
  }

  function drawTrace(): void {
    if (!ctx2d) return;
    const { width, height } = canvas;
    ctx2d.clearRect(0, 0, width, height);

    if (history.length < 2) return;

    const oldest = history[0];
    const newest = history[history.length - 1];
    const span = newest.ts - oldest.ts;
    if (span < 1) return;

    // Main path
    for (let i = 0; i < history.length - 1; i++) {
      const p0 = history[i];
      const p1 = history[i + 1];

      // Use the newer point's attributes for segment color/opacity
      const t = (p1.ts - oldest.ts) / span;
      const opacity = Math.pow(t, 1.3) * 0.65 * (0.25 + 0.75 * p1.mag);
      const color   = blendColor(p1.bandAmps);
      const lineW   = 1 + t * 1.8;

      ctx2d.beginPath();
      ctx2d.strokeStyle = color;
      ctx2d.globalAlpha = opacity;
      ctx2d.lineWidth   = lineW;
      ctx2d.moveTo(p0.x * width, (1 - p0.y) * height);
      ctx2d.lineTo(p1.x * width, (1 - p1.y) * height);
      ctx2d.stroke();
    }

    // Tip glow: last 400ms
    const glowCutoff = newest.ts - 400;
    const latestMag  = newest.mag;

    let glowStart = history.length - 1;
    while (glowStart > 0 && history[glowStart - 1].ts >= glowCutoff) {
      glowStart--;
    }

    ctx2d.shadowBlur  = 8;
    for (let i = glowStart; i < history.length - 1; i++) {
      const p0 = history[i];
      const p1 = history[i + 1];
      const t  = (p1.ts - oldest.ts) / span;
      const opacity = Math.pow(t, 1.3) * 0.30 * latestMag;
      const color   = blendColor(p1.bandAmps);
      const lineW   = (1 + t * 1.8) * 3;

      ctx2d.beginPath();
      ctx2d.strokeStyle = color;
      ctx2d.globalAlpha = opacity;
      ctx2d.lineWidth   = lineW;
      ctx2d.shadowColor = color;
      ctx2d.moveTo(p0.x * width, (1 - p0.y) * height);
      ctx2d.lineTo(p1.x * width, (1 - p1.y) * height);
      ctx2d.stroke();
    }
    ctx2d.shadowBlur  = 0;

    ctx2d.globalAlpha = 1;
  }

  // ── updateTrace (called externally from rAF loop) ─────────────────────────────
  function updateTrace(snapshot: BandSnapshot, mappings: AudioMapping[]): void {
    syncCanvasSize();

    // Find active mappings that target either pad param
    const activeMappings = mappings.filter(
      m => m.enabled && (m.param === xDef.paramKey || m.param === yDef.paramKey)
    );

    // Compute per-band amplitudes summed across all active mappings
    let totalAmp = 0;
    const bandAmps = { bass: 0, mid: 0, presence: 0, hi: 0 };

    for (const m of activeMappings) {
      const amp = snapshot[m.band] * m.gain;
      totalAmp += amp;
      if (m.band === 'bass')     bandAmps.bass     += amp;
      else if (m.band === 'mid') bandAmps.mid      += amp;
      else if (m.band === 'presence') bandAmps.presence += amp;
      else if (m.band === 'hi')  bandAmps.hi       += amp;
      // 'volume' band counts toward totalAmp but not individual bands (no color bucket)
    }

    const totalMag = Math.min(1, totalAmp);

    const nx = toNorm(params[xDef.paramKey], xDef);
    const ny = toNorm(params[yDef.paramKey], yDef);

    history.push({ x: nx, y: ny, bandAmps, mag: totalMag, ts: performance.now() });

    // Prune old entries
    const cutoff = performance.now() - TRACE_WINDOW_MS;
    let pruneIdx = 0;
    while (pruneIdx < history.length && history[pruneIdx].ts < cutoff) pruneIdx++;
    if (pruneIdx > 0) history.splice(0, pruneIdx);

    drawTrace();
  }

  container.appendChild(surf);

  return { el: surf, updateTrace };
}
