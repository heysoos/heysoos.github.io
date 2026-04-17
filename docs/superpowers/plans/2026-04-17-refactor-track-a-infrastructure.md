# Refactor Track A — Shared Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **WORKTREE REQUIRED:** Before starting, invoke `superpowers:using-git-worktrees` to create an isolated branch for this work.

**Goal:** Decompose `gallery/[...slug].astro`'s 500-line script block into focused modules, consolidate the three admin pages into a shared layout, and DRY the `astro.config.mjs` middleware and preset generators.

**Architecture:** Extract TypeScript modules under `src/lib/sim-page/` (panel drag/resize, shader editor, FPS counter, per-sim setup functions). Create `src/layouts/AdminLayout.astro` to hold shared admin HTML/CSS. Move duplicate preset generator logic to `src/lib/admin/presets.ts`. The `.astro` files become thin orchestrators.

**Tech Stack:** Astro, TypeScript, CodeMirror 6, WebGPU controllers (BoidsController, CPPNController, NCAController)

**Spec:** `docs/superpowers/specs/2026-04-17-codebase-refactoring-design.md` — Track A sections

---

## File Map

**Create:**
- `src/lib/sim-page/panel-manager.ts` — floating panel drag/resize/sessionStorage
- `src/lib/sim-page/fps-counter.ts` — FPS measurement + cap UI
- `src/lib/sim-page/shader-editor.ts` — CodeMirror editor setup + apply/reset wiring
- `src/lib/sim-page/sim-setup/index.ts` — `setupSim()` router
- `src/lib/sim-page/sim-setup/boids.ts` — boids-specific panel/audio/shader wiring
- `src/lib/sim-page/sim-setup/cppn.ts` — CPPN-specific panel wiring
- `src/lib/sim-page/sim-setup/nca.ts` — NCA-specific panel wiring
- `src/layouts/AdminLayout.astro` — shared admin HTML + CSS
- `src/lib/admin/presets.ts` — `createPresetsMiddleware`, `generateWeightsPresetsFile`

**Modify:**
- `src/pages/gallery/[...slug].astro` — replace 500-line script with ~80-line orchestrator
- `src/pages/admin/boids.astro` — use `AdminLayout`, keep only sim-specific script
- `src/pages/admin/cppn.astro` — use `AdminLayout`, keep only sim-specific script
- `src/pages/admin/nca.astro` — use `AdminLayout`, keep only sim-specific script
- `astro.config.mjs` — import from `src/lib/admin/presets.ts`, remove duplicated handlers

---

## Task 1: Extract PanelManager

**Files:**
- Create: `src/lib/sim-page/panel-manager.ts`

The block-scoped IIFE in `[...slug].astro` lines 644–803 handles drag, resize, and session storage. Move it verbatim into an exported class.

- [ ] **Step 1: Create the file**

