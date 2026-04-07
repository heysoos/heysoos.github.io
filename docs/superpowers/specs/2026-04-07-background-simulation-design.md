# Background Simulation Design

**Date:** 2026-04-07
**Status:** Approved

## Overview

A WebGPU simulation runs as a full-viewport fixed background on opt-in pages. Content elements (nav, sections, footer) act as obstacle zones that generate smooth repulsion fields — boids steer away from them, creating low-density voids beneath text. The site feels "lived-in": the simulation is aware of and responds to the page layout.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Interaction model | Density void (soft repulsion) | Organic, gradient-like — particles cluster around content edges, sparse beneath text |
| Canvas placement | `position: fixed; inset: 0` | Sim stays put as user scrolls; content passes over it. Simpler than full-page canvas. |
| Scope | Opt-in per page via BaseLayout prop | Only 1–2 pages need this; sitewide would be too heavy |
| Obstacle detection | CSS selector auto-detect | No markup changes; queries `nav, footer, .section, .content-width` |
| Obstacle→GPU | Rect uniform buffer (max 16) | Cheaper than texture upload; 256 bytes per frame write; fits easily in uniform limit |
| Hero canvas | Replaced by background sim | One GPU context covers both hero and below-fold sections |
| Force falloff | Smooth (C¹ continuous) | **First-class requirement.** No sharp boundaries. Use `smoothstep` or equivalent. |

## Architecture

### Layer Stack

```
z-index: 1+   nav, sections, footer         (position: relative)
z-index: 0    <canvas> position:fixed        ← background sim
z-index: -1   document background (--bg-primary)
```

The canvas has `pointer-events: none` so it never captures mouse events intended for content.

### Data Flow (per scroll event)

```
DOM elements (nav, .section, footer)
  → getBoundingClientRect()
  → ObstacleTracker: convert to NDC [cx, cy, hw, hh]
  → controller.setObstacles(rects: Float32Array, count: number)
  → device.queue.writeBuffer(obstacleUniformBuffer)
  → WGSL compute shader: per-particle repulsion
```

Updates are throttled to one per `requestAnimationFrame` — triggered by `scroll` and `resize` events, not every frame.

### New Files

| File | Purpose |
|------|---------|
| `src/components/BackgroundSim.astro` | Fixed canvas, controller bootstrap, ObstacleTracker wiring |
| `src/lib/webgpu/obstacle-tracker.ts` | IntersectionObserver, rect tracking, NDC conversion, `setObstacles` callback |

### Modified Files

| File | Change |
|------|--------|
| `src/config.ts` | Add `enableBackgroundSim: boolean` flag — master kill switch for all pages |
| `src/layouts/BaseLayout.astro` | Add `backgroundSim?: 'boids'` prop; render `<BackgroundSim>` when set |
| `src/pages/index.astro` | Conditionally pass `backgroundSim` prop and render hero canvas based on `siteConfig.enableBackgroundSim` |
| `src/components/simulations/boids/boids-controller.ts` | Add `setObstacles(rects, count)`, write obstacle uniform buffer |
| `src/components/simulations/boids/boids.wgsl` | Add `Obstacles` uniform binding; apply smooth repulsion in compute shader |

## Component Interface

### BaseLayout.astro

```astro
interface Props {
  title?: string;
  description?: string;
  backgroundSim?: 'boids';  // extensible: add 'particle-life' | 'nca' later
}
```

When `backgroundSim` is set, `<BackgroundSim sim={backgroundSim} />` is rendered before the page slot, outside `<main>`.

### BackgroundSim.astro

```astro
interface Props {
  sim: 'boids';
}
```

Renders a `<canvas id="bg-sim-canvas">` and a `<script>` that:
1. Initialises the appropriate controller
2. Calls `controller.init(canvas)`
3. Creates an `ObstacleTracker` and wires `controller.setObstacles` as its callback
4. Calls `controller.start()`

### ObstacleTracker

```typescript
class ObstacleTracker {
  constructor(
    selectors: string[],
    onUpdate: (rects: Float32Array, count: number) => void
  )
  start(): void   // begin observing
  stop(): void    // disconnect observers, remove listeners
}
```

**Selectors (default):** `['nav', 'footer', '.section', '.content-width']`

**NDC conversion:**
```
cx = (rect.left + rect.right)  / window.innerWidth  - 1.0
cy = 1.0 - (rect.top + rect.bottom) / window.innerHeight
hw = rect.width  / window.innerWidth
hh = rect.height / window.innerHeight
```

**Update strategy:**
- `IntersectionObserver` tracks which elements are currently in-viewport
- `scroll` and `resize` events set a dirty flag
- The dirty flag is consumed once per rAF — only visible elements' rects are recomputed

### Shared Controller Contract

Every sim that supports background mode must implement:

```typescript
setObstacles(rects: Float32Array, count: number): void
// rects: flat [cx, cy, hw, hh, cx, cy, hw, hh, ...] in NDC, length = count * 4
// count: number of active obstacles (0–16)
// Called on scroll/resize. Writes to GPU buffer via device.queue.writeBuffer.
```

## GPU: Obstacle Uniform

```wgsl
struct Obstacles {
  rects: array<vec4f, 16>,  // x=cx, y=cy, z=hw, w=hh in NDC
  count: u32,
  _pad: vec3u,
}

@group(0) @binding(3) var<uniform> obstacles: Obstacles;
```

## GPU: Smooth Repulsion (Boids)

The **smoothness of obstacle force fields is a first-class design requirement.** Force magnitude must be C¹ continuous — zero at the falloff boundary, maximum at the rect edge, no discontinuities anywhere.

```wgsl
fn obstacleForce(pos: vec2f) -> vec2f {
  var force = vec2f(0.0);
  let falloffRadius = 0.18;  // NDC units, tunable

  for (var i = 0u; i < obstacles.count; i++) {
    let r = obstacles.rects[i];
    let center = r.xy;
    let half   = r.zw;

    // Signed distance to rect edge (negative = inside rect)
    let d = abs(pos - center) - half;
    let dist = length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);

    if (dist < falloffRadius) {
      // smoothstep: 1.0 at dist=0, 0.0 at dist=falloffRadius, smooth derivatives at both ends
      let t = smoothstep(falloffRadius, 0.0, dist);
      let strength = t * t;  // square for softer onset, steeper near edge

      // Repulsion direction: away from nearest rect surface
      let awayDir = normalize(pos - clamp(pos, center - half, center + half));
      force += awayDir * strength * 2.0;  // scale tunable
    }
  }
  return force;
}
```

This force is added to the boid's velocity update in the compute shader each step.

## Background Sim Defaults

The background sim is ambient, not dominant. Boids defaults are reduced from the hero:

| Parameter | Hero default | Background default |
|-----------|-------------|-------------------|
| `numParticles` | 200 | 120 |
| `trailsEnabled` | user-controlled | false |
| `size` | 0.02 | 0.016 |
| `maxSpeed` | 0.22 | 0.18 |

These are set in `BackgroundSim.astro` when constructing the controller, not in the controller's own defaults.

## Future Sim Types

When `particle-life` or `nca` are added as background options:
- Their controllers implement `setObstacles(rects, count)`
- NCAs zero out (set cell state to 0) for cells within obstacle rects using the same `smoothstep` falloff — cell value multiplied by `1.0 - t²` where `t = smoothstep(falloffRadius, 0.0, dist)`
- The `BackgroundSim.astro` switch statement dispatches to the correct controller by the `sim` prop value
- No changes needed to `ObstacleTracker` or `BaseLayout`

## Reversibility

The feature has two levels of reversibility:

**Per-page opt-in:** Pages that do not pass `backgroundSim` to BaseLayout have zero overhead — no canvas, no WebGPU init, no ObstacleTracker, no listeners. Regular pages are completely unaffected.

**Master kill switch:** `siteConfig.enableBackgroundSim` in `src/config.ts` disables the feature across all pages at once:

```ts
// src/config.ts
export const siteConfig = {
  // ...existing fields...
  enableBackgroundSim: true,  // set false to disable sitewide
};
```

Pages that opt in read this flag:

```astro
---
import { siteConfig } from '../config';
---
<BaseLayout backgroundSim={siteConfig.enableBackgroundSim ? 'boids' : undefined}>
  <section class="hero">
    {!siteConfig.enableBackgroundSim && (
      <div class="hero-sim">
        <canvas id="boids-canvas"></canvas>
        <div id="boids-fallback" class="fallback" style="display:none;"></div>
      </div>
    )}
    <div class="hero-content">...</div>
  </section>
</BaseLayout>

{!siteConfig.enableBackgroundSim && <script>/* original hero BoidsController */</script>}
```

The hero canvas markup is **preserved, not deleted**. When `enableBackgroundSim = false`:
- `backgroundSim` prop is `undefined` → `BackgroundSim` not rendered → no fixed canvas
- Hero canvas and its script activate → original behaviour exactly

When `enableBackgroundSim = true`:
- `BackgroundSim` renders the fixed canvas
- Hero canvas suppressed (prevents a redundant GPU context)

## Legibility

Content sections retain their existing `--bg-primary` background color. No additional backdrop treatment is needed — the density void ensures boids are naturally sparse beneath text. The smooth falloff creates a visible "aura" of particle activity around content edges without particles crowding the text itself.

## Canvas CSS

```css
#bg-sim-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}
```

Page content wrapper (already in BaseLayout `<main>`):

```css
main {
  position: relative;
  z-index: 1;
}
```

The `<Nav>` component will also need `position: relative; z-index: 1` if not already set.
