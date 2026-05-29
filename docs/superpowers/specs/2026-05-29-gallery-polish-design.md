# Gallery Polish — Design Spec
**Date:** 2026-05-29

## Overview

Three independent improvements to the gallery simulation pages:

1. **Particle Life under-construction placeholder** — replace the blank WebGPU canvas with a styled CSS drift animation while the simulation is incomplete.
2. **Panel open by default** — the floating params panel opens immediately on page load (instead of requiring a ⚙ click), while still persisting close state within the browser session.
3. **Updated descriptions** — rewrite all four project `.md` files with a concise description paragraph + blockquote-styled usage callout block.

---

## 1. Particle Life Placeholder

### Problem
`/gallery/particle-life` renders a black empty canvas. The `ParticleLifeController` exists but has no panel and the visual output is minimal. It should be clearly marked as in-development rather than appearing broken.

### Approach
Add an optional `underConstruction: true` flag to the projects content collection schema. When set, `[...slug].astro` skips the canvas and WebGPU init entirely and renders a CSS drift overlay instead.

### Placeholder design
- Full-viewport `div` with `background: radial-gradient(ellipse, #1a1008, #0a0804)`
- ~28 absolutely-positioned `div` dots, each with randomised size (2–6 px), colour (from the tag colour palette), position, drift direction, and animation duration (5–13 s). The `drift` keyframe uses CSS custom properties `--tx`/`--ty` for per-dot translation. All driven by a ~20-line inline `<script>`.
- Centred text block: `"IN DEVELOPMENT"` in uppercase tracking + amber rule + `"Particle Life"` subtitle.
- Controls bar still renders, but the ⚙ button is visually dimmed (`opacity: 0.35`, `pointer-events: none`) since there is no panel.
- FPS display is conditionally hidden: the `#fps-display` element is not rendered when `underConstruction` is true (controlled via an Astro conditional in `[...slug].astro`, not CSS).

### Content collection schema change
In `src/content/config.ts`, add to the projects schema:
```ts
underConstruction: z.boolean().optional(),
```

### Files changed
| File | Change |
|---|---|
| `src/content/config.ts` | Add `underConstruction` optional boolean to projects schema |
| `src/content/projects/particle-life.md` | Add `underConstruction: true` to frontmatter |
| `src/pages/gallery/[...slug].astro` | Conditional render: drift overlay when `underConstruction`, skip canvas/controller init |

---

## 2. Panel Open by Default

### Problem
The params panel starts hidden (`style="display:none;"`) and requires the user to discover and click ⚙ to open it. Most users will never find it on first visit.

### Approach
After `setupSim()` resolves with `hasPanel = true`, set `panel.style.display = "flex"` to open immediately. Also persist the open/closed state in `sessionStorage` so that if the user explicitly closes the panel, it stays closed on the next page refresh (within the same browser session).

The open/closed state key is `${sim}-panel-open` in `sessionStorage`. On page load:
- If no saved state → open (default)
- If saved state is `"false"` → closed

When the ⚙ button is toggled, write the new open state to `sessionStorage`.

### Files changed
| File | Change |
|---|---|
| `src/pages/gallery/[...slug].astro` | After `setupSim`, open panel by default + read/write `sessionStorage` for open/closed state |

No changes to `PanelManager` — it already handles position/size persistence separately.

---

## 3. Updated Descriptions

### Format
Each `.md` file has:
1. A concise prose paragraph describing the system (1–2 sentences max — what it is, what it produces).
2. A markdown blockquote (`>`) containing bold `**Controls**` heading + a bullet list of usage instructions.

The blockquote renders via a new CSS rule in `[...slug].astro` (scoped as `:global` on `.prose`):
- `border-left: 2px solid var(--accent)`
- Amber-bordered panel style matching the design mockup
- List bullets replaced with `›` via `::before`

### New content

**Boids**
```
Craig Reynolds' flocking model — complex collective motion from three simple local rules applied to each agent: separation, alignment, and cohesion.

> **Controls**
> - Open ⚙ to tune force weights, perception radius, and max speed
> - Preset drawer — save and recall named configurations
> - Shader editor — hot-swap the WGSL render shader at runtime
> - Audio tab — bind microphone amplitude to any force parameter
```

**Particle Life** (underConstruction: true)
```
Multiple species of particles interact through attraction and repulsion forces defined by a species matrix, producing emergent self-organizing structures — clusters, rings, oscillators, and chains.

> **Controls**
> - Panel coming in a future update
```

**Neural Cellular Automata**
```
Each cell updates its state by applying a small neural network to its local neighborhood, producing emergent texture and pattern dynamics from a randomly initialized grid.

> **Controls**
> - Load a preset or click Random Init to start from scratch
> - Architecture — adjust channels, hidden size, filters, and activation
> - Runtime — tune fire rate, steps per frame, and dt
> - Brush — paint or damage the grid with configurable radius and strength
```

**CPPN Art**
```
A compositional pattern-producing network takes spatial coordinates as input and outputs color values, generating infinitely scalable abstract patterns by composing periodic activation functions.

> **Controls**
> - Arch tab — redesign the layer stack, widths, activations, and coordinate scale
> - Weights tab — randomize with normal, uniform, glorot, or sparse distributions
> - Z tab — control animation frequency bands and phase per band
```

### Files changed
| File | Change |
|---|---|
| `src/content/projects/boids.md` | Rewrite body |
| `src/content/projects/particle-life.md` | Rewrite body |
| `src/content/projects/nca.md` | Rewrite body |
| `src/content/projects/cppn.md` | Rewrite body |
| `src/pages/gallery/[...slug].astro` | Add blockquote CSS rule inside `.prose` |

---

## Summary of all files touched

| File | Reason |
|---|---|
| `src/content/config.ts` | `underConstruction` schema field |
| `src/content/projects/particle-life.md` | Frontmatter flag + new body |
| `src/content/projects/boids.md` | New body |
| `src/content/projects/nca.md` | New body |
| `src/content/projects/cppn.md` | New body |
| `src/pages/gallery/[...slug].astro` | Placeholder conditional, panel default-open logic, blockquote CSS |

No new files. No changes to controllers, panel builders, or `PanelManager`.