```typescript
// src/lib/sim-page/panel-manager.ts

const EDGE = 8; // px proximity to border counted as resize zone

interface PanelState {
  left: number;
  top: number;
  width?: number;
  height?: number;
  hasSize?: boolean;
}

export class PanelManager {
  private dragging = false;
  private dragOX = 0; private dragOY = 0;
  private startL = 0; private startT = 0;

  private resizeZone: string | null = null;
  private rsStartX = 0; private rsStartY = 0;
  private rsStartW = 0; private rsStartH = 0;
  private rsStartLeft = 0; private rsStartTop = 0;
  private rsFixedRight = 0; private rsFixedBottom = 0;

  private onDocMouseMove: (e: MouseEvent) => void;
  private onDocMouseUp: () => void;

  constructor(
    private panel: HTMLElement,
    private viewport: HTMLElement,
    private stateKey: string,
  ) {
    this.onDocMouseMove = (e) => this._onMouseMove(e);
    this.onDocMouseUp   = ()  => this._onMouseUp();
  }

  init(): void {
    this._restoreState();
    this._attachListeners();
  }

  dispose(): void {
    document.removeEventListener('mousemove', this.onDocMouseMove);
    document.removeEventListener('mouseup', this.onDocMouseUp);
  }

  private _saveState(includeSize = false): void {
    const vRect = this.viewport.getBoundingClientRect();
    const pRect = this.panel.getBoundingClientRect();
    if (pRect.width < 50 || pRect.height < 30) return;
    const prev: PanelState = JSON.parse(sessionStorage.getItem(this.stateKey) ?? '{}');
    const state: PanelState = { left: pRect.left - vRect.left, top: pRect.top - vRect.top };
    if (includeSize || prev.hasSize) {
      state.width = pRect.width; state.height = pRect.height; state.hasSize = true;
    }
    sessionStorage.setItem(this.stateKey, JSON.stringify(state));
  }

  private _restoreState(): void {
    const raw = sessionStorage.getItem(this.stateKey);
    if (!raw) return;
    const state: PanelState = JSON.parse(raw);
    const vRect = this.viewport.getBoundingClientRect();
    const panelW = state.width ?? 320;
    const left = Math.max(0, Math.min(state.left, vRect.width  - panelW));
    const top  = Math.max(0, Math.min(state.top,  vRect.height - 80));
    this.panel.style.right = 'auto';
    this.panel.style.left  = `${left}px`;
    this.panel.style.top   = `${top}px`;
    if (state.hasSize && state.width && state.height) {
      this.panel.style.maxHeight = 'none';
      this.panel.style.width     = `${state.width}px`;
      this.panel.style.height    = `${state.height}px`;
    }
  }

  private _getResizeZone(e: MouseEvent): string | null {
    const r = this.panel.getBoundingClientRect();
    const x = e.clientX, y = e.clientY;
    const nearTop = y - r.top    < EDGE;
    const nearBot = r.bottom - y < EDGE;
    const nearLft = x - r.left   < EDGE;
    const nearRgt = r.right  - x < EDGE;
    if (nearTop && nearLft) return 'nw';
    if (nearTop && nearRgt) return 'ne';
    if (nearBot && nearLft) return 'sw';
    if (nearBot && nearRgt) return 'se';
    if (nearTop) return 'n';
    if (nearBot) return 's';
    if (nearLft) return 'w';
    if (nearRgt) return 'e';
    return null;
  }

  private _attachListeners(): void {
    const dragHandle = this.panel.querySelector('.panel-drag-handle') as HTMLElement;

    this.panel.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.dragging || this.resizeZone) return;
      const zone = this._getResizeZone(e);
      this.panel.style.cursor = zone ? `${zone}-resize` : '';
    });
    this.panel.addEventListener('mouseleave', () => {
      if (!this.dragging && !this.resizeZone) this.panel.style.cursor = '';
    });

    dragHandle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      const vRect = this.viewport.getBoundingClientRect();
      const pRect = this.panel.getBoundingClientRect();
      this.panel.style.right = 'auto';
      this.panel.style.left  = `${pRect.left - vRect.left}px`;
      this.panel.style.top   = `${pRect.top  - vRect.top}px`;
      this.dragging = true;
      this.dragOX = e.clientX; this.dragOY = e.clientY;
      this.startL = pRect.left - vRect.left;
      this.startT = pRect.top  - vRect.top;
      document.body.style.userSelect = 'none';
    });

    this.panel.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.panel-drag-handle')) return;
      const zone = this._getResizeZone(e);
      if (!zone) return;
      e.preventDefault();
      e.stopPropagation();
      const vRect = this.viewport.getBoundingClientRect();
      const pRect = this.panel.getBoundingClientRect();
      this.resizeZone   = zone;
      this.rsStartX     = e.clientX;
      this.rsStartY     = e.clientY;
      this.rsStartW     = pRect.width;
      this.rsStartH     = pRect.height;
      this.rsStartLeft  = pRect.left - vRect.left;
      this.rsStartTop   = pRect.top  - vRect.top;
      this.rsFixedRight  = pRect.right  - vRect.left;
      this.rsFixedBottom = pRect.bottom - vRect.top;
      this.panel.style.right     = 'auto';
      this.panel.style.left      = `${this.rsStartLeft}px`;
      this.panel.style.top       = `${this.rsStartTop}px`;
      this.panel.style.maxHeight = 'none';
      this.panel.style.height    = `${this.rsStartH}px`;
      this.panel.style.cursor    = `${zone}-resize`;
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', this.onDocMouseMove);
    document.addEventListener('mouseup', this.onDocMouseUp);
  }

  private _onMouseMove(e: MouseEvent): void {
    if (this.dragging) {
      const vRect = this.viewport.getBoundingClientRect();
      const pRect = this.panel.getBoundingClientRect();
      const newL = Math.max(0, Math.min(this.startL + e.clientX - this.dragOX, vRect.width  - pRect.width));
      const newT = Math.max(0, Math.min(this.startT + e.clientY - this.dragOY, vRect.height - pRect.height));
      this.panel.style.left = `${newL}px`;
      this.panel.style.top  = `${newT}px`;
      return;
    }
    if (this.resizeZone) {
      const dx = e.clientX - this.rsStartX;
      const dy = e.clientY - this.rsStartY;
      let newW = this.rsStartW, newH = this.rsStartH;
      let newL = this.rsStartLeft, newT = this.rsStartTop;
      if (this.resizeZone.includes('e')) newW = Math.max(200, this.rsStartW + dx);
      if (this.resizeZone.includes('w')) { newW = Math.max(200, this.rsStartW - dx); newL = Math.max(0, this.rsFixedRight - newW); }
      if (this.resizeZone.includes('s')) newH = Math.max(80, this.rsStartH + dy);
      if (this.resizeZone.includes('n')) { newH = Math.max(80, this.rsStartH - dy); newT = Math.max(0, this.rsFixedBottom - newH); }
      this.panel.style.width  = `${newW}px`;
      this.panel.style.height = `${newH}px`;
      this.panel.style.left   = `${newL}px`;
      this.panel.style.top    = `${newT}px`;
    }
  }

  private _onMouseUp(): void {
    if (this.dragging) {
      this.dragging = false;
      document.body.style.userSelect = '';
      this.panel.style.cursor = '';
      this._saveState(false);
      return;
    }
    if (this.resizeZone) {
      this.resizeZone = null;
      document.body.style.userSelect = '';
      this.panel.style.cursor = '';
      this._saveState(true);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/sim-page/panel-manager.ts
git commit -m "refactor(sim-page): extract PanelManager from gallery slug page"
```

---

## Task 2: Extract FpsCounter

**Files:**
- Create: `src/lib/sim-page/fps-counter.ts`

Extracts lines 1031–1066 of `[...slug].astro`: the `setInterval` tick counter and the cap UI listeners.

- [ ] **Step 1: Create the file**

