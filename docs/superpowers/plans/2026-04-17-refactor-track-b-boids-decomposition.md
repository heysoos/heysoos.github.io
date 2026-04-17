# Refactor Track B — Boids Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **WORKTREE REQUIRED:** Before starting, invoke `superpowers:using-git-worktrees` to create an isolated branch for this work.
>
> **Prerequisite:** Track A (`2026-04-17-refactor-track-a-infrastructure.md`) must be merged first. This plan assumes `sim-setup/boids.ts` exists and imports from `boids-panel`.

**Goal:** Decompose `boids-panel.ts` (1,881 lines) into a `panel/` subdirectory of focused modules, and apply targeted cleanup to `boids-controller.ts` to break up the 172-line `tick()` method and eliminate duplicated patterns.

**Architecture:** `boids-panel.ts` becomes a `panel/` subdirectory. `buildAudioTab` (700 lines) is extracted as an `AudioTab` class to `audio-tab.ts`. Ring buffer canvas drawing is unified in `RingBufferCanvas`. Slider logic becomes `createRangeSlider`. Drawer open/close state moves into `DrawerController`. The controller's `tick()` is split into four private phase methods. Public API (`buildBoidsPanel` exported from `panel/index.ts`) is unchanged so no callers need updates.

**Tech Stack:** TypeScript, Canvas 2D API, ResizeObserver, Web Audio API

**Spec:** `docs/superpowers/specs/2026-04-17-codebase-refactoring-design.md` — Track B sections

---

## File Map

**Create (new `panel/` subdirectory):**
- `src/components/simulations/boids/panel/index.ts` — re-exports `buildBoidsPanel`; public API unchanged
- `src/components/simulations/boids/panel/boids-panel.ts` — thin orchestrator (~200 lines), moved from root
- `src/components/simulations/boids/panel/audio-tab.ts` — `buildAudioTab` function and all its helpers (~700 lines)
- `src/components/simulations/boids/panel/ring-buffer-canvas.ts` — `RingBufferCanvas` class (~120 lines)
- `src/components/simulations/boids/panel/drawer-controller.ts` — `DrawerController` class (~120 lines)
- `src/components/simulations/boids/panel/range-slider.ts` — `createRangeSlider` function (~100 lines)
- `src/components/simulations/boids/panel/panel-styles.ts` — `pillStyle` helper + `STYLES` constants
- `src/components/simulations/boids/panel/resize-observer-pool.ts` — `ResizeObserverPool` utility (~25 lines)

**Modify:**
- `src/components/simulations/boids/boids-controller.ts` — extract `_packUniforms()`, `_buildPingPongBindGroups()`, split `tick()`, snapshot rollback
- `src/lib/sim-page/sim-setup/boids.ts` — update import path: `boids-panel` → `boids/panel`

**No change to:**
- `boids.wgsl`, `boids-grid.wgsl`, `trail-renderer.ts`, `boids-image-force.ts`, `boids-webcam.ts`, `boids-audio.ts`

---

## Task 1: Create panel/resize-observer-pool.ts

**Files:**
- Create: `src/components/simulations/boids/panel/resize-observer-pool.ts`

Replaces the manual `disconnects: Array<() => void>` registry that `buildBoidsPanel` currently maintains. All ResizeObservers registered through the pool are disconnected in one call.

- [ ] **Step 1: Create the file**

```typescript
// src/components/simulations/boids/panel/resize-observer-pool.ts

export class ResizeObserverPool {
  private observers: ResizeObserver[] = [];

  observe(el: Element, callback: ResizeObserverCallback): ResizeObserver {
    const ro = new ResizeObserver(callback);
    ro.observe(el);
    this.observers.push(ro);
    return ro;
  }

  disconnectAll(): void {
    for (const ro of this.observers) ro.disconnect();
    this.observers = [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/simulations/boids/panel/resize-observer-pool.ts
git commit -m "refactor(boids-panel): add ResizeObserverPool utility"
```

---

## Task 2: Create panel/panel-styles.ts

**Files:**
- Create: `src/components/simulations/boids/panel/panel-styles.ts`

Extracts the `pillStyle` function and scattered inline CSS magic strings into named constants.

- [ ] **Step 1: Create the file**

```typescript
// src/components/simulations/boids/panel/panel-styles.ts

/** CSS string for a pill-style toggle button (presets, audio source, opacity mode). */
export function pillStyle(active: boolean): string {
  return [
    'padding:2px 8px',
    'border-radius:12px',
    'font-size:0.68rem',
    'cursor:pointer',
    'transition:background 0.15s,color 0.15s',
    active
      ? 'background:var(--accent);color:var(--bg-primary);border:1px solid transparent;'
      : 'background:transparent;color:var(--text-muted);border:1px solid var(--bg-surface-border);',
  ].join(';');
}

export const STYLES = {
  sectionLabel: 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:5px;',
  sourceSection: 'padding:8px 8px 6px;border-bottom:1px solid var(--bg-surface-border);',
  errorMsg:      'font-size:0.62rem;color:#e05060;margin-top:4px;display:none;word-break:break-word;',
  statusDot:     'width:7px;height:7px;border-radius:50%;display:inline-block;margin-left:auto;background:var(--text-muted);transition:background 0.2s;',
  drawerRow:     'border-bottom:1px solid var(--bg-surface-border);',
  drawerHeader:  'display:flex;align-items:center;cursor:pointer;padding:5px 8px;gap:6px;font-size:0.68rem;color:var(--text-body);user-select:none;',
  drawerBody:    'padding:6px 8px 8px;display:flex;flex-direction:column;gap:6px;',
  matrixCanvas:  'background:#06050a;border-radius:2px;display:block;',
  bgCanvas:      '#06050a',
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/simulations/boids/panel/panel-styles.ts
git commit -m "refactor(boids-panel): extract pillStyle and STYLES constants"
```

