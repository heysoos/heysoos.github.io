# Simulation Card Hover Preview

**Date:** 2026-04-09  
**Status:** Approved

## Context

Gallery cards currently show a gradient placeholder in the preview area. The goal is a still-frame thumbnail that is actually a frozen frame of the live simulation, which resumes seamlessly on mouse hover. When the user mouses off, the sim freezes again at the current frame — so every subsequent hover continues exactly where it left off. Stubs (particle-life, nca, cppn) fall back to the gradient for now but are wired for easy upgrade.

---

## Approach

The "thumbnail" is not a screenshot file — it is the WebGPU canvas frozen after a short warm-up run. A frozen WebGPU canvas retains its last rendered frame, so no `toDataURL()` or separate `<img>` element is needed. The canvas is hidden behind a gradient placeholder until init completes, then fades in as the static thumbnail.

**Lifecycle per card:**

1. Page load → gradient placeholder visible, canvas hidden
2. Card scrolls into view (IntersectionObserver) → init WebGPU, run ~800ms (~48 frames at 60 fps), then pause
3. Canvas fades in over placeholder → frozen frame is the "thumbnail"
4. `mouseenter` → resume rAF loop → live sim
5. `mouseleave` → stop rAF → canvas freezes on last frame
6. Repeat steps 4–5 indefinitely; no re-init, no state loss

---

## Files

### New: `src/components/SimulationPreview.astro`

Props: `simulation: string`

DOM structure inside `.sim-card-preview`:

```html
<div class="preview-wrap" data-preview-sim={simulation}>
  <div class="preview-placeholder" />   <!-- gradient, fades out once ready -->
  <canvas class="preview-canvas" />     <!-- opacity:0 → opacity:1 when ready -->
</div>
```

CSS: both layers are `position:absolute; inset:0`. Canvas has `pointer-events:none` (so the parent `<a>` link still receives clicks). Both canvas and placeholder have `transition: opacity 0.3s ease`.

Inline `<script>`:
- Selects all `[data-preview-sim]` elements on the page
- For each: sets up IntersectionObserver (threshold: 0.1) that fires once
- On intersection: calls `createPreviewController(sim, canvas)` from `preview-registry.ts`
  - If `null` (stub): does nothing — gradient stays
  - If controller: call `resume()`, wait 800ms, call `pause()`, then simultaneously set canvas `opacity:1` and placeholder `opacity:0`
- Attaches `mouseenter`/`mouseleave` to the parent `.sim-card` element
  - `mouseenter`: `controller.resume()` — no opacity change needed (canvas already visible)
  - `mouseleave`: `controller.pause()` — canvas stays visible, frozen on last frame

### New: `src/lib/webgpu/preview-registry.ts`

```ts
interface PreviewController {
  pause(): void
  resume(): void
}

export async function createPreviewController(
  sim: string,
  canvas: HTMLCanvasElement
): Promise<PreviewController | null>
```

Registry:

| Slug | Returns |
|------|---------|
| `'boids'` | `BoidsPreviewController` (see below) |
| `'particle-life'` | `null` |
| `'nca'` | `null` |
| `'cppn'` | `null` |

**Upgrading a stub:** implement `PreviewController` in the sim's controller file, then change `null` → factory call in this registry. The card automatically gets a live preview.

`BoidsPreviewController` (defined in this file):
- Wraps `BoidsController`
- `init(canvas)`: calls `ctrl.init(canvas)`, then sets preview params:
  - `numParticles: 150`, `trailsEnabled: false`, `size: 0.018`
- `pause()` → `ctrl.stop()`
- `resume()` → `ctrl.start()`

### Modified: `src/components/SimulationCard.astro`

- Add `import SimulationPreview from './SimulationPreview.astro'`
- Replace the `{thumbnail ? <img> : <div class="placeholder">}` block with `<SimulationPreview simulation={slug} />`
- Keep `thumbnail?` in the Props interface (no-op — call sites in index pages already pass it; removing it would require touching those files for no gain)
- No changes to the card's link, body, or hover CSS

### Modified: `src/components/simulations/boids/boids-controller.ts`

No changes needed. `BoidsController` already has `start()` / `stop()` which are used as `resume()` / `pause()` by the preview wrapper.

### Unchanged

`pages/index.astro`, `pages/gallery/index.astro`, `gallery/[...slug].astro`, all theme CSS, content markdown files.

---

## Key design decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Thumbnail source | Frozen WebGPU canvas | No `toDataURL()` needed; frozen canvas retains last frame |
| Mouse-out behavior | Freeze (stop rAF, keep buffers) | Instant resume; VRAM cost ~160 KB/sim, negligible |
| Init trigger | IntersectionObserver (scroll into view) | Lazy — no GPU work until card is visible |
| Stub behavior | Gradient placeholder, no canvas | Stubs have no compute shader yet |
| Preview boid count | 150 (down from default 200) | Adequate visual density at card size |
| Canvas pointer events | `pointer-events: none` | Preserves click-through to parent `<a>` link |
| Warm-up duration | 800ms | ~48 frames — enough for boids to spread from random init |

---

## Verification

1. Run `npm run dev`
2. Navigate to home page — gallery teaser should show gradient placeholders initially
3. Scroll down to gallery teaser — cards should animate in (gradient → frozen boids frame)
4. Hover boids card → sim resumes from frozen frame (no jump cut)
5. Move mouse off → sim freezes on current frame
6. Re-hover → resumes from that frozen frame
7. Repeat for gallery page (`/gallery`) — same behavior
8. Verify stubs (particle-life, nca, cppn) show gradient and do not init any WebGPU context
9. Verify clicking any card still navigates to `/gallery/{slug}`
10. Verify no console errors about multiple WebGPU contexts or lost devices
