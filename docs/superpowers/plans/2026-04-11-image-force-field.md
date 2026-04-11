# Image Force Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable GPU image editor library and wire it into the boids simulation as a live, toggleable force field derived from user-uploaded or hand-painted images.

**Architecture:** A self-contained `src/lib/webgpu/image-editor/` library owns a GPU texture stack (source, mask, paint, composited, processed) and a processing pipeline (composite → blur → mode pass). A thin `boids-image-force.ts` adapter binds the output texture into the boids compute pipeline at bindings 7 & 8. All image processing is GPU-only after initial upload; no CPU readbacks.

**Tech Stack:** WebGPU, WGSL compute shaders, Astro, TypeScript. No new npm dependencies.

---

## Worktree setup

Before starting, create an isolated worktree:

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git worktree add ../website-image-force -b feat/image-force-field
cd ../website-image-force
npm install
```

All work happens in `../website-image-force`. Open that directory in your editor.

---

## Output texture encoding (reference for all tasks)

Every mode shader writes `processedTexture` in this encoding:
- **r** = `force_x * 0.5 + 0.5`  (0.5 = zero, 0 = full left, 1 = full right)
- **g** = `force_y * 0.5 + 0.5`
- **b** = force magnitude `[0, 1]`
- **a** = `1.0` if pixel has image content, `0.0` if outside image bounds (no force)

Decoded in `boids.wgsl`:
```wgsl
fn decodeForce(s: vec4f) -> vec2f {
  if (s.a < 0.01) { return vec2f(0.0); }
  return (s.rg * 2.0 - vec2f(1.0)) * s.b;
}
```

---

## Task 1: Types and interfaces

**Files:**
- Create: `src/lib/webgpu/image-editor/image-editor-types.ts`

- [ ] **Step 1: Create the types file**

```ts
// src/lib/webgpu/image-editor/image-editor-types.ts

export interface ImageTransform {
  offsetX: number; // canvas pixels from left
  offsetY: number; // canvas pixels from top
  scaleX:  number; // rendered width in canvas pixels
  scaleY:  number; // rendered height in canvas pixels
}

// 0–5 match the imageForceMode uniform value read in boids.wgsl
export const ProcessingMode = {
  LuminanceAttract:  0,
  LuminanceRepel:    1,
  GradientFlow:      2,
  GradientAttract:   3,
  Threshold:         4,
  SDF:               5,
} as const;
export type ProcessingMode = typeof ProcessingMode[keyof typeof ProcessingMode];

export const BrushMode = {
  Paint:      'paint',
  ErasePaint: 'erase-paint',
  MaskImage:  'mask-image',
  Blur:       'blur',
} as const;
export type BrushMode = typeof BrushMode[keyof typeof BrushMode];

export interface BrushOptions {
  mode:     BrushMode;
  x:        number;  // canvas pixels
  y:        number;  // canvas pixels
  radius:   number;  // canvas pixels
  softness: number;  // 0 = hard edge, 1 = full feather
}

export interface ProcessingParams {
  mode:       ProcessingMode;
  blurRadius: number;   // 0 = skip blur pass
  threshold:  number;   // [0,1], used by Threshold and SDF modes
  invert:     boolean;
}

