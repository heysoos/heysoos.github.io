# Boids: Live Shader Editor, Appearance Controls & Trail Renderer

**Date:** 2026-04-06  
**Simulation:** Boids (`src/components/simulations/boids/`)

---

## Overview

Add a live WGSL shader editor (CodeMirror 6) accessible from the parameters panel, alongside a suite of new appearance controls: particle size, shape presets, color picker, and GPU-based motion trails. The parameters panel gains categorized sections with dividers and a close button.

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/components/simulations/boids/trail-renderer.ts` | Ping-pong trail textures, fade pipeline, blit pipeline |
| `src/components/simulations/boids/trail.wgsl` | WGSL shaders for the fade and blit fullscreen-quad passes |

### Modified Files

| File | Changes |
|------|---------|
| `boids-controller.ts` | New params (size, shapeId, color, trailDecay), delegates frame compositing to TrailRenderer, adds `reloadShader()` |
| `boids.wgsl` | Expanded Params struct, quad vertex buffer, SDF shape selection in fragment, color uniforms |
| `gallery/[...slug].astro` | Panel close button, categorized params UI, color picker, shape selector, trail controls, CodeMirror shader editor panel |

---

## Uniform Buffer

Expanded from 64 bytes to 96 bytes. New fields appended after existing layout:

| Offset | Field | Type | Default |
|--------|-------|------|---------|
| 0–56 | *(existing fields unchanged)* | — | — |
| 60 | `size` | f32 | 1.0 |
| 64 | `shapeId` | u32 | 0 (triangle) |
| 68 | `colorR` | f32 | 0.88 |
| 72 | `colorG` | f32 | 0.63 |
| 76 | `colorB` | f32 | 0.25 |
| 80–92 | `_pad` | f32×3 | — |

`uniformBuffer` allocation in `boids-controller.ts` changes from 64 to 96 bytes.

---

## Shader Changes (`boids.wgsl`)

### Vertex Buffer → Quad Billboard

Replace the 3-vertex `TRIANGLE_VERTS` with a 6-vertex quad (`-1..1` in x and y, two triangles). The vertex shader:
- Scales `vertexPos` by `params.size`
- Rotates to face velocity direction (existing logic)
- Outputs `uv: vec2f` (the pre-rotation vertex position, used for SDF in fragment)
- Corrects for aspect ratio (existing logic)

`draw(3, numParticles)` → `draw(6, numParticles)`

### Fragment Shader — SDF Shape Selection

```wgsl
// Incoming: uv (vec2f, -1..1), alpha (f32 from velocity magnitude)

var mask: f32 = 1.0;
switch params.shapeId {
  case 0u: { // triangle SDF — signed distance to equilateral triangle
    ...
    if dist > 0.0 { discard; }
  }
  case 1u: { // circle
    if length(uv) > 1.0 { discard; }
  }
  case 2u: { // diamond
    if abs(uv.x) + abs(uv.y) > 1.0 { discard; }
  }
  case 3u: { // soft blob — circle with smooth alpha falloff
    let d = length(uv);
    if d > 1.0 { discard; }
    mask = 1.0 - smoothstep(0.5, 1.0, d);
  }
  default: {}
}

