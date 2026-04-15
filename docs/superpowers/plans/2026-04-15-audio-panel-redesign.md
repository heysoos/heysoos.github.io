# Audio Panel Redesign — Param × Band Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat audio-mapping list in `buildAudioTab` with a param × band matrix where each row is a param, each column is a band, and clicking a cell opens an inline drawer with per-band controls and an optional ∑ total tab.

**Architecture:** All changes are confined to `boids-panel.ts` and a one-line change in `[...slug].astro`. The data model (`boids-audio.ts`) is untouched. The matrix and drawer are built as DOM `<table>` rows; the drawer is a `<tr colspan="6">` inserted after the selected param row and removed when another row is selected or the same row is clicked again.

**Tech Stack:** TypeScript, vanilla DOM, canvas 2D (for traces), existing CSS custom properties from the site theme.

---

## File Map

| File | Change |
|------|--------|
| `src/components/simulations/boids/boids-panel.ts` | Rewrite `buildAudioTab` (lines 519–1125): replace `buildMappingRow` / `rebuildMappingsList` / `addBtn` with `buildMappingMatrix` / `buildDrawer` / `rebuildMatrix`. Change `mappingRowUpdaters` → `cellUpdaters` + `totalUpdaters`. Add `baseParams` param to `updateAudioViz`. |
| `src/pages/gallery/[...slug].astro` | Pass `baseParams` when calling `panelControls?.updateAudioViz(baseParams)`. |

---

## Task 1 — Thread `baseParams` through to `updateAudioViz`

The total tab needs the pre-modulation param value. `baseParams` already exists in slug.astro but isn't passed to the panel. This task wires it through with no visible UI change.

**Files:**
- Modify: `src/components/simulations/boids/boids-panel.ts`
- Modify: `src/pages/gallery/[...slug].astro`

- [ ] **Step 1: Add `BandSnapshot` to the import from `boids-audio`**

In `boids-panel.ts`, change the import block at the top:

```typescript
import {
  type AudioReactor,
  type BandKey,
  type AudioMapping,
  type BandSnapshot,      // ← add this
  BAND_COLORS,
  PARAM_META,
  MAPPABLE_PARAMS,
  defaultMapping,
  drawAudioViz,
} from './boids-audio';
```

- [ ] **Step 2: Replace `mappingRowUpdaters` with `cellUpdaters` + `totalUpdaters` in `buildBoidsPanel`**

In `buildBoidsPanel` (around line 33), replace:

```typescript
const mappingRowUpdaters = new Map<AudioMapping, (fraction: number | null) => void>();
```

with:

```typescript
const cellUpdaters  = new Map<string, (amplitude: number) => void>();
const totalUpdaters = new Map<string, (snapshot: BandSnapshot, baseVal: number, modulatedVal: number) => void>();
```

- [ ] **Step 3: Update `updateAudioViz` signature and body**

Replace the entire `updateAudioViz` function (lines 467–507) with:

```typescript
function updateAudioViz(baseParams?: Record<string, number>): void {
  const reactor = opts.reactor;
  if (!reactor) return;

  // Reset all param indicators to hidden first
  for (const [, ind] of paramIndicators) ind.wrap.style.display = 'none';

  if (!reactor.isActive()) {
    for (const [, u] of cellUpdaters) u(0);
    return;
  }

  const snapshot = reactor.analyze();

  // Cell amplitude bars + traces
  for (const m of reactor.mappings) {
    if (!m.enabled) continue;
    const key = `${String(m.param)}::${m.band}`;
    const u = cellUpdaters.get(key);
    if (!u) continue;
    const effectiveSignal = Math.min(1, snapshot[m.band] * (m.gain ?? 1));
    u(effectiveSignal);
  }

  // Total-tab live updates
  for (const [param, u] of totalUpdaters) {
    const baseVal      = baseParams?.[param] ?? (controller.params as Record<string, number>)[param] ?? 0;
    const modulatedVal = (controller.params as Record<string, number>)[param] ?? 0;
    u(snapshot, baseVal, modulatedVal);
  }

  // Param indicators in the Params tab
  for (const m of reactor.mappings) {
    if (!m.enabled) continue;
    const meta = PARAM_META[m.param as string];
    if (!meta) continue;
    const currentVal = (controller.params as Record<string, number>)[m.param as string] ?? 0;
    const range = meta.max - meta.min;
    const fraction = range > 0 ? Math.max(0, Math.min(1, (currentVal - meta.min) / range)) : 0;
    const ind = paramIndicators.get(m.param as string);
    if (ind) {
      ind.wrap.style.display = 'block';
      ind.fill.style.width   = `${fraction * 100}%`;
      ind.fill.style.background = BAND_COLORS[m.band];
    }
  }
}
```

- [ ] **Step 4: Update the return type of `buildBoidsPanel`**

Change the return type annotation on line 30:

```typescript
): { teardown: () => void; updateAudioViz: (baseParams?: Record<string, number>) => void } {
```

- [ ] **Step 5: Update `buildAudioTab` call to pass the new maps**

Find the call to `buildAudioTab` (around line 124) and change it to:

```typescript
audioVizControls = buildAudioTab(audioBody, opts.reactor, switchTab, cellUpdaters, totalUpdaters);
```

- [ ] **Step 6: Update `buildAudioTab` function signature**

Change the function signature at line 519:

```typescript
function buildAudioTab(
  container: HTMLElement,
  reactor: AudioReactor,
  switchTab: (name: string) => void,
  cellUpdaters: Map<string, (amplitude: number) => void>,
  totalUpdaters: Map<string, (snapshot: BandSnapshot, baseVal: number, modulatedVal: number) => void>,
): { start: () => void; stop: () => void } {
```

- [ ] **Step 7: Update slug.astro to pass `baseParams`**

Find the `panelControls?.updateAudioViz()` call in `src/pages/gallery/[...slug].astro` (around line 685) and change it to:

```typescript
panelControls?.updateAudioViz(baseParams as Record<string, number>);
```

- [ ] **Step 8: Run `npm run dev` and open the gallery page — verify Audio tab still renders and no TypeScript errors in the terminal**

Run: `npm run dev`
Expected: dev server starts, no TS errors in the console, the Audio tab looks exactly as before.

- [ ] **Step 9: Commit**

```bash
git add src/components/simulations/boids/boids-panel.ts src/pages/gallery/[...slug].astro
git commit -m "refactor(audio): thread baseParams into updateAudioViz, add cellUpdaters/totalUpdaters maps"
```

---

## Task 2 — Build the matrix (static, no drawer yet)

Replace the `mappingsList` flat-list DOM with a `<table>` showing all 9 params × 5 bands. Mapped cells show colored dots sized by depth. Live amplitude bars appear beneath each dot. The old `buildMappingRow` / `rebuildMappingsList` / `addBtn` / `collapseAllBtn` code is deleted in this task.

**Files:**
- Modify: `src/components/simulations/boids/boids-panel.ts`

- [ ] **Step 1: Delete the old mappings section and add a new one**

Inside `buildAudioTab`, find the block that starts with `// ── Mappings section ──` (around line 674) and runs through the closing `container.appendChild(mappingsSection)` (around line 1088). Delete everything in that range and replace it with the following. Keep the `// ── Visualiser rAF loop` section below untouched.

```typescript
// ── Mappings section ──────────────────────────────────────────────
const mappingsSection = document.createElement('div');
mappingsSection.style.cssText = 'padding:0;';

const mappingsHeader = document.createElement('div');
mappingsHeader.style.cssText = 'display:flex;align-items:center;padding:5px 8px 3px;';
const mappingsLabel = document.createElement('div');
mappingsLabel.style.cssText = 'font-size:0.55rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);flex:1;';
mappingsLabel.textContent = 'Mappings';
mappingsHeader.appendChild(mappingsLabel);
mappingsSection.appendChild(mappingsHeader);

// Matrix table
const matrixTable = document.createElement('table');
matrixTable.style.cssText = 'width:100%;border-collapse:collapse;';

// thead — band column headers
const thead = document.createElement('thead');
const headerRow = document.createElement('tr');
const paramTh = document.createElement('th');
paramTh.style.cssText = 'text-align:left;padding-left:8px;font-size:0.5rem;color:transparent;user-select:none;';
paramTh.textContent = '-';
headerRow.appendChild(paramTh);
const BAND_KEYS_ORDER: BandKey[] = ['bass', 'mid', 'presence', 'hi', 'volume'];
const BAND_ABBR: Record<BandKey, string> = { bass: 'B', mid: 'M', presence: 'P', hi: 'H', volume: 'V' };
for (const band of BAND_KEYS_ORDER) {
  const th = document.createElement('th');
  th.style.cssText = `font-size:0.5rem;text-transform:uppercase;letter-spacing:0.06em;padding:2px 0;text-align:center;color:${BAND_COLORS[band]};`;
  th.textContent = BAND_ABBR[band];
  headerRow.appendChild(th);
}
thead.appendChild(headerRow);
matrixTable.appendChild(thead);

const tbody = document.createElement('tbody');
matrixTable.appendChild(tbody);
mappingsSection.appendChild(matrixTable);
container.appendChild(mappingsSection);

// Track which param row's drawer is currently open (null = none)
let openParam: string | null = null;
let drawerRow: HTMLTableRowElement | null = null;

function rebuildMatrix(): void {
  cellUpdaters.clear();
  totalUpdaters.clear();
  tbody.innerHTML = '';
  openParam = null;
  drawerRow = null;

  for (const paramKey of MAPPABLE_PARAMS) {
    const param = String(paramKey);
    const meta  = PARAM_META[param];
    if (!meta) continue;

    const activeMappings = reactor.mappings.filter(m => String(m.param) === param);
    const hasAny = activeMappings.length > 0;

    const tr = document.createElement('tr');
    tr.style.cssText = 'cursor:pointer;transition:background 0.1s;';
    tr.addEventListener('mouseenter', () => { if (openParam !== param) tr.style.background = 'rgba(255,255,255,0.03)'; });
    tr.addEventListener('mouseleave', () => { if (openParam !== param) tr.style.background = ''; });

    // Param label cell
    const nameTd = document.createElement('td');
    nameTd.style.cssText = `font-size:0.57rem;padding:3px 4px 3px 8px;white-space:nowrap;color:${hasAny ? 'var(--text-body)' : 'var(--text-muted)'};opacity:${hasAny ? '1' : '0.4'};`;
    nameTd.textContent = meta.label;
    tr.appendChild(nameTd);

    // Band cells
    for (const band of BAND_KEYS_ORDER) {
      const td  = document.createElement('td');
      td.style.cssText = 'text-align:center;padding:3px 0;';

      const mapping = activeMappings.find(m => m.band === band) ?? null;
      const cellDiv = document.createElement('div');
      cellDiv.style.cssText = 'display:inline-flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;padding:2px;border-radius:3px;transition:background 0.1s;';
      cellDiv.addEventListener('mouseenter', () => { cellDiv.style.background = 'rgba(255,255,255,0.06)'; });
      cellDiv.addEventListener('mouseleave', () => { cellDiv.style.background = ''; });

      const dot = document.createElement('div');
      dot.style.cssText = `border-radius:50%;border:1px solid var(--bg-surface-border);background:transparent;display:block;`;
      if (mapping) {
        const sz = mapping.depth < 0.33 ? 6 : mapping.depth < 0.67 ? 9 : 11;
        dot.style.width  = `${sz}px`;
        dot.style.height = `${sz}px`;
        dot.style.background  = BAND_COLORS[band];
        dot.style.borderColor = BAND_COLORS[band];
        dot.style.boxShadow   = `0 0 4px ${BAND_COLORS[band]}aa`;
      } else {
        dot.style.width   = '8px';
        dot.style.height  = '8px';
        dot.style.opacity = '0.2';
      }
      cellDiv.appendChild(dot);

      // Live amplitude bar beneath dot (only for mapped cells)
      const liveBar = document.createElement('div');
      liveBar.style.cssText = `width:${mapping ? '12px' : '0'};height:2px;background:var(--bg-surface-border);border-radius:1px;overflow:hidden;`;
      const liveFill = document.createElement('div');
      liveFill.style.cssText = `height:100%;width:0%;background:${BAND_COLORS[band]};border-radius:1px;`;
      liveBar.appendChild(liveFill);
      cellDiv.appendChild(liveBar);

      if (mapping) {
        const key = `${param}::${band}`;
        cellUpdaters.set(key, (amplitude: number) => {
          liveFill.style.width = `${Math.round(amplitude * 100)}%`;
        });
      }

      td.appendChild(cellDiv);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

rebuildMatrix();
```