export interface ImageEditorState {
  hasImage:   boolean;
  hasPaint:   boolean;  // paintCanvasTexture is non-empty
  transform:  ImageTransform;
  params:     ProcessingParams;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/webgpu/image-editor/image-editor-types.ts
git commit -m "feat(image-editor): add shared types and interfaces"
```

---

## Task 2: Composite shader

**Files:**
- Create: `src/lib/webgpu/image-editor/shaders/composite.wgsl`

The composite shader reads three textures (source, mask, paint) and writes a blended canvas-space result.

- [ ] **Step 1: Create the shader**

```wgsl
// src/lib/webgpu/image-editor/shaders/composite.wgsl

struct Transform {
  offsetX: f32,
  offsetY: f32,
  scaleX:  f32,
  scaleY:  f32,
}

@group(0) @binding(0) var<uniform> tf: Transform;
@group(0) @binding(1) var srcTex:   texture_2d<f32>;
@group(0) @binding(2) var maskTex:  texture_2d<f32>;
@group(0) @binding(3) var paintTex: texture_2d<f32>;
@group(0) @binding(4) var outTex:   texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn compositeMain(@builtin(global_invocation_id) id: vec3u) {
  let outDims = textureDimensions(outTex);
  if (id.x >= outDims.x || id.y >= outDims.y) { return; }

  // Map output pixel → source image UV via inverse transform
  let cx = f32(id.x);
  let cy = f32(id.y);
  let u  = (cx - tf.offsetX) / tf.scaleX;
  let v  = (cy - tf.offsetY) / tf.scaleY;

  var src = vec4f(0.0);
  if (u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0 && tf.scaleX > 0.0 && tf.scaleY > 0.0) {
    let srcDims  = textureDimensions(srcTex);
    let srcCoord = vec2u(vec2f(f32(srcDims.x) * u, f32(srcDims.y) * v));
    src = textureLoad(srcTex, clamp(srcCoord, vec2u(0u), srcDims - 1u), 0);
  }

  let mask  = textureLoad(maskTex,  id.xy, 0);
  let paint = textureLoad(paintTex, id.xy, 0);

  // Composite: (source × mask.r) + paint, clamped
  let result = clamp(src * mask.r + paint, vec4f(0.0), vec4f(1.0));
  textureStore(outTex, vec2i(id.xy), result);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/webgpu/image-editor/shaders/composite.wgsl
git commit -m "feat(image-editor): add composite WGSL shader"
```

---

## Task 3: Blur shader

**Files:**
- Create: `src/lib/webgpu/image-editor/shaders/blur.wgsl`

Two-pass separable Gaussian blur. Run H pass then V pass, ping-ponging between two textures.

- [ ] **Step 1: Create the shader**

```wgsl
// src/lib/webgpu/image-editor/shaders/blur.wgsl

struct BlurParams {
  radius:    u32,   // kernel half-width in pixels
  horizontal: u32,  // 1 = H pass, 0 = V pass
}

@group(0) @binding(0) var<uniform> p:      BlurParams;
@group(0) @binding(1) var          inTex:  texture_2d<f32>;
@group(0) @binding(2) var          outTex: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn blurMain(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(outTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let r     = i32(p.radius);
  var accum = vec4f(0.0);
  var total = 0.0;

  // Gaussian weights: w(i) = exp(-i*i / (2*sigma^2)), sigma = radius/2
  let sigma2 = f32(r) * f32(r) * 0.25 + 0.001;

  for (var i = -r; i <= r; i++) {
    var coord: vec2i;
    if (p.horizontal == 1u) {
      coord = vec2i(i32(id.x) + i, i32(id.y));
    } else {
      coord = vec2i(i32(id.x), i32(id.y) + i);
    }
    let clamped = clamp(coord, vec2i(0), vec2i(dims) - vec2i(1));
    let w  = exp(-f32(i * i) / (2.0 * sigma2));
    accum += textureLoad(inTex, clamped, 0) * w;
    total += w;
  }

  textureStore(outTex, vec2i(id.xy), accum / total);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/webgpu/image-editor/shaders/blur.wgsl
git commit -m "feat(image-editor): add separable Gaussian blur shader"
```

---

## Task 4: Mode shaders

**Files:**
- Create: `src/lib/webgpu/image-editor/shaders/mode-luminance.wgsl`
- Create: `src/lib/webgpu/image-editor/shaders/mode-gradient.wgsl`
- Create: `src/lib/webgpu/image-editor/shaders/mode-threshold.wgsl`
- Create: `src/lib/webgpu/image-editor/shaders/mode-sdf.wgsl`

All mode shaders read `compositedTexture` (or `blurTempTexture` after blur) and write to `processedTexture` in the standard rg=dir, b=mag, a=mask encoding.

- [ ] **Step 1: Create mode-luminance.wgsl (modes 0 and 1)**

```wgsl
// src/lib/webgpu/image-editor/shaders/mode-luminance.wgsl
// mode 0 = attract (toward bright), mode 1 = repel (away from bright)

struct ModeParams { mode: u32, _pad0: u32, _pad1: u32, _pad2: u32 }

@group(0) @binding(0) var<uniform> p:      ModeParams;
@group(0) @binding(1) var          inTex:  texture_2d<f32>;
@group(0) @binding(2) var          outTex: texture_storage_2d<rgba8unorm, write>;

fn lum(c: vec4f) -> f32 {
  return dot(c.rgb, vec3f(0.299, 0.587, 0.114));
}

@compute @workgroup_size(8, 8)
fn modeMain(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(outTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let c  = textureLoad(inTex, vec2i(id.xy), 0);
  let l  = lum(c);
  let mask = c.a;  // alpha from composite: 1 = has content, 0 = outside image

  // 3×3 Sobel gradient of luminance
  var gx = 0.0; var gy = 0.0;
  let d  = vec2i(dims);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let coord = clamp(vec2i(id.xy) + vec2i(dx, dy), vec2i(0), d - vec2i(1));
      let s     = lum(textureLoad(inTex, coord, 0));
      // Sobel kernels
      let wx = f32(dx) * select(1.0, 2.0, dx == 0); // [-1,0,1; -2,0,2; -1,0,1]
      let wy = f32(dy) * select(1.0, 2.0, dy == 0); // [-1,-2,-1; 0,0,0; 1,2,1]
      gx += s * wx;
      gy += s * wy;
    }
  }

  let gLen = length(vec2f(gx, gy));
  var dir  = vec2f(0.0);
  if (gLen > 0.0001) {
    dir = vec2f(gx, gy) / gLen;
  }

  // mode 1 = repel → negate direction
  if (p.mode == 1u) { dir = -dir; }

  // Encode: rg = dir*0.5+0.5, b = magnitude (luminance), a = mask
  let mag = l;
  let encoded = vec4f(dir * 0.5 + 0.5, mag, mask);
  textureStore(outTex, vec2i(id.xy), encoded);
}
```

- [ ] **Step 2: Create mode-gradient.wgsl (modes 2 and 3)**

```wgsl
// src/lib/webgpu/image-editor/shaders/mode-gradient.wgsl
// mode 2 = gradient flow (along contours), mode 3 = gradient attract (toward edges)

struct ModeParams { mode: u32, _pad0: u32, _pad1: u32, _pad2: u32 }

@group(0) @binding(0) var<uniform> p:      ModeParams;
@group(0) @binding(1) var          inTex:  texture_2d<f32>;
@group(0) @binding(2) var          outTex: texture_storage_2d<rgba8unorm, write>;

fn lum(c: vec4f) -> f32 { return dot(c.rgb, vec3f(0.299, 0.587, 0.114)); }

@compute @workgroup_size(8, 8)
fn modeMain(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(outTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let c    = textureLoad(inTex, vec2i(id.xy), 0);
  let mask = c.a;
  let d    = vec2i(dims);

  var gx = 0.0; var gy = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let coord = clamp(vec2i(id.xy) + vec2i(dx, dy), vec2i(0), d - vec2i(1));
      let s     = lum(textureLoad(inTex, coord, 0));
      let wx    = f32(dx) * select(1.0, 2.0, dx == 0);
      let wy    = f32(dy) * select(1.0, 2.0, dy == 0);
      gx += s * wx;
      gy += s * wy;
    }
  }

  let gLen = length(vec2f(gx, gy));
  var dir  = vec2f(0.0);
  if (gLen > 0.0001) {
    let norm = vec2f(gx, gy) / gLen;
    if (p.mode == 2u) {
      dir = vec2f(-norm.y, norm.x);  // tangent: flow along contours
    } else {
      dir = norm;                     // normal: attract toward edges
    }
  }

  // magnitude = edge strength (gradient magnitude), normalized to ~[0,1]
  let mag = clamp(gLen / 4.0, 0.0, 1.0);
  textureStore(outTex, vec2i(id.xy), vec4f(dir * 0.5 + 0.5, mag, mask));
}
```

- [ ] **Step 3: Create mode-threshold.wgsl (mode 4)**

```wgsl
// src/lib/webgpu/image-editor/shaders/mode-threshold.wgsl
// Applies a hard luminance threshold, then computes gradient of the thresholded field.
// Boids feel force at the boundary between above/below-threshold regions.

struct ModeParams { mode: u32, _pad0: u32, threshold_bits: u32, _pad1: u32 }

@group(0) @binding(0) var<uniform> p:      ModeParams;
@group(0) @binding(1) var          inTex:  texture_2d<f32>;
@group(0) @binding(2) var          outTex: texture_storage_2d<rgba8unorm, write>;

fn lum(c: vec4f) -> f32 { return dot(c.rgb, vec3f(0.299, 0.587, 0.114)); }

@compute @workgroup_size(8, 8)
fn modeMain(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(outTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let c         = textureLoad(inTex, vec2i(id.xy), 0);
  let mask      = c.a;
  let threshold = bitcast<f32>(p.threshold_bits);
  let d         = vec2i(dims);

  // Sobel on thresholded luminance
  var gx = 0.0; var gy = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let coord = clamp(vec2i(id.xy) + vec2i(dx, dy), vec2i(0), d - vec2i(1));
      let s     = select(0.0, 1.0, lum(textureLoad(inTex, coord, 0)) > threshold);
      let wx    = f32(dx) * select(1.0, 2.0, dx == 0);
      let wy    = f32(dy) * select(1.0, 2.0, dy == 0);
      gx += s * wx;
      gy += s * wy;
    }
  }

  let gLen = length(vec2f(gx, gy));
  var dir  = vec2f(0.0);
  if (gLen > 0.0001) { dir = vec2f(gx, gy) / gLen; }
  let mag = clamp(gLen / 4.0, 0.0, 1.0);

  textureStore(outTex, vec2i(id.xy), vec4f(dir * 0.5 + 0.5, mag, mask));
}
```

- [ ] **Step 4: Create mode-sdf.wgsl (mode 5) — two entry points**

Jump-flood SDF. Requires N = ceil(log2(max_dim)) dispatch passes with step sizes halving each pass. Two shaders: `sdfSeed` (initialize) and `sdfJump` (one JFA step). The host dispatches sdfSeed once, then sdfJump log2(max_dim) times, then sdfFinalize once to convert nearest-coord to force.

```wgsl
// src/lib/webgpu/image-editor/shaders/mode-sdf.wgsl

struct SdfParams {
  step:      u32,  // current jump step size in pixels
  threshold_bits: u32,
  _pad0: u32, _pad1: u32,
}

@group(0) @binding(0) var<uniform> p:       SdfParams;
@group(0) @binding(1) var          inTex:   texture_2d<f32>;    // source luminance
@group(0) @binding(2) var          pingTex: texture_storage_2d<rgba32float, read_write>; // nearest-coord store
@group(0) @binding(3) var          outTex:  texture_storage_2d<rgba8unorm, write>;       // final output

fn lum(c: vec4f) -> f32 { return dot(c.rgb, vec3f(0.299, 0.587, 0.114)); }

// Pass 1: seed — write pixel coord to pingTex if above threshold, else write sentinel
@compute @workgroup_size(8, 8)
fn sdfSeed(@builtin(global_invocation_id) id: vec3u) {
  let dims      = textureDimensions(inTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let threshold = bitcast<f32>(p.threshold_bits);
  let c         = textureLoad(inTex, vec2i(id.xy), 0);
  let isSeed    = lum(c) > threshold;
  // Store: rg = seed position (normalized), ba = sentinel flag
  if (isSeed) {
    let uv = vec2f(f32(id.x), f32(id.y));
    textureStore(pingTex, vec2i(id.xy), vec4f(uv, 1.0, 1.0));
  } else {
    textureStore(pingTex, vec2i(id.xy), vec4f(-1.0, -1.0, 0.0, 0.0));
  }
}

// Pass 2 (repeated): jump-flood step
@compute @workgroup_size(8, 8)
fn sdfJump(@builtin(global_invocation_id) id: vec3u) {
  let dims  = textureDimensions(inTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let step  = i32(p.step);
  let self  = textureLoad(pingTex, vec2i(id.xy));
  var best  = self;
  var bestDist = 1e9;
  if (best.z > 0.5) {
    let d = vec2f(id.xy) - best.xy;
    bestDist = dot(d, d);
  }

  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let nc  = vec2i(i32(id.x) + dx * step, i32(id.y) + dy * step);
      if (any(nc < vec2i(0)) || any(nc >= vec2i(dims))) { continue; }
      let nb  = textureLoad(pingTex, nc);
      if (nb.z < 0.5) { continue; }  // no seed stored
      let dv  = vec2f(id.xy) - nb.xy;
      let d2  = dot(dv, dv);
      if (d2 < bestDist) { bestDist = d2; best = nb; }
    }
  }
  textureStore(pingTex, vec2i(id.xy), best);
}

// Pass 3: finalize — convert nearest-seed distance to force
@compute @workgroup_size(8, 8)
fn sdfFinalize(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(outTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let src  = textureLoad(inTex, vec2i(id.xy), 0);
  let mask = src.a;
  let data = textureLoad(pingTex, vec2i(id.xy));

  var dir = vec2f(0.0);
  var mag = 0.0;
  if (data.z > 0.5) {
    let toSeed = data.xy - vec2f(id.xy);
    let dist   = length(toSeed);
    if (dist > 0.5) {
      // Force direction = away from nearest seed (boids orbit the shape boundary)
      dir = -toSeed / dist;
      // Magnitude: strong near seed, falls off with distance
      mag = clamp(1.0 / (1.0 + dist * 0.02), 0.0, 1.0);
    }
  }

  textureStore(outTex, vec2i(id.xy), vec4f(dir * 0.5 + 0.5, mag, mask));
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/webgpu/image-editor/shaders/
git commit -m "feat(image-editor): add all mode WGSL shaders (luminance, gradient, threshold, SDF)"
```

---

## Task 5: Brush shader and ImageBrush class

**Files:**
- Create: `src/lib/webgpu/image-editor/shaders/brush.wgsl`
- Create: `src/lib/webgpu/image-editor/image-brush.ts`

Paint/erase use a render pipeline with GPU blend modes. Blur uses a compute ping-pong (copy texture → blur into original).

- [ ] **Step 1: Create brush.wgsl (used by the render pipeline)**

```wgsl
// src/lib/webgpu/image-editor/shaders/brush.wgsl

struct BrushParams {
  centerX:  f32,
  centerY:  f32,
  radius:   f32,
  softness: f32,
  value:    f32,   // paint value [0,1]
  _pad0: f32, _pad1: f32, _pad2: f32,
}

@group(0) @binding(0) var<uniform> brush: BrushParams;

struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0)       uv:  vec2f,
}

// Full-screen quad: 6 vertices covering the brush bounding box in NDC
@vertex
fn vsMain(@builtin(vertex_index) vi: u32) -> VertexOut {
  // Quad vertex positions in NDC — overridden by JS to clip to brush bbox
  var pos = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f(1.0,  1.0),
  );
  var out: VertexOut;
  out.pos = vec4f(pos[vi], 0.0, 1.0);
  out.uv  = pos[vi] * 0.5 + 0.5;
  return out;
}

@fragment
fn fsPaint(in: VertexOut) -> @location(0) vec4f {
  // Convert NDC uv back to canvas pixels via brush uniform
  // (we pass canvas dims via center/radius in the same pixel space)
  // The fragment position gives us canvas pixels directly via @builtin(position)
  return vec4f(0.0); // placeholder — see note below
}
```

Note: The brush render pipeline uses `@builtin(position)` in the fragment shader for pixel coordinates. Rewrite the fragment shader to use `@builtin(position)`:

```wgsl
// Replace fsPaint with this:
@fragment
fn fsPaint(@builtin(position) fragPos: vec4f) -> @location(0) vec4f {
  let d     = length(fragPos.xy - vec2f(brush.centerX, brush.centerY));
  if (d > brush.radius) { discard; }
  let inner = brush.radius * (1.0 - brush.softness);
  let alpha = 1.0 - smoothstep(inner, brush.radius, d);
  return vec4f(brush.value, brush.value, brush.value, alpha);
}
```

Final brush.wgsl (combine):

```wgsl
// src/lib/webgpu/image-editor/shaders/brush.wgsl

struct BrushParams {
  centerX:  f32,
  centerY:  f32,
  radius:   f32,
  softness: f32,
  value:    f32,
  _pad0: f32, _pad1: f32, _pad2: f32,
}
@group(0) @binding(0) var<uniform> brush: BrushParams;

struct VertexOut { @builtin(position) pos: vec4f }