---

## Task 3: Create panel/range-slider.ts

**Files:**
- Create: `src/components/simulations/boids/panel/range-slider.ts`

Extracts the `addSlider` function (currently lines 213–306 of `boids-panel.ts`) into an exported `createRangeSlider` function. The audio indicator bar creation is exposed via an optional `onIndicatorCreate` callback.

- [ ] **Step 1: Create the file**

```typescript
// src/components/simulations/boids/panel/range-slider.ts

export interface RangeSliderOpts {
  label:   string;
  min:     number;
  max:     number;
  step:    number;
  get:     () => number;
  set:     (v: number) => void;
  scale?:  'linear' | 'log';
  /** Called with (indWrap, indFill) if an audio indicator bar should be created. */
  onIndicatorCreate?: (wrap: HTMLElement, fill: HTMLElement) => void;
}

/** Appends a labelled range-slider row to `parent`. */
export function createRangeSlider(parent: HTMLElement, opts: RangeSliderOpts): void {
  const { label, min, max, step, get, set, scale = 'linear' } = opts;

  const row      = document.createElement('div');
  row.className  = 'param-row';
  const labelEl  = document.createElement('div');
  labelEl.className = 'param-label';
  const nameSpan = document.createElement('span');
  nameSpan.textContent = label;
  const valueSpan = document.createElement('span');
  valueSpan.className = 'param-value';
  valueSpan.style.cursor = 'text';
  valueSpan.title = 'Click to edit';
  labelEl.appendChild(nameSpan);
  labelEl.appendChild(valueSpan);

  const input    = document.createElement('input');
  input.type     = 'range';

  const isLog    = scale === 'log';
  const sliderMin  = isLog ? Math.log(min)  : min;
  const sliderMax  = isLog ? Math.log(max)  : max;
  const sliderStep = isLog ? (sliderMax - sliderMin) / 1000 : step;
  const decimals   = step >= 1 ? 0 : (String(step).split('.')[1]?.length ?? 2);

  function sliderToValue(s: number): number {
    if (!isLog) return s;
    const v = Math.exp(s);
    return decimals === 0 ? Math.round(v) : parseFloat(v.toFixed(decimals));
  }
  function valueToSlider(v: number): number {
    return isLog ? Math.log(Math.max(v, min)) : v;
  }

  input.min   = String(sliderMin);
  input.max   = String(sliderMax);
  input.step  = String(sliderStep);
  input.value = String(valueToSlider(get()));
  valueSpan.textContent = get().toFixed(decimals);

  input.addEventListener('input', () => {
    const val = sliderToValue(parseFloat(input.value));
    set(val);
    valueSpan.textContent = val.toFixed(decimals);
  });

  valueSpan.addEventListener('click', () => {
    const lastVal = get();
    const editInput = document.createElement('input');
    editInput.type       = 'text';
    editInput.value      = lastVal.toFixed(decimals);
    editInput.className  = 'param-value-edit';
    valueSpan.replaceWith(editInput);
    editInput.select();

    function commit(): void {
      const raw      = decimals === 0 ? parseInt(editInput.value, 10) : parseFloat(editInput.value);
      const isValid  = !isNaN(raw) && raw >= min && raw <= max;
      const finalVal = isValid ? raw : lastVal;
      if (isValid) { set(finalVal); input.value = String(valueToSlider(finalVal)); }
      valueSpan.textContent = finalVal.toFixed(decimals);
      editInput.replaceWith(valueSpan);
    }

    editInput.addEventListener('blur', commit);
    editInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { editInput.blur(); }
      if (e.key === 'Escape') { editInput.value = lastVal.toFixed(decimals); editInput.blur(); }
    });
    editInput.focus();
  });

  row.appendChild(labelEl);
  row.appendChild(input);

  if (opts.onIndicatorCreate) {
    const indWrap = document.createElement('div');
    indWrap.style.cssText = 'height:2px;background:var(--bg-surface-border);border-radius:1px;overflow:hidden;margin-top:2px;display:none;';
    const indFill = document.createElement('div');
    indFill.style.cssText = 'height:100%;width:0%;border-radius:1px;';
    indWrap.appendChild(indFill);
    row.appendChild(indWrap);
    opts.onIndicatorCreate(indWrap, indFill);
  }

  parent.appendChild(row);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/simulations/boids/panel/range-slider.ts
git commit -m "refactor(boids-panel): extract addSlider as createRangeSlider"
```

---

## Task 4: Create panel/ring-buffer-canvas.ts

**Files:**
- Create: `src/components/simulations/boids/panel/ring-buffer-canvas.ts`

Unifies the four ring-buffer canvas patterns (`makeMatrixTrace`, `makeTraceCanvas`, `makeBandTrace`, and the stacked trace) behind one class. Drawing is injected as a `render` callback so the caller controls the visual style while the class handles ring-buffer bookkeeping, ResizeObserver, and canvas sizing.

- [ ] **Step 1: Create the file**