- [ ] **Step 2: Run `npm run dev` and verify**

Run: `npm run dev`
Open the gallery page and switch to the Audio tab.
Expected: a table with 9 param rows and 5 band columns, colored dots where mappings exist, blank circles elsewhere. Band meters and spectrum canvas unchanged above. No JS errors in browser console.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/boids/boids-panel.ts
git commit -m "feat(audio): replace flat mapping list with param×band matrix"
```

---

## Task 3 — Drawer open/close with band tabs and controls

Clicking any cell opens an inline drawer below that param row (as a `<tr colspan="6">`). The drawer shows one tab per active band mapping. Each tab has the full set of controls (depth, gain, mode, min/max, trace). Clicking the same row again closes it. Clicking a different row swaps the drawer.

**Files:**
- Modify: `src/components/simulations/boids/boids-panel.ts`

- [ ] **Step 1: Add `openDrawer` and `closeDrawer` helpers inside `buildAudioTab`, after `rebuildMatrix`**

Add the following directly after the `rebuildMatrix()` call and before the `// ── Visualiser rAF loop` comment:

```typescript
// ── Drawer helpers ────────────────────────────────────────────────

const TRACE_LEN = 200;
const TRACE_W = 184;
const TRACE_H = 32;
const dpr = window.devicePixelRatio || 1;

function makeTraceCanvas(bandColor: string): {
  canvas: HTMLCanvasElement;
  push: (v: number) => void;
  draw: () => void;
} {
  const data = new Float32Array(TRACE_LEN);
  let ptr = 0;
  const canvas = document.createElement('canvas');
  canvas.width  = TRACE_W * dpr;
  canvas.height = TRACE_H * dpr;
  canvas.style.cssText = `width:100%;height:${TRACE_H}px;display:block;border-radius:2px;background:#06050a;margin-top:2px;`;

  function draw(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = TRACE_W, H = TRACE_H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    let trMin = Infinity, trMax = -Infinity;
    for (let i = 0; i < TRACE_LEN; i++) {
      if (data[i] < trMin) trMin = data[i];
      if (data[i] > trMax) trMax = data[i];
    }
    if (!isFinite(trMin)) trMin = 0;
    if (!isFinite(trMax)) trMax = 0;
    const currentVal = data[(ptr - 1 + TRACE_LEN) % TRACE_LEN];

    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, 1);     ctx.lineTo(W, 1);
    ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1);
    ctx.stroke();

    const innerH = H - 2;
    ctx.strokeStyle = bandColor;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let i = 0; i < TRACE_LEN; i++) {
      const idx = (ptr + i) % TRACE_LEN;
      const x = (i / (TRACE_LEN - 1)) * W;
      const y = H - data[idx] * innerH - 1;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Labels: min (bottom-left), max (top-left), current (right, tracks tip)
    const FONT = '9px monospace';
    ctx.font = FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(trMax.toFixed(2), 2, 10);
    ctx.fillText(trMin.toFixed(2), 2, H - 2);
    const tipY = H - currentVal * innerH - 1;
    const clampedTipY = Math.max(10, Math.min(H - 2, tipY));
    ctx.fillStyle = bandColor;
    ctx.fillText(currentVal.toFixed(2), W - 26, clampedTipY);
  }

  function push(v: number): void {
    data[ptr] = v;
    ptr = (ptr + 1) % TRACE_LEN;
    draw();
  }

  return { canvas, push, draw };
}