```typescript
// src/lib/sim-page/fps-counter.ts

interface FpsTarget {
  maxFps: number;
  tickCount: number;
}

export function createFpsCounter(
  fpsValueEl:     HTMLElement,
  fpsUnlimited:   HTMLInputElement,
  fpsSlider:      HTMLInputElement,
  fpsSliderLabel: HTMLElement,
  fpsSliderRow:   HTMLElement,
  ctrl:           FpsTarget,
): { dispose: () => void } {
  const intervalId = setInterval(() => {
    const now   = performance.now();
    const ticks = ctrl.tickCount - lastTick;
    fpsValueEl.textContent = `${Math.round(ticks * 1000 / (now - lastMs))} fps`;
    lastTick = ctrl.tickCount;
    lastMs   = now;
  }, 500);

  let lastTick = ctrl.tickCount;
  let lastMs   = performance.now();

  function applyMaxFps(): void {
    if (fpsUnlimited.checked) {
      ctrl.maxFps = Infinity;
      fpsSliderRow.style.opacity = '0.35';
      fpsSliderRow.style.pointerEvents = 'none';
    } else {
      ctrl.maxFps = parseInt(fpsSlider.value);
      fpsSliderRow.style.opacity = '';
      fpsSliderRow.style.pointerEvents = '';
    }
  }

  fpsUnlimited.addEventListener('change', applyMaxFps);
  fpsSlider.addEventListener('input', () => {
    fpsSliderLabel.textContent = fpsSlider.value;
    applyMaxFps();
  });
  applyMaxFps();

  return {
    dispose() { clearInterval(intervalId); },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/sim-page/fps-counter.ts
git commit -m "refactor(sim-page): extract createFpsCounter from gallery slug page"
```

---

## Task 3: Extract ShaderEditorController

**Files:**
- Create: `src/lib/sim-page/shader-editor.ts`

Extracts the CodeMirror setup and apply/reset/close listeners from `setupBoids` in `[...slug].astro` (lines 904–962). Returns a handle so callers can push new content into the editor on preset load.

- [ ] **Step 1: Create the file**

```typescript
// src/lib/sim-page/shader-editor.ts
import { EditorView, basicSetup } from 'codemirror';
import { StreamLanguage } from '@codemirror/language';
import { cpp } from '@codemirror/legacy-modes/mode/clike';

export interface ShaderEditorHandle {
  /** Replace the editor content (e.g. on preset load) */
  setDoc(code: string): void;
  dispose(): void;
}

export function createShaderEditor(
  editorWrap:   HTMLElement,
  errorsEl:     HTMLElement,
  applyBtn:     HTMLButtonElement,
  resetBtn:     HTMLButtonElement,
  closeBtn:     HTMLButtonElement,
  shaderPanel:  HTMLElement,
  opts: {
    initialCode: string;
    onApply: (code: string) => Promise<{ success: boolean; error?: string }>;
    onReset: () => string;
    onClose: () => void;
  },
): ShaderEditorHandle {
  const view = new EditorView({
    doc: opts.initialCode,
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
    parent: editorWrap,
  });

  applyBtn.addEventListener('click', async () => {
    const code = view.state.doc.toString();
    const result = await opts.onApply(code);
    if (result.success) {
      errorsEl.style.display = 'none';
      errorsEl.textContent = '';
      applyBtn.textContent = 'Applied ✓';
      applyBtn.style.borderColor = 'var(--accent)';
      applyBtn.style.color = 'var(--accent)';
      setTimeout(() => {
        applyBtn.textContent = 'Apply';
        applyBtn.style.borderColor = '';
        applyBtn.style.color = '';
      }, 1500);
    } else {
      errorsEl.textContent = result.error || 'Unknown error';
      errorsEl.style.display = 'block';
    }
  });

  resetBtn.addEventListener('click', async () => {
    const src = opts.onReset();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } });
    await opts.onApply(src);
    errorsEl.style.display = 'none';
  });

  closeBtn.addEventListener('click', () => {
    shaderPanel.style.display = 'none';
    opts.onClose();
  });

  return {
    setDoc(code: string): void {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
    },
    dispose(): void {
      view.destroy();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/sim-page/shader-editor.ts
git commit -m "refactor(sim-page): extract createShaderEditor from gallery slug page"
```

---

## Task 4: Create sim-setup/boids.ts

**Files:**
- Create: `src/lib/sim-page/sim-setup/boids.ts`

Extracts `setupBoids()` from `[...slug].astro` (lines 822–962). The function now calls `createShaderEditor()` instead of setting up CodeMirror inline.

- [ ] **Step 1: Create the file**

