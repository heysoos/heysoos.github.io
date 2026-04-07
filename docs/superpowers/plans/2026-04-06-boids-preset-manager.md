# Boids Preset Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin tool at `/admin/boids` for authoring named boids presets, plus a user-facing preset switcher in the params panel.

**Architecture:** Presets are stored in `src/data/boids-presets.ts` (committed to git). The params panel builder is extracted from `[...slug].astro` into a shared `boids-panel.ts` module used by both the gallery page and the admin page. The admin page writes presets to disk via a Vite `configureServer` middleware that only runs during `npm run dev`.

**Tech Stack:** Astro (static), TypeScript, WebGPU/WGSL, CodeMirror 6, Vite dev middleware

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/data/boids-presets.ts` | `BoidsPreset` type + `BOIDS_PRESETS` array — source of truth |
| Create | `src/components/simulations/boids/boids-panel.ts` | Extracted params panel DOM builder |
| Create | `src/pages/admin/boids.astro` | Dev-only admin page |
| Modify | `src/pages/gallery/[...slug].astro` | Replace inline panel builder; apply default preset |
| Modify | `astro.config.mjs` | Vite `configureServer` middleware for saving presets |

---

## Task 1: Create the preset data layer

**Files:**
- Create: `src/data/boids-presets.ts`

- [ ] **Step 1: Create `src/data/boids-presets.ts`**

```typescript
// src/data/boids-presets.ts
import type { BoidsParams } from '../components/simulations/boids/boids-controller';

export interface BoidsPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  params: BoidsParams;
  trailsEnabled: boolean;
  trailDecay: number;
  shader?: string; // undefined = use default boids.wgsl
}

export const BOIDS_PRESETS: BoidsPreset[] = [
  {
    id: 'default',
    name: 'Default',
    isDefault: true,
    params: {
      dt: 0.016,
      numParticles: 200,
      attractionRadius: 0.2,
      repulsionRadius: 0.05,
      attraction: 0.3,
      repulsion: 1.5,
      alignment: 0.1,
      friction: 2.0,
      maxSpeed: 0.22,
      mouseRadius: 0.15,
      coneAngle: -0.5,
      size: 0.02,
      shapeId: 0,
      colorR: 0.88,
      colorG: 0.63,
      colorB: 0.25,
    },
    trailsEnabled: false,
    trailDecay: 0.92,
  },
];
```

- [ ] **Step 2: Type-check**

```bash
cd "src" && npx astro check
```

Expected: no errors related to `boids-presets.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/data/boids-presets.ts
git commit -m "feat(presets): add BoidsPreset type and default preset data"
```

---

## Task 2: Extract shared panel builder

**Files:**
- Create: `src/components/simulations/boids/boids-panel.ts`

This moves the inline DOM-building code from `src/pages/gallery/[...slug].astro` lines ~456–685 into a reusable function.

- [ ] **Step 1: Create `src/components/simulations/boids/boids-panel.ts`**

```typescript
// src/components/simulations/boids/boids-panel.ts
import type { BoidsController } from './boids-controller';
import type { BoidsPreset } from '../../../data/boids-presets';

export interface BoidsPanelOpts {
  onShaderEdit?: () => void;
  onClose?: () => void;
  presets?: BoidsPreset[];
  activePresetId?: string;
  onPresetLoad?: (preset: BoidsPreset) => void;
}

