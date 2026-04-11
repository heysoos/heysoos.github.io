# Image Force Field — Design Spec

**Date:** 2026-04-11
**Feature:** Image-based attraction/repulsion forces for the Boids simulation
**Scope:** Reusable image editor library + boids-specific force adapter

---

## Overview

Users can upload an image into the boids simulation. The image is processed on the GPU into a force field texture. Boids sample that texture each frame and accumulate an additional force vector — attracting toward, repelling from, or flowing along image features. A brush editor lets users erase and blur regions of the image live while boids continue running. All image processing happens on the GPU; no CPU round-trips after the initial upload.

---

## Module Architecture

### Reusable library: `src/lib/webgpu/image-editor/`

Self-contained; no dependency on any simulation. Any simulation imports what it needs.

| File | Responsibility |
|------|---------------|
| `image-editor-types.ts` | Shared interfaces: `ImageTransform`, `ProcessingMode`, `BrushMode`, `BrushOptions`, `ImageEditorState` |
| `image-uploader.ts` | File `→` `GPUTexture` (sourceTexture). Accepts PNG/JPG/SVG via `<input type=file>` or drag-and-drop. Decodes via `createImageBitmap`, uploads with `device.queue.copyExternalImageToTexture`. Optional — editor works without it. |
| `image-processor.ts` | Owns the GPU texture stack and processing pipeline. Exposes `setTransform()`, `setMode()`, `setProcessingParams()`, `triggerReprocess()`, `getOutputTexture(): GPUTexture`. |
| `image-brush.ts` | Brush render passes. **Paint** and **Erase paint** write to `paintCanvasTexture`; **Mask image** writes to `imageMaskTexture`. All modes accept size + softness. Triggers reprocess after each stroke. |
| `image-editor-overlay.ts` | Full-screen overlay UI. Left sidebar (brush mode selector, size/softness sliders, fit presets, processing mode pills, transform sliders, Reset Paint / Clear Image buttons). Right area: interactive editing canvas with drag-to-move, 8 resize handles, force field overlay toggle, brush cursor, coordinate readout. Boids continue running behind dimmed overlay. |
| `image-panel-section.ts` | Compact panel widget: live thumbnail of `processedTexture`. When image loaded: force mode pills, strength slider, invert toggle, enable toggle, "Open Editor", "Clear Image". When no image: "Paint Force Field" button opens editor to blank canvas. Always shows "Reset Paint" if `paintCanvasTexture` is non-empty. |

**Public interface of `ImageProcessor`:**
```ts
class ImageProcessor {
  init(device: GPUDevice): void
  loadImage(bitmap: ImageBitmap): void
  setTransform(t: ImageTransform): void     // triggers reprocess
  setMode(mode: ProcessingMode): void       // triggers reprocess
  setBlurRadius(r: number): void            // triggers reprocess
  setThreshold(v: number): void             // triggers reprocess
  setInvert(v: boolean): void               // triggers reprocess
  brushStroke(x: number, y: number, opts: BrushOptions): void  // immediate GPU pass
  getOutputTexture(): GPUTexture
  getOutputSampler(): GPUSampler
  destroy(): void
}
```

Future extension points (not in scope now): `getLuminanceTexture()`, `getPaintMaskTexture()` — the textures already exist internally.

### Boids adapter: `src/components/simulations/boids/boids-image-force.ts`

Thin adapter that connects `ImageProcessor` output to the boids compute pipeline.

```ts
class BoidsImageForce {
  init(device: GPUDevice, processor: ImageProcessor): void
  buildBindGroupEntries(): GPUBindGroupEntry[]   // entries for bindings 7, 8
  getExtraParams(): { imageStrength: number, imageForceMode: number, imageInvert: number }
  setStrength(v: number): void
  setForceMode(m: ImageForceMode): void          // Attract | Repel | GradientFlow | GradientAttract | Threshold | SDF
  setInvert(v: boolean): void
  setEnabled(v: boolean): void                   // toggle — does not unload the image
  isActive(): boolean                            // true only if image loaded AND enabled
  destroy(): void
}
```

`BoidsController` calls `buildBindGroupEntries()` when constructing `boidsBindGroups` and includes the extra params in the uniform buffer.

**Toggle behavior and GPU cost:**

| State | `imageStrength` in uniform | Shader behavior | GPU cost |
|-------|---------------------------|-----------------|----------|
| No image loaded | 0.0 | Early-exit at `if (imageStrength > 0.0)` | Zero — uniform branch, entire workgroup skips |
| Image loaded, enabled=false | 0.0 | Same early-exit | Zero — same uniform branch |
| Image loaded, enabled=true | user value > 0 | Full force sampling | Normal |

Because `imageStrength` is a uniform (not per-thread), the `if` branch is a **uniform branch** — the GPU executes it as a predicate across the whole workgroup, not divergent per-lane. Toggling off costs nothing beyond writing one float to the uniform buffer.

