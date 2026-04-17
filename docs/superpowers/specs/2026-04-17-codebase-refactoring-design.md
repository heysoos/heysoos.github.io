# Codebase Refactoring Design

**Date:** 2026-04-17
**Status:** Approved

## Context

The codebase has grown organically around the boids simulation and gallery infrastructure. Several files have accumulated far more responsibilities than they should: `gallery/[...slug].astro` is 1,100 lines managing layout, drag/resize, FPS counting, shader editing, and three simulation setups. `boids-panel.ts` is 1,881 lines mixing tab management, audio visualization, ring-buffer canvas drawing (duplicated four times), drawer state, and slider logic. Admin pages share boilerplate HTML and CSS with no shared layout. `astro.config.mjs` has three near-identical middleware handlers and preset generators.

**Goal:** Clean up shared infrastructure to unblock building new simulations (NCA, CPPN, particle-life), then fully decompose the boids simulation files for maintainability.

**Sequencing:** Track A (infrastructure) first, Track B (boids internals) second. The tracks are largely independent and Track A unblocks new simulations faster.

---

## Track A — Shared Infrastructure

### A1. Gallery Page Decomposition

**File:** `src/pages/gallery/[...slug].astro` (1,100 lines → ~200 lines)

Extract four TypeScript modules under `src/lib/sim-page/`:

| Module | Responsibility | Est. Lines |
|--------|---------------|------------|
| `panel-manager.ts` | Floating params panel drag/resize, sessionStorage persistence | ~150 |
| `shader-editor.ts` | CodeMirror setup, error display, hot-reload wiring | ~100 |
| `fps-counter.ts` | FPS measurement + DOM update loop | ~50 |
| `sim-setup/boids.ts` | Boids-specific setup: preset loading, panel building, audio wiring | ~120 |
| `sim-setup/cppn.ts` | CPPN-specific setup | ~60 |
| `sim-setup/nca.ts` | NCA-specific setup | ~60 |
| `sim-setup/index.ts` | `SimSetup` interface + router (`setupSim(type, ctrl, container)`) | ~30 |

The `.astro` file becomes a thin orchestrator: resolve slug, get canvas, call `setupSim()`.

**SimSetup interface:**
```typescript
interface SimSetup {
  buildPanel(container: HTMLElement, ctrl: SimController): () => void; // returns teardown
  onPresetChange?(preset: unknown): void;
}
```

### A2. Admin Pages → Shared Layout

**Files:** `src/pages/admin/boids.astro`, `admin/cppn.astro`, `admin/nca.astro`

Extract `src/layouts/AdminLayout.astro` containing:
- Shared HTML structure: `.admin-wrap`, `.admin-canvas-area`, `<canvas id="admin-canvas">`, `.admin-fallback`, `.sim-controls`, `.admin-sidebar`, `.tab-bar`, `.tab-pane`
- All shared admin CSS
- Props: `simName: string`, `tabs: string[]` (e.g. `['params', 'presets']`)

Each admin page becomes a `<AdminLayout>` consumer with only its sim-specific `<script>` block.

### A3. `astro.config.mjs` Cleanup

**File:** `astro.config.mjs` (~265 lines → ~100 lines in config)

Extract to `src/lib/admin/presets.ts`:

- `createPresetsMiddleware(route: string, generator: (data: unknown) => string)` — generic factory returning a Vite `Connect.NextHandleFunction` for the three POST middleware handlers, eliminating duplicated try/catch + JSON parse + file write
- `generateWeightsPresetsFile(simName: string, weights: unknown[]): string` — shared generator for CPPN and NCA (currently two identical functions)
- Keep `generateBoidsPresetsFile()` separate (shader files differ enough)

### A4. Theme System

Minor documentation cleanup only. Add a comment block at the top of each theme file listing all CSS variable names defined. No runtime switching, no data-driven generation.

---

## Track B — Boids Decomposition

### B1. `boids-panel.ts` Split

**Current:** `src/components/simulations/boids/boids-panel.ts` (1,881 lines)

**New structure:**
```
src/components/simulations/boids/panel/
  index.ts                 # re-exports buildBoidsPanel (public API unchanged)
  boids-panel.ts           # thin orchestrator: tab bar, preset pills, coordinator (~200 lines)
  audio-tab.ts             # AudioTab class: spectrum, matrix, drawers (~700 lines)
  ring-buffer-canvas.ts    # RingBufferCanvas: push/draw/resize, used by audio-tab (~100 lines)
  drawer-controller.ts     # DrawerController: openParam/drawerRow/disconnect state (~150 lines)
  range-slider.ts          # RangeSliderController: sliderToValue, valueToSlider, listeners (~100 lines)
  panel-styles.ts          # STYLES constants: padding, fontSize, colors
  resize-observer-pool.ts  # ResizeObserverPool: observe/disconnectAll utility
```