export function buildBoidsPanel(
  container: HTMLElement,
  controller: BoidsController,
  opts: BoidsPanelOpts = {},
): void {
  // ── Header ───────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'panel-header';
  const title = document.createElement('p');
  title.className = 'panel-title';
  title.textContent = 'Parameters';
  const headerRight = document.createElement('div');
  headerRight.style.cssText = 'display:flex;align-items:center;gap:0.35rem;';
  if (opts.onShaderEdit) {
    const shaderBtn = document.createElement('button');
    shaderBtn.className = 'panel-close';
    shaderBtn.title = 'Edit Shader';
    shaderBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    shaderBtn.addEventListener('click', opts.onShaderEdit);
    headerRight.appendChild(shaderBtn);
  }
  if (opts.onClose) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', opts.onClose);
    headerRight.appendChild(closeBtn);
  }
  header.appendChild(title);
  header.appendChild(headerRight);
  container.appendChild(header);

  // ── Preset switcher ───────────────────────────────────────────────
  if (opts.presets && opts.presets.length > 0) {
    const pillRow = document.createElement('div');
    pillRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:0.3rem 0 0.1rem;';
    for (const preset of opts.presets) {
      const isActive = preset.id === opts.activePresetId;
      const pill = document.createElement('button');
      pill.style.cssText = [
        'padding:2px 8px',
        'border-radius:12px',
        'font-size:0.68rem',
        'cursor:pointer',
        'transition:background 0.15s,color 0.15s',
        isActive
          ? 'background:var(--accent);color:var(--bg-primary);border:1px solid transparent;'
          : 'background:transparent;color:var(--text-muted);border:1px solid var(--bg-surface-border);',
      ].join(';');
      pill.textContent = preset.name;
      pill.addEventListener('click', () => opts.onPresetLoad?.(preset));
      pillRow.appendChild(pill);
    }
    container.appendChild(pillRow);
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function addSection(parent: HTMLElement, label: string): void {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    parent.appendChild(divider);
    const heading = document.createElement('p');
    heading.className = 'section-heading';
    heading.textContent = label;
    parent.appendChild(heading);
  }

  function addSlider(
    parent: HTMLElement,
    label: string,
    min: number, max: number, step: number,
    get: () => number,
    set: (v: number) => void,
  ): void {
    const row = document.createElement('div');
    row.className = 'param-row';
    const labelEl = document.createElement('div');
    labelEl.className = 'param-label';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = label;
    const valueSpan = document.createElement('span');
    valueSpan.className = 'param-value';
    labelEl.appendChild(nameSpan);
    labelEl.appendChild(valueSpan);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    const decimals = step >= 1 ? 0 : (String(step).split('.')[1]?.length ?? 2);
    valueSpan.textContent = get().toFixed(decimals);
    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      set(val);
      valueSpan.textContent = val.toFixed(decimals);
    });
    row.appendChild(labelEl);
    row.appendChild(input);
    parent.appendChild(row);
  }

  // ── Appearance ────────────────────────────────────────────────────
  addSection(container, 'Appearance');
  addSlider(container, 'Size', 0.005, 0.08, 0.001, () => controller.params.size, v => { controller.params.size = v; });

  // Shape selector
  {
    const labelEl = document.createElement('div');
    labelEl.className = 'param-label';
    labelEl.innerHTML = '<span>Shape</span>';
    container.appendChild(labelEl);
    const shapeRow = document.createElement('div');
    shapeRow.className = 'shape-row';
    const shapes = [
      { id: 0, glyph: '▲' },
      { id: 1, glyph: '●' },
      { id: 2, glyph: '◆' },
      { id: 3, glyph: '✦' },
    ];
    const shapeBtns: HTMLButtonElement[] = [];
    for (const s of shapes) {
      const btn = document.createElement('button');
      btn.className = 'shape-btn' + (controller.params.shapeId === s.id ? ' active' : '');
      btn.textContent = s.glyph;
      btn.title = ['Triangle', 'Circle', 'Diamond', 'Blob'][s.id];
      btn.addEventListener('click', () => {
        controller.params.shapeId = s.id;
        shapeBtns.forEach((b, i) => b.classList.toggle('active', i === s.id));
      });
      shapeBtns.push(btn);
      shapeRow.appendChild(btn);
    }
    container.appendChild(shapeRow);
  }

  // Color
  {
    const labelEl = document.createElement('div');
    labelEl.className = 'param-label';
    labelEl.innerHTML = '<span>Color</span>';
    container.appendChild(labelEl);
    const colorRow = document.createElement('div');
    colorRow.className = 'color-row';
    const colorPresets = [
      { hex: '#e0a040', r: 0.88, g: 0.63, b: 0.25, label: 'Amber' },
      { hex: '#4090e0', r: 0.25, g: 0.56, b: 0.88, label: 'Blue' },
      { hex: '#50c878', r: 0.31, g: 0.78, b: 0.47, label: 'Green' },
      { hex: '#e05080', r: 0.88, g: 0.31, b: 0.50, label: 'Rose' },
      { hex: '#ffffff', r: 1.00, g: 1.00, b: 1.00, label: 'White' },
    ];
    const swatches: HTMLButtonElement[] = [];
    function applyColor(r: number, g: number, b: number): void {
      controller.params.colorR = r;
      controller.params.colorG = g;
      controller.params.colorB = b;
    }
    function hexToRgb(hex: string): [number, number, number] {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
    }
    for (let i = 0; i < colorPresets.length; i++) {
      const p = colorPresets[i];
      const btn = document.createElement('button');
      btn.className = 'color-swatch' + (i === 0 ? ' active' : '');
      btn.style.background = p.hex;
      btn.title = p.label;
      btn.addEventListener('click', () => {
        applyColor(p.r, p.g, p.b);
        swatches.forEach((s, j) => s.classList.toggle('active', j === i));
        colorPicker.value = p.hex;
      });
      swatches.push(btn);
      colorRow.appendChild(btn);
    }
    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.className = 'color-picker';
    colorPicker.value = colorPresets[0].hex;
    colorPicker.title = 'Custom color';
    colorPicker.addEventListener('input', () => {
      const [r, g, b] = hexToRgb(colorPicker.value);
      applyColor(r, g, b);
      swatches.forEach(s => s.classList.remove('active'));
    });
    colorRow.appendChild(colorPicker);
    container.appendChild(colorRow);
  }

  // Trails
  {
    const trailRow = document.createElement('div');
    trailRow.className = 'trail-row';
    const trailLabel = document.createElement('span');
    trailLabel.textContent = 'Trails';
    const toggleWrap = document.createElement('label');
    toggleWrap.className = 'toggle-switch';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = controller.trailsEnabled;
    const toggleSlider = document.createElement('span');
    toggleSlider.className = 'toggle-slider';
    toggleWrap.appendChild(toggleInput);
    toggleWrap.appendChild(toggleSlider);
    trailRow.appendChild(trailLabel);
    trailRow.appendChild(toggleWrap);
    container.appendChild(trailRow);
    const decayWrapper = document.createElement('div');
    decayWrapper.style.display = controller.trailsEnabled ? 'block' : 'none';
    addSlider(decayWrapper, 'Trail Decay', 0.80, 0.99, 0.01,
      () => controller.trailDecay,
      v => { controller.trailDecay = v; },
    );
    container.appendChild(decayWrapper);
    toggleInput.addEventListener('change', () => {
      controller.trailsEnabled = toggleInput.checked;
      decayWrapper.style.display = toggleInput.checked ? 'block' : 'none';
    });
  }

  // ── Simulation ────────────────────────────────────────────────────
  addSection(container, 'Simulation');
  addSlider(container, 'Time Step', 0.001, 0.1,  0.001, () => controller.params.dt,           v => { controller.params.dt = v; });
  addSlider(container, 'Particles', 10,    2000, 10,    () => controller.params.numParticles,  v => { controller.params.numParticles = v; });

  // ── Forces ────────────────────────────────────────────────────────
  addSection(container, 'Forces');
  addSlider(container, 'Attraction Radius', 0.02, 0.6,  0.01,  () => controller.params.attractionRadius, v => { controller.params.attractionRadius = v; });
  addSlider(container, 'Repulsion Radius',  0.01, 0.3,  0.005, () => controller.params.repulsionRadius,  v => { controller.params.repulsionRadius = v; });
  addSlider(container, 'Attraction',        0,    2.0,  0.01,  () => controller.params.attraction,       v => { controller.params.attraction = v; });
  addSlider(container, 'Repulsion',         0,    5.0,  0.05,  () => controller.params.repulsion,        v => { controller.params.repulsion = v; });
  addSlider(container, 'Alignment',         0,    1.0,  0.01,  () => controller.params.alignment,        v => { controller.params.alignment = v; });
  addSlider(container, 'Friction',          0,    10.0, 0.1,   () => controller.params.friction,         v => { controller.params.friction = v; });
  addSlider(container, 'Max Speed',         0.01, 1.0,  0.01,  () => controller.params.maxSpeed,         v => { controller.params.maxSpeed = v; });

  // ── Perception ────────────────────────────────────────────────────
  addSection(container, 'Perception');
  addSlider(container, 'Vision Cone',  -1.0, 0.99, 0.05, () => controller.params.coneAngle,   v => { controller.params.coneAngle = v; });
  addSlider(container, 'Mouse Radius', 0.05, 0.5,  0.01, () => controller.params.mouseRadius, v => { controller.params.mouseRadius = v; });
}
```

- [ ] **Step 2: Type-check**

```bash
npx astro check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/boids/boids-panel.ts
git commit -m "feat(presets): extract boids panel builder into shared module"
```

---

## Task 3: Update gallery page to use shared panel + preset switching

**Files:**
- Modify: `src/pages/gallery/[...slug].astro` (script tag, boids section only)

- [ ] **Step 1: Add imports at the top of the `<script>` tag**

In `src/pages/gallery/[...slug].astro`, find the `<script>` block. After the existing imports (around line 419), add:

```typescript
import { buildBoidsPanel } from '../../components/simulations/boids/boids-panel';
import { BOIDS_PRESETS } from '../../data/boids-presets';
```

- [ ] **Step 2: Replace the inline boids panel block**

Find the `if (sim === 'boids') {` block (around line 451). Replace everything from that opening brace up to (but not including) the `// ── Shader editor (CodeMirror)` comment with:

```typescript
if (sim === 'boids') {
  const boidsCtrl = controller as BoidsController;

  // Apply default preset before starting
  const defaultPreset = BOIDS_PRESETS.find(p => p.isDefault) ?? BOIDS_PRESETS[0];
  if (defaultPreset) {
    Object.assign(boidsCtrl.params, defaultPreset.params);
    boidsCtrl.trailsEnabled = defaultPreset.trailsEnabled;
    boidsCtrl.trailDecay = defaultPreset.trailDecay;
    if (defaultPreset.shader !== undefined) {
      await boidsCtrl.reloadShader(defaultPreset.shader);
    }
  }

  // Rebuild panel helper (re-syncs sliders + active pill after preset load)
  function buildPanel(activeId?: string): void {
    panel.innerHTML = '';
    buildBoidsPanel(panel, boidsCtrl, {
      presets: BOIDS_PRESETS,
      activePresetId: activeId,
      onClose: () => { panel.style.display = 'none'; panelOpen = false; },
      onShaderEdit: () => {
        shaderEditorOpen = !shaderEditorOpen;
        shaderPanelEl.style.display = shaderEditorOpen ? 'flex' : 'none';
      },
      onPresetLoad: async (preset) => {
        Object.assign(boidsCtrl.params, preset.params);
        boidsCtrl.trailsEnabled = preset.trailsEnabled;
        boidsCtrl.trailDecay = preset.trailDecay;
        await boidsCtrl.reloadShader(preset.shader ?? boidsCtrl.shaderSource);
        buildPanel(preset.id);
      },
    });
  }
  buildPanel(defaultPreset?.id);

  // ── Shader editor (CodeMirror) ─────────────────────────────────
```

The rest of the boids block (shader editor setup, controls bar) stays unchanged.

- [ ] **Step 3: Verify in browser**

```bash
npm run dev
```

Open `http://localhost:4321/gallery/boids`. Check:
- Params panel opens and shows preset pill "Default" (highlighted amber)
- Sliders work
- Shader editor opens and applies

- [ ] **Step 4: Commit**

```bash
git add src/pages/gallery/[...slug].astro
git commit -m "feat(presets): wire gallery page to shared panel + preset switcher"
```

---

## Task 4: Admin page — skeleton, layout, sim init, tab switching

**Files:**
- Create: `src/pages/admin/boids.astro`

- [ ] **Step 1: Create `src/pages/admin/boids.astro`**

```astro
---
if (import.meta.env.PROD) {
  return new Response(null, { status: 404 });
}
import BaseLayout from '../../layouts/BaseLayout.astro';
---

<BaseLayout title="Boids Admin">
  <div class="admin-wrap">
    <div class="admin-canvas-area">
      <canvas id="admin-canvas"></canvas>
      <div id="admin-fallback" class="admin-fallback" style="display:none;">
        <p>WebGPU not available.</p>
      </div>
      <div class="sim-controls">
        <button id="btn-play-pause" class="sim-btn">⏸</button>
        <button id="btn-reset" class="sim-btn">↺</button>
      </div>
    </div>
    <div class="admin-sidebar">
      <div class="tab-bar">
        <button class="tab-btn active" data-tab="params">Params</button>
        <button class="tab-btn" data-tab="presets">Presets</button>
        <button class="tab-btn" data-tab="shader">Shader</button>
      </div>
      <div id="tab-params" class="tab-pane"></div>
      <div id="tab-presets" class="tab-pane" style="display:none;"></div>
      <div id="tab-shader" class="tab-pane" style="display:none;">
        <div id="admin-shader-wrap" class="shader-wrap"></div>
        <div class="shader-footer">
          <div class="shader-btn-row">
            <button id="admin-shader-apply" class="shader-btn">Apply</button>
            <button id="admin-shader-reset" class="shader-btn">Reset to Default</button>
          </div>
          <div id="admin-shader-errors" class="shader-errors" style="display:none;"></div>
        </div>
      </div>
    </div>
  </div>
</BaseLayout>

<style>
  /* Override BaseLayout body padding for full-height workspace */
  :global(main), :global(.page-content) { padding: 0 !important; }

  .admin-wrap {
    display: flex;
    height: calc(100vh - 3rem); /* subtract nav height */
    overflow: hidden;
  }

  .admin-canvas-area {
    flex: 1;
    position: relative;
    background: var(--bg-primary);
  }

  #admin-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .admin-fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .sim-controls {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0.5rem;
  }

  .sim-btn {
    padding: 0.3rem 0.75rem;
    background: transparent;
    border: 1px solid var(--bg-surface-border);
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.9rem;
    transition: border-color 0.15s, color 0.15s;
  }

  .sim-btn:hover { border-color: var(--accent); color: var(--accent); }

  .admin-sidebar {
    width: 240px;
    flex-shrink: 0;
    background: var(--bg-nav);
    border-left: 1px solid var(--bg-surface-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .tab-bar {
    display: flex;
    border-bottom: 1px solid var(--bg-surface-border);
    flex-shrink: 0;
  }

  .tab-btn {
    flex: 1;
    padding: 0.5rem;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.7rem;
    letter-spacing: 1px;
    text-transform: uppercase;
    transition: color 0.15s;
  }

  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .tab-pane {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .shader-wrap { flex: 1; overflow: auto; font-size: 0.72rem; }

  .shader-wrap :global(.cm-editor) { height: 100%; min-height: 200px; }
  .shader-wrap :global(.cm-scroller) { overflow: auto; font-family: monospace; font-size: 0.72rem; }

  .shader-footer {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem 0.75rem;
    border-top: 1px solid var(--bg-surface-border);
    flex-shrink: 0;
  }

  .shader-btn-row { display: flex; gap: 0.4rem; }

  .shader-btn {
    padding: 0.3rem 0.75rem;
    border-radius: 4px;
    border: 1px solid var(--bg-surface-border);
    background: transparent;
    color: var(--text-body);
    font-size: 0.72rem;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .shader-btn:hover { border-color: var(--accent); color: var(--accent); }

  .shader-errors {
    font-family: monospace;
    font-size: 0.68rem;
    color: #e05060;
    white-space: pre-wrap;
    max-height: 80px;
    overflow-y: auto;
  }
</style>

<script>
  import { BoidsController } from '../../components/simulations/boids/boids-controller';
  import { buildBoidsPanel } from '../../components/simulations/boids/boids-panel';
  import { BOIDS_PRESETS } from '../../data/boids-presets';
  import type { BoidsPreset } from '../../data/boids-presets';
  import { EditorView, basicSetup } from 'codemirror';
  import { StreamLanguage } from '@codemirror/language';
  import { cpp } from '@codemirror/legacy-modes/mode/clike';

  // ── Sim init ───────────────────────────────────────────────────────
  const canvas = document.getElementById('admin-canvas') as HTMLCanvasElement;
  const fallback = document.getElementById('admin-fallback') as HTMLElement;
  const ctrl = new BoidsController();
  const ok = await ctrl.init(canvas);

  if (!ok) {
    canvas.style.display = 'none';
    fallback.style.display = 'flex';
  } else {
    ctrl.start();
  }

  // ── Play/pause + reset ─────────────────────────────────────────────
  let playing = true;
  document.getElementById('btn-play-pause')!.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (playing) { ctrl.stop(); btn.textContent = '▶'; }
    else { ctrl.start(); btn.textContent = '⏸'; }
    playing = !playing;
  });
  document.getElementById('btn-reset')!.addEventListener('click', () => ctrl.reset());

  // ── Tab switching ─────────────────────────────────────────────────
  const tabBtns = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
  const tabPanes = document.querySelectorAll<HTMLElement>('.tab-pane');

  function switchTab(name: string): void {
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    tabPanes.forEach(p => { p.style.display = p.id === `tab-${name}` ? 'flex' : 'none'; });
  }

  tabBtns.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab!)));
</script>
```

- [ ] **Step 2: Verify page loads**

```bash
npm run dev
```

Open `http://localhost:4321/admin/boids`. Check: page renders, simulation runs, play/pause and reset work, tabs switch without errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/boids.astro
git commit -m "feat(admin): add admin page skeleton with sim init and tab switching"
```

---

## Task 5: Admin page — Params tab and Shader tab

**Files:**
- Modify: `src/pages/admin/boids.astro` (script block only — append after tab switching code)

- [ ] **Step 1: Wire Params tab**

Append to the `<script>` block, after the tab switching section:

```typescript
  // ── Params tab ────────────────────────────────────────────────────
  const paramsContainer = document.getElementById('tab-params') as HTMLElement;
  buildBoidsPanel(paramsContainer, ctrl);
```

- [ ] **Step 2: Wire Shader tab**

Append to the `<script>` block:

```typescript
  // ── Shader tab ────────────────────────────────────────────────────
  const shaderWrap = document.getElementById('admin-shader-wrap') as HTMLElement;
  const shaderErrors = document.getElementById('admin-shader-errors') as HTMLElement;

  const editorView = new EditorView({
    doc: ctrl.shaderSource,
    extensions: [
      basicSetup,
      StreamLanguage.define(cpp),
      EditorView.theme({
        '&': { background: 'var(--bg-primary)' },
        '.cm-content': { color: 'var(--text-body)', caretColor: 'var(--accent)' },
        '.cm-gutters': {
          background: 'var(--bg-surface)',
          color: 'var(--text-muted)',
          borderRight: '1px solid var(--bg-surface-border)',
        },
        '.cm-activeLineGutter': { background: 'var(--bg-surface)' },
        '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
        '.cm-selectionBackground': { background: 'rgba(224,160,64,0.2) !important' },
      }),
    ],
    parent: shaderWrap,
  });

  document.getElementById('admin-shader-apply')!.addEventListener('click', async () => {
    const applyBtn = document.getElementById('admin-shader-apply') as HTMLButtonElement;
    const result = await ctrl.reloadShader(editorView.state.doc.toString());
    if (result.success) {
      shaderErrors.style.display = 'none';
      applyBtn.textContent = 'Applied ✓';
      applyBtn.style.borderColor = 'var(--accent)';
      applyBtn.style.color = 'var(--accent)';
      setTimeout(() => {
        applyBtn.textContent = 'Apply';
        applyBtn.style.borderColor = '';
        applyBtn.style.color = '';
      }, 1500);
    } else {
      shaderErrors.textContent = result.error || 'Unknown error';
      shaderErrors.style.display = 'block';
    }
  });

  document.getElementById('admin-shader-reset')!.addEventListener('click', async () => {
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: ctrl.shaderSource },
    });
    await ctrl.reloadShader(ctrl.shaderSource);
    shaderErrors.style.display = 'none';
  });