function buildBandTab(mapping: AudioMapping): HTMLDivElement {
  const body = document.createElement('div');
  body.style.cssText = 'padding:6px 8px;';
  const color = BAND_COLORS[mapping.band];

  function row(label: string, content: HTMLElement): void {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:0.55rem;color:var(--text-muted);min-width:30px;';
    lbl.textContent = label;
    r.appendChild(lbl);
    r.appendChild(content);
    body.appendChild(r);
  }

  function makeSlider(min: number, max: number, step: number, value: number): { el: HTMLInputElement; valEl: HTMLSpanElement } {
    const el = document.createElement('input');
    el.type  = 'range';
    el.min   = String(min);
    el.max   = String(max);
    el.step  = String(step);
    el.value = String(value);
    el.style.cssText = `flex:1;accent-color:${color};`;
    const valEl = document.createElement('span');
    valEl.style.cssText = `font-size:0.6rem;color:${color};min-width:28px;text-align:right;font-variant-numeric:tabular-nums;`;
    valEl.textContent = value.toFixed(2);
    return { el, valEl };
  }

  // Depth
  const { el: depthSlider, valEl: depthVal } = makeSlider(0, 1, 0.01, mapping.depth);
  depthSlider.addEventListener('input', () => {
    mapping.depth = parseFloat(depthSlider.value);
    depthVal.textContent = mapping.depth.toFixed(2);
    reactor.saveMappings();
    rebuildMatrix(); // dot size updates
    openDrawer(String(mapping.param), mapping.band);
  });
  const depthWrap = document.createElement('div');
  depthWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;';
  depthWrap.appendChild(depthSlider);
  depthWrap.appendChild(depthVal);
  row('Depth', depthWrap);

  // Gain
  const { el: gainSlider, valEl: gainVal } = makeSlider(0, 4, 0.05, mapping.gain ?? 1.0);
  gainSlider.addEventListener('input', () => {
    mapping.gain = parseFloat(gainSlider.value);
    gainVal.textContent = mapping.gain.toFixed(2);
    reactor.saveMappings();
  });
  const gainWrap = document.createElement('div');
  gainWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;';
  gainWrap.appendChild(gainSlider);
  gainWrap.appendChild(gainVal);
  row('Gain', gainWrap);

  // Mode
  const modeBtn = document.createElement('button');
  modeBtn.style.cssText = [
    'padding:1px 6px;border-radius:3px;font-size:0.65rem;cursor:pointer;',
    'border:1px solid var(--bg-surface-border);background:transparent;color:var(--text-muted);',
  ].join('');
  modeBtn.textContent = mapping.mode === 'add' ? '+ add' : '× mul';
  modeBtn.addEventListener('click', () => {
    mapping.mode = mapping.mode === 'add' ? 'multiply' : 'add';
    modeBtn.textContent = mapping.mode === 'add' ? '+ add' : '× mul';
    reactor.saveMappings();
  });
  row('Mode', modeBtn);

  // Min / Max
  const minMaxRow = document.createElement('div');
  minMaxRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;';
  const inputStyle = [
    'width:48px;background:var(--bg-surface);color:var(--text-body);',
    'border:1px solid var(--bg-surface-border);border-radius:3px;',
    'font-size:0.62rem;padding:1px 3px;text-align:right;',
  ].join('');
  const meta = PARAM_META[String(mapping.param)];

  const minLabel = document.createElement('span');
  minLabel.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
  minLabel.textContent = 'Min';
  const minInput = document.createElement('input');
  minInput.type = 'text'; minInput.value = String(mapping.min); minInput.style.cssText = inputStyle;
  minInput.addEventListener('blur', () => {
    const v = parseFloat(minInput.value);
    if (!isNaN(v) && v < mapping.max) { mapping.min = v; reactor.saveMappings(); }
    else minInput.value = String(mapping.min);
  });

  const maxLabel = document.createElement('span');
  maxLabel.style.cssText = 'font-size:0.6rem;color:var(--text-muted);margin-left:4px;';
  maxLabel.textContent = 'Max';
  const maxInput = document.createElement('input');
  maxInput.type = 'text'; maxInput.value = String(mapping.max); maxInput.style.cssText = inputStyle;
  maxInput.addEventListener('blur', () => {
    const v = parseFloat(maxInput.value);
    if (!isNaN(v) && v > mapping.min) { mapping.max = v; reactor.saveMappings(); }
    else maxInput.value = String(mapping.max);
  });

  minMaxRow.appendChild(minLabel); minMaxRow.appendChild(minInput);
  minMaxRow.appendChild(maxLabel); minMaxRow.appendChild(maxInput);
  body.appendChild(minMaxRow);

  // Trace
  const { canvas: traceCanvas, push: pushTrace } = makeTraceCanvas(color);
  body.appendChild(traceCanvas);

  // Register updater for this cell's trace
  const key = `${String(mapping.param)}::${mapping.band}`;
  const existingUpdater = cellUpdaters.get(key);
  cellUpdaters.set(key, (amplitude: number) => {
    existingUpdater?.(amplitude); // keep the live bar updater alive
    pushTrace(amplitude);
  });

  return body;
}