**RingBufferCanvas interface:**
```typescript
class RingBufferCanvas {
  constructor(canvas: HTMLCanvasElement, opts: { lineColor: string; interpolate?: boolean })
  push(value: number): void
  clear(): void
  draw(): void
  onResize(width: number, height: number): void
}
```

**Key consolidation:** The four separate ring-buffer canvas patterns (`makeMatrixTrace`, `makeTraceCanvas`, `makeBandTrace`, stacked trace in `buildTotalTab`) all become `RingBufferCanvas` instances.

**ResizeObserver management:** Replace the manual `disconnects` array with a lightweight `ResizeObserverPool` (observe/disconnect all) extracted to its own `resize-observer-pool.ts` utility file under `panel/`.

### B2. `boids-controller.ts` Targeted Cleanup

**File:** `src/components/simulations/boids/boids-controller.ts` (697 lines)

No file split — the controller is cohesive enough. Targeted changes:

1. **Break up `tick()`** (172 lines) into private methods:
   - `_preFrameSetup()` — resize check, webcam update, uniform packing
   - `_runComputePasses(encoder)` — all 6 compute dispatch calls
   - `_renderFrame(encoder)` — particle render + trail blit + image overlay
   - `_scheduleNextFrame()` — RAF scheduling + FPS capping

2. **Extract `_buildPingPongBindGroups(layout, ...buffers)`** — eliminates three near-identical bind group construction blocks (lines ~228–254, ~301–328, ~662–689)

3. **Extract `_packUniforms()`** — isolates the 34-line DataView block, making the uniform layout documentable and the method independently readable

4. **Snapshot-based pipeline rollback** — replace the fragile 4-property manual restore in `reloadShader()` with `const snapshot = { ...this._pipelines }` / restore atomically on failure

### B3. `boids-audio.ts` Light Refactor

**File:** `src/components/simulations/boids/boids-audio.ts` (378 lines)

Split `AudioReactor` into three focused classes (can remain in the same file if total stays under ~400 lines, or split into separate files):

- `AudioSource` — mic/system audio lifecycle, stream management
- `FrequencyAnalyzer` — FFT setup, band extraction, bin range caching on construction
- `MappingStore` — mapping persistence, getter/setter interface

`AudioReactor` becomes a thin coordinator of the three.

---

## New File Tree (additions only)

```
src/
  lib/
    sim-page/
      panel-manager.ts
      shader-editor.ts
      fps-counter.ts
      sim-setup/
        index.ts
        boids.ts
        cppn.ts
        nca.ts
    admin/
      presets.ts
  layouts/
    AdminLayout.astro        # new
  components/simulations/boids/
    panel/
      index.ts
      boids-panel.ts
      audio-tab.ts
      ring-buffer-canvas.ts
      drawer-controller.ts
      range-slider.ts
      panel-styles.ts
      resize-observer-pool.ts
```

---

## What This Enables

- **New simulations** (NCA, CPPN, particle-life) add a `sim-setup/<name>.ts`, a `buildPanel()` function, and a new `AdminLayout` consumer — no touching the gallery page or `astro.config.mjs` for the shared skeleton
- **Audio tab extensions** (XY pad forces, video recorder) target `audio-tab.ts` in isolation
- **Panel component reuse** — `RingBufferCanvas`, `RangeSliderController` usable in future sim panels without copy-paste

---

## Post-Refactor: Update CLAUDE.md

After both tracks are complete, invoke the `claude-md-management:revise-claude-md` skill to update `CLAUDE.md` with the new file structure. The Architecture and Simulations sections will need to reflect:
- The new `src/lib/sim-page/` and `src/lib/admin/` modules
- The `boids/panel/` subdirectory replacing the flat `boids-panel.ts`
- `AdminLayout.astro` alongside `BaseLayout.astro` and `SimLayout.astro`

---

## Verification

After Track A:
- All three admin pages render correctly in `npm run dev`
- Gallery page loads Boids, CPPN, and NCA simulations with panels functioning
- Preset save endpoints work (`/api/admin/save-boids-presets`, etc.)
- `npm run build` succeeds (no SSR import leaks)

After Track B:
- Boids simulation runs at full fidelity (audio tab, image tab, XY pad all functional)
- Panel drag/resize and preset switching work
- Shader hot-reload (`reloadShader()`) works
- No console errors on panel teardown / navigation away