```typescript
// src/components/simulations/boids/panel/ring-buffer-canvas.ts

export const TRACE_LEN = 256; // shared ring buffer length

export interface RingBufferCanvasOpts {
  /** Called whenever a redraw is needed. Receives buffer data, write pointer, and canvas context. */
  render: (
    ctx:  CanvasRenderingContext2D,
    data: Float32Array,
    ptr:  number,
    cssW: number,
    cssH: number,
    dpr:  number,
  ) => void;
  /** Called on resize with (newCssWidth, newCssHeight). Return updated height or undefined to keep it. */
  onResize?: (cssW: number, cssH: number) => number | undefined;
  initialHeight?: number;
}

export class RingBufferCanvas {
  readonly canvas: HTMLCanvasElement;
  private data:    Float32Array;
  private ptr      = 0;
  private cssH:    number;
  private ro:      ResizeObserver;
  private render:  RingBufferCanvasOpts['render'];
  private onResize?: RingBufferCanvasOpts['onResize'];

  private static dpr = Math.round(window.devicePixelRatio ?? 1);

  constructor(opts: RingBufferCanvasOpts) {
    const dpr = RingBufferCanvas.dpr;
    this.render   = opts.render;
    this.onResize = opts.onResize;
    this.cssH     = opts.initialHeight ?? 40;
    this.data     = new Float32Array(TRACE_LEN);

    this.canvas         = document.createElement('canvas');
    this.canvas.height  = Math.round(this.cssH * dpr);
    this.canvas.style.height = `${this.cssH}px`;

    this.ro = new ResizeObserver(() => {
      const w = this.canvas.clientWidth;
      if (w > 0) this.canvas.width = Math.round(w * dpr);
      const newH = this.onResize?.(w, this.cssH);
      if (newH !== undefined && newH !== this.cssH) {
        this.cssH               = newH;
        this.canvas.height      = Math.round(newH * dpr);
        this.canvas.style.height = `${newH}px`;
      }
      this.draw();
    });
    this.ro.observe(this.canvas);
  }

  push(value: number): void {
    this.data[this.ptr] = value;
    this.ptr = (this.ptr + 1) % TRACE_LEN;
    this.draw();
  }

  pushMultiple(values: Float32Array): void {
    for (let i = 0; i < values.length; i++) {
      this.data[this.ptr] = values[i];
      this.ptr = (this.ptr + 1) % TRACE_LEN;
    }
    this.draw();
  }

  draw(): void {
    const dpr = RingBufferCanvas.dpr;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    this.render(ctx, this.data, this.ptr, this.canvas.width / dpr, this.canvas.height / dpr, dpr);
  }

  clear(): void {
    this.data.fill(0);
    this.ptr = 0;
    this.draw();
  }

  disconnect(): void {
    this.ro.disconnect();
  }
}

/** Standard waveform trace renderer — used by makeTraceCanvas and makeBandTrace equivalents. */
export function makeTraceRenderer(bandColor: string): RingBufferCanvasOpts['render'] {
  return (ctx, data, ptr, W, H) => {
    const vLen    = Math.min(TRACE_LEN, Math.max(2, W));
    const startOff = TRACE_LEN - vLen;
    let trMin = Infinity, trMax = -Infinity;
    for (let i = 0; i < vLen; i++) {
      const v = data[(ptr + startOff + i) % TRACE_LEN];
      if (v < trMin) trMin = v;
      if (v > trMax) trMax = v;
    }
    if (!isFinite(trMin)) trMin = 0;
    if (!isFinite(trMax)) trMax = 0;
    const currentVal = data[(ptr - 1 + TRACE_LEN) % TRACE_LEN];

    // Guide lines
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, 1); ctx.lineTo(W, 1);
    ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1);
    ctx.stroke();

    const innerH = H - 2;
    ctx.strokeStyle  = bandColor;
    ctx.lineWidth    = 1.5;
    ctx.lineCap      = 'round';
    ctx.lineJoin     = 'round';
    ctx.globalAlpha  = 0.9;
    ctx.beginPath();
    if (vLen <= W) {
      for (let x = 0; x < W; x++) {
        const t  = (x / Math.max(1, W - 1)) * (vLen - 1);
        const i0 = Math.floor(t);
        const i1 = Math.min(vLen - 1, i0 + 1);
        const v  = data[(ptr + startOff + i0) % TRACE_LEN] * (1 - (t - i0))
                 + data[(ptr + startOff + i1) % TRACE_LEN] * (t - i0);
        const y  = H - v * innerH - 1;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    } else {
      for (let i = 0; i < vLen; i++) {
        const x = (i / (vLen - 1)) * W;
        const y = H - data[(ptr + startOff + i) % TRACE_LEN] * innerH - 1;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Labels
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(trMax.toFixed(2), 2, 10);
    ctx.fillText(trMin.toFixed(2), 2, H - 2);
    const tipY   = H - currentVal * innerH - 1;
    const labelY = Math.max(9, Math.min(H - 3, tipY - 5));
    ctx.fillStyle = bandColor;
    ctx.fillText(currentVal.toFixed(2), W - 26, labelY);
  };
}

/** Mini sparkline renderer — used by matrix column traces. */
export function makeMiniRenderer(lineColor: string): RingBufferCanvasOpts['render'] {
  return (ctx, data, ptr, W, H) => {
    const vLen     = Math.min(TRACE_LEN, Math.max(2, Math.round(W)));
    const startOff = TRACE_LEN - vLen;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    for (let i = 0; i < vLen; i++) {
      const x = (i / (vLen - 1)) * W;
      const y = H - data[(ptr + startOff + i) % TRACE_LEN] * H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/simulations/boids/panel/ring-buffer-canvas.ts
git commit -m "refactor(boids-panel): extract RingBufferCanvas with pluggable renderer"
```

---

## Task 5: Create panel/drawer-controller.ts

**Files:**
- Create: `src/components/simulations/boids/panel/drawer-controller.ts`

Extracts the drawer open/close state machine from `buildAudioTab` (the `openParam`, `drawerRow`, `activeDrawerDisconnects` variables and their management logic).

- [ ] **Step 1: Create the file**