@vertex
fn vsMain(@builtin(vertex_index) vi: u32) -> VertexOut {
  var pos = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f(1.0,  1.0),
  );
  return VertexOut(vec4f(pos[vi], 0.0, 1.0));
}

@fragment
fn fsPaint(@builtin(position) fragPos: vec4f) -> @location(0) vec4f {
  let d     = length(fragPos.xy - vec2f(brush.centerX, brush.centerY));
  if (d > brush.radius) { discard; }
  let inner = brush.radius * (1.0 - brush.softness);
  let alpha = 1.0 - smoothstep(inner, brush.radius, d);
  return vec4f(brush.value, brush.value, brush.value, alpha);
}
```

- [ ] **Step 2: Create image-brush.ts**

```ts
// src/lib/webgpu/image-editor/image-brush.ts

import type { BrushOptions } from './image-editor-types';
import { BrushMode } from './image-editor-types';
import brushShaderCode from './shaders/brush.wgsl?raw';
import blurShaderCode  from './shaders/blur.wgsl?raw';

export class ImageBrush {
  private device!: GPUDevice;
  private brushUniform!: GPUBuffer;
  private paintPipeline!: GPURenderPipeline;   // additive paint
  private erasePipeline!: GPURenderPipeline;   // subtractive erase
  private blurComputePipeline!: GPUComputePipeline;
  private blurUniform!: GPUBuffer;