When `enabled=false`, the image stays in VRAM and bindings 7 & 8 remain pointing to `processedTexture`. Re-enabling is instant — no re-upload, no bind group rebuild. Only loading or swapping an image triggers a bind group rebuild.

When no image has ever been loaded, bindings 7 & 8 point to a 1×1 zero texture to satisfy the bind group layout with no null-binding errors.

---

## GPU Texture Stack

All textures are `rgba8unorm`, sized to the canvas resolution and updated when the canvas resizes.

| Texture | Initial value | Updated when |
|---------|--------------|-------------|
| `sourceTexture` | zeros (1×1 dummy until image loaded) | Image loaded |
| `imageMaskTexture` | all-ones (full opacity) | "Mask image" brush stroke |
| `paintCanvasTexture` | zeros | "Paint" / "Erase paint" / "Blur" brush stroke |
| `compositedTexture` | — | Reprocess triggered |
| `processedTexture` | — | Reprocess triggered (final output) |

**Three-layer composite** (Pass 1):
```
compositedTexture = (sourceTexture × imageMaskTexture) + paintCanvasTexture
```

- **No image loaded:** `sourceTexture` is zeros → `output = paintCanvasTexture`. Users paint force fields directly from scratch.
- **Image only:** `output = sourceTexture × imageMaskTexture`. Same as before.
- **Image + paint:** both layers contribute additively.

The composite pass also applies `ImageTransform` to `sourceTexture` (placing it in canvas space). `paintCanvasTexture` is always in canvas space — brush strokes map directly to canvas pixels. Downstream passes (blur, mode) operate on `compositedTexture` in canvas space. The boids shader samples at `uv = pos * 0.5 + 0.5` with no transform logic.

---

## Processing Pipeline (GPU compute passes, run on demand)

```
sourceTexture + imageMaskTexture + paintCanvasTexture
        │
        ▼
[Pass 1] Composite + Transform
   — applies ImageTransform to sourceTexture (offset, scale → canvas space)
   — output = (sourceTexture × imageMaskTexture) + paintCanvasTexture
   — writes to compositedTexture
        │
        ▼
[Pass 2] Optional Gaussian Blur (2-pass separable, ping-pong)
   — tunable radius; skipped if radius = 0
        │
        ▼
[Pass 3] Mode pass (one of):
   — Luminance        → grayscale intensity → scalar field
   — Gradient (Sobel) → 3×3 Sobel → gradient direction + magnitude
   — Threshold        → hard cutoff at user-set value
   — Invert           → 1 − luminance
   — SDF              → iterative jump-flood algorithm → signed distance from edges
        │
        ▼
processedTexture  ──→  boids shader (binding 7)
```

Reprocess is triggered by any param change (mode, blur radius, threshold value, invert toggle, transform update, brush stroke). Since it's a few compute dispatches with no CPU readback, it completes within the same frame.

---

## Image Transform

`ImageTransform = { offsetX: number, offsetY: number, scaleX: number, scaleY: number }` in canvas-pixel units.

**Fit presets** (compute scaleX/Y, center the image):

| Preset | Logic |
|--------|-------|
| Fill | Cover full canvas, crop overflow |
| Contain | Entire image visible, letterbox/pillarbox |
| Fit Width | Image width = canvas width |
| Fit Height | Image height = canvas height |
| Original 1:1 | Pixel-exact, centered |

**Interactive controls in the editor overlay:**
- Drag image body → update offsetX/offsetY → immediate reprocess
- Drag any of 8 resize handles (corners + edge midpoints) → update scaleX/scaleY → immediate reprocess
- Transform sliders (X offset, Y offset, Scale) as numeric alternatives to drag

---

## Force Derivation Modes

Six modes selectable at runtime from the editor panel, plus an **Invert** boolean modifier:

| Mode | GPU derivation | Boid behavior |
|------|---------------|---------------|
| **Luminance → Attract** | `force = normalize(grad(lum)) * lum * strength` | Pool in bright regions |
| **Luminance → Repel** | Same, negated | Avoid bright regions |
| **Gradient (edge flow)** | Sobel → tangent direction | Flow along contours |
| **Gradient (edge attract)** | Sobel → normal toward edge | Concentrate at edges |
| **Threshold** | Hard 0/1 mask, force at boundary | Stay inside/outside a shape |
| **SDF** | Jump-flood SDF → falloff from edge | Orbit shape at tunable distance |

**Invert** is a post-mode modifier (boolean uniform flag), not a standalone mode. When enabled, the force direction is negated after the mode pass — e.g. Luminance Attract becomes Luminance Repel, SDF orbit inverts. This lets all six modes be inverted without doubling the mode list.