return vec4f(params.colorR, params.colorG, params.colorB, alpha * mask);
```

---

## TrailRenderer

### Responsibilities
- Own two `GPURenderTexture`s (`trailTex[0]`, `trailTex[1]`), `rgba16float`, with `RENDER_ATTACHMENT | TEXTURE_BINDING` usage
- Own fade pipeline, blit pipeline, and their bind groups
- Expose a `render()` method that orchestrates each frame

### API

```ts
class TrailRenderer {
  init(device: GPUDevice, format: GPUTextureFormat, width: number, height: number): void
  resize(device: GPUDevice, width: number, height: number): void
  render(
    device: GPUDevice,
    context: GPUCanvasContext,
    decayFactor: number,
    trailsEnabled: boolean,
    particlePassFn: (targetView: GPUTextureView) => void
  ): void
  destroy(): void
}
```

### Frame sequence (trails enabled)

1. **Fade pass** — fullscreen quad reads `trailTex[read]`, multiplies every pixel by `decayFactor`, writes to `trailTex[write]` (loadOp: `clear`)
2. **Particle pass** — `BoidsController` renders boids to `trailTex[write]` (loadOp: `load`, additive blend)
3. **Blit pass** — fullscreen quad samples `trailTex[write]`, writes to swapchain

Indices swap: `read = write`, `write = 1 - write`.

### Frame sequence (trails disabled)

`particlePassFn` receives the swapchain view directly. Fade and blit pipelines are not invoked. Zero overhead vs. current behavior.

### Canvas Resize

`BoidsController.tick()` calls `resizeCanvasToDisplaySize()`. If `canvas.width` or `canvas.height` changed from the previous frame, `trailRenderer.resize()` is called to recreate both textures at the new size.

---

## Params Panel UI

### Close Button

A `×` button in the top-right of the panel header. Clicking sets `panelOpen = false` and hides the panel. The existing settings button in Controls toggles it open again.

### Categorized Layout

Each category has a small uppercase subheading and a 1px divider above it (except the first).

| Category | Controls |
|----------|---------|
| **Simulation** | Time Step, Particles |
| **Forces** | Outer Radius, Inner Radius, Attraction, Repulsion, Alignment, Friction, Max Speed |
| **Perception** | Vision Cone, Mouse Radius |
| **Appearance** | Size (slider), Shape (4 icon buttons: △ ○ ◇ ●), Color (5 swatches + `<input type="color">`), Trails (toggle), Trail Decay (slider — visible only when trails on) |
| **Shader** | "Edit Shader" button |

### Shape Selector

Four small buttons displaying shape glyphs. Active shape gets an accent-colored border. Clicking updates `shapeId` uniform immediately.

### Color Controls

Five preset swatches:
- Warm amber `#e0a040` (default)
- Cool blue `#4090e0`
- Soft green `#50c878`
- Rose `#e05080`
- White `#ffffff`

Followed by a native `<input type="color">` picker. Selecting any swatch or color updates `colorR/G/B` uniforms and syncs the color picker value.

### Trail Controls

- **Trails toggle** — checkbox or toggle switch
- **Trail Decay** — slider (range 0.80–0.99, step 0.01, default 0.92), visible only when trails are enabled

---

## Shader Editor Panel

A second absolutely-positioned panel rendered adjacent to the params panel.

### Components

- **Header** — "Shader Editor" label + `×` close button
- **CodeMirror 6 editor** — displays current shader source, WGSL syntax highlighting via `@codemirror/legacy-modes` with a C-like language approximation (no official WGSL CM6 package exists)
- **Button row** — "Apply" button + "Reset to Default" button
- **Error display** — red monospace text below editor, shows `GPUCompilationMessage` entries with line/column numbers. Hidden when no errors.

### Apply Flow

1. User clicks "Apply"
2. `boidsCtrl.reloadShader(editorCode)` is called
3. `device.createShaderModule({ code })` → `shaderModule.compilationInfo()`
4. If errors: display in error area, pipelines unchanged, simulation continues
5. If clean: recreate `computePipeline` and `renderPipeline` from new module, clear error area

### Reset Flow

Replaces editor content with the original `shaderCode` imported at build time, then auto-applies.

### `reloadShader()` in BoidsController

```ts
async reloadShader(code: string): Promise<{ success: boolean; errors: GPUCompilationMessage[] }> {
  const module = this.gpu!.device.createShaderModule({ code });
  const info = await module.compilationInfo();
  const errors = info.messages.filter(m => m.type === 'error');
  if (errors.length > 0) return { success: false, errors };
  // Recreate pipelines — buffers and bind groups are unaffected
  this.computePipeline = device.createComputePipeline({ ... module ... });
  this.renderPipeline  = device.createRenderPipeline({ ... module ... });
  return { success: true, errors: [] };
}
```

Particle buffers, uniform buffer, and bind groups are **not** recreated — the simulation state is preserved across shader reloads.

---

## Dependencies

Add to `package.json`:
- `@codemirror/view`
- `@codemirror/state`
- `@codemirror/basic-setup`
- `@codemirror/legacy-modes`
- `@codemirror/language`

These are tree-shaken by Astro's Vite bundler; only the imported modules are included in the build.

---

## What Is Not Changing

- `Controls.astro` — no changes (close button lives on the panel, not the toolbar)
- Other simulations (`particle-life`, `nca`, `cppn`) — stubs, untouched
- `TrailRenderer` is written generically but not wired into other simulations yet
- No changes to the gallery index page, layouts, or theme system
