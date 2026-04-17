# Boids XY Pad Forces Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 8 Forces section sliders in the boids panel with 4 interactive 2D XY pads that pair semantically related parameters, with audio trace visualization.

**Architecture:** New `boids-xy-pad.ts` holds all XY pad logic (types, DOM, drag, canvas trace). `boids-panel.ts` gains a `buildForcesPads()` closure function that builds the 2×2 grid and pushes each pad's `updateViz` into a new `updMaps.padVizUpdaters` array. `updateAudioViz` calls those updaters every rAF. CSS goes in `[...slug].astro` global rules.

**Tech Stack:** TypeScript, DOM APIs, Canvas 2D, existing `boids-audio.ts` types (`BandSnapshot`, `AudioMapping`, `BAND_COLORS`)

---

### Task 1: CSS for pad layout and elements

**Files:**
- Modify: `src/pages/gallery/[...slug].astro` (after the last `.params-panel :global(...)` block, ~line 375)

- [ ] **Step 1: Add pad CSS rules**

After the `.params-panel :global(.edit-shader-btn:hover)` block, insert:

```css
  .params-panel :global(.pads-grid) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 2px;
  }

  .params-panel :global(.pad-surf) {
    position: relative;
    aspect-ratio: 1;
    width: 100%;
    background: var(--bg-surface);
    border: 1px solid var(--bg-surface-border);
    border-radius: 4px;
    cursor: crosshair;
    overflow: hidden;
    user-select: none;
  }

  .params-panel :global(.pad-canvas) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .params-panel :global(.pad-dot) {
    position: absolute;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 7px var(--accent-glow), 0 0 0 1.5px var(--bg-surface);
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 2;
  }

  .params-panel :global(.axis-chip) {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 4px;
    border-radius: 3px;
    background: rgba(10, 8, 4, 0.82);
    backdrop-filter: blur(4px);
    font-size: 0.5rem;
    color: var(--text-muted);
    pointer-events: none;
    z-index: 3;
    line-height: 1;
  }

  .params-panel :global(.axis-chip svg) {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  }

  .params-panel :global(.chip-y) {
    top: 4px;
    left: 4px;
  }

  .params-panel :global(.chip-x) {
    bottom: 4px;
    right: 4px;
  }

  .params-panel :global(.val-x) {
    position: absolute;
    top: 4px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.5rem;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    z-index: 3;
  }

  .params-panel :global(.val-y) {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.5rem;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    z-index: 3;
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/gallery/[...slug].astro
git commit -m "style: add CSS for XY pad forces elements"
```

---

### Task 2: Create `boids-xy-pad.ts`

**Files:**
- Create: `src/components/simulations/boids/boids-xy-pad.ts`

This file contains: exported types, `toNorm`/`fromNorm` helpers, the SVG sprite injector, and the full `buildXYPad` function (DOM skeleton, drag interaction, value readouts, canvas trace, `updateViz`).

- [ ] **Step 1: Create the file**

Create `src/components/simulations/boids/boids-xy-pad.ts` with this full content:

```ts
// src/components/simulations/boids/boids-xy-pad.ts

import type { BoidsController } from './boids-controller';
import { type BandKey, type BandSnapshot, type AudioMapping, BAND_COLORS } from './boids-audio';

// ── Public types ──────────────────────────────────────────────────────────────

export interface XYPadDef {
  paramKey: string;
  label:    string;
  iconId:   string;
  min:      number;
  max:      number;
  scale:    'linear' | 'log';
  decimals: number;
}

export interface XYPadHandle {
  el:        HTMLElement;
  teardown:  () => void;
  updateViz: (snapshot: BandSnapshot | null, mappings: AudioMapping[]) => void;
}

// ── Coordinate helpers ────────────────────────────────────────────────────────

export function toNorm(v: number, def: XYPadDef): number {
  const c = Math.max(def.min, Math.min(def.max, v));
  if (def.scale === 'log') {
    return (Math.log(c) - Math.log(def.min)) / (Math.log(def.max) - Math.log(def.min));
  }
  return (c - def.min) / (def.max - def.min);
}

export function fromNorm(t: number, def: XYPadDef): number {
  const c = Math.max(0, Math.min(1, t));
  if (def.scale === 'log') {
    return Math.exp(Math.log(def.min) + c * (Math.log(def.max) - Math.log(def.min)));
  }
  return def.min + c * (def.max - def.min);
}

// ── SVG sprite ────────────────────────────────────────────────────────────────

const SPRITE_ID = 'boids-xy-pad-sprite';

function ensureSprite(): void {
  if (document.getElementById(SPRITE_ID)) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = SPRITE_ID;
  svg.setAttribute('style', 'display:none;');
  svg.innerHTML = `
    <symbol id="ic-attract" viewBox="0 0 24 24">
      <circle cx="4" cy="12" r="2" fill="currentColor"/>
      <circle cx="20" cy="12" r="2" fill="currentColor"/>
      <polyline points="8,9 11,12 8,15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="16,9 13,12 16,15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="ic-repulse" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
      <line x1="12" y1="3"  x2="12" y2="7"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="3"  y1="12" x2="7"  y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="17" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="5.6"  y1="5.6"  x2="8.5"  y2="8.5"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="15.5" y1="15.5" x2="18.4" y2="18.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="18.4" y1="5.6"  x2="15.5" y2="8.5"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="8.5"  y1="15.5" x2="5.6"  y2="18.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </symbol>
    <symbol id="ic-align" viewBox="0 0 24 24">
      <line x1="4" y1="6"  x2="18" y2="6"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <polyline points="15,3 18,6 15,9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="4" y1="12" x2="18" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <polyline points="15,9 18,12 15,15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="4" y1="18" x2="18" y2="18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <polyline points="15,15 18,18 15,21" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="ic-noise" viewBox="0 0 24 24">
      <polyline points="2,12 5,6 8,18 11,8 14,16 17,10 20,14 22,12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="ic-speed" viewBox="0 0 24 24">
      <line x1="2"  y1="10" x2="10" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="2"  y1="14" x2="8"  y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="10" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <polyline points="18,8 22,12 18,16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="ic-friction" viewBox="0 0 24 24">
      <path d="M3,12 C5,9 7,15 9,12 C11,9 13,15 15,12 C17,9 19,15 21,12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="2"  y1="17" x2="22" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="5"  y1="17" x2="4"  y2="20" stroke="currentColor" stroke-width="1"   stroke-linecap="round"/>
      <line x1="9"  y1="17" x2="8"  y2="20" stroke="currentColor" stroke-width="1"   stroke-linecap="round"/>
      <line x1="13" y1="17" x2="12" y2="20" stroke="currentColor" stroke-width="1"   stroke-linecap="round"/>
      <line x1="17" y1="17" x2="16" y2="20" stroke="currentColor" stroke-width="1"   stroke-linecap="round"/>
    </symbol>
    <symbol id="ic-radius" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="2"  fill="currentColor"/>
      <circle cx="12" cy="12" r="5"  fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.5 2"/>
      <circle cx="12" cy="12" r="9"  fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.5 2"/>
      <circle cx="5.5"  cy="5.5"  r="1.2" fill="currentColor" opacity="0.7"/>
      <circle cx="18.5" cy="5.5"  r="1.2" fill="currentColor" opacity="0.7"/>
    </symbol>
  `;
  document.body.appendChild(svg);
}

// ── buildXYPad ────────────────────────────────────────────────────────────────

const TRACE_WINDOW_MS = 6500;

interface TracePoint {
  nx:    number;
  ny:    number;
  bands: Record<BandKey, number>;
  mag:   number;
  ts:    number;
}

export function buildXYPad(
  container: HTMLElement,
  xDef: XYPadDef,
  yDef: XYPadDef,
  controller: BoidsController,
): XYPadHandle {
  ensureSprite();

  // ── DOM ───────────────────────────────────────────────────────────────────
  const surface = document.createElement('div');
  surface.className = 'pad-surf';

  const canvas = document.createElement('canvas');
  canvas.className = 'pad-canvas';
  surface.appendChild(canvas);

  const dot = document.createElement('div');
  dot.className = 'pad-dot';
  surface.appendChild(dot);

  function makeChip(def: XYPadDef, extraClass: string): HTMLElement {
    const chip = document.createElement('div');
    chip.className = `axis-chip ${extraClass}`;
    chip.innerHTML = `<svg><use href="#${def.iconId}"/></svg><span>${def.label}</span>`;
    return chip;
  }
  surface.appendChild(makeChip(yDef, 'chip-y'));
  surface.appendChild(makeChip(xDef, 'chip-x'));

  const valX = document.createElement('div');
  valX.className = 'val-x';
  const valY = document.createElement('div');
  valY.className = 'val-y';
  surface.appendChild(valX);
  surface.appendChild(valY);

  container.appendChild(surface);

  // ── Canvas resize ─────────────────────────────────────────────────────────
  const ro = new ResizeObserver(() => {
    const rect = surface.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width  = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
      drawTrace();
    }
  });
  ro.observe(surface);

  // ── Dot position + value readouts ─────────────────────────────────────────
  function refreshDot(): void {
    const params = controller.params as Record<string, number>;
    const nx = toNorm(params[xDef.paramKey] ?? xDef.min, xDef);
    const ny = toNorm(params[yDef.paramKey] ?? yDef.min, yDef);
    dot.style.left = `${nx * 100}%`;
    dot.style.top  = `${(1 - ny) * 100}%`;
    valX.textContent = (params[xDef.paramKey] ?? xDef.min).toFixed(xDef.decimals);
    valY.textContent = (params[yDef.paramKey] ?? yDef.min).toFixed(yDef.decimals);
  }

  // ── Drag ──────────────────────────────────────────────────────────────────
  function applyPointer(clientX: number, clientY: number): void {
    const rect = surface.getBoundingClientRect();
    const nx   = Math.max(0, Math.min(1, (clientX - rect.left)  / rect.width));
    const ny   = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    const params = controller.params as Record<string, number>;
    params[xDef.paramKey] = fromNorm(nx, xDef);
    params[yDef.paramKey] = fromNorm(ny, yDef);
    refreshDot();
  }

  function onMouseDown(e: MouseEvent): void {
    e.preventDefault();
    applyPointer(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => applyPointer(ev.clientX, ev.clientY);
    const onUp   = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }
  surface.addEventListener('mousedown', onMouseDown);

  // ── Audio trace ───────────────────────────────────────────────────────────
  const history: TracePoint[] = [];

  function blendBandColor(bands: Record<BandKey, number>): { r: number; g: number; b: number } {
    let totalW = 0, r = 0, g = 0, b = 0;
    for (const band of Object.keys(bands) as BandKey[]) {
      const w = bands[band];
      if (w <= 0) continue;
      const hex = BAND_COLORS[band];
      r += w * parseInt(hex.slice(1, 3), 16);
      g += w * parseInt(hex.slice(3, 5), 16);
      b += w * parseInt(hex.slice(5, 7), 16);
      totalW += w;
    }
    if (totalW < 0.01) return { r: 140, g: 130, b: 160 };
    return {
      r: Math.round(r / totalW),
      g: Math.round(g / totalW),
      b: Math.round(b / totalW),
    };
  }

  function drawTrace(): void {
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    if (history.length < 2) return;

    const now    = performance.now();
    const oldest = now - TRACE_WINDOW_MS;
    ctx.lineCap = 'round';

    for (let i = 1; i < history.length; i++) {
      const pt   = history[i];
      const prev = history[i - 1];
      const t       = Math.max(0, (pt.ts - oldest) / TRACE_WINDOW_MS);
      const opacity = Math.pow(t, 1.3) * 0.65 * (0.25 + 0.75 * pt.mag);
      if (opacity < 0.01) continue;

      const color  = blendBandColor(pt.bands);
      const isTip  = (now - pt.ts) < 400;
      const width  = isTip ? 1 + 1.8 * pt.mag : 1 + 0.8 * pt.mag;

      ctx.beginPath();
      ctx.moveTo(prev.nx * w, (1 - prev.ny) * h);
      ctx.lineTo(pt.nx   * w, (1 - pt.ny)   * h);
      ctx.lineWidth   = Math.max(1, Math.min(2.8, width));
      ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${opacity})`;

      if (isTip && pt.mag > 0.1) {
        ctx.shadowBlur  = 4 * pt.mag;
        ctx.shadowColor = `rgba(${color.r},${color.g},${color.b},0.6)`;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  // ── updateViz ─────────────────────────────────────────────────────────────
  function updateViz(snapshot: BandSnapshot | null, mappings: AudioMapping[]): void {
    refreshDot();

    if (!snapshot) {
      drawTrace();
      return;
    }

    const activeMappings = mappings.filter(
      m => m.enabled && (m.param === xDef.paramKey || m.param === yDef.paramKey),
    );
    const mag = Math.min(1, activeMappings.reduce(
      (sum, m) => sum + Math.min(1, snapshot[m.band] * (m.gain ?? 1)), 0,
    ));

    const params = controller.params as Record<string, number>;
    const nx = toNorm(params[xDef.paramKey] ?? xDef.min, xDef);
    const ny = toNorm(params[yDef.paramKey] ?? yDef.min, yDef);

    const bands: Record<BandKey, number> = { bass: 0, mid: 0, presence: 0, hi: 0, volume: 0 };
    for (const m of activeMappings) {
      const amp = Math.min(1, snapshot[m.band] * (m.gain ?? 1));
      bands[m.band] = Math.max(bands[m.band], amp);
    }

    const cutoff = performance.now() - TRACE_WINDOW_MS;
    let drop = 0;
    while (drop < history.length && history[drop].ts < cutoff) drop++;
    if (drop > 0) history.splice(0, drop);

    history.push({ nx, ny, bands, mag, ts: performance.now() });
    drawTrace();
  }

  refreshDot();

  return {
    el: surface,
    teardown: () => {
      ro.disconnect();
      surface.removeEventListener('mousedown', onMouseDown);
    },
    updateViz,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/simulations/boids/boids-xy-pad.ts
git commit -m "feat(boids): add boids-xy-pad.ts — XY pad with drag and audio trace"
```

---

### Task 3: Wire `buildForcesPads` into `boids-panel.ts`

**Files:**
- Modify: `src/components/simulations/boids/boids-panel.ts`

- [ ] **Step 1: Add import**

After the existing imports at the top of `boids-panel.ts` (~line 32), add:

```ts
import { buildXYPad, type XYPadDef, type XYPadHandle } from './boids-xy-pad';
```

- [ ] **Step 2: Add `padVizUpdaters` field to `AudioUpdaterMaps` interface (~line 55)**

```ts
interface AudioUpdaterMaps {
  paramIndicators:     Map<string, { wrap: HTMLElement; fill: HTMLElement }>;
  cellUpdaters:        Map<string, (amplitude: number) => void>;
  totalUpdaters:       Map<string, (snapshot: BandSnapshot, baseVal: number, modulatedVal: number) => void>;
  traceUpdaters:       Map<string, (amplitude: number) => void>;
  matrixTraceUpdaters: Map<string, (normalizedVal: number) => void>;
  padVizUpdaters:      Array<(snapshot: BandSnapshot | null, mappings: AudioMapping[]) => void>;
}
```

- [ ] **Step 3: Initialize `padVizUpdaters` in the `updMaps` object (~line 85)**

```ts
  const updMaps: AudioUpdaterMaps = {
    paramIndicators:     new Map(),
    cellUpdaters:        new Map(),
    totalUpdaters:       new Map(),
    traceUpdaters:       new Map(),
    matrixTraceUpdaters: new Map(),
    padVizUpdaters:      [],
  };
```

- [ ] **Step 4: Add `buildForcesPads` function inside the `buildBoidsPanel` closure, after `addSlider` (~line 307)**

```ts
  function buildForcesPads(parent: HTMLElement): void {
    const PAD_DEFS: [XYPadDef, XYPadDef][] = [
      [
        { paramKey: 'attraction',       label: 'Attraction',  iconId: 'ic-attract',  min: 0,    max: 2.0,  scale: 'linear', decimals: 2 },
        { paramKey: 'repulsion',        label: 'Repulsion',   iconId: 'ic-repulse',  min: 0,    max: 5.0,  scale: 'linear', decimals: 2 },
      ],
      [
        { paramKey: 'attractionRadius', label: 'Attr Radius', iconId: 'ic-radius',   min: 0.02, max: 0.6,  scale: 'log',    decimals: 2 },
        { paramKey: 'repulsionRadius',  label: 'Rep Radius',  iconId: 'ic-radius',   min: 0.01, max: 0.3,  scale: 'log',    decimals: 3 },
      ],
      [
        { paramKey: 'alignment',        label: 'Alignment',   iconId: 'ic-align',    min: 0,    max: 1.0,  scale: 'linear', decimals: 2 },
        { paramKey: 'noise',            label: 'Noise',       iconId: 'ic-noise',    min: 0,    max: 0.5,  scale: 'linear', decimals: 3 },
      ],
      [
        { paramKey: 'maxSpeed',         label: 'Max Speed',   iconId: 'ic-speed',    min: 0.01, max: 1.0,  scale: 'linear', decimals: 2 },
        { paramKey: 'friction',         label: 'Friction',    iconId: 'ic-friction', min: 0,    max: 10.0, scale: 'linear', decimals: 1 },
      ],
    ];

    const grid = document.createElement('div');
    grid.className = 'pads-grid';

    for (const [xDef, yDef] of PAD_DEFS) {
      const handle: XYPadHandle = buildXYPad(grid, xDef, yDef, controller);
      updMaps.padVizUpdaters.push(handle.updateViz);
      disconnects.push(handle.teardown);
    }

    parent.appendChild(grid);
  }
```

- [ ] **Step 5: Replace 8 Forces `addSlider` calls with `buildForcesPads`**

Find the Forces block (~lines 323–332):

```ts
  // ── Forces ────────────────────────────────────────────────────────────────
  addSection(paramsBody, 'Forces');
  addSlider(paramsBody, 'Attraction Radius', 0.02, 0.6,  0.01,  () => controller.params.attractionRadius, v => { controller.params.attractionRadius = v; }, 'linear', 'attractionRadius');
  addSlider(paramsBody, 'Repulsion Radius',  0.01, 0.3,  0.005, () => controller.params.repulsionRadius,  v => { controller.params.repulsionRadius = v; },  'linear', 'repulsionRadius');
  addSlider(paramsBody, 'Attraction',        0,    2.0,  0.01,  () => controller.params.attraction,       v => { controller.params.attraction = v; },       'linear', 'attraction');
  addSlider(paramsBody, 'Repulsion',         0,    5.0,  0.05,  () => controller.params.repulsion,        v => { controller.params.repulsion = v; },        'linear', 'repulsion');
  addSlider(paramsBody, 'Alignment',         0,    1.0,  0.01,  () => controller.params.alignment,        v => { controller.params.alignment = v; },        'linear', 'alignment');
  addSlider(paramsBody, 'Friction',          0,    10.0, 0.1,   () => controller.params.friction,         v => { controller.params.friction = v; },         'linear', 'friction');
  addSlider(paramsBody, 'Max Speed',         0.01, 1.0,  0.01,  () => controller.params.maxSpeed,         v => { controller.params.maxSpeed = v; },         'linear', 'maxSpeed');
  addSlider(paramsBody, 'Noise',             0,    0.5,  0.005, () => controller.params.noise ?? 0,       v => { controller.params.noise = v; });
```

Replace with:

```ts
  // ── Forces ────────────────────────────────────────────────────────────────
  addSection(paramsBody, 'Forces');
  buildForcesPads(paramsBody);
```

- [ ] **Step 6: Update `updateAudioViz` to call pad updaters**

Replace the full `updateAudioViz` function body (~lines 357–412) with:

```ts
  function updateAudioViz(baseParams?: Record<string, number>): void {
    const reactor = opts.reactor;

    if (!reactor) {
      for (const u of updMaps.padVizUpdaters) u(null, []);
      return;
    }

    // Reset all param indicators to hidden
    for (const [, ind] of updMaps.paramIndicators) ind.wrap.style.display = 'none';

    if (!reactor.isActive()) {
      for (const [, u] of updMaps.cellUpdaters) u(0);
      for (const u of updMaps.padVizUpdaters) u(null, []);
      return;
    }

    const snapshot = reactor.analyze();

    // Cell amplitude bars + traces
    for (const m of reactor.mappings) {
      if (!m.enabled) continue;
      const key = `${String(m.param)}::${m.band}`;
      const effectiveSignal = Math.min(1, snapshot[m.band] * (m.gain ?? 1));
      updMaps.cellUpdaters.get(key)?.(effectiveSignal);
      updMaps.traceUpdaters.get(key)?.(effectiveSignal);
    }

    // Total-tab live updates
    for (const [param, u] of updMaps.totalUpdaters) {
      const baseVal      = baseParams?.[param] ?? (controller.params as Record<string, number>)[param] ?? 0;
      const modulatedVal = (controller.params as Record<string, number>)[param] ?? 0;
      u(snapshot, baseVal, modulatedVal);
    }

    // Matrix row sparklines (one per param, shows combined modulated value)
    for (const [param, u] of updMaps.matrixTraceUpdaters) {
      const meta = PARAM_META[param];
      if (!meta) continue;
      const modulatedVal = (controller.params as Record<string, number>)[param] ?? 0;
      const range = meta.max - meta.min;
      const normalized = range > 0 ? Math.max(0, Math.min(1, (modulatedVal - meta.min) / range)) : 0;
      u(normalized);
    }

    // Param indicators in the Params tab (sliders only — pads use trace canvas)
    for (const m of reactor.mappings) {
      if (!m.enabled) continue;
      const meta = PARAM_META[m.param as string];
      if (!meta) continue;
      const currentVal = (controller.params as Record<string, number>)[m.param as string] ?? 0;
      const range = meta.max - meta.min;
      const fraction = range > 0 ? Math.max(0, Math.min(1, (currentVal - meta.min) / range)) : 0;
      const ind = updMaps.paramIndicators.get(m.param as string);
      if (ind) {
        ind.wrap.style.display = 'block';
        ind.fill.style.width   = `${fraction * 100}%`;
        ind.fill.style.background = BAND_COLORS[m.band];
      }
    }

    // XY pad dot positions + audio trace
    for (const u of updMaps.padVizUpdaters) u(snapshot, reactor.mappings);
  }
```

- [ ] **Step 7: Start dev server and verify**

```bash
npm run dev
```

Open `http://localhost:4321/gallery/boids` in Chrome. Check:

1. **Forces section** shows a 2×2 grid of square pads (8 sliders gone)
2. Each pad has a dot, corner chips (Y-axis label top-left, X-axis label bottom-right), and two axis value readouts (X centered on top edge, Y centered on right edge)
3. SVG icons render in the chips (small, uses `currentColor`)
4. **Drag**: clicking anywhere on a pad moves the dot there immediately; dragging tracks the cursor
5. **Values**: readouts update live during drag with the correct decimal places
6. **Simulation**: boid behavior changes as you drag (attraction, repulsion, etc. are live)
7. **Audio trace** (if you enable microphone): a fading path appears on the canvas and blends band colors

- [ ] **Step 8: Commit**

```bash
git add src/components/simulations/boids/boids-panel.ts
git commit -m "feat(boids): replace Forces sliders with XY pad grid, wire audio trace"
```