```typescript
// src/lib/sim-page/sim-setup/boids.ts
import type { BoidsController } from '../../../components/simulations/boids/boids-controller';
import { buildBoidsPanel } from '../../../components/simulations/boids/boids-panel';
import { AudioReactor } from '../../../components/simulations/boids/boids-audio';
import { BOIDS_PRESETS } from '../../../data/boids-presets';
import { createShaderEditor, type ShaderEditorHandle } from '../shader-editor';

export async function setupBoids(
  ctrl: BoidsController,
  panelContent: HTMLElement,
  panel: HTMLElement,
  shaderPanelEl: HTMLElement,
): Promise<void> {
  const reactor = new AudioReactor();

  let panelControls: { teardown: () => void; updateAudioViz: (baseParams?: Record<string, number>) => void } | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseParams: Record<string, number> = { ...(ctrl.params as any) };
  let isApplyingAudio = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trackedParams = new Proxy(ctrl.params as any, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set(target: any, prop: string, value: any): boolean {
      target[prop] = value;
      if (!isApplyingAudio) baseParams[prop] = value;
      return true;
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctrl as any).params = trackedParams;

  let mappingRafId = 0;
  (function mappingLoop() {
    if (reactor.isActive()) {
      isApplyingAudio = true;
      Object.assign(ctrl.params, baseParams);
      const snapshot = reactor.analyze();
      reactor.applyMappings(ctrl.params, snapshot);
      isApplyingAudio = false;
    }
    panelControls?.updateAudioViz(baseParams as Record<string, number>);
    mappingRafId = requestAnimationFrame(mappingLoop);
  })();

  document.addEventListener('pagehide', () => {
    cancelAnimationFrame(mappingRafId);
    reactor.stop();
  }, { once: true });

  const defaultPreset = BOIDS_PRESETS.find(p => p.isDefault) ?? BOIDS_PRESETS[0];
  if (defaultPreset) {
    Object.assign(ctrl.params, defaultPreset.params);
    ctrl.trailsEnabled = defaultPreset.trailsEnabled;
    ctrl.trailDecay = defaultPreset.trailDecay;
    if (defaultPreset.shader !== undefined) await ctrl.reloadShader(defaultPreset.shader);
  }

  let shaderEditorHandle: ShaderEditorHandle | null = null;
  let shaderEditorOpen = false;

  function buildPanel(activeId?: string): void {
    panelControls?.teardown();
    panelContent.innerHTML = '';
    panelControls = buildBoidsPanel(panelContent, ctrl, {
      presets: BOIDS_PRESETS,
      activePresetId: activeId,
      reactor,
      onClose: () => {
        panelControls?.teardown();
        panel.style.display = 'none';
      },
      onShaderEdit: () => {
        shaderEditorOpen = !shaderEditorOpen;
        shaderPanelEl.style.display = shaderEditorOpen ? 'flex' : 'none';
      },
      onPresetLoad: async (preset) => {
        Object.assign(ctrl.params, preset.params);
        ctrl.trailsEnabled = preset.trailsEnabled;
        ctrl.trailDecay = preset.trailDecay;
        const nextShader = preset.shader ?? ctrl.defaultShaderSource;
        await ctrl.reloadShader(nextShader);
        shaderEditorHandle?.setDoc(nextShader);
        buildPanel(preset.id);
      },
    });
  }
  buildPanel(defaultPreset?.id);

  const editorWrap   = document.getElementById('shader-editor-wrap') as HTMLElement;
  const shaderErrors = document.getElementById('shader-errors') as HTMLElement;
  const applyBtn     = document.getElementById('shader-apply') as HTMLButtonElement;
  const resetBtn     = document.getElementById('shader-reset') as HTMLButtonElement;
  const closeBtn     = document.getElementById('shader-panel-close') as HTMLButtonElement;

  shaderEditorHandle = createShaderEditor(
    editorWrap,
    shaderErrors,
    applyBtn,
    resetBtn,
    closeBtn,
    shaderPanelEl,
    {
      initialCode: ctrl.shaderSource,
      onApply: (code) => ctrl.reloadShader(code),
      onReset: () => ctrl.shaderSource,
      onClose: () => { shaderEditorOpen = false; },
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/sim-page/sim-setup/boids.ts
git commit -m "refactor(sim-page): extract setupBoids to sim-setup/boids.ts"
```

---

## Task 5: Create sim-setup/cppn.ts and sim-setup/nca.ts

**Files:**
- Create: `src/lib/sim-page/sim-setup/cppn.ts`
- Create: `src/lib/sim-page/sim-setup/nca.ts`

Extracts `setupCPPN` (lines 966–986) and `setupNCA` (lines 990–1008) verbatim.

- [ ] **Step 1: Create cppn.ts**

```typescript
// src/lib/sim-page/sim-setup/cppn.ts
import type { CPPNController } from '../../../components/simulations/cppn/cppn-controller';
import { buildCPPNPanel } from '../../../components/simulations/cppn/cppn-panel';
import { CPPN_PRESETS } from '../../../data/cppn-presets';

export async function setupCPPN(
  ctrl: CPPNController,
  panelContent: HTMLElement,
  panel: HTMLElement,
): Promise<void> {
  const defaultPreset = CPPN_PRESETS.find(p => p.isDefault) ?? CPPN_PRESETS[0];
  if (defaultPreset) await ctrl.loadPreset(defaultPreset);

  let activeId = defaultPreset?.id;

  function buildPanel(id?: string): void {
    panelContent.innerHTML = '';
    buildCPPNPanel(panelContent, ctrl, {
      presets: CPPN_PRESETS,
      activePresetId: id,
      onClose: () => { panel.style.display = 'none'; },
      onPresetLoad: async (preset) => {
        await ctrl.loadPreset(preset);
        activeId = preset.id;
        buildPanel(preset.id);
      },
    });
  }
  buildPanel(activeId);
}
```

- [ ] **Step 2: Create nca.ts**