```typescript
// src/components/simulations/boids/panel/drawer-controller.ts

export class DrawerController {
  private openParam:                 string | null = null;
  private drawerRow:                 HTMLElement | null = null;
  private activeDrawerDisconnects:   Array<() => void> = [];

  /**
   * Opens a drawer row for the given param key.
   * @param key - param identifier (e.g. 'attraction')
   * @param row - the matrix row element to inject the drawer body into
   * @param buildContent - called to populate the drawer body element; returns disconnect fns
   */
  open(
    key:          string,
    row:          HTMLElement,
    buildContent: (body: HTMLElement) => Array<() => void>,
  ): void {
    if (this.openParam === key) {
      this.close();
      return;
    }
    this.close();
    this.openParam = key;
    this.drawerRow = row;

    const body = document.createElement('div');
    body.style.cssText = 'padding:6px 8px 8px;display:flex;flex-direction:column;gap:6px;';
    this.activeDrawerDisconnects = buildContent(body);
    row.appendChild(body);
  }

  close(): void {
    if (!this.openParam) return;
    for (const fn of this.activeDrawerDisconnects) fn();
    this.activeDrawerDisconnects = [];
    // Remove the injected drawer body (last child of row)
    if (this.drawerRow) {
      const body = this.drawerRow.lastElementChild;
      if (body && body !== this.drawerRow.firstElementChild) {
        this.drawerRow.removeChild(body);
      }
    }
    this.openParam = null;
    this.drawerRow = null;
  }

  isOpen(key: string): boolean {
    return this.openParam === key;
  }

  dispose(): void {
    this.close();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/simulations/boids/panel/drawer-controller.ts
git commit -m "refactor(boids-panel): extract DrawerController for audio matrix drawer state"
```

---

## Task 6: Create panel/audio-tab.ts

**Files:**
- Create: `src/components/simulations/boids/panel/audio-tab.ts`

Moves `buildAudioTab` (~700 lines, `boids-panel.ts` lines 1186–1881) and all its helper functions (`buildBandTab`, `buildTotalTab`, `makeMatrixTrace`, `makeTraceCanvas`) into this file. Functions that used `makeTraceCanvas` / `makeMatrixTrace` are updated to use `RingBufferCanvas`. The drawer state uses `DrawerController`.

- [ ] **Step 1: Create the file**

The file begins with imports and then contains the verbatim move of the audio-related functions from `boids-panel.ts`:

```typescript
// src/components/simulations/boids/panel/audio-tab.ts
import type { AudioReactor, BandKey, AudioMapping, BandSnapshot } from '../boids-audio';
import { BAND_COLORS, PARAM_META, MAPPABLE_PARAMS, drawAudioViz } from '../boids-audio';
import { RingBufferCanvas, makeTraceRenderer, makeMiniRenderer, TRACE_LEN } from './ring-buffer-canvas';
import { DrawerController } from './drawer-controller';
import { ResizeObserverPool } from './resize-observer-pool';
import { pillStyle, STYLES } from './panel-styles';

// ── Module-level constants (shared between buildBandTab, buildTotalTab, buildAudioTab) ──

// ... copy TRACE_*, MAT_TRACE_*, dpr, BAND_KEYS_ORDER constants from boids-panel.ts lines 705-717

/**
 * Groups the five Maps that bridge Params tab indicator bars and Audio tab live updaters.
 * Matches the AudioUpdaterMaps interface in boids-panel.ts — same shape, moved here.
 */
export interface AudioUpdaterMaps {
  paramIndicators:     Map<string, { wrap: HTMLElement; fill: HTMLElement }>;
  cellUpdaters:        Map<string, (amplitude: number) => void>;
  totalUpdaters:       Map<string, (snapshot: BandSnapshot, baseVal: number, modulatedVal: number) => void>;
  traceUpdaters:       Map<string, (amplitude: number) => void>;
  matrixTraceUpdaters: Map<string, (normalizedVal: number) => void>;
}
```

Then move these functions verbatim from `boids-panel.ts`, updating each to use `RingBufferCanvas`:

**`makeMatrixTrace`** — replace manual canvas + ResizeObserver + ring buffer with:
```typescript
function makeMatrixTrace(
  bandColor: string,
): { canvas: HTMLCanvasElement; push: (v: number) => void; disconnect: () => void } {
  const rbc = new RingBufferCanvas({
    render: makeMiniRenderer(bandColor),
    initialHeight: 16,
  });
  rbc.canvas.style.cssText = STYLES.matrixCanvas + 'width:100%;height:16px;';
  return {
    canvas:     rbc.canvas,
    push:       (v) => rbc.push(v),
    disconnect: () => rbc.disconnect(),
  };
}
```

**`makeTraceCanvas`** — replace with:
```typescript
function makeTraceCanvas(
  bandColor: string,
  registerDisconnect: (fn: () => void) => void,
): { canvas: HTMLCanvasElement; push: (v: number) => void } {
  const TRACE_H = 40;
  const dpr = Math.round(window.devicePixelRatio ?? 1);
  const rbc = new RingBufferCanvas({
    render: makeTraceRenderer(bandColor),
    initialHeight: TRACE_H,
    onResize: (w, currentH) => {
      // dynamic height: 20% of panel height, clamped to [TRACE_H, 160]
      const panelEl = rbc.canvas.closest?.('.params-panel') as HTMLElement | null;
      if (!panelEl) return undefined;
      const newH = Math.round(Math.min(160, Math.max(TRACE_H, panelEl.clientHeight * 0.20)));
      return newH !== currentH ? newH : undefined;
    },
  });
  registerDisconnect(() => rbc.disconnect());
  return { canvas: rbc.canvas, push: (v) => rbc.push(v) };
}
```

Then move `buildBandTab`, `buildTotalTab`, and `buildAudioTab` verbatim. Update `buildAudioTab` to:
- Accept `roPool: ResizeObserverPool` instead of `registerDisconnect`
- Use `DrawerController` for drawer state instead of `openParam/drawerRow/activeDrawerDisconnects`
- Use `createRangeSlider` from `range-slider.ts` for any sliders inside drawers