  init(device: GPUDevice): void {
    this.device = device;

    const brushModule = device.createShaderModule({ code: brushShaderCode });
    const blurModule  = device.createShaderModule({ code: blurShaderCode });

    this.brushUniform = device.createBuffer({
      size: 32,  // 8 × f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.blurUniform = device.createBuffer({
      size: 16,  // 2 × u32 + padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Paint pipeline — additive blend
    this.paintPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: brushModule, entryPoint: 'vsMain' },
      fragment: {
        module: brushModule, entryPoint: 'fsPaint',
        targets: [{
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one',       dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Erase pipeline — subtractive: dst = dst × (1 - src.a)
    this.erasePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: brushModule, entryPoint: 'vsMain' },
      fragment: {
        module: brushModule, entryPoint: 'fsPaint',
        targets: [{
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Blur compute pipeline
    this.blurComputePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: blurModule, entryPoint: 'blurMain' },
    });
  }

  /** Applies a single brush stroke to the given target texture. */
  stroke(opts: BrushOptions, targetTex: GPUTexture, blurTempTex?: GPUTexture): void {
    const { mode, x, y, radius, softness } = opts;

    if (mode === BrushMode.Blur) {
      if (!blurTempTex) return;
      this._applyBlur(targetTex, blurTempTex, x, y, radius, softness);
      return;
    }

    const isErase = mode === BrushMode.ErasePaint || mode === BrushMode.MaskImage;
    const value   = isErase ? 0.0 : 1.0;

    // Write brush uniform
    const u = new Float32Array([x, y, radius, softness, value, 0, 0, 0]);
    this.device.queue.writeBuffer(this.brushUniform, 0, u);

    const pipeline   = isErase ? this.erasePipeline : this.paintPipeline;
    const bindGroup  = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.brushUniform } }],
    });

    const view    = targetTex.createView();
    const encoder = this.device.createCommandEncoder();
    const pass    = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        loadOp:  'load',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private _applyBlur(
    targetTex: GPUTexture, tempTex: GPUTexture,
    cx: number, cy: number, radius: number, _softness: number,
  ): void {
    const { width, height } = targetTex;
    const blurRadius = Math.max(1, Math.round(radius / 4));

    const writeBlurUniform = (r: u32, horizontal: number) => {
      const u = new Uint32Array([r, horizontal, 0, 0]);
      this.device.queue.writeBuffer(this.blurUniform, 0, u);
    };

    const encoder = this.device.createCommandEncoder();
    // Copy target → temp so we can read from it
    encoder.copyTextureToTexture(
      { texture: targetTex }, { texture: tempTex }, [width, height, 1],
    );
    this.device.queue.submit([encoder.finish()]);

    // H pass: temp → target
    writeBlurUniform(blurRadius, 1);
    this._dispatchBlur(tempTex, targetTex, width, height);

    // V pass: target → temp, then copy back (reuse copy from above trick: copy target→temp first)
    const enc2 = this.device.createCommandEncoder();
    enc2.copyTextureToTexture({ texture: targetTex }, { texture: tempTex }, [width, height, 1]);
    this.device.queue.submit([enc2.finish()]);

    writeBlurUniform(blurRadius, 0);
    this._dispatchBlur(tempTex, targetTex, width, height);
  }

  private _dispatchBlur(
    inTex: GPUTexture, outTex: GPUTexture, w: number, h: number,
  ): void {
    const bg = this.device.createBindGroup({
      layout: this.blurComputePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.blurUniform } },
        { binding: 1, resource: inTex.createView()  },
        { binding: 2, resource: outTex.createView() },
      ],
    });
    const enc  = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.blurComputePipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  destroy(): void {
    this.brushUniform.destroy();
    this.blurUniform.destroy();
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/webgpu/image-editor/shaders/brush.wgsl src/lib/webgpu/image-editor/image-brush.ts
git commit -m "feat(image-editor): add brush shader and ImageBrush class"
```

---

## Task 6: ImageProcessor

**Files:**
- Create: `src/lib/webgpu/image-editor/image-processor.ts`

Owns the texture stack and runs the processing pipeline on demand.

- [ ] **Step 1: Create image-processor.ts**

```ts
// src/lib/webgpu/image-editor/image-processor.ts

import type { ImageTransform, ProcessingParams, BrushOptions } from './image-editor-types';
import { ProcessingMode, BrushMode } from './image-editor-types';
import { ImageBrush } from './image-brush';
import compositeCode     from './shaders/composite.wgsl?raw';
import blurCode          from './shaders/blur.wgsl?raw';
import modeLuminanceCode from './shaders/mode-luminance.wgsl?raw';
import modeGradientCode  from './shaders/mode-gradient.wgsl?raw';
import modeThresholdCode from './shaders/mode-threshold.wgsl?raw';
import modeSdfCode       from './shaders/mode-sdf.wgsl?raw';

const TEX_USAGE_COMPUTE_IN  = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
const TEX_USAGE_COMPUTE_OUT = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
const TEX_USAGE_RENDER_TGT  = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

export class ImageProcessor {
  private device!: GPUDevice;
  private brush!: ImageBrush;
  private sampler!: GPUSampler;

  // Texture stack
  private sourceTexture!:      GPUTexture;
  private imageMaskTexture!:   GPUTexture;  // all-ones by default
  private paintCanvasTexture!: GPUTexture;  // zeros by default
  private compositedTexture!:  GPUTexture;
  private blurTempTexture!:    GPUTexture;
  private processedTexture!:   GPUTexture;
  private sdfPingTexture!:     GPUTexture;  // rgba32float for JFA

  // Pipelines
  private compositePipeline!:     GPUComputePipeline;
  private blurPipeline!:          GPUComputePipeline;
  private modeLuminancePipeline!: GPUComputePipeline;
  private modeGradientPipeline!:  GPUComputePipeline;
  private modeThresholdPipeline!: GPUComputePipeline;
  private sdfSeedPipeline!:       GPUComputePipeline;
  private sdfJumpPipeline!:       GPUComputePipeline;
  private sdfFinalizePipeline!:   GPUComputePipeline;

  // Uniforms
  private transformUniform!: GPUBuffer;  // 16 bytes (4 × f32)
  private blurUniform!:      GPUBuffer;  // 16 bytes
  private modeUniform!:      GPUBuffer;  // 16 bytes
  private sdfUniform!:       GPUBuffer;  // 16 bytes

  // State
  private width  = 1;
  private height = 1;
  private imageWidth  = 1;
  private imageHeight = 1;
  hasPaint = false;
  hasImage = false;

  transform: ImageTransform = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
  params: ProcessingParams = {
    mode: ProcessingMode.LuminanceAttract,
    blurRadius: 0,
    threshold:  0.5,
    invert:     false,
  };

  // Thumbnail support
  private thumbnailContext: GPUCanvasContext | null = null;
  private blitPipeline: GPURenderPipeline | null = null;

  init(device: GPUDevice): void {
    this.device  = device;
    this.brush   = new ImageBrush();
    this.brush.init(device);
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

    // Uniforms
    this.transformUniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.blurUniform      = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.modeUniform      = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sdfUniform       = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Pipelines
    const make = (code: string, entry: string) => device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code }), entryPoint: entry },
    });
    this.compositePipeline     = make(compositeCode,     'compositeMain');
    this.blurPipeline          = make(blurCode,          'blurMain');
    this.modeLuminancePipeline = make(modeLuminanceCode, 'modeMain');
    this.modeGradientPipeline  = make(modeGradientCode,  'modeMain');
    this.modeThresholdPipeline = make(modeThresholdCode, 'modeMain');
    this.sdfSeedPipeline       = make(modeSdfCode,       'sdfSeed');
    this.sdfJumpPipeline       = make(modeSdfCode,       'sdfJump');
    this.sdfFinalizePipeline   = make(modeSdfCode,       'sdfFinalize');

    this._allocateTextures(1, 1);
    this._clearMaskToOnes();
    this._triggerReprocess();
  }

  private _allocateTextures(w: number, h: number): void {
    const d = this.device;
    const make = (usage: number, format: GPUTextureFormat = 'rgba8unorm') =>
      d.createTexture({ size: [w, h, 1], format, usage });

    this.sourceTexture?.destroy();
    this.imageMaskTexture?.destroy();
    this.paintCanvasTexture?.destroy();
    this.compositedTexture?.destroy();
    this.blurTempTexture?.destroy();
    this.processedTexture?.destroy();
    this.sdfPingTexture?.destroy();

    this.sourceTexture      = make(TEX_USAGE_COMPUTE_IN);
    this.imageMaskTexture   = make(TEX_USAGE_RENDER_TGT);
    this.paintCanvasTexture = make(TEX_USAGE_RENDER_TGT);
    this.compositedTexture  = make(TEX_USAGE_COMPUTE_OUT);
    this.blurTempTexture    = make(TEX_USAGE_COMPUTE_OUT);
    this.processedTexture   = make(TEX_USAGE_COMPUTE_OUT);
    this.sdfPingTexture     = make(
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      'rgba32float',
    );
    this.width  = w;
    this.height = h;
  }

  private _clearMaskToOnes(): void {
    // Render a white fullscreen quad into imageMaskTexture
    const enc  = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view:       this.imageMaskTexture.createView(),
        loadOp:     'clear',
        clearValue: { r: 1, g: 1, b: 1, a: 1 },
        storeOp:    'store',
      }],
    });
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  loadImage(bitmap: ImageBitmap): void {
    const { device } = this;
    this.imageWidth  = bitmap.width;
    this.imageHeight = bitmap.height;
    this.hasImage    = true;

    // Re-allocate sourceTexture at image resolution
    this.sourceTexture.destroy();
    this.sourceTexture = device.createTexture({
      size: [bitmap.width, bitmap.height, 1],
      format: 'rgba8unorm',
      usage: TEX_USAGE_COMPUTE_IN | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: this.sourceTexture },
      [bitmap.width, bitmap.height],
    );

    // Default transform: contain
    this._applyContainTransform();
    this._triggerReprocess();
  }

  clearImage(): void {
    this.hasImage = false;
    this.sourceTexture.destroy();
    this.sourceTexture = this.device.createTexture({
      size: [1, 1, 1], format: 'rgba8unorm', usage: TEX_USAGE_COMPUTE_IN,
    });
    this._clearMaskToOnes();
    this.transform = { offsetX: 0, offsetY: 0, scaleX: this.width, scaleY: this.height };
    this._triggerReprocess();
  }

  resetPaint(): void {
    const enc  = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.paintCanvasTexture.createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store',
      }],
    });
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.hasPaint = false;
    this._triggerReprocess();
  }

  setTransform(t: ImageTransform): void {
    this.transform = t;
    this._triggerReprocess();
  }

  setMode(mode: ProcessingMode): void   { this.params.mode = mode; this._triggerReprocess(); }
  setBlurRadius(r: number): void        { this.params.blurRadius = r; this._triggerReprocess(); }
  setThreshold(v: number): void         { this.params.threshold = v; this._triggerReprocess(); }
  setInvert(v: boolean): void           { this.params.invert = v; this._triggerReprocess(); }

  brushStroke(opts: BrushOptions): void {
    const target = opts.mode === BrushMode.MaskImage
      ? this.imageMaskTexture
      : this.paintCanvasTexture;
    this.brush.stroke(opts, target, this.blurTempTexture);
    if (opts.mode !== BrushMode.MaskImage) this.hasPaint = true;
    this._triggerReprocess();
  }

  resize(w: number, h: number): void {
    if (w === this.width && h === this.height) return;
    // Preserve paint by reading it out — not in scope, just reallocate
    this._allocateTextures(w, h);
    this._clearMaskToOnes();
    if (this.hasImage) this._applyContainTransform();
    this._triggerReprocess();
  }

  getOutputTexture(): GPUTexture  { return this.processedTexture; }
  getOutputSampler(): GPUSampler  { return this.sampler; }

  setThumbnailContext(ctx: GPUCanvasContext): void {
    this.thumbnailContext = ctx;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device: this.device, format, alphaMode: 'premultiplied' });
    this._buildBlitPipeline(format);
    this.renderThumbnail();
  }

  renderThumbnail(): void {
    if (!this.thumbnailContext || !this.blitPipeline) return;
    const swapChainTexture = this.thumbnailContext.getCurrentTexture();
    const bg = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.processedTexture.createView() },
      ],
    });
    const enc  = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: swapChainTexture.createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
      }],
    });
    pass.setPipeline(this.blitPipeline);
    pass.setBindGroup(0, bg);
    pass.draw(6);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  private _buildBlitPipeline(format: GPUTextureFormat): void {
    const blitWGSL = /* wgsl */`
      @group(0) @binding(0) var s: sampler;
      @group(0) @binding(1) var t: texture_2d<f32>;
      struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> V {
        var pos = array<vec2f,6>(
          vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),
          vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
        return V(vec4f(pos[i],0,1), pos[i]*0.5+0.5);
      }
      @fragment fn fs(v: V) -> @location(0) vec4f {
        return textureSample(t, s, vec2f(v.uv.x, 1.0 - v.uv.y));
      }
    `;
    const mod = this.device.createShaderModule({ code: blitWGSL });
    this.blitPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  private _applyContainTransform(): void {
    const imgAspect    = this.imageWidth / this.imageHeight;
    const canvasAspect = this.width / this.height;
    let iw: number, ih: number;
    if (imgAspect > canvasAspect) {
      iw = this.width;  ih = iw / imgAspect;
    } else {
      ih = this.height; iw = ih * imgAspect;
    }
    this.transform = {
      offsetX: (this.width  - iw) / 2,
      offsetY: (this.height - ih) / 2,
      scaleX: iw, scaleY: ih,
    };
  }

  private _triggerReprocess(): void {
    const { device, width, height } = this;
    const enc = device.createCommandEncoder();
    const wg  = (n: number) => Math.ceil(n / 8);

    // ── Pass 1: Composite ──────────────────────────────────────────────
    const tf = new Float32Array([
      this.transform.offsetX, this.transform.offsetY,
      this.transform.scaleX,  this.transform.scaleY,
    ]);
    device.queue.writeBuffer(this.transformUniform, 0, tf);

    const compositeBG = device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.transformUniform } },
        { binding: 1, resource: this.sourceTexture.createView() },
        { binding: 2, resource: this.imageMaskTexture.createView() },
        { binding: 3, resource: this.paintCanvasTexture.createView() },
        { binding: 4, resource: this.compositedTexture.createView() },
      ],
    });
    const compositePass = enc.beginComputePass();
    compositePass.setPipeline(this.compositePipeline);
    compositePass.setBindGroup(0, compositeBG);
    compositePass.dispatchWorkgroups(wg(width), wg(height));
    compositePass.end();
    device.queue.submit([enc.finish()]);

    // ── Pass 2: Optional blur ─────────────────────────────────────────
    if (this.params.blurRadius > 0) {
      const r = Math.round(this.params.blurRadius);
      const makeBlurBG = (inT: GPUTexture, outT: GPUTexture, horiz: number) => {
        device.queue.writeBuffer(this.blurUniform, 0, new Uint32Array([r, horiz, 0, 0]));
        return device.createBindGroup({
          layout: this.blurPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.blurUniform } },
            { binding: 1, resource: inT.createView() },
            { binding: 2, resource: outT.createView() },
          ],
        });
      };
      const e1 = device.createCommandEncoder();
      const p1 = e1.beginComputePass();
      p1.setPipeline(this.blurPipeline);
      p1.setBindGroup(0, makeBlurBG(this.compositedTexture, this.blurTempTexture, 1));
      p1.dispatchWorkgroups(wg(width), wg(height));
      p1.end();
      device.queue.submit([e1.finish()]);

      const e2 = device.createCommandEncoder();
      const p2 = e2.beginComputePass();
      p2.setPipeline(this.blurPipeline);
      p2.setBindGroup(0, makeBlurBG(this.blurTempTexture, this.compositedTexture, 0));
      p2.dispatchWorkgroups(wg(width), wg(height));
      p2.end();
      device.queue.submit([e2.finish()]);
    }

    // ── Pass 3: Mode pass ─────────────────────────────────────────────
    const mode = this.params.mode;

    if (mode === ProcessingMode.SDF) {
      this._runSdfPipeline(width, height);
    } else {
      const pipeline = mode <= 1 ? this.modeLuminancePipeline
        : mode <= 3 ? this.modeGradientPipeline
        : this.modeThresholdPipeline;

      const modeData = new ArrayBuffer(16);
      new Uint32Array(modeData)[0] = mode;
      new Uint32Array(modeData)[2] = new Float32Array([this.params.threshold])[0]; // bitcast
      const mv = new DataView(modeData);
      mv.setUint32(0, mode, true);
      mv.setFloat32(8, this.params.threshold, true); // threshold_bits
      device.queue.writeBuffer(this.modeUniform, 0, modeData);

      const modeBG = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.modeUniform } },
          { binding: 1, resource: this.compositedTexture.createView() },
          { binding: 2, resource: this.processedTexture.createView() },
        ],
      });
      const e3 = device.createCommandEncoder();
      const p3 = e3.beginComputePass();
      p3.setPipeline(pipeline);
      p3.setBindGroup(0, modeBG);
      p3.dispatchWorkgroups(wg(width), wg(height));
      p3.end();
      device.queue.submit([e3.finish()]);
    }

    this.renderThumbnail();
  }

  private _runSdfPipeline(w: number, h: number): void {
    const { device } = this;
    const wg = (n: number) => Math.ceil(n / 8);

    // Write threshold to sdfUniform (step=0 for seed pass)
    const writeStep = (step: number) => {
      const buf = new ArrayBuffer(16);
      const dv  = new DataView(buf);
      dv.setUint32(0, step, true);
      dv.setFloat32(4, this.params.threshold, true); // threshold_bits — store as bits
      // Actually threshold_bits needs to be the bit-pattern of the float:
      const tmp = new Float32Array([this.params.threshold]);
      dv.setUint32(4, new Uint32Array(tmp.buffer)[0], true);
      device.queue.writeBuffer(this.sdfUniform, 0, buf);
    };

    const makeSDFBG = (pipeline: GPUComputePipeline) => device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sdfUniform } },
        { binding: 1, resource: this.compositedTexture.createView() },
        { binding: 2, resource: this.sdfPingTexture.createView() },
        { binding: 3, resource: this.processedTexture.createView() },
      ],
    });

    // Seed pass
    writeStep(0);
    const e1 = device.createCommandEncoder();
    const p1 = e1.beginComputePass();
    p1.setPipeline(this.sdfSeedPipeline);
    p1.setBindGroup(0, makeSDFBG(this.sdfSeedPipeline));
    p1.dispatchWorkgroups(wg(w), wg(h));
    p1.end();
    device.queue.submit([e1.finish()]);

    // JFA passes
    const maxDim = Math.max(w, h);
    let step = Math.pow(2, Math.ceil(Math.log2(maxDim)));
    while (step >= 1) {
      writeStep(Math.round(step));
      const e = device.createCommandEncoder();
      const p = e.beginComputePass();
      p.setPipeline(this.sdfJumpPipeline);
      p.setBindGroup(0, makeSDFBG(this.sdfJumpPipeline));
      p.dispatchWorkgroups(wg(w), wg(h));
      p.end();
      device.queue.submit([e.finish()]);
      step /= 2;
    }

    // Finalize pass
    const e3 = device.createCommandEncoder();
    const p3 = e3.beginComputePass();
    p3.setPipeline(this.sdfFinalizePipeline);
    p3.setBindGroup(0, makeSDFBG(this.sdfFinalizePipeline));
    p3.dispatchWorkgroups(wg(w), wg(h));
    p3.end();
    device.queue.submit([e3.finish()]);
  }

  destroy(): void {
    this.brush.destroy();
    this.transformUniform.destroy();
    this.blurUniform.destroy();
    this.modeUniform.destroy();
    this.sdfUniform.destroy();
    for (const t of [
      this.sourceTexture, this.imageMaskTexture, this.paintCanvasTexture,
      this.compositedTexture, this.blurTempTexture, this.processedTexture, this.sdfPingTexture,
    ]) t?.destroy();
  }
}
```

- [ ] **Step 2: Verify the file compiles (TypeScript check)**

```bash
npx tsc --noEmit
```

Expected: no errors in `image-processor.ts`. If `GPUTextureUsage` or similar are not found, check that `tsconfig.json` includes `"lib": ["ES2020", "DOM"]` — these are WebGPU types from `@webgpu/types`. If not installed:

```bash
npm i --save-dev @webgpu/types
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/webgpu/image-editor/image-processor.ts
git commit -m "feat(image-editor): add ImageProcessor with full GPU pipeline"
```

---

## Task 7: ImageUploader

**Files:**
- Create: `src/lib/webgpu/image-editor/image-uploader.ts`

- [ ] **Step 1: Create the file**

```ts
// src/lib/webgpu/image-editor/image-uploader.ts