```

- [ ] **Step 3: Verify in browser**

Open `http://localhost:4321/admin/boids`. Check:
- Params tab shows sliders, all controls work
- Shader tab shows CodeMirror editor
- Apply changes the simulation visually
- Reset restores default shader

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/boids.astro
git commit -m "feat(admin): wire params panel and shader editor tabs"
```

---

## Task 6: Admin page — Presets tab (in-memory)

**Files:**
- Modify: `src/pages/admin/boids.astro` (script block — append after shader tab section)

- [ ] **Step 1: Add in-memory preset state and render function**

Append to the `<script>` block:

```typescript
  // ── Presets tab ───────────────────────────────────────────────────
  // Deep-copy so we never mutate the imported constant
  let adminPresets: BoidsPreset[] = JSON.parse(JSON.stringify(BOIDS_PRESETS));
  let activePresetId: string | undefined = adminPresets.find(p => p.isDefault)?.id;

  const presetsContainer = document.getElementById('tab-presets') as HTMLElement;

  function renderPresetList(): void {
    presetsContainer.innerHTML = '';

    // Preset rows
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:3px;';

    for (const preset of adminPresets) {
      const isActive = preset.id === activePresetId;
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:4px;cursor:pointer;border:1px solid ${isActive ? 'var(--accent)' : 'var(--bg-surface-border)'};`;

      const name = document.createElement('span');
      name.style.cssText = `flex:1;font-size:0.75rem;color:${isActive ? 'var(--accent)' : 'var(--text-body)'};`;
      name.textContent = preset.name + (preset.isDefault ? ' ★' : '');

      const starBtn = document.createElement('button');
      starBtn.textContent = '★';
      starBtn.title = 'Set as default';
      starBtn.style.cssText = `background:none;border:none;cursor:pointer;font-size:0.7rem;color:${preset.isDefault ? 'var(--accent)' : 'var(--text-muted)'};padding:0;`;
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        adminPresets.forEach(p => { p.isDefault = p.id === preset.id; });
        renderPresetList();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Delete';
      deleteBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:0.7rem;color:var(--text-muted);padding:0;';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        adminPresets = adminPresets.filter(p => p.id !== preset.id);
        if (activePresetId === preset.id) activePresetId = undefined;
        renderPresetList();
      });

      // Click row = load preset
      row.addEventListener('click', () => {
        activePresetId = preset.id;
        Object.assign(ctrl.params, preset.params);
        ctrl.trailsEnabled = preset.trailsEnabled;
        ctrl.trailDecay = preset.trailDecay;
        ctrl.reloadShader(preset.shader ?? ctrl.shaderSource);
        // Sync shader editor
        editorView.dispatch({
          changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: preset.shader ?? ctrl.shaderSource,
          },
        });
        renderPresetList();
      });

      row.appendChild(name);
      row.appendChild(starBtn);
      row.appendChild(deleteBtn);
      list.appendChild(row);
    }

    presetsContainer.appendChild(list);

    // Divider
    const divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:var(--bg-surface-border);margin:0.5rem 0;flex-shrink:0;';
    presetsContainer.appendChild(divider);

    // Save row: name input + Save button
    const saveRow = document.createElement('div');
    saveRow.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'preset name...';
    nameInput.style.cssText = 'flex:1;background:var(--bg-primary);border:1px solid var(--bg-surface-border);border-radius:4px;padding:0.25rem 0.5rem;color:var(--text-body);font-size:0.72rem;';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'padding:0.25rem 0.6rem;border:1px solid var(--bg-surface-border);border-radius:4px;background:transparent;color:var(--text-body);font-size:0.72rem;cursor:pointer;white-space:nowrap;';
    saveBtn.addEventListener('click', () => {
      const rawName = nameInput.value.trim();
      if (!rawName) return;
      const id = rawName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const newPreset: BoidsPreset = {
        id: adminPresets.some(p => p.id === id) ? `${id}-${Date.now()}` : id,
        name: rawName,
        params: { ...ctrl.params },
        trailsEnabled: ctrl.trailsEnabled,
        trailDecay: ctrl.trailDecay,
        shader: editorView.state.doc.toString() !== ctrl.shaderSource
          ? editorView.state.doc.toString()
          : undefined,
      };
      adminPresets.push(newPreset);
      activePresetId = newPreset.id;
      nameInput.value = '';
      renderPresetList();
    });
    saveRow.appendChild(nameInput);
    saveRow.appendChild(saveBtn);
    presetsContainer.appendChild(saveRow);

    // Write to disk button
    const writeBtn = document.createElement('button');
    writeBtn.textContent = '↓ Write to disk';
    writeBtn.id = 'write-to-disk';
    writeBtn.style.cssText = 'margin-top:0.25rem;padding:0.35rem;border:1px solid var(--accent);border-radius:4px;background:transparent;color:var(--accent);font-size:0.72rem;cursor:pointer;flex-shrink:0;';
    writeBtn.addEventListener('click', writeToDisk);
    presetsContainer.appendChild(writeBtn);
  }

  renderPresetList();
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:4321/admin/boids` → Presets tab. Check:
- Default preset row shows, clicking it re-applies params
- Typing a name and clicking Save adds a new row
- ★ toggles default (the old default loses ★, new one gains it)
- ✕ removes the row
- "Write to disk" button appears (clicking it will error until Task 7)

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/boids.astro
git commit -m "feat(admin): add in-memory preset management tab"
```

---

## Task 7: Vite middleware + Write to disk

**Files:**
- Modify: `astro.config.mjs`
- Modify: `src/pages/admin/boids.astro` (script block — add `writeToDisk` function before `renderPresetList`)

- [ ] **Step 1: Add the `writeToDisk` function to the admin page script**

In `src/pages/admin/boids.astro`, add this function **before** the `renderPresetList` function definition:

```typescript
  async function writeToDisk(): Promise<void> {
    const writeBtn = document.getElementById('write-to-disk');
    try {
      const res = await fetch('/api/admin/save-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adminPresets),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (writeBtn) {
        writeBtn.textContent = '✓ Written';
        writeBtn.style.borderColor = 'var(--accent)';
        setTimeout(() => {
          writeBtn.textContent = '↓ Write to disk';
        }, 2000);
      }
    } catch (err) {
      if (writeBtn) {
        writeBtn.textContent = '✗ Error';
        writeBtn.style.borderColor = '#e05060';
        writeBtn.style.color = '#e05060';
        setTimeout(() => {
          writeBtn.textContent = '↓ Write to disk';
          writeBtn.style.borderColor = 'var(--accent)';
          writeBtn.style.color = 'var(--accent)';
        }, 2000);
      }
      console.error('Write to disk failed:', err);
    }
  }
```

- [ ] **Step 2: Update `astro.config.mjs` to add the Vite middleware**

Replace the entire contents of `astro.config.mjs` with:

```javascript
// @ts-check
import { defineConfig } from 'astro/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** @param {import('./src/data/boids-presets').BoidsPreset[]} presets */
function generatePresetsFile(presets) {
  return `// AUTO-GENERATED by /admin/boids — do not edit manually
import type { BoidsParams } from '../components/simulations/boids/boids-controller';

export interface BoidsPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  params: BoidsParams;
  trailsEnabled: boolean;
  trailDecay: number;
  shader?: string;
}

export const BOIDS_PRESETS: BoidsPreset[] = ${JSON.stringify(presets, null, 2)};
`;
}

export default defineConfig({
  site: 'https://heysoos.github.io',
  vite: {
    plugins: [
      {
        name: 'admin-save-presets',
        configureServer(server) {
          server.middlewares.use('/api/admin/save-presets', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.end();
              return;
            }
            try {
              const chunks = [];
              for await (const chunk of req) chunks.push(chunk);
              const presets = JSON.parse(Buffer.concat(chunks).toString());
              const filePath = resolve('src/data/boids-presets.ts');
              writeFileSync(filePath, generatePresetsFile(presets), 'utf-8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch (err) {
              console.error('[admin-save-presets]', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(err) }));
            }
          });
        },
      },
    ],
  },
});
```

- [ ] **Step 3: Verify write-to-disk works**

```bash
npm run dev
```

Open `http://localhost:4321/admin/boids` → Presets tab:
1. Create a new preset (e.g. name "Test"), click Save
2. Click "↓ Write to disk"
3. Verify button shows "✓ Written"
4. Check `src/data/boids-presets.ts` — it should now contain the "Test" preset
5. Astro hot-reloads; verify the gallery page (`/gallery/boids`) now shows the new preset pill
6. Delete the "Test" preset in admin, write to disk again, verify it disappears from the gallery