```typescript
// src/lib/sim-page/sim-setup/nca.ts
import type { NCAController } from '../../../components/simulations/nca/nca-controller';
import { buildNCAPanel } from '../../../components/simulations/nca/nca-panel';
import { NCA_PRESETS } from '../../../data/nca-presets';

export function setupNCA(
  ctrl: NCAController,
  panelContent: HTMLElement,
  panel: HTMLElement,
): void {
  const defaultPreset = NCA_PRESETS.find(p => p.isDefault) ?? NCA_PRESETS[0];
  if (defaultPreset) ctrl.loadPreset(defaultPreset);

  let activeId = defaultPreset?.id;

  function buildPanel(id?: string): void {
    panelContent.innerHTML = '';
    buildNCAPanel(panelContent, ctrl, {
      presets: NCA_PRESETS,
      activePresetId: id,
      onClose: () => { panel.style.display = 'none'; },
      onPresetLoad: (preset) => {
        activeId = preset.id;
        buildPanel(preset.id);
      },
    });
  }
  buildPanel(activeId);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/sim-page/sim-setup/cppn.ts src/lib/sim-page/sim-setup/nca.ts
git commit -m "refactor(sim-page): extract setupCPPN and setupNCA to sim-setup/"
```

---

## Task 6: Create sim-setup/index.ts

**Files:**
- Create: `src/lib/sim-page/sim-setup/index.ts`

Router that maps a sim id string to its setup function. Adding a new simulation in future = add one case here.

- [ ] **Step 1: Create the file**

```typescript
// src/lib/sim-page/sim-setup/index.ts
import type { BoidsController } from '../../../components/simulations/boids/boids-controller';
import type { CPPNController } from '../../../components/simulations/cppn/cppn-controller';
import type { NCAController } from '../../../components/simulations/nca/nca-controller';
import { setupBoids } from './boids';
import { setupCPPN } from './cppn';
import { setupNCA } from './nca';

type AnyController = { init(c: HTMLCanvasElement): Promise<boolean>; start(): void; stop(): void; reset(): void };

/**
 * Returns true if the sim has a settings panel (controls bar should show ⚙ button).
 * Returns false for unknown sims or sims without panels.
 */
export async function setupSim(
  sim: string,
  ctrl: AnyController,
  panelContent: HTMLElement,
  panel: HTMLElement,
  shaderPanelEl: HTMLElement,
): Promise<boolean> {
  switch (sim) {
    case 'boids':
      await setupBoids(ctrl as BoidsController, panelContent, panel, shaderPanelEl);
      return true;
    case 'cppn':
      await setupCPPN(ctrl as CPPNController, panelContent, panel);
      return true;
    case 'nca':
      setupNCA(ctrl as NCAController, panelContent, panel);
      return true;
    default:
      return false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/sim-page/sim-setup/index.ts
git commit -m "refactor(sim-page): add setupSim router in sim-setup/index.ts"
```

---

## Task 7: Rewrite [slug].astro script to thin orchestrator

**Files:**
- Modify: `src/pages/gallery/[...slug].astro`

Replace the entire `<script>` block (lines 601–1100) with a slim orchestrator that imports the extracted modules. HTML/CSS blocks are unchanged.

- [ ] **Step 1: Replace the script block**

Delete everything from `<script>` through `</script>` and replace with:

```html
<script>
  import { BoidsController } from '../../components/simulations/boids/boids-controller';
  import { ParticleLifeController } from '../../components/simulations/particle-life/particle-life-controller';
  import { NCAController } from '../../components/simulations/nca/nca-controller';
  import { CPPNController } from '../../components/simulations/cppn/cppn-controller';
  import { PanelManager } from '../../lib/sim-page/panel-manager';
  import { createFpsCounter } from '../../lib/sim-page/fps-counter';
  import { setupSim } from '../../lib/sim-page/sim-setup/index';

  const viewport      = document.getElementById('sim-viewport') as HTMLElement;
  const sim           = viewport.dataset.sim!;
  const canvas        = document.getElementById('sim-canvas') as HTMLCanvasElement;
  const fallback      = document.getElementById('sim-fallback') as HTMLElement;
  const panel         = document.getElementById('params-panel') as HTMLElement;
  const panelContent  = document.getElementById('panel-content') as HTMLElement;
  const shaderPanelEl = document.getElementById('shader-panel') as HTMLElement;

  const panelManager = new PanelManager(panel, viewport, sim);
  panelManager.init();

  const controllers: Record<string, { init(c: HTMLCanvasElement): Promise<boolean>; start(): void; stop(): void; reset(): void }> = {
    boids: new BoidsController(),
    'particle-life': new ParticleLifeController(),
    nca: new NCAController(),
    cppn: new CPPNController(),
  };

  const controller = controllers[sim];
  let playing = true;

  if (!controller) {
    fallback.style.display = 'flex';
    (fallback.querySelector('p') as HTMLElement).textContent = 'Simulation coming soon.';
  } else {
    try {
      const ok = await controller.init(canvas);
      if (ok) {
        controller.start();

        createFpsCounter(
          document.getElementById('fps-value') as HTMLElement,
          document.getElementById('fps-unlimited') as HTMLInputElement,
          document.getElementById('fps-slider') as HTMLInputElement,
          document.getElementById('fps-slider-label') as HTMLElement,
          document.getElementById('fps-slider-row') as HTMLElement,
          controller as unknown as { maxFps: number; tickCount: number },
        );

        const hasPanel = await setupSim(sim, controller, panelContent, panel, shaderPanelEl);

        const controls = document.getElementById(`controls-${sim}`);
        controls?.addEventListener('click', (e) => {
          const btn = (e.target as HTMLElement).closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'play-pause') {
            if (playing) { controller.stop(); btn.querySelector('.ctrl-icon')!.textContent = '▶'; }
            else { controller.start(); btn.querySelector('.ctrl-icon')!.textContent = '⏸'; }
            playing = !playing;
          } else if (action === 'reset') {
            controller.reset();
          } else if (action === 'fullscreen') {
            document.getElementById('sim-viewport')?.requestFullscreen();
          } else if (action === 'settings' && hasPanel) {
            const isOpen = panel.style.display !== 'none';
            panel.style.display = isOpen ? 'none' : 'flex';
          }
        });
      } else {
        canvas.style.display = 'none';
        fallback.style.display = 'flex';
      }
    } catch (e) {
      console.error('Simulation failed to start:', e);
      canvas.style.display = 'none';
      fallback.style.display = 'flex';
    }
  }
</script>
```