export function createFileInput(onBitmap: (bmp: ImageBitmap, name: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type   = 'accept';
  input.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
  input.type   = 'file';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const bmp = await createImageBitmap(file);
    onBitmap(bmp, file.name);
    input.value = '';  // allow re-selecting same file
  });
  return input;
}

export function attachDropZone(
  el: HTMLElement,
  onBitmap: (bmp: ImageBitmap, name: string) => void,
): () => void {
  const onDragOver = (e: DragEvent) => { e.preventDefault(); el.style.outline = '2px solid var(--accent)'; };
  const onDragLeave = () => { el.style.outline = ''; };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    el.style.outline = '';
    const file = e.dataTransfer?.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const bmp = await createImageBitmap(file);
    onBitmap(bmp, file.name);
  };
  el.addEventListener('dragover',  onDragOver);
  el.addEventListener('dragleave', onDragLeave);
  el.addEventListener('drop',      onDrop);
  return () => {
    el.removeEventListener('dragover',  onDragOver);
    el.removeEventListener('dragleave', onDragLeave);
    el.removeEventListener('drop',      onDrop);
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/webgpu/image-editor/image-uploader.ts
git commit -m "feat(image-editor): add ImageUploader (file input + drag-drop)"
```

---

## Task 8: BoidsImageForce adapter

**Files:**
- Create: `src/components/simulations/boids/boids-image-force.ts`

- [ ] **Step 1: Create the adapter**

```ts
// src/components/simulations/boids/boids-image-force.ts

import type { ImageProcessor } from '../../../lib/webgpu/image-editor/image-processor';
import { ProcessingMode } from '../../../lib/webgpu/image-editor/image-editor-types';

export type ImageForceMode = typeof ProcessingMode[keyof typeof ProcessingMode];

export class BoidsImageForce {
  private device!: GPUDevice;
  private processor!: ImageProcessor;
  private dummyTexture!: GPUTexture;
  private sampler!: GPUSampler;

  private _strength   = 0.5;
  private _forceMode: ImageForceMode = ProcessingMode.LuminanceAttract;
  private _invert     = false;
  private _enabled    = true;

  init(device: GPUDevice, processor: ImageProcessor): void {
    this.device    = device;
    this.processor = processor;
    this.sampler   = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    // 1×1 black texture for when no image is loaded
    this.dummyTexture = device.createTexture({
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
  }

  buildBindGroupEntries(): GPUBindGroupEntry[] {
    const tex = this.processor.hasImage || this.processor.hasPaint
      ? this.processor.getOutputTexture()
      : this.dummyTexture;
    return [
      { binding: 7, resource: tex.createView() },
      { binding: 8, resource: this.processor.getOutputSampler() },
    ];
  }

  getExtraParams(): { imageStrength: number; imageForceMode: number; imageInvert: number } {
    const active = this._enabled && (this.processor.hasImage || this.processor.hasPaint);
    return {
      imageStrength:  active ? this._strength : 0.0,
      imageForceMode: this._forceMode,
      imageInvert:    this._invert ? 1 : 0,
    };
  }

  setStrength(v: number):          void { this._strength  = v; }
  setForceMode(m: ImageForceMode): void { this._forceMode = m; }
  setInvert(v: boolean):           void { this._invert    = v; }
  setEnabled(v: boolean):          void { this._enabled   = v; }

  isActive(): boolean {
    return this._enabled && (this.processor.hasImage || this.processor.hasPaint);
  }

  destroy(): void {
    this.dummyTexture.destroy();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/simulations/boids/boids-image-force.ts
git commit -m "feat(boids): add BoidsImageForce adapter"
```

---

## Task 9: boids.wgsl — add image force sampling

**Files:**
- Modify: `src/components/simulations/boids/boids.wgsl`

- [ ] **Step 1: Extend the Params struct** (after the existing `_pad3: f32` at byte 92)

Find the struct in `boids.wgsl` and add three fields after `_pad3`:

```wgsl
  imageStrength:  f32,  // 96 — 0.0 = feature disabled
  imageForceMode: u32,  // 100
  imageInvert:    u32,  // 104
  _pad4:          f32,  // 108
```

The full struct `Params` now ends at byte 112 (next 16-byte multiple). Confirm the existing fields are unchanged; only append after `_pad3`.

- [ ] **Step 2: Add texture and sampler bindings** after the existing `@group(0) @binding(6)` line:

```wgsl
@group(0) @binding(7) var imageTexture: texture_2d<f32>;
@group(0) @binding(8) var imageSampler: sampler;
```

- [ ] **Step 3: Add `decodeForce` function** before `computeMain`:

```wgsl
fn decodeForce(s: vec4f) -> vec2f {
  // a < 0.01 means outside image bounds — no force
  if (s.a < 0.01) { return vec2f(0.0); }
  // rg encodes direction: (dir * 0.5 + 0.5) → decode to [-1, 1]
  let dir = (s.rg * 2.0 - vec2f(1.0)) * s.b;
  return dir;
}
```

- [ ] **Step 4: Add image force block** inside `computeMain`, after the mouse attraction block (before `// Integrate position`):

```wgsl
  // Image force field
  if (params.imageStrength > 0.0) {
    // Map boid NDC position [-1,1] → UV [0,1]
    let uv      = pos * vec2f(0.5, -0.5) + vec2f(0.5);
    let sample  = textureSampleLevel(imageTexture, imageSampler, uv, 0.0);
    var imgForce = decodeForce(sample);
    if (params.imageInvert == 1u) { imgForce = -imgForce; }
    // Convert from canvas space (y-down) to clip space (y-up): flip y
    vel += vec2f(imgForce.x, -imgForce.y) * params.imageStrength;
  }
```

Note: `textureSampleLevel` is used instead of `textureSample` because compute shaders cannot use `textureSample` (fragment-only). Level 0.0 = full-resolution mip.

- [ ] **Step 5: Verify the boids simulation still runs in dev server**

```bash
npm run dev
```

Open `http://localhost:4321/gallery/boids` in the browser. Boids should render and move normally. Open browser console — no WebGPU errors. The new bindings 7 & 8 are not yet wired in `BoidsController` so this will error — that's fine for now; verify the shader compiles.

- [ ] **Step 6: Commit**

```bash
git add src/components/simulations/boids/boids.wgsl
git commit -m "feat(boids): extend shader with image force bindings and decodeForce"
```

---

## Task 10: BoidsController integration

**Files:**
- Modify: `src/components/simulations/boids/boids-controller.ts`

- [ ] **Step 1: Import and declare `imageForce` and `imageProcessor`** at the top and as class members

Add imports after the existing imports:

```ts
import { ImageProcessor } from '../../../lib/webgpu/image-editor/image-processor';
import { BoidsImageForce } from './boids-image-force';
```

Add as class fields (after `private trailRenderer = new TrailRenderer();`):

```ts
readonly imageProcessor = new ImageProcessor();
readonly imageForce     = new BoidsImageForce();
```

- [ ] **Step 2: Expand uniform buffer from 96 → 112 bytes**

In `init()`, change:
```ts
this.uniformBuffer = createUniformBuffer(device, 96);
```
to:
```ts
this.uniformBuffer = createUniformBuffer(device, 112);
```

- [ ] **Step 3: Initialize imageProcessor and imageForce** in `init()`, after `this.gpu` is assigned and the uniform buffer is created:

```ts
this.imageProcessor.init(device);
this.imageForce.init(device, this.imageProcessor);
```

- [ ] **Step 4: Add bindings 7 and 8 to `boidsBindGroupLayout`** in `_createBoidsPipelines()`

Append to the `entries` array of `boidsBindGroupLayout`:

```ts
{ binding: 7, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
{ binding: 8, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
```

- [ ] **Step 5: Add image force entries to `boidsBindGroups`** in `_createBoidsPipelines()`

In both `boidsBindGroups[0]` and `boidsBindGroups[1]` entries arrays, append:

```ts
...this.imageForce.buildBindGroupEntries(),
```

- [ ] **Step 6: Write image force params in `tick()`** after the existing `v.setUint32(88, gridDim, true)` line (byte 88):

```ts
const imgParams = this.imageForce.getExtraParams();
v.setFloat32(96, imgParams.imageStrength,  true);
v.setUint32 (100, imgParams.imageForceMode, true);
v.setUint32 (104, imgParams.imageInvert,    true);
// byte 108: _pad4 — zero from ArrayBuffer init
```

Also update the `uniformArray` allocation to 112 bytes:
```ts
const uniformArray = new ArrayBuffer(112);
```

- [ ] **Step 7: Notify imageProcessor of canvas resize** in `tick()` inside the resize check block:

```ts
if (resized || canvas.width !== this.prevCanvasWidth || canvas.height !== this.prevCanvasHeight) {
  this.trailRenderer.resize(device, canvas.width, canvas.height);
  this.imageProcessor.resize(canvas.width, canvas.height);  // ADD THIS LINE
  this.prevCanvasWidth  = canvas.width;
  this.prevCanvasHeight = canvas.height;
}
```

- [ ] **Step 8: Rebuild bind groups when image changes**

Add a public method to `BoidsController`:

```ts
rebuildBoidsBindGroups(): void {
  if (!this.gpu) return;
  const { device } = this.gpu;
  const boidsModule = device.createShaderModule({ code: this.shaderSource });
  this._createBoidsPipelines(boidsModule);
}
```

Call this from the panel section whenever a new image is loaded or cleared.

- [ ] **Step 9: Destroy image resources in cleanup** — if the controller has a `destroy()` method, add:

```ts
this.imageProcessor.destroy();
this.imageForce.destroy();
```

If no destroy method exists, skip — Astro pages handle cleanup on navigation.

- [ ] **Step 10: Smoke test**

```bash
npm run dev
```

Open `http://localhost:4321/gallery/boids`. No console errors. Boids run normally. The image force params default to `imageStrength = 0.0` so no visible effect yet — that's correct.

- [ ] **Step 11: Commit**

```bash
git add src/components/simulations/boids/boids-controller.ts
git commit -m "feat(boids): integrate ImageProcessor and BoidsImageForce into BoidsController"
```

---

## Task 11: ImagePanelSection UI

**Files:**
- Create: `src/lib/webgpu/image-editor/image-panel-section.ts`

- [ ] **Step 1: Create the panel section**

```ts
// src/lib/webgpu/image-editor/image-panel-section.ts

import type { ImageProcessor }  from './image-processor';
import type { BoidsImageForce } from '../../components/simulations/boids/boids-image-force';
  // Note: callers pass onRebindGroups instead of importing BoidsImageForce directly
import { ProcessingMode } from './image-editor-types';
import { createFileInput, attachDropZone } from './image-uploader';

export interface ImagePanelSectionOpts {
  onOpenEditor:     () => void;
  onRebindGroups:   () => void;  // called after image load/clear so controller rebuilds bind groups
  imageForce:       {
    setEnabled:   (v: boolean) => void;
    setStrength:  (v: number)  => void;
    setForceMode: (m: number)  => void;
    setInvert:    (v: boolean) => void;
    isActive:     () => boolean;
  };
}

export function buildImagePanelSection(
  container:  HTMLElement,
  processor:  ImageProcessor,
  opts:       ImagePanelSectionOpts,
): () => void  // returns cleanup fn
{
  const section = document.createElement('div');
  section.style.cssText = 'border-top:1px solid var(--bg-surface-border);padding:0.5rem 0.6rem;';
  container.appendChild(section);

  // ── Label row ─────────────────────────────────────────────────────
  const labelRow = document.createElement('div');
  labelRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:0.35rem;';
  const label = document.createElement('span');
  label.style.cssText = 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);';
  label.textContent = 'Image Force';
  const enableToggle = document.createElement('input');
  enableToggle.type    = 'checkbox';
  enableToggle.checked = true;
  enableToggle.title   = 'Enable/disable image force';
  enableToggle.addEventListener('change', () => {
    opts.imageForce.setEnabled(enableToggle.checked);
  });
  labelRow.appendChild(label);
  labelRow.appendChild(enableToggle);
  section.appendChild(labelRow);

  // ── Thumbnail canvas ───────────────────────────────────────────────
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width  = 180;
  thumbCanvas.height = 101;  // ~16:9
  thumbCanvas.style.cssText = 'width:100%;border-radius:3px;border:1px solid var(--bg-surface-border);display:block;margin-bottom:0.4rem;cursor:pointer;';
  thumbCanvas.title = 'Click to open editor';
  thumbCanvas.addEventListener('click', opts.onOpenEditor);
  section.appendChild(thumbCanvas);

  // Wire thumbnail to processor
  const thumbCtx = thumbCanvas.getContext('webgpu') as GPUCanvasContext | null;
  if (thumbCtx) {
    processor.setThumbnailContext(thumbCtx);
  }

  // ── Load image / paint buttons ─────────────────────────────────────
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:4px;margin-bottom:0.4rem;';

  const fileInput = createFileInput((bmp, _name) => {
    processor.loadImage(bmp);
    opts.onRebindGroups();
    refreshUI();
  });
  document.body.appendChild(fileInput);

  const loadBtn = document.createElement('button');
  loadBtn.className   = 'panel-close';
  loadBtn.textContent = 'Load Image';
  loadBtn.style.cssText = 'flex:1;font-size:0.65rem;padding:3px 6px;';
  loadBtn.addEventListener('click', () => fileInput.click());

  const paintBtn = document.createElement('button');
  paintBtn.className   = 'panel-close';
  paintBtn.textContent = 'Paint';
  paintBtn.style.cssText = 'flex:1;font-size:0.65rem;padding:3px 6px;';
  paintBtn.addEventListener('click', opts.onOpenEditor);

  btnRow.appendChild(loadBtn);
  btnRow.appendChild(paintBtn);
  section.appendChild(btnRow);

  // ── Force mode pills ───────────────────────────────────────────────
  const modeNames = ['Attract','Repel','Grad Flow','Grad Edge','Threshold','SDF'];
  const pillRow = document.createElement('div');
  pillRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:0.4rem;';
  modeNames.forEach((name, i) => {
    const pill = document.createElement('button');
    pill.textContent = name;
    pill.dataset.mode = String(i);
    pill.style.cssText = 'font-size:0.58rem;padding:2px 6px;border-radius:10px;border:1px solid var(--bg-surface-border);background:transparent;color:var(--text-muted);cursor:pointer;';
    if (i === 0) {
      pill.style.background = 'var(--accent)';
      pill.style.color      = 'var(--bg-primary)';
      pill.style.border     = '1px solid transparent';
    }
    pill.addEventListener('click', () => {
      pillRow.querySelectorAll('button').forEach((b: HTMLButtonElement) => {
        b.style.background = 'transparent';
        b.style.color      = 'var(--text-muted)';
        b.style.border     = '1px solid var(--bg-surface-border)';
      });
      pill.style.background = 'var(--accent)';
      pill.style.color      = 'var(--bg-primary)';
      pill.style.border     = '1px solid transparent';
      opts.imageForce.setForceMode(i);
      processor.setMode(i as any);
    });
    pillRow.appendChild(pill);
  });
  section.appendChild(pillRow);

  // ── Strength slider ────────────────────────────────────────────────
  const makeSlider = (labelText: string, min: number, max: number, val: number, step: number, cb: (v: number) => void) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:0.3rem;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);min-width:48px;';
    lbl.textContent = labelText;
    const inp = document.createElement('input');
    inp.type  = 'range'; inp.min = String(min); inp.max = String(max);
    inp.step  = String(step); inp.value = String(val);
    inp.style.cssText = 'flex:1;';
    inp.addEventListener('input', () => cb(Number(inp.value)));
    row.appendChild(lbl); row.appendChild(inp);
    section.appendChild(row);
  };

  makeSlider('Strength', 0, 2, 0.5, 0.01, v => opts.imageForce.setStrength(v));

  // ── Invert toggle ──────────────────────────────────────────────────
  const invertRow = document.createElement('div');
  invertRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:0.3rem;';
  const invertLbl = document.createElement('span');
  invertLbl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
  invertLbl.textContent   = 'Invert';
  const invertChk = document.createElement('input');
  invertChk.type = 'checkbox';
  invertChk.addEventListener('change', () => {
    opts.imageForce.setInvert(invertChk.checked);
  });
  invertRow.appendChild(invertLbl);
  invertRow.appendChild(invertChk);
  section.appendChild(invertRow);

  // ── Clear / Reset buttons ──────────────────────────────────────────
  const actionRow = document.createElement('div');
  actionRow.style.cssText = 'display:flex;gap:4px;margin-top:0.2rem;';
  const clearBtn = document.createElement('button');
  clearBtn.className   = 'panel-close';
  clearBtn.textContent = 'Clear Image';
  clearBtn.style.cssText = 'flex:1;font-size:0.6rem;padding:3px 6px;';
  clearBtn.addEventListener('click', () => {
    processor.clearImage();
    opts.onRebindGroups();
    refreshUI();
  });
  const resetBtn = document.createElement('button');
  resetBtn.className   = 'panel-close';
  resetBtn.textContent = 'Reset Paint';
  resetBtn.style.cssText = 'flex:1;font-size:0.6rem;padding:3px 6px;';
  resetBtn.addEventListener('click', () => {
    processor.resetPaint();
    refreshUI();
  });
  actionRow.appendChild(clearBtn);
  actionRow.appendChild(resetBtn);
  section.appendChild(actionRow);

  // Drop zone on the thumbnail
  const cleanupDrop = attachDropZone(thumbCanvas, (bmp) => {
    processor.loadImage(bmp);
    opts.onRebindGroups();
    refreshUI();
  });

  function refreshUI() {
    clearBtn.style.display  = processor.hasImage  ? '' : 'none';
    resetBtn.style.display  = processor.hasPaint  ? '' : 'none';
    processor.renderThumbnail();
  }
  refreshUI();

  return () => {
    cleanupDrop();
    fileInput.remove();
    section.remove();
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/webgpu/image-editor/image-panel-section.ts
git commit -m "feat(image-editor): add ImagePanelSection UI widget"
```

---

## Task 12: ImageEditorOverlay

**Files:**
- Create: `src/lib/webgpu/image-editor/image-editor-overlay.ts`

The overlay handles: full-screen mount/unmount, brush canvas with mouse events, transform drag/resize, processing controls, and "Done" button.

- [ ] **Step 1: Create image-editor-overlay.ts**

```ts
// src/lib/webgpu/image-editor/image-editor-overlay.ts

import type { ImageProcessor } from './image-processor';
import { BrushMode, ProcessingMode } from './image-editor-types';
import type { BrushOptions, ImageTransform } from './image-editor-types';
import { createFileInput } from './image-uploader';

export interface OverlayOpts {
  onClose:          () => void;
  onRebindGroups:   () => void;
}

export function openImageEditorOverlay(processor: ImageProcessor, opts: OverlayOpts): () => void {
  // ── Root overlay ──────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:1000',
    'display:flex',
    'background:rgba(5,4,2,0.82)',
    'backdrop-filter:blur(2px)',
  ].join(';');
  document.body.appendChild(overlay);

  // ── Left sidebar ──────────────────────────────────────────────────
  const sidebar = document.createElement('div');
  sidebar.style.cssText = [
    'width:180px;flex-shrink:0',
    'background:#0f0c07',
    'border-right:1px solid #2a2418',
    'padding:12px 10px',
    'overflow-y:auto',
    'display:flex;flex-direction:column;gap:10px',
  ].join(';');
  overlay.appendChild(sidebar);

  // ── Right canvas area ─────────────────────────────────────────────
  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;';
  overlay.appendChild(canvasWrap);

  const editorCanvas = document.createElement('canvas');
  editorCanvas.style.cssText = 'width:100%;height:100%;display:block;';
  canvasWrap.appendChild(editorCanvas);

  // ── Brush cursor ──────────────────────────────────────────────────
  const brushCursor = document.createElement('div');
  brushCursor.style.cssText = 'position:absolute;pointer-events:none;border:1.5px solid rgba(255,255,255,0.55);border-radius:50%;display:none;';
  canvasWrap.appendChild(brushCursor);

  // ── State ─────────────────────────────────────────────────────────
  let currentBrush: BrushMode = BrushMode.Paint;
  let brushRadius   = 30;   // canvas pixels
  let brushSoftness = 0.7;
  let isPainting    = false;
  let showForce     = true;

  // Image transform dragging
  let isDraggingImg = false;
  let dragStartX = 0, dragStartY = 0;
  let dragStartTf: ImageTransform = { ...processor.transform };

  // Resize handle dragging
  type HandleId = 'tl'|'tc'|'tr'|'ml'|'mr'|'bl'|'bc'|'br';
  let isResizing = false;
  let resizeHandle: HandleId | null = null;
  let resizeStartTf: ImageTransform = { ...processor.transform };
  let resizeStartMx = 0, resizeStartMy = 0;

  // ── Sidebar helpers ───────────────────────────────────────────────
  const makeLabel = (text: string): HTMLElement => {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:0.58rem;color:#5a4a35;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px;';
    el.textContent = text;
    return el;
  };

  const makeBtn = (text: string, active = false): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = [
      'flex:1;padding:4px 0;border-radius:3px;font-family:inherit;font-size:0.62rem;cursor:pointer',
      active
        ? 'background:#1e2818;border:1px solid #40c0a0;color:#80e0c8'
        : 'background:#1a1610;border:1px solid #2a2418;color:#7a6a50',
    ].join(';');
    return b;
  };

  const makeSlider = (label: string, min: number, max: number, val: number, step: number, cb: (v: number) => void): HTMLElement => {
    const row = document.createElement('div');
    const lbl = makeLabel(`${label}: ${val.toFixed(2)}`);
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = String(min); inp.max = String(max);
    inp.step = String(step); inp.value = String(val);
    inp.style.cssText = 'width:100%;margin-top:2px;';
    inp.addEventListener('input', () => {
      lbl.textContent = `${label}: ${Number(inp.value).toFixed(2)}`;
      cb(Number(inp.value));
    });
    row.appendChild(lbl); row.appendChild(inp);
    return row;
  };

  // ── Brush section ─────────────────────────────────────────────────
  sidebar.appendChild(makeLabel('Brush Mode'));
  const brushRow = document.createElement('div');
  brushRow.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;';

  const brushBtns: Record<BrushMode, HTMLButtonElement> = {
    [BrushMode.Paint]:      makeBtn('Paint',      true),
    [BrushMode.ErasePaint]: makeBtn('Erase',      false),
    [BrushMode.MaskImage]:  makeBtn('Mask Img',   false),
    [BrushMode.Blur]:       makeBtn('Blur',        false),
  };

  const selectBrush = (mode: BrushMode) => {
    currentBrush = mode;
    Object.entries(brushBtns).forEach(([m, btn]) => {
      const active = m === mode;
      btn.style.background = active ? '#1e2818' : '#1a1610';
      btn.style.borderColor = active ? '#40c0a0' : '#2a2418';
      btn.style.color       = active ? '#80e0c8' : '#7a6a50';
    });
    // Disable Mask Image if no image loaded
    brushBtns[BrushMode.MaskImage].disabled = !processor.hasImage;
    brushBtns[BrushMode.MaskImage].style.opacity = processor.hasImage ? '1' : '0.35';
  };

  Object.entries(brushBtns).forEach(([mode, btn]) => {
    btn.addEventListener('click', () => selectBrush(mode as BrushMode));
    brushRow.appendChild(btn);
  });
  sidebar.appendChild(brushRow);

  sidebar.appendChild(makeSlider('Size', 5, 200, brushRadius, 1, v => { brushRadius = v; }));
  sidebar.appendChild(makeSlider('Softness', 0, 1, brushSoftness, 0.01, v => { brushSoftness = v; }));

  // ── Processing section ────────────────────────────────────────────
  sidebar.appendChild(makeLabel('Processing'));

  const blurSlider = makeSlider('Blur radius', 0, 20, processor.params.blurRadius, 0.5,
    v => processor.setBlurRadius(v));
  sidebar.appendChild(blurSlider);

  const threshSlider = makeSlider('Threshold', 0, 1, processor.params.threshold, 0.01,
    v => processor.setThreshold(v));
  sidebar.appendChild(threshSlider);

  const invertRow = document.createElement('div');
  invertRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
  const invertLbl = document.createElement('span');
  invertLbl.style.cssText = 'font-size:0.6rem;color:#7a6a50;';
  invertLbl.textContent = 'Invert';
  const invertChk = document.createElement('input');
  invertChk.type    = 'checkbox';
  invertChk.checked = processor.params.invert;
  invertChk.addEventListener('change', () => processor.setInvert(invertChk.checked));
  invertRow.appendChild(invertLbl); invertRow.appendChild(invertChk);
  sidebar.appendChild(invertRow);

  // ── Fit presets ───────────────────────────────────────────────────
  sidebar.appendChild(makeLabel('Fit Preset'));
  const fitRow = document.createElement('div');
  fitRow.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;';
  const fits: Array<[string, () => ImageTransform]> = [
    ['Fill',    () => fitTransform('fill')],
    ['Contain', () => fitTransform('contain')],
    ['Fit W',   () => fitTransform('width')],
    ['Fit H',   () => fitTransform('height')],
    ['1:1',     () => fitTransform('original')],
  ];
  fits.forEach(([name, tfFn]) => {
    const btn = makeBtn(name);
    btn.addEventListener('click', () => {
      const tf = tfFn();
      processor.setTransform(tf);
      renderEditorCanvas();
    });
    fitRow.appendChild(btn);
  });
  sidebar.appendChild(fitRow);

  // ── Load image / Reset / Clear ─────────────────────────────────────
  const fileInput = createFileInput((bmp) => {
    processor.loadImage(bmp);
    opts.onRebindGroups();
    selectBrush(currentBrush);
  });
  document.body.appendChild(fileInput);

  const loadBtn = makeBtn('Load Image');
  loadBtn.addEventListener('click', () => fileInput.click());
  loadBtn.style.width = '100%';
  sidebar.appendChild(loadBtn);

  const resetPaintBtn = makeBtn('Reset Paint');
  resetPaintBtn.addEventListener('click', () => processor.resetPaint());
  resetPaintBtn.style.width = '100%';
  sidebar.appendChild(resetPaintBtn);

  const clearImgBtn = makeBtn('Clear Image');
  clearImgBtn.addEventListener('click', () => {
    processor.clearImage();
    opts.onRebindGroups();
    selectBrush(currentBrush);
  });
  clearImgBtn.style.width = '100%';
  sidebar.appendChild(clearImgBtn);

  // ── Force overlay toggle + Done button ────────────────────────────
  const forceToggleBtn = makeBtn('Show Force', true);
  forceToggleBtn.style.width = '100%';
  forceToggleBtn.addEventListener('click', () => {
    showForce = !showForce;
    forceToggleBtn.style.background   = showForce ? '#1e2818' : '#1a1610';
    forceToggleBtn.style.borderColor  = showForce ? '#40c0a0' : '#2a2418';
    forceToggleBtn.style.color        = showForce ? '#80e0c8' : '#7a6a50';
    renderEditorCanvas();
  });
  sidebar.appendChild(forceToggleBtn);

  const doneBtn = document.createElement('button');
  doneBtn.textContent = 'Done';
  doneBtn.style.cssText = 'margin-top:auto;padding:6px;width:100%;background:var(--accent);color:var(--bg-primary);border:none;border-radius:4px;font-family:inherit;font-size:0.72rem;cursor:pointer;';
  doneBtn.addEventListener('click', close);
  sidebar.appendChild(doneBtn);

  // ── Editor canvas: 2D rendering of transform/handles/force ────────
  function getCanvasRect() { return editorCanvas.getBoundingClientRect(); }

  function resizeEditorCanvas() {
    const r = getCanvasRect();
    editorCanvas.width  = Math.round(r.width);
    editorCanvas.height = Math.round(r.height);
    renderEditorCanvas();
  }

  function renderEditorCanvas() {
    const ctx = editorCanvas.getContext('2d');
    if (!ctx) return;
    const { width: cw, height: ch } = editorCanvas;
    ctx.clearRect(0, 0, cw, ch);

    const tf = processor.transform;

    // Draw image bounds
    if (processor.hasImage) {
      ctx.strokeStyle = 'rgba(224,160,64,0.5)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(tf.offsetX, tf.offsetY, tf.scaleX, tf.scaleY);
    }

    // Draw handles
    if (processor.hasImage) {
      drawHandles(ctx, tf);
    }

    // "no force" zones
    ctx.font      = '10px monospace';
    ctx.fillStyle = 'rgba(90,74,53,0.6)';
    ctx.textAlign = 'center';
    if (tf.offsetY > 20) ctx.fillText('no force', cw / 2, tf.offsetY / 2);
    const botY = tf.offsetY + tf.scaleY;
    if (botY < ch - 20) ctx.fillText('no force', cw / 2, botY + (ch - botY) / 2);
  }

  const HANDLE_SIZE = 8;
  const handles: Array<{ id: HandleId; ax: number; ay: number }> = [
    { id: 'tl', ax: 0,   ay: 0   }, { id: 'tc', ax: 0.5, ay: 0   }, { id: 'tr', ax: 1,   ay: 0   },
    { id: 'ml', ax: 0,   ay: 0.5 },                                   { id: 'mr', ax: 1,   ay: 0.5 },
    { id: 'bl', ax: 0,   ay: 1   }, { id: 'bc', ax: 0.5, ay: 1   }, { id: 'br', ax: 1,   ay: 1   },
  ];

  function drawHandles(ctx: CanvasRenderingContext2D, tf: ImageTransform) {
    ctx.fillStyle = '#e0c060';
    handles.forEach(({ ax, ay }) => {
      const hx = tf.offsetX + ax * tf.scaleX - HANDLE_SIZE / 2;
      const hy = tf.offsetY + ay * tf.scaleY - HANDLE_SIZE / 2;
      ctx.fillRect(hx, hy, HANDLE_SIZE, HANDLE_SIZE);
    });
  }

  function hitHandle(mx: number, my: number, tf: ImageTransform): HandleId | null {
    for (const { id, ax, ay } of handles) {
      const hx = tf.offsetX + ax * tf.scaleX;
      const hy = tf.offsetY + ay * tf.scaleY;
      if (Math.abs(mx - hx) < HANDLE_SIZE + 2 && Math.abs(my - hy) < HANDLE_SIZE + 2) return id;
    }
    return null;
  }

  function hitImage(mx: number, my: number, tf: ImageTransform): boolean {
    return mx >= tf.offsetX && mx <= tf.offsetX + tf.scaleX &&
           my >= tf.offsetY && my <= tf.offsetY + tf.scaleY;
  }

  // Canvas-relative mouse coords
  function canvasXY(e: MouseEvent): [number, number] {
    const r = editorCanvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ── Mouse events: brush painting ──────────────────────────────────
  editorCanvas.addEventListener('mousedown', (e) => {
    const [mx, my] = canvasXY(e);
    const tf = processor.transform;

    // Check resize handles first
    const h = hitHandle(mx, my, tf);
    if (h && processor.hasImage) {
      isResizing = true; resizeHandle = h;
      resizeStartTf = { ...tf };
      resizeStartMx = mx; resizeStartMy = my;
      return;
    }

    // Check image drag
    if (hitImage(mx, my, tf) && processor.hasImage) {
      isDraggingImg = true;
      dragStartX = mx; dragStartY = my;
      dragStartTf = { ...tf };
      return;
    }

    // Else: brush stroke
    isPainting = true;
    applyBrushAt(mx, my);
  });

  editorCanvas.addEventListener('mousemove', (e) => {
    const [mx, my] = canvasXY(e);

    // Update brush cursor
    const sz = brushRadius * 2;
    brushCursor.style.display = 'block';
    brushCursor.style.width   = sz + 'px';
    brushCursor.style.height  = sz + 'px';
    brushCursor.style.left    = (mx - brushRadius) + 'px';
    brushCursor.style.top     = (my - brushRadius) + 'px';

    if (isResizing && resizeHandle) {
      applyResize(mx, my);
      return;
    }
    if (isDraggingImg) {
      processor.setTransform({
        ...processor.transform,
        offsetX: dragStartTf.offsetX + (mx - dragStartX),
        offsetY: dragStartTf.offsetY + (my - dragStartY),
      });
      renderEditorCanvas();
      return;
    }
    if (isPainting) applyBrushAt(mx, my);
  });

  const stopAll = () => { isPainting = false; isDraggingImg = false; isResizing = false; resizeHandle = null; };
  editorCanvas.addEventListener('mouseup',    stopAll);
  editorCanvas.addEventListener('mouseleave', () => { brushCursor.style.display = 'none'; stopAll(); });

  function applyBrushAt(mx: number, my: number) {
    const opts: BrushOptions = { mode: currentBrush, x: mx, y: my, radius: brushRadius, softness: brushSoftness };
    processor.brushStroke(opts);
    renderEditorCanvas();
  }

  function applyResize(mx: number, my: number) {
    const dx = mx - resizeStartMx;
    const dy = my - resizeStartMy;
    const tf  = { ...resizeStartTf };
    const id  = resizeHandle!;

    if (id.includes('l')) { tf.offsetX += dx; tf.scaleX -= dx; }
    if (id.includes('r')) { tf.scaleX  += dx; }
    if (id.includes('t')) { tf.offsetY += dy; tf.scaleY -= dy; }
    if (id.includes('b')) { tf.scaleY  += dy; }

    // Clamp: minimum size 20px
    if (tf.scaleX < 20 || tf.scaleY < 20) return;
    processor.setTransform(tf);
    renderEditorCanvas();
  }

  // ── Fit transform helpers ──────────────────────────────────────────
  function fitTransform(mode: string): ImageTransform {
    const cw = editorCanvas.width  || editorCanvas.clientWidth;
    const ch = editorCanvas.height || editorCanvas.clientHeight;
    // Use processor's stored image dims via its transform as a proxy
    // (We don't expose imageWidth/Height directly, so we compute from current transform)
    // For now use the canvas dimensions as a stand-in
    const imgAspect = (processor as any).imageWidth / (processor as any).imageHeight || 16/9;
    const canvasAspect = cw / ch;
    let iw: number, ih: number;
    if (mode === 'fill') {
      if (imgAspect > canvasAspect) { ih = ch; iw = ih * imgAspect; }
      else { iw = cw; ih = iw / imgAspect; }
    } else if (mode === 'contain') {
      if (imgAspect > canvasAspect) { iw = cw; ih = iw / imgAspect; }
      else { ih = ch; iw = ih * imgAspect; }
    } else if (mode === 'width')  { iw = cw; ih = iw / imgAspect; }
    else if (mode === 'height')   { ih = ch; iw = ih * imgAspect; }
    else                          { iw = Math.min(cw, (processor as any).imageWidth || cw); ih = iw / imgAspect; }
    return { offsetX: (cw - iw) / 2, offsetY: (ch - ih) / 2, scaleX: iw, scaleY: ih };
  }

  // ── Cleanup / close ───────────────────────────────────────────────
  function close() {
    fileInput.remove();
    overlay.remove();
    resizeObserver.disconnect();
    opts.onClose();
  }

  const resizeObserver = new ResizeObserver(resizeEditorCanvas);
  resizeObserver.observe(canvasWrap);
  resizeEditorCanvas();
  selectBrush(BrushMode.Paint);

  return close;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/webgpu/image-editor/image-editor-overlay.ts
git commit -m "feat(image-editor): add ImageEditorOverlay with brush, drag, resize handles"
```

---

## Task 13: BoidsPanel integration and smoke test

**Files:**
- Modify: `src/components/simulations/boids/boids-panel.ts`

- [ ] **Step 1: Import the panel section builder and overlay opener** at the top of `boids-panel.ts`:

```ts
import { buildImagePanelSection } from '../../../lib/webgpu/image-editor/image-panel-section';
import { openImageEditorOverlay  } from '../../../lib/webgpu/image-editor/image-editor-overlay';
```

- [ ] **Step 2: Add controller type to the parameter** (boids-panel already receives `controller: BoidsController` — verify it has `imageProcessor` and `imageForce` on it, which Task 10 added).

- [ ] **Step 3: Mount the image panel section** at the bottom of `buildBoidsPanel()`, before the closing brace:

```ts
buildImagePanelSection(container, controller.imageProcessor, {
  onOpenEditor: () => {
    openImageEditorOverlay(controller.imageProcessor, {
      onClose:        () => { /* overlay closed */ },
      onRebindGroups: () => controller.rebuildBoidsBindGroups(),
    });
  },
  onRebindGroups: () => controller.rebuildBoidsBindGroups(),
  imageForce: controller.imageForce,
});
```

- [ ] **Step 4: Full end-to-end smoke test**

```bash
npm run dev
```

1. Open `http://localhost:4321/gallery/boids`
2. Open the side panel
3. Scroll to "Image Force" section — verify thumbnail canvas and buttons appear
4. Click "Load Image" — select any PNG/JPG
5. Verify thumbnail updates to show the processed image
6. Enable the toggle — boids should start responding to image force
7. Try each force mode pill — verify boids change behavior
8. Click "Open Editor" — verify overlay opens, boids continue running behind it
9. Paint with brush — verify strokes appear (thumbnail updates)
10. Drag the image in the overlay — verify it repositions and thumbnail updates
11. Drag a resize handle — verify the image scales
12. Click "Done" — verify overlay closes
13. Click "Reset Paint" — verify paint clears
14. Open console — confirm no WebGPU validation errors

- [ ] **Step 5: Commit**

```bash
git add src/components/simulations/boids/boids-panel.ts
git commit -m "feat(boids): wire ImagePanelSection and overlay into boids panel"
```

---

## Task 14: Build verification and worktree merge

- [ ] **Step 1: Production build**

```bash
npm run build
```

Expected: exits 0. Check for TypeScript errors or missing imports. Fix any before proceeding.

- [ ] **Step 2: Preview build**

```bash
npm run preview
```

Open `http://localhost:4321/gallery/boids` in the preview. Repeat the smoke test from Task 13 Step 4. Confirm the feature works in the production build (no dev-server-only dependencies).

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -p  # stage only relevant changes
git commit -m "fix(image-editor): address build-time issues"
```

- [ ] **Step 4: Merge to main**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git merge feat/image-force-field --no-ff -m "feat: add image force field with GPU editor (boids)"
git worktree remove ../website-image-force
```

---

## Known implementation notes

- **`textureSampleLevel` not `textureSample`**: compute shaders cannot use `textureSample`. Use `textureSampleLevel(tex, samp, uv, 0.0)` in `boids.wgsl`.
- **`rgba32float` for SDF ping-pong**: `rgba8unorm` has insufficient precision for storing pixel coordinates. The `sdfPingTexture` must be `rgba32float`. Ensure the device supports this format (it's a core WebGPU feature).
- **Bind group rebuild on image load**: `BoidsController.rebuildBoidsBindGroups()` must be called every time `imageProcessor.loadImage()` or `imageProcessor.clearImage()` is called, because the GPUTexture reference changes.
- **`_pad4` in Params struct**: the uniform buffer is 112 bytes (next multiple of 16 after 108). Confirm `createUniformBuffer(device, 112)` in `boids-controller.ts`.
- **`imageWidth`/`imageHeight` access in overlay**: `fitTransform()` in the overlay accesses `(processor as any).imageWidth`. To avoid the cast, expose these as public readonly fields on `ImageProcessor`.
- **Thumbnail WebGPU context**: some browsers require the canvas to be attached to the DOM before `getContext('webgpu')` works. `buildImagePanelSection` appends the section to `container` before calling `setThumbnailContext`, which handles this.
