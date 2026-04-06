# Boids Preset Manager — Design Spec

**Date:** 2026-04-06
**Status:** Approved

## Overview

An admin tool for authoring and persisting named boids presets, plus a user-facing preset switcher in the params panel. Presets capture the full simulation state: params, trails, and shader. The admin tool lives at `/admin/boids` and is excluded from production builds.

---

## Goals

1. Let Sina experiment with boids params + shader and save configurations as named presets
2. Set one preset as the default loaded on page open
3. Expose a preset switcher to visitors inside the existing params panel
4. Design the data layer to be reusable for a future user-submitted gallery

---

## Data Layer

### `src/data/boids-presets.ts`

Single source of truth for all presets. Committed to git. Written by the admin tool.

```ts
import type { BoidsParams } from '../components/simulations/boids/boids-controller';

export interface BoidsPreset {
  id: string;            // slug, e.g. "murmurations" — used as key
  name: string;          // display name shown in UI
  isDefault?: boolean;   // exactly one preset should have this true
  params: BoidsParams;
  trailsEnabled: boolean;
  trailDecay: number;
  shader?: string;       // custom WGSL source; undefined = use default boids.wgsl
}

export const BOIDS_PRESETS: BoidsPreset[] = [
  {
    id: 'default',
    name: 'Default',
    isDefault: true,
    params: { /* copy of DEFAULT_PARAMS from boids-controller.ts */ },
    trailsEnabled: false,
    trailDecay: 0.92,
  },
  // Additional presets added via admin tool
];
```

---

## New Files

### `src/components/simulations/boids/boids-panel.ts`

Extracted from the inline script in `[...slug].astro`. Exports one function:

```ts
export function buildBoidsPanel(
  container: HTMLElement,
  controller: BoidsController,
  opts?: {
    onShaderEdit?: () => void;
    presets?: BoidsPreset[];        // renders switcher when provided
    onPresetLoad?: (p: BoidsPreset) => void;
  }
): void
```

Renders the full params panel DOM (header, appearance, simulation, forces, perception sections). When `presets` is provided, renders a preset switcher at the top before all other sections. The gallery page passes in `BOIDS_PRESETS`; the admin page passes the local in-memory preset list.

### `src/pages/admin/boids.astro`

Dev-only admin page. Excluded from `astro build` via `astro.config.mjs`.

**Layout:** Full-height canvas on the left, 210px sidebar on the right.

**Sidebar tabs:**

- **Params** — calls `buildBoidsPanel()` (same as gallery, no preset switcher)
- **Presets** — preset management UI (see below)
- **Shader** — CodeMirror WGSL editor, Apply / Reset buttons

**Presets tab:**

- List of saved presets, each row showing: name | ★ (set default) | ✕ (delete)
- Active preset highlighted with accent border
- Name input + Save button — captures current `params`, `trailsEnabled`, `trailDecay`, and current shader source from the editor
- Clicking a preset row loads it into the controller and updates the shader editor
- "Write to disk" button — POSTs all in-memory presets to the Vite dev middleware, which writes `src/data/boids-presets.ts`; Astro hot-reloads automatically

**In-memory model:** All edits (save, delete, ★) update local state only. Nothing is persisted until "Write to disk" is pressed. This allows batch experimentation before committing.

---

## Modified Files

### `src/pages/gallery/[...slug].astro`

- Import `BOIDS_PRESETS` from `src/data/boids-presets.ts`
- Replace the inline boids panel builder (~200 lines) with a call to `buildBoidsPanel(panel, boidsCtrl, { presets: BOIDS_PRESETS, onShaderEdit: ... })`
- On init: find the preset with `isDefault: true`, apply its `params`, `trailsEnabled`, `trailDecay`, and call `reloadShader(preset.shader)` if it has a custom shader — before `controller.start()`

### `astro.config.mjs`

Two additions:

1. **Vite `configureServer` middleware** — handles `POST /api/admin/save-presets`. Receives `BoidsPreset[]` as JSON, generates and writes `src/data/boids-presets.ts`. Runs only during dev by nature of `configureServer`.

2. **Build exclusion** — exclude `src/pages/admin/**` from the static build so the admin page is never deployed.

---

## User-Facing Preset Switcher

Located at the top of the params panel, above all sections. Rendered by `buildBoidsPanel()` when `presets` is provided.

**Appearance:** Horizontally wrapping pill buttons. Active preset uses accent background (`--accent` + dark text). Inactive presets use a subtle border.

**Behaviour:** Clicking a pill immediately applies all preset fields to the controller. If the preset has a custom `shader`, calls `controller.reloadShader(preset.shader)`. If `shader` is undefined, reloads the default `boids.wgsl` source.

---

## Dev-Only Exclusion Strategy

- `src/pages/admin/boids.astro` checks `import.meta.env.PROD` in its frontmatter and returns a 404 response in production builds. The page is inert in prod — it has no sensitive data, it just won't function without the dev middleware.
- The Vite `configureServer` hook only runs during `npm run dev` — it is never invoked during build or in the deployed site.
- The file-write endpoint therefore has zero production surface area.

---

## Extensibility Notes

- `BoidsPreset` is a standalone exported type — future user-submitted presets share the same shape
- `buildBoidsPanel()` hides the switcher when `presets` is omitted or empty — safe for embedded use
- The Vite middleware is scoped to one endpoint; extending to other simulations means adding parallel endpoints and data files following the same pattern

---

## Out of Scope

- User authentication on the admin page (it's localhost-only, not deployed)
- User-submitted preset gallery (future work — same `BoidsPreset` type, different storage)
- Preset ordering / drag-to-reorder (array order in the file is the display order; reorder by editing)