- [ ] **Step 2: Start dev server and verify**

```bash
npm run dev
```

Open `http://localhost:4321/gallery/boids` in browser. Verify:
- Simulation runs
- ⚙ button opens/closes the params panel
- Panel drag and resize work, position persists on refresh
- Shader editor opens via "Edit Shader" button in panel
- Apply / Reset shader buttons work
- FPS display shows and cap slider works
- Audio tab functions (if audio source available)

Open `http://localhost:4321/gallery/cppn` and `http://localhost:4321/gallery/nca` and verify panels work.

- [ ] **Step 3: Commit**

```bash
git add src/pages/gallery/\[...slug\].astro
git commit -m "refactor(gallery): replace 500-line script with orchestrator using extracted modules"
```

---

## Task 8: Create AdminLayout.astro

**Files:**
- Create: `src/layouts/AdminLayout.astro`

The three admin pages share the same HTML skeleton and all their CSS. Extract into a layout component. The shader panel (boids-only) is provided via an optional `<slot name="canvas-overlay" />` so boids.astro can inject it.

- [ ] **Step 1: Read full boids admin page CSS block to copy shared styles**

Read `src/pages/admin/boids.astro` lines 45–350 (the `<style>` block). Note which CSS rules are `.admin-shader-panel` specific — those stay in boids.astro. Everything else is shared.

- [ ] **Step 2: Create the layout**

```astro
---
// src/layouts/AdminLayout.astro
// Dev-only admin layout. Shared structure and CSS for all sim admin pages.
import BaseLayout from './BaseLayout.astro';

interface Props {
  title: string;
  tabs?: string[];  // defaults to ['params', 'presets']
}

const { title, tabs = ['params', 'presets'] } = Astro.props;
---

<BaseLayout title={title}>
  <div class="admin-wrap">
    <div class="admin-canvas-area">
      <canvas id="admin-canvas"></canvas>
      <div id="admin-fallback" class="admin-fallback" style="display:none;">
        <p>WebGPU not available.</p>
      </div>
      <slot name="canvas-overlay" />
      <div class="sim-controls">
        <button id="btn-play-pause" class="sim-btn">⏸</button>
        <button id="btn-reset" class="sim-btn">↺</button>
      </div>
    </div>
    <div class="admin-sidebar">
      <div class="tab-bar">
        {tabs.map((tab, i) => (
          <button class={`tab-btn${i === 0 ? ' active' : ''}`} data-tab={tab}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div id={`tab-${tab}`} class="tab-pane params-panel" style={i > 0 ? 'display:none;' : ''} />
      ))}
    </div>
  </div>
  <slot />
</BaseLayout>

<style>
  /* PASTE the shared admin CSS here — everything from boids.astro's <style>
     EXCEPT .admin-shader-panel and its children (those stay in boids.astro) */
  .admin-wrap {
    display: flex;
    height: calc(100vh - 60px);
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
    padding: 0.4rem 0.75rem;
    background: var(--bg-nav);
    border: 1px solid var(--bg-surface-border);
    border-radius: var(--border-radius);
    color: var(--text-body);
    cursor: pointer;
    font-size: 0.9rem;
    backdrop-filter: blur(4px);
    transition: border-color var(--transition-speed);
  }

  .sim-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .admin-sidebar {
    width: 320px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border-left: 1px solid var(--bg-surface-border);
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
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.7rem;
    letter-spacing: 1px;
    text-transform: uppercase;
    transition: color var(--transition-speed), border-color var(--transition-speed);
  }

  .tab-btn.active,
  .tab-btn:hover {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
  }

  .tab-pane {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 0.2rem 0.75rem 1rem;
    scrollbar-width: thin;
    scrollbar-color: var(--bg-surface-border) transparent;
  }
</style>
```

> **Note:** After creating this file, open `src/pages/admin/boids.astro` and copy the full CSS from its `<style>` block into AdminLayout, excluding `.admin-shader-panel` and its children. The exact CSS values need to match what's currently in boids.astro — copy them verbatim.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/AdminLayout.astro
git commit -m "refactor(admin): create AdminLayout.astro with shared HTML and CSS"
```

---

## Task 9: Migrate admin pages to AdminLayout

**Files:**
- Modify: `src/pages/admin/boids.astro`
- Modify: `src/pages/admin/cppn.astro`
- Modify: `src/pages/admin/nca.astro`

Each admin page keeps only its sim-specific `<script>` block and any sim-specific CSS (e.g. `.admin-shader-panel` in boids).

- [ ] **Step 1: Update boids.astro**

Replace the frontmatter + HTML in `boids.astro` with:

```astro
---
// Dev-only admin page. Write-to-disk API only exists during `npm run dev`.
import AdminLayout from '../../layouts/AdminLayout.astro';
---