function openDrawer(param: string, activeBand: BandKey): void {
  // Remove existing drawer if any
  drawerRow?.remove();
  drawerRow = null;

  const activeMappings = reactor.mappings.filter(m => String(m.param) === param);
  const multiMapping   = activeMappings.length >= 2;

  // Find the param <tr> in tbody
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const paramIdx = MAPPABLE_PARAMS.findIndex(p => String(p) === param);
  const paramTr  = rows[paramIdx];
  if (!paramTr) return;

  openParam = param;
  paramTr.style.background = 'var(--bg-surface)';

  // Build the drawer <tr>
  const tr = document.createElement('tr');
  tr.className = 'audio-drawer-row';
  const td = document.createElement('td');
  td.colSpan = 6;
  td.style.cssText = 'padding:0;border-top:1px solid var(--bg-surface-border);border-bottom:1px solid var(--bg-surface-border);';

  // Tab strip
  const tabs = document.createElement('div');
  tabs.style.cssText = 'display:flex;border-bottom:1px solid var(--bg-surface-border);background:var(--bg-surface);';

  const tabBodies: Record<string, HTMLDivElement> = {};
  let activeTabKey = multiMapping ? '∑' : activeBand;

  function switchDrawerTab(key: string): void {
    activeTabKey = key;
    for (const [k, t] of Object.entries(tabBodies)) {
      t.style.display = k === key ? 'block' : 'none';
    }
    // Update tab underline styles
    tabs.querySelectorAll<HTMLButtonElement>('[data-tabkey]').forEach(btn => {
      const isActive = btn.dataset['tabkey'] === key;
      const bColor   = btn.dataset['bandcolor'] ?? 'var(--text-body)';
      btn.style.borderBottomColor = isActive ? bColor : 'transparent';
      btn.style.color = isActive ? bColor : 'var(--text-muted)';
    });
  }

  function makeTabBtn(label: string, key: string, color: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset['tabkey']    = key;
    btn.dataset['bandcolor'] = color;
    btn.style.cssText = [
      'flex:1;padding:4px 2px;font-size:0.52rem;text-align:center;',
      'cursor:pointer;border:none;background:transparent;',
      'border-bottom:2px solid transparent;transition:color 0.1s;',
      `color:var(--text-muted);`,
    ].join('');
    btn.addEventListener('click', () => switchDrawerTab(key));
    return btn;
  }

  // Band tabs
  for (const m of activeMappings) {
    const label = `● ${m.band}`;
    const color = BAND_COLORS[m.band];
    const btn   = makeTabBtn(label, m.band, color);
    tabs.appendChild(btn);
    const body = buildBandTab(m);
    body.style.display = 'none';
    tabBodies[m.band] = body;
  }

  // Remove button (removes current active band's mapping)
  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'remove';
  removeBtn.style.cssText = 'font-size:0.52rem;color:var(--text-muted);padding:4px 8px;background:none;border:none;cursor:pointer;white-space:nowrap;';
  removeBtn.addEventListener('mouseenter', () => { removeBtn.style.color = '#e05060'; });
  removeBtn.addEventListener('mouseleave', () => { removeBtn.style.color = 'var(--text-muted)'; });
  removeBtn.addEventListener('click', () => {
    const idx = reactor.mappings.findIndex(m => String(m.param) === param && m.band === activeTabKey);
    if (idx !== -1) reactor.mappings.splice(idx, 1);
    reactor.saveMappings();
    closeDrawer();
    rebuildMatrix();
    // Reopen drawer on same param if mappings remain
    if (reactor.mappings.some(m => String(m.param) === param)) {
      const remaining = reactor.mappings.filter(m => String(m.param) === param);
      openDrawer(param, remaining[0].band);
    }
  });
  tabs.appendChild(removeBtn);

  // ∑ total tab (only when 2+ mappings; built in Task 4)
  if (multiMapping) {
    const totalBtn = makeTabBtn('∑ total', '∑', 'var(--text-body)');
    tabs.insertBefore(totalBtn, removeBtn);
    const totalBody = document.createElement('div');
    totalBody.style.display = 'none';
    totalBody.dataset['placeholder'] = 'total'; // replaced in Task 4
    tabBodies['∑'] = totalBody;
  }

  td.appendChild(tabs);
  for (const body of Object.values(tabBodies)) td.appendChild(body);

  // "+ add another band" footer
  const addBandFooter = document.createElement('div');
  addBandFooter.style.cssText = [
    'padding:4px 8px;font-size:0.55rem;color:var(--text-muted);',
    'cursor:pointer;border-top:1px dashed var(--bg-surface-border);text-align:center;',
  ].join('');
  addBandFooter.textContent = '+ add another band';
  addBandFooter.addEventListener('mouseenter', () => { addBandFooter.style.color = 'var(--accent)'; });
  addBandFooter.addEventListener('mouseleave', () => { addBandFooter.style.color = 'var(--text-muted)'; });
  addBandFooter.addEventListener('click', () => {
    const usedBands = reactor.mappings.filter(m => String(m.param) === param).map(m => m.band);
    const nextBand  = (BAND_KEYS_ORDER as string[]).find(b => !usedBands.includes(b as BandKey)) as BandKey | undefined;
    if (!nextBand) return; // all 5 bands already used
    const meta = PARAM_META[param];
    reactor.mappings.push({
      param: param as keyof import('./boids-controller').BoidsParams,
      band: nextBand, mode: 'add', depth: 0.5, gain: 1.0,
      min: meta.min, max: meta.max, enabled: true,
    });
    reactor.saveMappings();
    closeDrawer();
    rebuildMatrix();
    openDrawer(param, nextBand);
  });
  td.appendChild(addBandFooter);

  tr.appendChild(td);
  // Insert after paramTr
  paramTr.insertAdjacentElement('afterend', tr);
  drawerRow = tr;

  switchDrawerTab(activeTabKey);
}