- [ ] **Step 4: Add `.superpowers/` to `.gitignore`**

Open `.gitignore` (or create it at project root) and add:

```
.superpowers/
```

- [ ] **Step 5: Commit**

```bash
git add astro.config.mjs src/pages/admin/boids.astro .gitignore
git commit -m "feat(admin): add Vite save-presets middleware and write-to-disk wiring"
```

---

## Self-Review Checklist

- [x] Data layer (`BoidsPreset`, `BOIDS_PRESETS`) — Task 1
- [x] Shared panel builder extracted — Task 2
- [x] Gallery page uses shared builder + preset switcher + applies default — Task 3
- [x] Admin page prod guard (`import.meta.env.PROD` → 404) — Task 4
- [x] Admin Params tab — Task 5
- [x] Admin Shader tab with Apply/Reset — Task 5
- [x] Admin Presets tab: save, delete, ★ default, load — Task 6
- [x] Write to disk → Vite middleware → overwrites `boids-presets.ts` — Task 7
- [x] `.superpowers/` added to `.gitignore` — Task 7
- [x] `editorView` referenced in Task 6 is defined in Task 5 — both in same script block ✓
- [x] `writeToDisk` defined before `renderPresetList` which calls it — order specified in Task 7 Step 1 ✓
- [x] `BoidsPreset` type imported in admin script — included in Task 4 imports ✓