The function signature stays:
```typescript
export function buildAudioTab(
  container:          HTMLElement,
  reactor:            AudioReactor,
  updMaps:            AudioUpdaterMaps,
  registerDisconnect: (fn: () => void) => void,
): { start: () => void; stop: () => void }
```

> **Implementation note:** This is a large verbatim move. Copy the entire block (lines 718–1881 of `boids-panel.ts`) into `audio-tab.ts`, then make the targeted substitutions listed above. Run the dev server after each substitution, not at the end of all of them, to catch regressions early.

- [ ] **Step 2: Commit after each substitution group**

After moving verbatim:
```bash
git add src/components/simulations/boids/panel/audio-tab.ts
git commit -m "refactor(boids-panel): move buildAudioTab block to audio-tab.ts"
```

After updating `makeMatrixTrace` to use `RingBufferCanvas`:
```bash
git commit -am "refactor(boids-panel): makeMatrixTrace → RingBufferCanvas"
```

After updating `makeTraceCanvas` to use `RingBufferCanvas`:
```bash
git commit -am "refactor(boids-panel): makeTraceCanvas → RingBufferCanvas"
```

After updating `buildAudioTab` internals (DrawerController, roPool):
```bash
git commit -am "refactor(boids-panel): buildAudioTab uses DrawerController + ResizeObserverPool"
```

---

## Task 7: Create panel/boids-panel.ts and panel/index.ts

**Files:**
- Create: `src/components/simulations/boids/panel/boids-panel.ts`
- Create: `src/components/simulations/boids/panel/index.ts`
- Modify: `src/lib/sim-page/sim-setup/boids.ts` (update import path)

Move `boids-panel.ts` content — everything except the audio-tab functions already extracted — into `panel/boids-panel.ts`. This is the thin orchestrator: tab bar, preset pills, `addSection` helpers, Params tab sliders, and the coordinator that wires up `buildAudioTab`.

- [ ] **Step 1: Create `panel/boids-panel.ts`**

This file should contain (in order):
1. Imports: `createRangeSlider`, `pillStyle/STYLES` from panel-styles, `buildAudioTab` / `AudioUpdaterMaps` from audio-tab, `buildImagePanelSection` / `openImageEditorOverlay` from image-editor, type imports for controller/presets/audio
2. `BoidsPanelOpts` interface — verbatim from boids-panel.ts
3. `buildBoidsPanel` function — replace the `addSlider` calls with `createRangeSlider`, replace manual `disconnects` array with `ResizeObserverPool`
4. `addSection`, `buildOpacityModeRow`, `buildShapeRow`, `buildColorRow`, `buildTrailsRow`, `makeResetBtn` — verbatim from boids-panel.ts
5. **No** `buildAudioTab` block (now in audio-tab.ts)

The only change to `buildBoidsPanel` itself is:
- Replace `const disconnects: Array<() => void> = []; const registerDisconnect = ...` with `const roPool = new ResizeObserverPool()`
- Replace `disconnects.forEach(fn => fn())` in teardown with `roPool.disconnectAll()`
- Replace all `addSlider(...)` calls with `createRangeSlider(parent, { label, min, max, step, get, set, scale, onIndicatorCreate: (w, f) => updMaps.paramIndicators.set(paramKey, { wrap: w, fill: f }) })`

- [ ] **Step 2: Create `panel/index.ts`**

```typescript
// src/components/simulations/boids/panel/index.ts
export { buildBoidsPanel, type BoidsPanelOpts } from './boids-panel';
```

- [ ] **Step 3: Update the import in sim-setup/boids.ts**

Change:
```typescript
import { buildBoidsPanel } from '../../../components/simulations/boids/boids-panel';
```
To:
```typescript
import { buildBoidsPanel } from '../../../components/simulations/boids/panel';
```

Also search for any other imports of `boids-panel` across the codebase:
```bash
grep -r "boids-panel" src/ --include="*.ts" --include="*.astro"
```
Update each one found to use `boids/panel` instead.

- [ ] **Step 4: Verify boids simulation**

```bash
npm run dev
```

Open `http://localhost:4321/gallery/boids`. Verify:
- Params tab: all sliders work, value editing works, reset buttons work
- Audio tab: source selection, spectrum, matrix grid, drawers open/close, traces update live
- Image tab: file upload and force overlay work
- Preset switching rebuilds panel correctly
- No console errors on panel teardown

- [ ] **Step 5: Delete the old boids-panel.ts root file**

```bash
git rm src/components/simulations/boids/boids-panel.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/components/simulations/boids/panel/
git add src/lib/sim-page/sim-setup/boids.ts
git commit -m "refactor(boids-panel): split into panel/ subdirectory, public API unchanged"
```

---

## Task 8: Controller — extract _packUniforms()

**Files:**
- Modify: `src/components/simulations/boids/boids-controller.ts`

The 34-line DataView block currently inline in `tick()` (lines 481–514) becomes a private method. This makes `tick()`'s structure readable and the uniform layout inspectable in one place.

- [ ] **Step 1: Add the private method**

After the `setObstacles` method (around line 446 in the original), add:

```typescript
private _packUniforms(aspect: number): ArrayBuffer {
  const buf = new ArrayBuffer(112);
  const v   = new DataView(buf);
  v.setFloat32( 0, this.params.dt,                   true);
  v.setFloat32( 4, this.params.attractionRadius,      true);
  v.setFloat32( 8, this.params.repulsionRadius,       true);
  v.setFloat32(12, this.params.attraction,            true);
  v.setFloat32(16, this.params.repulsion,             true);
  v.setFloat32(20, this.params.alignment,             true);
  v.setFloat32(24, this.params.friction,              true);
  v.setFloat32(28, this.params.maxSpeed,              true);
  v.setUint32 (32, this.params.numParticles,          true);
  v.setFloat32(36, this.mouseX,                       true);
  v.setFloat32(40, this.mouseY,                       true);
  v.setFloat32(44, this.mouseActive ? 1.0 : 0.0,      true);
  v.setFloat32(48, this.params.mouseRadius,           true);
  v.setFloat32(52, this.params.coneAngle,             true);
  v.setFloat32(56, aspect,                            true);
  v.setFloat32(60, this.params.size,                  true);
  v.setUint32 (64, this.params.shapeId,               true);
  v.setFloat32(68, this.params.colorR,                true);
  v.setFloat32(72, this.params.colorG,                true);
  v.setFloat32(76, this.params.colorB,                true);
  v.setFloat32(80, this.params.opacity,               true);
  v.setUint32 (84, this.params.opacityMode,           true);
  const gridDim = Math.max(4, Math.min(MAX_GRID_DIM, Math.floor(2.0 / this.params.attractionRadius)));
  v.setUint32 (88, gridDim,                           true);
  v.setUint32 (92, this.frame,                        true);
  const imgParams = this.imageForce.getExtraParams();
  v.setFloat32(96,  imgParams.imageStrength,          true);
  v.setUint32 (100, imgParams.imageForceMode,         true);
  v.setUint32 (104, imgParams.imageInvert,            true);
  v.setFloat32(108, this.params.noise ?? 0.0,         true);
  return buf;
}
```

- [ ] **Step 2: Replace the inline block in tick()**

In `tick()`, replace lines 481–514 (the DataView block) with:

```typescript
const uniformArray = this._packUniforms(aspect);
device.queue.writeBuffer(this.uniformBuffer, 0, uniformArray);

const N = this.params.numParticles;
const gridDim = Math.max(4, Math.min(MAX_GRID_DIM, Math.floor(2.0 / this.params.attractionRadius)));
const gridSize = gridDim * gridDim;
```

> **Note:** `gridDim` is now computed twice (once inside `_packUniforms`, once in `tick()` for `gridSize`). This duplication is acceptable — extracting a shared helper for a single value is premature. If this becomes a concern later, move `gridDim` out of `_packUniforms` and pass it as a parameter.

- [ ] **Step 3: Verify boids simulation still runs**

```bash
npm run dev
```

Open `http://localhost:4321/gallery/boids`. Run for 10 seconds, verify no visual glitches.

- [ ] **Step 4: Commit**

```bash
git add src/components/simulations/boids/boids-controller.ts
git commit -m "refactor(boids-controller): extract _packUniforms() from tick()"
```

---

## Task 9: Controller — extract _buildPingPongBindGroups()

**Files:**
- Modify: `src/components/simulations/boids/boids-controller.ts`

Three nearly-identical bind group pair constructions exist: grid bind groups (~228–254), boids bind groups (~301–328), and the render-time rebuild in `rebuildBoidsBindGroups` (~662–689). The grid and boids patterns differ by buffer entries, so a shared helper takes the layout and entry list.

- [ ] **Step 1: Add the helper method**

```typescript
private _buildBindGroupPair(
  layout:   GPUBindGroupLayout,
  entriesA: GPUBindGroupEntry[],
  entriesB: GPUBindGroupEntry[],
): GPUBindGroup[] {
  const { device } = this.gpu!;
  return [
    device.createBindGroup({ layout, entries: entriesA }),
    device.createBindGroup({ layout, entries: entriesB }),
  ];
}
```

- [ ] **Step 2: Replace the grid bind group construction in init()**

Replace the two-element array literal for `this.gridBindGroups` (lines ~226–254) with:

```typescript
this.gridBindGroups = this._buildBindGroupPair(
  this.gridBindGroupLayout,
  [
    { binding: 0, resource: { buffer: this.uniformBuffer } },
    { binding: 1, resource: { buffer: this.particleBuffers[0] } },
    { binding: 2, resource: { buffer: this.particleCellIDsBuffer } },
    { binding: 3, resource: { buffer: this.cellCountsBuffer } },
    { binding: 4, resource: { buffer: this.cellOffsetsBuffer } },
    { binding: 5, resource: { buffer: this.cellScatterIdxBuffer } },
    { binding: 6, resource: { buffer: this.sortedIndicesBuffer } },
    { binding: 7, resource: { buffer: this.sortedParticlesBuffer } },
  ],
  [
    { binding: 0, resource: { buffer: this.uniformBuffer } },
    { binding: 1, resource: { buffer: this.particleBuffers[1] } },
    { binding: 2, resource: { buffer: this.particleCellIDsBuffer } },
    { binding: 3, resource: { buffer: this.cellCountsBuffer } },
    { binding: 4, resource: { buffer: this.cellOffsetsBuffer } },
    { binding: 5, resource: { buffer: this.cellScatterIdxBuffer } },
    { binding: 6, resource: { buffer: this.sortedIndicesBuffer } },
    { binding: 7, resource: { buffer: this.sortedParticlesBuffer } },
  ],
);
```

- [ ] **Step 3: Update _createBoidsPipelines() to use the helper**

Find `this.boidsBindGroups = [...]` in `_createBoidsPipelines` and replace with `this._buildBindGroupPair(...)` using the appropriate entries from that block.

- [ ] **Step 4: Update rebuildBoidsBindGroups() to use the helper**

Find `rebuildBoidsBindGroups()` and replace its bind group array construction with `this._buildBindGroupPair(...)`.

- [ ] **Step 5: Commit**

```bash
git add src/components/simulations/boids/boids-controller.ts
git commit -m "refactor(boids-controller): extract _buildBindGroupPair to remove duplicated bind group construction"
```

---

## Task 10: Controller — break up tick()

**Files:**
- Modify: `src/components/simulations/boids/boids-controller.ts`

Split the 172-line `tick()` into four private phase methods. `tick()` becomes a coordinator.