<AdminLayout title="Boids Admin">
  <div slot="canvas-overlay" id="admin-shader-panel" class="admin-shader-panel" style="display:none;">
    <div class="shader-panel-header">
      <span>Shader Editor</span>
      <button id="admin-shader-close" class="shader-panel-close">×</button>
    </div>
    <div id="admin-shader-wrap" class="shader-editor-wrap"></div>
    <div class="shader-panel-footer">
      <div class="shader-btn-row">
        <button id="admin-shader-apply" class="shader-apply-btn">Apply</button>
        <button id="admin-shader-reset" class="shader-reset-btn">Reset to Default</button>
      </div>
      <div id="admin-shader-errors" class="shader-errors" style="display:none;"></div>
    </div>
  </div>
</AdminLayout>

<style>
  /* Shader panel styles — boids-specific, NOT in AdminLayout */
  .admin-shader-panel { /* ... keep existing .admin-shader-panel CSS from boids.astro ... */ }
  /* keep .shader-panel-header, .shader-panel-close, .shader-editor-wrap,
     .shader-panel-footer, .shader-btn-row, .shader-apply-btn, .shader-reset-btn,
     .shader-errors CSS blocks here */
</style>

<script>
  /* keep the existing boids admin script block entirely unchanged */
</script>
```

- [ ] **Step 2: Update cppn.astro**

Replace frontmatter + HTML with:

```astro
---
import AdminLayout from '../../layouts/AdminLayout.astro';
---

<AdminLayout title="CPPN Admin">
</AdminLayout>

<script>
  /* keep existing cppn admin script block entirely unchanged */
</script>
```

Remove the `<style>` block from cppn.astro entirely (all CSS now in AdminLayout).

- [ ] **Step 3: Update nca.astro** — same pattern as cppn.astro above.

- [ ] **Step 4: Verify admin pages**

```bash
npm run dev
```

Open `http://localhost:4321/admin/boids`, `http://localhost:4321/admin/cppn`, `http://localhost:4321/admin/nca`. Verify layout renders correctly, tabs switch, shader panel works in boids.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/boids.astro src/pages/admin/cppn.astro src/pages/admin/nca.astro
git commit -m "refactor(admin): migrate all admin pages to AdminLayout"
```

---

## Task 10: Extract src/lib/admin/presets.ts

**Files:**
- Create: `src/lib/admin/presets.ts`

Extracts `generateCPPNPresetsFile` and `generateNCAPresetsFile` from `astro.config.mjs` into a shared `generateWeightsPresetsFile` function, and provides a `createPresetsMiddleware` factory to replace the three copy-paste middleware handlers.

- [ ] **Step 1: Create the file**

```typescript
// src/lib/admin/presets.ts
// Node.js utilities used by astro.config.mjs — not browser code.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Connect } from 'vite';

/**
 * Generic factory for admin POST middleware. Reads the request body as JSON,
 * calls `generator`, and writes the result to `outputPath`.
 */
export function createPresetsMiddleware(
  route: string,
  outputPath: string,
  generator: (data: unknown) => string,
): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (req.url !== route) { next(); return; }
    if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      writeFileSync(resolve(outputPath), generator(data), 'utf-8');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error(`[${route}]`, err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(err) }));
    }
  };
}

/** Convert a kebab-case id to a camelCase weights variable name: "soft-colors" → "softColorsWeights" */
export function idToWeightsVarName(id: string): string {
  return id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) + 'Weights';
}

/**
 * Shared generator for CPPN and NCA presets — both follow the same pattern:
 * extract weights into per-id JSON files, then emit an import-based TS file.
 */