Force sampling in `boids.wgsl`:
```wgsl
if (params.imageStrength > 0.0) {
  let uv = pos * 0.5 + vec2f(0.5);
  let sample = textureSample(imageTexture, imageSampler, uv);
  let imgForce = decodeForce(sample, params.imageForceMode) * params.imageStrength;
  vel += imgForce * params.deltaTime;
}
```

`decodeForce` interprets the rgba channels based on `imageForceMode`. The output texture encodes:
- **rg** = force direction (xy, remapped from [0,1] to [−1,1])
- **b** = force magnitude
- **a** = mask (0 = outside image, no force)

---

## New Boids Shader Bindings

`boidsBindGroupLayout` gains two entries:

| Binding | Resource | Type |
|---------|----------|------|
| 7 | `processedTexture` | `texture_2d<f32>` |
| 8 | `imageSampler` | `sampler` (linear, clamp-to-edge) |

`BoidsParams` uniform gains three fields, expanding the buffer from 96 → 108 bytes:

```wgsl
imageStrength:   f32,  // byte 96 — 0.0 = feature disabled
imageForceMode:  u32,  // byte 100 — 0–5 matching ProcessingMode enum
imageInvert:     u32,  // byte 104 — 0 or 1, negates force direction
// byte 108: end (uniform buffer resized from 96 to 108 bytes)
```

`boids-controller.ts` `createUniformBuffer(device, 96)` becomes `createUniformBuffer(device, 112)` (next multiple of 16 for alignment). The DataView writes in `tick()` gain three new `setFloat32`/`setUint32` calls.

Bind groups are rebuilt (cheaply) when an image is first loaded or swapped. When `isActive()` is false, bindings 7 & 8 point to a 1×1 zero texture — no null binding errors, no shader branching cost beyond the early-exit on `imageStrength`.

---

## UI Integration

**Panel section** (always visible when image is loaded):
- Thumbnail: live `processedTexture` rendered into a `<canvas>` element, updates each animation frame
- **Enable toggle** (on/off) — zero GPU cost when off; image stays loaded
- Force mode pills: Attract | Repel | Grad Flow | Grad Edge | Threshold | SDF
- Strength slider (0–2, default 0.5)
- Invert toggle
- "Open Editor" button → mounts overlay
- "Clear Image" button (unloads image, frees VRAM, resets to dummy texture)

**Editor overlay** (mounted on demand, boids continue):
- Left sidebar:
  - Brush mode: **Paint** | **Erase paint** | **Mask image** (greyed out if no image loaded) | **Blur**
  - Size + softness sliders
  - Fit presets + transform sliders (only relevant when image loaded)
  - Processing options: blur radius, threshold value, invert toggle
  - "Reset Paint" button (clears `paintCanvasTexture`)
  - "Clear Image" button (unloads image, resets `sourceTexture` and `imageMaskTexture`)
- Right canvas: drag-to-move + 8 resize handles on image (if loaded), force-arrow overlay toggle, brush cursor, NDC/UV/force coordinate readout in sidebar
- All changes apply live (immediate reprocess pass)
- "Done" button → unmounts overlay, returns to full boids view

---

## File Checklist

**New files:**
- `src/lib/webgpu/image-editor/image-editor-types.ts`
- `src/lib/webgpu/image-editor/image-uploader.ts`
- `src/lib/webgpu/image-editor/image-processor.ts`
- `src/lib/webgpu/image-editor/image-brush.ts`
- `src/lib/webgpu/image-editor/image-editor-overlay.ts`
- `src/lib/webgpu/image-editor/image-panel-section.ts`
- `src/lib/webgpu/image-editor/shaders/composite.wgsl`  ← three-layer blend
- `src/lib/webgpu/image-editor/shaders/blur.wgsl`
- `src/lib/webgpu/image-editor/shaders/mode-luminance.wgsl`
- `src/lib/webgpu/image-editor/shaders/mode-gradient.wgsl`
- `src/lib/webgpu/image-editor/shaders/mode-threshold.wgsl`
- `src/lib/webgpu/image-editor/shaders/mode-sdf.wgsl`
- `src/lib/webgpu/image-editor/shaders/brush.wgsl`
- `src/components/simulations/boids/boids-image-force.ts`

**Modified files:**
- `src/components/simulations/boids/boids-controller.ts` — integrate `BoidsImageForce`, extend uniform buffer, add bindings 7 & 8
- `src/components/simulations/boids/boids-panel.ts` — mount `ImagePanelSection`
- `src/components/simulations/boids/boids.wgsl` — add texture/sampler bindings, `decodeForce`, image force block in `computeMain`

---

## Out of Scope

- Multiple simultaneous images
- Image rotation (translate + scale only)
- Undo/redo for brush strokes
- Saving/loading the edited image state
- Per-particle color modulation from image (future: `getLuminanceTexture()`)
- NCA / particle-life integration (future: same library, new adapter)