function closeDrawer(): void {
  if (drawerRow) {
    drawerRow.remove();
    drawerRow = null;
  }
  if (openParam) {
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const paramIdx = MAPPABLE_PARAMS.findIndex(p => String(p) === openParam);
    const paramTr  = rows[paramIdx];
    if (paramTr) paramTr.style.background = '';
  }
  openParam = null;
}
```

- [ ] **Step 2: Wire cell clicks in `rebuildMatrix` to `openDrawer` / `closeDrawer`**

Inside the `rebuildMatrix` function, find the line `cellDiv.addEventListener('mouseleave', ...)` and add the click handler directly after it:

```typescript
cellDiv.addEventListener('click', () => {
  if (mapping) {
    // Filled dot: toggle drawer or switch to this band's tab
    if (openParam === param) {
      // Drawer already open for this param
      const activeTab = drawerRow?.querySelector<HTMLButtonElement>('[data-tabkey].active-tab');
      if (activeTab?.dataset['tabkey'] === band) {
        closeDrawer(); // clicking the active band's dot closes the drawer
      } else {
        openDrawer(param, band); // switch to this band's tab
      }
    } else {
      openDrawer(param, band);
    }
  } else {
    // Empty cell: create a new mapping for this param+band and open drawer
    const meta = PARAM_META[param];
    reactor.mappings.push({
      param: paramKey,
      band,
      mode: 'add',
      depth: 0.5,
      gain: 1.0,
      min: meta.min,
      max: meta.max,
      enabled: true,
    });
    reactor.saveMappings();
    closeDrawer();
    rebuildMatrix();
    openDrawer(param, band);
  }
});
```

Also add a click handler on the `tr` (the param row itself) for clicking on the label cell to toggle the drawer:

```typescript
nameTd.style.cssText += ';cursor:pointer;';
nameTd.addEventListener('click', () => {
  if (openParam === param) {
    closeDrawer();
  } else if (activeMappings.length > 0) {
    const firstBand = activeMappings[0].band;
    openDrawer(param, firstBand);
  }
});
```

- [ ] **Step 3: Run `npm run dev` and test interactivity**

Run: `npm run dev`
1. Click a filled dot → drawer opens below that row with depth/gain/mode/min/max/trace controls.
2. Click the same dot again → drawer closes.
3. Click a dot on a different row → drawer moves to that row.
4. Click an empty cell → new mapping created, drawer opens on that band tab.
5. Click "remove" → mapping deleted, dot disappears from grid.
6. Click "+ add another band" → new tab added to drawer.

- [ ] **Step 4: Commit**

```bash
git add src/components/simulations/boids/boids-panel.ts
git commit -m "feat(audio): add inline drawer with band tabs and all mapping controls"
```

---

## Task 4 — ∑ total tab with live updates

Build the total tab content and wire up `totalUpdaters` so the stacked trace, range bar, live value header, and contributions breakdown update on every rAF tick.

**Files:**
- Modify: `src/components/simulations/boids/boids-panel.ts`

- [ ] **Step 1: Add `buildTotalTab` function after `buildBandTab`**

Add the following function inside `buildAudioTab`, after `buildBandTab`:

```typescript
function buildTotalTab(param: string): {
  body: HTMLDivElement;
  registerUpdater: () => void;
} {
  const meta     = PARAM_META[param];
  const mappings = reactor.mappings.filter(m => String(m.param) === param);

  const body = document.createElement('div');
  body.style.cssText = 'padding:6px 8px;';

  // ── Live value header ─────────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:baseline;gap:6px;margin-bottom:4px;';
  const liveVal  = document.createElement('span');
  liveVal.style.cssText = 'font-size:0.75rem;font-variant-numeric:tabular-nums;color:var(--text-body);font-weight:600;min-width:32px;';
  liveVal.textContent = '—';
  const baseValEl = document.createElement('span');
  baseValEl.style.cssText = 'font-size:0.58rem;color:var(--text-muted);';
  baseValEl.textContent = 'base —';
  const deltaEl = document.createElement('span');
  deltaEl.style.cssText = 'font-size:0.58rem;margin-left:auto;font-variant-numeric:tabular-nums;';
  deltaEl.textContent = '';
  header.appendChild(liveVal);
  header.appendChild(baseValEl);
  header.appendChild(deltaEl);
  body.appendChild(header);

  // ── Range bar ──────────────────────────────────────────────────────
  const rangeRow = document.createElement('div');
  rangeRow.style.cssText = 'display:flex;align-items:center;gap:5px;margin-bottom:4px;';
  const rangeLbl = document.createElement('span');
  rangeLbl.style.cssText = 'font-size:0.52rem;color:var(--text-muted);min-width:28px;';
  rangeLbl.textContent = 'range';
  const rangeWrap = document.createElement('div');
  rangeWrap.style.cssText = 'flex:1;position:relative;';
  const rangeTrack = document.createElement('div');
  rangeTrack.style.cssText = 'height:5px;background:var(--bg-surface-border);border-radius:3px;overflow:hidden;';
  const rangeFill = document.createElement('div');
  rangeFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,var(--accent),var(--text-body));opacity:0.5;border-radius:3px;';
  rangeTrack.appendChild(rangeFill);
  const rangeCursor = document.createElement('div');
  rangeCursor.style.cssText = 'position:absolute;top:-1px;width:2px;height:7px;background:var(--text-body);border-radius:1px;box-shadow:0 0 3px var(--text-body);transform:translateX(-1px);left:0%;';
  const rangeMinMax = document.createElement('div');
  rangeMinMax.style.cssText = 'display:flex;justify-content:space-between;font-size:0.5rem;color:var(--text-muted);margin-top:1px;font-variant-numeric:tabular-nums;';
  rangeMinMax.innerHTML = `<span>${meta.min}</span><span class="range-cur-lbl" style="color:var(--text-body);">—</span><span>${meta.max}</span>`;
  const rangeCurLbl = rangeMinMax.querySelector<HTMLSpanElement>('.range-cur-lbl')!;
  rangeWrap.appendChild(rangeTrack);
  rangeWrap.appendChild(rangeCursor);
  rangeWrap.appendChild(rangeMinMax);
  rangeRow.appendChild(rangeLbl);
  rangeRow.appendChild(rangeWrap);
  body.appendChild(rangeRow);

  // ── Stacked trace canvas ──────────────────────────────────────────
  const STACKED_H = 40;
  const stackCanvas = document.createElement('canvas');
  stackCanvas.width  = TRACE_W * dpr;
  stackCanvas.height = STACKED_H * dpr;
  stackCanvas.style.cssText = `width:100%;height:${STACKED_H}px;display:block;border-radius:2px;background:#06050a;margin-bottom:3px;`;
  body.appendChild(stackCanvas);

  // Legend
  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;font-size:0.5rem;margin-bottom:5px;';
  for (const m of mappings) {
    const s = document.createElement('span');
    s.style.color = BAND_COLORS[m.band];
    s.textContent = `— ${m.band}`;
    legend.appendChild(s);
  }
  const combSpan = document.createElement('span');
  combSpan.style.cssText = 'color:var(--text-body);font-weight:600;';
  combSpan.textContent = '— combined';
  legend.appendChild(combSpan);
  body.appendChild(legend);

  // ── Contributions breakdown ───────────────────────────────────────
  const contribSection = document.createElement('div');
  contribSection.style.cssText = 'border-top:1px solid var(--bg-surface-border);padding-top:5px;';
  const contribLbl = document.createElement('div');
  contribLbl.style.cssText = 'font-size:0.5rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:3px;';
  contribLbl.textContent = 'contributions';
  contribSection.appendChild(contribLbl);
  const contribRows: { fill: HTMLElement; valEl: HTMLElement }[] = [];
  for (const m of mappings) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:3px;';
    const swatch = document.createElement('div');
    swatch.style.cssText = `width:6px;height:6px;border-radius:50%;background:${BAND_COLORS[m.band]};flex-shrink:0;`;
    const name = document.createElement('span');
    name.style.cssText = `font-size:0.52rem;color:${BAND_COLORS[m.band]};min-width:30px;`;
    name.textContent = m.band;
    const modeEl = document.createElement('span');
    modeEl.style.cssText = 'font-size:0.5rem;color:var(--text-muted);min-width:22px;';
    modeEl.textContent = m.mode === 'add' ? '+add' : '×mul';
    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'flex:1;height:3px;background:var(--bg-surface-border);border-radius:2px;';
    const barFill = document.createElement('div');
    barFill.style.cssText = `height:100%;width:0%;background:${BAND_COLORS[m.band]};border-radius:2px;`;
    barWrap.appendChild(barFill);
    const valEl = document.createElement('span');
    valEl.style.cssText = `font-size:0.5rem;color:${BAND_COLORS[m.band]};min-width:32px;text-align:right;font-variant-numeric:tabular-nums;`;
    valEl.textContent = '—';
    row.appendChild(swatch); row.appendChild(name); row.appendChild(modeEl);
    row.appendChild(barWrap); row.appendChild(valEl);
    contribSection.appendChild(row);
    contribRows.push({ fill: barFill, valEl });
  }
  body.appendChild(contribSection);

  // Per-band ring buffers for stacked trace
  const bandBuffers = mappings.map(() => new Float32Array(TRACE_LEN));
  const combinedBuffer = new Float32Array(TRACE_LEN);
  let tracePtr = 0;

  function drawStackedTrace(): void {
    const ctx = stackCanvas.getContext('2d');
    if (!ctx) return;
    const W = TRACE_W, H = STACKED_H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const innerH = H - 2;
    // Individual band traces (faint)
    mappings.forEach((m, i) => {
      ctx.strokeStyle = BAND_COLORS[m.band];
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      for (let j = 0; j < TRACE_LEN; j++) {
        const idx = (tracePtr + j) % TRACE_LEN;
        const x = (j / (TRACE_LEN - 1)) * W;
        const y = H - bandBuffers[i][idx] * innerH - 1;
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    // Combined trace (bright)
    ctx.strokeStyle = 'var(--text-body)';
    ctx.lineWidth   = 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let j = 0; j < TRACE_LEN; j++) {
      const idx = (tracePtr + j) % TRACE_LEN;
      const x = (j / (TRACE_LEN - 1)) * W;
      const y = H - Math.min(1, Math.max(0, combinedBuffer[idx])) * innerH - 1;
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function registerUpdater(): void {
    totalUpdaters.set(param, (snapshot: BandSnapshot, baseVal: number, modulatedVal: number) => {
      // Update live value header
      const delta = modulatedVal - baseVal;
      liveVal.textContent    = modulatedVal.toFixed(3);
      baseValEl.textContent  = `base ${baseVal.toFixed(3)}`;
      deltaEl.textContent    = (delta >= 0 ? '+' : '') + delta.toFixed(3);
      deltaEl.style.color    = delta >= 0 ? '#80d060' : '#e05060';

      // Range bar
      const rangeSpan = meta.max - meta.min;
      const fraction  = rangeSpan > 0 ? Math.max(0, Math.min(1, (modulatedVal - meta.min) / rangeSpan)) : 0;
      rangeFill.style.width         = `${fraction * 100}%`;
      rangeCursor.style.left        = `${fraction * 100}%`;
      rangeCurLbl.textContent       = modulatedVal.toFixed(3);

      // Per-band contributions
      // Additive contribution: signal * depth * (max - min)
      // Multiplicative contribution: (1 + signal * depth)
      mappings.forEach((m, i) => {
        const signal = Math.min(1, snapshot[m.band] * (m.gain ?? 1));
        const mappingMeta = PARAM_META[String(m.param)];
        let contribution: number;
        let barFraction: number;
        if (m.mode === 'add') {
          contribution = signal * m.depth * (m.max - m.min);
          barFraction  = Math.min(1, Math.abs(contribution) / Math.max(0.001, mappingMeta.max - mappingMeta.min));
          contribRows[i].valEl.textContent = (contribution >= 0 ? '+' : '') + contribution.toFixed(3);
        } else {
          contribution = 1 + signal * m.depth;
          barFraction  = Math.min(1, (contribution - 1) / 2); // 0 to 3 mapped to 0–1
          contribRows[i].valEl.textContent = `×${contribution.toFixed(3)}`;
        }
        (contribRows[i].fill as HTMLElement).style.width = `${barFraction * 100}%`;

        // Push to per-band ring buffer (normalised amplitude)
        bandBuffers[i][tracePtr] = signal;
      });

      // Combined: normalise modulated value to 0–1 within param range
      const normModulated = rangeSpan > 0 ? Math.max(0, Math.min(1, (modulatedVal - meta.min) / rangeSpan)) : 0;
      combinedBuffer[tracePtr] = normModulated;
      tracePtr = (tracePtr + 1) % TRACE_LEN;

      drawStackedTrace();
    });
  }

  return { body, registerUpdater };
}
```

- [ ] **Step 2: Wire `buildTotalTab` into `openDrawer`**

Inside `openDrawer`, find the section that creates the `∑` total body:
```typescript
const totalBody = document.createElement('div');
totalBody.style.display = 'none';
totalBody.dataset['placeholder'] = 'total'; // replaced in Task 4
tabBodies['∑'] = totalBody;
```

Replace it with:
```typescript
const { body: totalBody, registerUpdater } = buildTotalTab(param);
totalBody.style.display = 'none';
tabBodies['∑'] = totalBody;
registerUpdater();
```

- [ ] **Step 3: Run `npm run dev`, start audio, and verify the ∑ total tab**

Run: `npm run dev`
1. Add 2+ band mappings to any param (e.g. Attraction ← bass + mid).
2. Click the Attraction row → drawer opens on ∑ total tab (it's the default).
3. Start audio (Microphone or System Audio).
4. Expected: live value header updates in real time, range cursor moves, stacked trace animates (faint individual band traces + bright combined), contributions breakdown shows live +X.XXX / ×X.XXX values.
5. Switch to bass tab → individual trace animates correctly.
6. Switch back to ∑ total → still animating.

- [ ] **Step 4: Commit**

```bash
git add src/components/simulations/boids/boids-panel.ts
git commit -m "feat(audio): add ∑ total tab with stacked trace and live contributions breakdown"
```

---

## Task 5 — Cleanup and cell-updater trace registration fix

The cell updaters registered in `rebuildMatrix` only update the live amplitude bar. Task 3 added trace pushing inside `buildBandTab` by overwriting the cellUpdater entry. This task makes the trace registration clean by separating bar updaters (registered in `rebuildMatrix`) from trace updaters (registered when the drawer opens a band tab), and removes any remaining old code.

**Files:**
- Modify: `src/components/simulations/boids/boids-panel.ts`

- [ ] **Step 1: Separate bar and trace updater maps**

The current approach of overwriting `cellUpdaters` inside `buildBandTab` is fragile. Replace it with a separate `traceUpdaters` map that holds a push function per `"param::band"` key. Add this declaration in `buildAudioTab` alongside `openParam` and `drawerRow`:

```typescript
const traceUpdaters = new Map<string, (amplitude: number) => void>();
```

- [ ] **Step 2: Remove the `cellUpdaters.set` call from `buildBandTab`**

Inside `buildBandTab`, delete these lines near the end:
```typescript
// Register updater for this cell's trace
const key = `${String(mapping.param)}::${mapping.band}`;
const existingUpdater = cellUpdaters.get(key);
cellUpdaters.set(key, (amplitude: number) => {
  existingUpdater?.(amplitude); // keep the live bar updater alive
  pushTrace(amplitude);
});
```

Replace with:
```typescript
// Register trace updater — bar updater lives in cellUpdaters (registered by rebuildMatrix)
const key = `${String(mapping.param)}::${mapping.band}`;
traceUpdaters.set(key, pushTrace);
```

- [ ] **Step 3: Push trace samples in `updateAudioViz`**

In `updateAudioViz`, after the `cellUpdaters` loop, add:

```typescript
// Traces for open drawer band tabs
for (const m of reactor.mappings) {
  if (!m.enabled) continue;
  const key = `${String(m.param)}::${m.band}`;
  const push = traceUpdaters.get(key);
  if (!push) continue;
  const effectiveSignal = Math.min(1, snapshot[m.band] * (m.gain ?? 1));
  push(effectiveSignal);
}
```

- [ ] **Step 4: Clear `traceUpdaters` in `rebuildMatrix`**

In `rebuildMatrix`, alongside `cellUpdaters.clear()` and `totalUpdaters.clear()`, add:
```typescript
traceUpdaters.clear();
```

Also clear it in `closeDrawer` — band tabs are gone when the drawer closes:
```typescript
function closeDrawer(): void {
  // Clear trace updaters for the closing param
  if (openParam) {
    reactor.mappings
      .filter(m => String(m.param) === openParam)
      .forEach(m => traceUpdaters.delete(`${openParam}::${m.band}`));
  }
  // ... rest of closeDrawer unchanged
}
```

- [ ] **Step 5: Verify there are no remaining references to old variables**

Search `boids-panel.ts` for any remaining references to `mappingRowUpdaters`, `mappingsList`, `buildMappingRow`, `rebuildMappingsList`, `traceSetters`, `collapseAllBtn`, `allTracesVisible`. If any exist, delete them.

```bash
grep -n "mappingRowUpdaters\|mappingsList\|buildMappingRow\|rebuildMappingsList\|traceSetters\|collapseAllBtn\|allTracesVisible" \
  src/components/simulations/boids/boids-panel.ts
```

Expected output: no matches.

- [ ] **Step 6: Run `npm run dev` and do a full regression check**

Run: `npm run dev`

Check all of the following:
1. Params tab — all sliders work, audio indicator bars appear beneath sliders when audio is active.
2. Audio tab — spectrum canvas, band meters animate when audio is active.
3. Matrix — dots appear for existing saved mappings on page load.
4. Click a single-mapping cell → drawer opens on that band's tab (no ∑ total tab visible).
5. Click a 2+-mapping row → drawer opens on ∑ total tab by default.
6. Trace in band tab animates while audio is active.
7. ∑ total tab: all three sections (header, range bar, stacked trace) update live.
8. Add a mapping via empty cell click → mapping persists on page reload (localStorage).
9. Remove a mapping → dot disappears from grid, mapping gone from localStorage.
10. Image tab — unaffected, still works.

- [ ] **Step 7: Commit**

```bash
git add src/components/simulations/boids/boids-panel.ts
git commit -m "refactor(audio): clean up trace updater registration, remove old mapping list code"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Param × band matrix, dots sized by depth | Task 2 |
| Live amplitude bars beneath dots | Task 2 |
| Drawer opens between selected row and next | Task 3 |
| One drawer at a time, click same row to close | Task 3 |
| Click empty cell → creates mapping and opens drawer | Task 3 |
| Band tab: depth, gain, mode, min/max, trace | Task 3 |
| Remove button removes current tab's mapping | Task 3 |
| `+ add another band` footer link | Task 3 |
| ∑ total tab only when 2+ mappings | Task 3 (placeholder), Task 4 (implementation) |
| ∑ total tab is default when 2+ mappings | Task 3 (`activeTabKey = multiMapping ? '∑' : activeBand`) |
| Total: live value header (modulated, base, delta) | Task 4 |
| Total: range bar with cursor | Task 4 |
| Total: stacked trace (faint per-band + bright combined) | Task 4 |
| Total: contributions breakdown (+X / ×X) | Task 4 |
| `cellUpdaters` replace `mappingRowUpdaters` | Task 1, Task 2 |
| `totalUpdaters` fed from `updateAudioViz` | Task 1, Task 4 |
| `baseParams` threaded from slug.astro | Task 1 |
| `boids-audio.ts` unchanged | (no task touches it — correct) |
| Params tab indicators unchanged | Task 1 (retained in `updateAudioViz`) |

All spec requirements covered. No gaps.