export function generateWeightsPresetsFile(opts: {
  simName: string;       // 'cppn' | 'nca'
  typeImportPath: string; // '../components/simulations/cppn/cppn-types'
  typeName: string;       // 'CPPNPreset' | 'NCAPreset'
  constName: string;     // 'CPPN_PRESETS' | 'NCA_PRESETS'
  weightsDir: string;    // 'src/data/cppn-weights'
  presets: Array<{ id: string; weights: unknown; [key: string]: unknown }>;
}): string {
  const { typeImportPath, typeName, constName, weightsDir, presets } = opts;

  if (!existsSync(weightsDir)) mkdirSync(weightsDir, { recursive: true });

  const SENTINEL = '__WEIGHTS_VAR__';
  const imports: Array<{ id: string; varName: string }> = [];

  const presetsWithoutWeights = presets.map(preset => {
    const { weights, ...rest } = preset;
    writeFileSync(
      resolve(weightsDir, `${preset.id}.json`),
      JSON.stringify(weights, null, 2) + '\n',
      'utf-8',
    );
    const varName = idToWeightsVarName(preset.id);
    imports.push({ id: preset.id, varName });
    return { ...rest, weights: `${SENTINEL}${varName}` };
  });

  const importLines = imports
    .map(({ id, varName }) => `import ${varName} from './${opts.simName}-weights/${id}.json';`)
    .join('\n');

  let arrJson = JSON.stringify(presetsWithoutWeights, null, 2);
  for (const { varName } of imports) {
    arrJson = arrJson.replaceAll(`"${SENTINEL}${varName}"`, varName);
  }

  return `// AUTO-GENERATED by /admin/${opts.simName} — do not edit manually
import type { ${typeName} } from '${typeImportPath}';

${importLines}

export type { ${typeName} };

export const ${constName}: ${typeName}[] = ${arrJson};
`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/admin/presets.ts
git commit -m "refactor(admin): extract createPresetsMiddleware and generateWeightsPresetsFile"
```

---

## Task 11: Clean up astro.config.mjs

**Files:**
- Modify: `astro.config.mjs`

Replace `generateCPPNPresetsFile`, `generateNCAPresetsFile`, and the three middleware handlers with calls to the extracted utilities.

- [ ] **Step 1: Read existing generatePresetsFile**

Read `astro.config.mjs` lines 31–113. This is the full `generatePresetsFile` function — copy it before editing.

- [ ] **Step 2: Update astro.config.mjs**

Replace the file content with:

```javascript
// @ts-check
import { defineConfig } from 'astro/config';
import { writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createPresetsMiddleware, generateWeightsPresetsFile } from './src/lib/admin/presets.ts';

const SHADERS_DIR = 'src/data/boids-shaders';

function stemToVarName(stem) {
  return stem.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Shader';
}

function loadShaderFileMap() {
  const map = new Map();
  if (!existsSync(SHADERS_DIR)) return map;
  for (const f of readdirSync(SHADERS_DIR)) {
    if (!f.endsWith('.wgsl')) continue;
    const stem = f.slice(0, -5);
    const content = readFileSync(resolve(SHADERS_DIR, f), 'utf-8');
    map.set(content, { stem, varName: stemToVarName(stem) });
  }
  return map;
}

// Paste the full generatePresetsFile body copied from lines 31–113 of the existing file here.
function generatePresetsFile(presets) {
  // [content from Step 1 above]
}

export default defineConfig({
  site: 'https://heysoos.github.io',
  vite: {
    plugins: [
      {
        name: 'admin-save-presets',
        configureServer(server) {
          server.middlewares.use(createPresetsMiddleware(
            '/api/admin/save-presets',
            'src/data/boids-presets.ts',
            generatePresetsFile,
          ));
          server.middlewares.use(createPresetsMiddleware(
            '/api/admin/save-cppn-presets',
            'src/data/cppn-presets.ts',
            (presets) => generateWeightsPresetsFile({
              simName: 'cppn',
              typeImportPath: '../components/simulations/cppn/cppn-types',
              typeName: 'CPPNPreset',
              constName: 'CPPN_PRESETS',
              weightsDir: 'src/data/cppn-weights',
              presets,
            }),
          ));
          server.middlewares.use(createPresetsMiddleware(
            '/api/admin/save-nca-presets',
            'src/data/nca-presets.ts',
            (presets) => generateWeightsPresetsFile({
              simName: 'nca',
              typeImportPath: '../components/simulations/nca/nca-types',
              typeName: 'NCAPreset',
              constName: 'NCA_PRESETS',
              weightsDir: 'src/data/nca-weights',
              presets,
            }),
          ));
        },
      },
    ],
  },
});
```

> **Note:** Keep the full body of `generatePresetsFile` unchanged — it's boids-specific and has no counterpart to merge with. Only the CPPN/NCA generators and the three middleware handlers are replaced.

- [ ] **Step 3: Verify dev server starts and admin saves work**

```bash
npm run dev
```

Open `/admin/boids`, make a change and click Save Preset. Verify `src/data/boids-presets.ts` updates. Repeat for `/admin/cppn` and `/admin/nca`.

- [ ] **Step 4: Verify production build**

```bash
npm run build
```

Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add astro.config.mjs
git commit -m "refactor(config): replace duplicate middleware handlers using createPresetsMiddleware"
```

---

## Task 12: Theme documentation

**Files:**
- Modify: `src/styles/themes/warm-ember.css`
- Modify: `src/styles/themes/deep-space.css`
- Modify: `src/styles/themes/muted-violet.css`
- Modify: `src/styles/themes/monochrome.css`

Add a comment block at the top of each theme listing all CSS variables defined — makes the token contract visible without opening BaseLayout.

- [ ] **Step 1: Add header comment to each theme file**

At the top of each theme file, before the `:root {` block, add:

```css
/*
 * Theme: <theme-name>
 * Tokens: --bg-primary, --bg-surface, --bg-surface-hover, --bg-surface-border,
 *         --bg-nav, --text-primary, --text-body, --text-muted, --text-link,
 *         --text-link-hover, --accent, --accent-glow, --accent-subtle,
 *         --hero-gradient-start, --hero-gradient-end,
 *         --border-radius, --transition-speed
 */
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/themes/
git commit -m "docs(themes): add token contract comment to all theme files"
```

---

## Task 13: Final verification

- [ ] **Step 1: Full smoke test**

```bash
npm run dev
```

Verify each page:
- `http://localhost:4321/gallery/boids` — sim runs, panel opens/closes/drags/resizes, shader editor works, FPS counter works, audio tab works
- `http://localhost:4321/gallery/cppn` — sim runs, panel opens/closes
- `http://localhost:4321/gallery/nca` — sim runs, panel opens/closes
- `http://localhost:4321/admin/boids` — layout correct, tabs switch, shader panel works
- `http://localhost:4321/admin/cppn` — layout correct, tabs switch
- `http://localhost:4321/admin/nca` — layout correct, tabs switch

- [ ] **Step 2: Production build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 3: Final commit and PR**

```bash
git add -A
git commit -m "refactor: complete Track A infrastructure cleanup"
```