- [ ] **Step 1: Extract _preFrameSetup()**

Add this method (moves resize check + webcam update from tick):

```typescript
private _preFrameSetup(): { device: GPUDevice; context: GPUCanvasContext; canvas: HTMLCanvasElement; aspect: number } {
  const { device, context, canvas } = this.gpu!;
  const resized = resizeCanvasToDisplaySize(canvas);
  if (resized || canvas.width !== this.prevCanvasWidth || canvas.height !== this.prevCanvasHeight) {
    this.trailRenderer.resize(device, canvas.width, canvas.height);
    this.imageProcessor.resize(canvas.width, canvas.height);
    this.rebuildBoidsBindGroups();
    this.overlayBindGroup = null;
    this.prevCanvasWidth  = canvas.width;
    this.prevCanvasHeight = canvas.height;
  }
  if (this.webcam.status === 'active') {
    this.webcam.tick(this.imageProcessor);
  }
  const aspect = canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 1.0;
  return { device, context, canvas, aspect };
}
```

- [ ] **Step 2: Extract _runComputePasses()**

```typescript
private _runComputePasses(device: GPUDevice, N: number, gridDim: number, gridSize: number): void {
  const gridBG = this.gridBindGroups[this.frame % 2];
  const computeEncoder = device.createCommandEncoder();
  const computePass    = computeEncoder.beginComputePass();
  computePass.setPipeline(this.clearGridPipeline);
  computePass.setBindGroup(0, gridBG);
  computePass.dispatchWorkgroups(Math.ceil(gridSize / 256));
  computePass.setPipeline(this.gridAssignPipeline);
  computePass.setBindGroup(0, gridBG);
  computePass.dispatchWorkgroups(Math.ceil(N / 256));
  computePass.setPipeline(this.prefixSumPipeline);
  computePass.setBindGroup(0, gridBG);
  computePass.dispatchWorkgroups(1);
  computePass.setPipeline(this.scatterPipeline);
  computePass.setBindGroup(0, gridBG);
  computePass.dispatchWorkgroups(Math.ceil(N / 256));
  computePass.setPipeline(this.scatterDataPipeline);
  computePass.setBindGroup(0, gridBG);
  computePass.dispatchWorkgroups(Math.ceil(N / 256));
  computePass.setPipeline(this.computePipeline);
  computePass.setBindGroup(0, this.boidsBindGroups[this.frame % 2]);
  computePass.dispatchWorkgroups(Math.ceil(N / 256));
  computePass.end();
  device.queue.submit([computeEncoder.finish()]);
}
```

- [ ] **Step 3: Extract _renderFrame()**

```typescript
private _renderFrame(
  device: GPUDevice,
  context: GPUCanvasContext,
  N: number,
): void {
  this.trailRenderer.render(
    device,
    context,
    this.trailDecay,
    this.trailsEnabled,
    (encoder, targetView, loadOp) => {
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: targetView,
          clearValue: { r: 0.039, g: 0.031, b: 0.016, a: 1 },
          loadOp,
          storeOp: 'store',
        }],
      });
      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.renderParamsBindGroup);
      renderPass.setVertexBuffer(0, this.particleBuffers[(this.frame + 1) % 2]);
      renderPass.setVertexBuffer(1, this.vertexBuffer);
      renderPass.draw(6, N);
      renderPass.end();
    },
  );

  if (this.imageForce.isActive() && this.imageForce.showOverlay && this.overlayPipeline) {
    if (!this.overlayBindGroup) {
      this.overlayBindGroup = device.createBindGroup({
        layout: this.overlayPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.imageProcessor.getOutputSampler() },
          { binding: 1, resource: this.imageProcessor.getCompositedTexture().createView() },
        ],
      });
    }
    const enc  = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this.overlayPipeline);
    pass.setBindGroup(0, this.overlayBindGroup);
    pass.draw(6);
    pass.end();
    device.queue.submit([enc.finish()]);
  }
}
```

- [ ] **Step 4: Rewrite tick() as coordinator**

```typescript
private tick = () => {
  if (!this.running || !this.gpu) return;

  if (Number.isFinite(this.maxFps)) {
    const now = performance.now();
    if (now - this.lastFrameTime < (1000 / this.maxFps) - 1) {
      this.animId = requestAnimationFrame(this.tick);
      return;
    }
    this.lastFrameTime = now;
  }

  const { device, context, aspect } = this._preFrameSetup();
  device.queue.writeBuffer(this.uniformBuffer, 0, this._packUniforms(aspect));

  const N       = this.params.numParticles;
  const gridDim = Math.max(4, Math.min(MAX_GRID_DIM, Math.floor(2.0 / this.params.attractionRadius)));
  const gridSize = gridDim * gridDim;

  this._runComputePasses(device, N, gridDim, gridSize);
  this._renderFrame(device, context, N);

  this.frame++;
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
```

- [ ] **Step 5: Verify boids simulation**

```bash
npm run dev
```

Open `http://localhost:4321/gallery/boids`. Run with various particle counts, enable trails, test image force overlay. Verify no regression.

- [ ] **Step 6: Commit**

```bash
git add src/components/simulations/boids/boids-controller.ts
git commit -m "refactor(boids-controller): split 172-line tick() into _preFrameSetup/_runComputePasses/_renderFrame phases"
```

---

## Task 11: Controller — snapshot-based pipeline rollback

**Files:**
- Modify: `src/components/simulations/boids/boids-controller.ts`

The current `reloadShader` manually saves and restores 5 properties. Replace with an atomic snapshot object.

- [ ] **Step 1: Update reloadShader()**

Replace lines 382–408 with:

```typescript
async reloadShader(code: string): Promise<{ success: boolean; error: string }> {
  if (!this.gpu) return { success: false, error: 'GPU not initialized' };
  try {
    const { device } = this.gpu;

    // Snapshot current pipeline state for atomic rollback on failure
    const snapshot = {
      computePipeline:       this.computePipeline,
      renderPipeline:        this.renderPipeline,
      boidsBindGroupLayout:  this.boidsBindGroupLayout,
      boidsBindGroups:       this.boidsBindGroups,
      renderParamsBindGroup: this.renderParamsBindGroup,
    };

    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code });
    this._createBoidsPipelines(module);
    const gpuError = await device.popErrorScope();

    if (gpuError) {
      Object.assign(this, snapshot);
      return { success: false, error: gpuError.message };
    }

    this.shaderSource = code;
    return { success: true, error: '' };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
```

- [ ] **Step 2: Test shader hot-reload**

```bash
npm run dev
```

Open `/gallery/boids`, open the shader editor (⚙ → Edit Shader button), introduce a syntax error, click Apply. Verify the simulation keeps running with the old shader. Fix the error, click Apply. Verify the new shader loads.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/boids/boids-controller.ts
git commit -m "refactor(boids-controller): atomic snapshot-based pipeline rollback in reloadShader"
```

---

## Task 12: boids-audio.ts — add section comments and cache bin ranges

**Files:**
- Modify: `src/components/simulations/boids/boids-audio.ts`

The file is 378 lines — just under the threshold where splitting to separate files becomes worthwhile. Instead of a full split, add clear section header comments and fix the one concrete performance issue: `_hzToBin` recomputes bin indices on every `analyze()` call by deriving them from `ctx.sampleRate`. Cache them after `start()`.

- [ ] **Step 1: Add section comments to AudioReactor**

Open `boids-audio.ts` and add these four comment blocks above their respective method groups:

```
// ── Audio lifecycle ──────────────────────────────────────────────────────────
// (before: constructor, isActive, getSampleRate, start, stop)

// ── Frequency analysis ───────────────────────────────────────────────────────
// (before: _hzToBin, _bandAverage, analyze, getFrequencyData)

// ── Mapping application ──────────────────────────────────────────────────────
// (before: applyMappings)

// ── Mapping persistence ──────────────────────────────────────────────────────
// (before: saveMappings, loadMappings, saveGlobal, loadGlobal)
```

- [ ] **Step 2: Cache band bin ranges after start()**

Add a private field and a `_cacheBinRanges()` method:

```typescript
private bandBins: Record<BandKey, [number, number]> = {
  bass: [0, 0], mid: [0, 0], presence: [0, 0], hi: [0, 0], volume: [0, 0],
};

private _cacheBinRanges(): void {
  for (const [band, [lo, hi]] of Object.entries(BAND_HZ) as [BandKey, [number, number]][]) {
    if (band === 'volume') { this.bandBins[band] = [0, 0]; continue; }
    this.bandBins[band] = [
      Math.max(0, this._hzToBin(lo)),
      Math.min(this.freqData.length - 1, this._hzToBin(hi)),
    ];
  }
}
```

Call it at the end of the `start()` method, after `this.status = 'active'`:

```typescript
this._cacheBinRanges();
```

Update `_bandAverage` to use the cached bins:

```typescript
private _bandAverage(band: BandKey): number {
  const [loB, hiB] = this.bandBins[band];
  if (hiB < loB) return 0;
  let sum = 0;
  for (let i = loB; i <= hiB; i++) sum += this.freqData[i];
  return sum / ((hiB - loB + 1) * 255);
}
```

Update `analyze()` to call `_bandAverage(band)` with just the key instead of spread args:

```typescript
return {
  bass:     this._bandAverage('bass'),
  mid:      this._bandAverage('mid'),
  presence: this._bandAverage('presence'),
  hi:       this._bandAverage('hi'),
  volume,
};
```

Remove the old `_hzToBin` calls from `_bandAverage` (they're now only called by `_cacheBinRanges`).

- [ ] **Step 3: Verify audio tab still works**

```bash
npm run dev
```

Open `/gallery/boids`, switch to Audio tab, connect microphone. Verify the spectrum bar updates, band traces update, and mappings apply correctly.

- [ ] **Step 4: Commit**

```bash
git add src/components/simulations/boids/boids-audio.ts
git commit -m "refactor(boids-audio): add section comments and cache band bin ranges"
```

---

## Task 14: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (at repo root)

After all refactoring is complete, invoke the `claude-md-management:revise-claude-md` skill to update the Architecture and Simulations sections. The key changes to reflect:

- Architecture tree: `boids/panel/` subdirectory replaces the flat `boids-panel.ts`
- New lib modules: `src/lib/sim-page/`, `src/lib/admin/`
- Layouts: `AdminLayout.astro` alongside `BaseLayout.astro` and `SimLayout.astro`

```
Invoke: claude-md-management:revise-claude-md
```

- [ ] **Step 1: Invoke the skill and confirm the CLAUDE.md changes look correct**

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): update architecture to reflect Track A + B refactoring"
```

---

## Task 15: Final verification + merge

- [ ] **Step 1: Full smoke test**

```bash
npm run dev
```

Verify:
- `http://localhost:4321/gallery/boids` — all features work (params, audio tab matrix+drawers, image tab, shader editor, drag/resize panel, FPS counter)
- `http://localhost:4321/gallery/cppn` — panel works
- `http://localhost:4321/gallery/nca` — panel works
- `http://localhost:4321/admin/boids` — layout, tabs, shader panel
- `http://localhost:4321/admin/cppn` — layout, tabs
- `http://localhost:4321/admin/nca` — layout, tabs
- `http://localhost:4321/` (index page) — hero boids still works

- [ ] **Step 2: Production build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors (or same errors as before this refactoring — do not introduce new type errors).

- [ ] **Step 4: Invoke superpowers:finishing-a-development-branch**
