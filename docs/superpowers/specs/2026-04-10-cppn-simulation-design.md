# CPPN Simulation — Design Spec
**Date:** 2026-04-10

## Overview

Implement a Compositional Pattern Producing Network (CPPN) as a WebGPU gallery simulation. The CPPN forward pass runs entirely in a dynamically generated WGSL fragment shader — evaluated at every pixel in parallel. A rich control panel exposes architecture configuration, weight distributions, and an animated latent z-band system. An admin page enables preset saving/loading mirroring the boids pattern.

The piece is designed as interactive art: random weight draws produce instant organic imagery, z-band oscillators animate the latent space, and future audio integration will map spectral bands directly to z-band amplitudes.

---

## File Structure

```
src/components/simulations/cppn/
  CPPN.astro              — component wrapper (replaces existing stub)
  cppn-controller.ts      — WebGPU state, render loop, weight generation, z animation
  cppn-codegen.ts         — pure function: generateShader(config) → WGSL string
  cppn-panel.ts           — sidebar UI builder (mirrors boids-panel.ts pattern)

src/data/
  cppn-presets.ts         — auto-generated preset file (like boids-presets.ts)

src/pages/admin/
  cppn.astro              — admin page (mirrors admin/boids.astro)

astro.config.mjs          — gains /api/admin/save-cppn-presets endpoint
```

`src/components/simulations/cppn/cppn.wgsl` is deleted — the shader is generated dynamically by `cppn-codegen.ts`.

**Separation of concerns:**
- `cppn-codegen.ts` — no WebGPU, no DOM. Pure string generation.
- `cppn-controller.ts` — no DOM. Pure GPU state and math.
- `cppn-panel.ts` — no GPU. Pure UI construction.

---

## Data Model

```typescript
type Activation = 'tanh' | 'sin' | 'cos' | 'abs' | 'sigmoid';

interface LayerConfig {
  width: number;        // number of neurons in this hidden layer
  activation: Activation;
}

type DistributionType = 'normal' | 'uniform' | 'glorot' | 'sparse';

interface WeightDistribution {
  type: DistributionType;
  sigma?: number;     // Normal: std dev (default 1.0)
  a?: number;         // Uniform: range [-a, a] (default 1.0)
  scale?: number;     // Glorot: scale multiplier (default 1.0)
  sparsity?: number;  // Sparse: fraction of zeros (default 0.8)
  magnitude?: number; // Sparse: scale of non-zero weights (default 2.0)
}

interface ZBand {
  freq: number;       // cycles/second, range 0.05–4.0
  amplitude: number;  // range 0.0–2.0
  phase: number;      // global phase offset in radians
}

interface CPPNConfig {
  zDim: number;               // total latent dimensions (default 16)
  layers: LayerConfig[];      // hidden layers only; input/output are fixed
  distribution: WeightDistribution;
  numBands: number;           // 2 | 3 | 4
  zBands: ZBand[];            // length === numBands
  scale: number;              // coordinate space scale (default 1.0, range 0.1–5.0)
}

interface CPPNPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  config: CPPNConfig;
  weights: number[];  // serialized Float32Array — exact reproduction
  seed: number;       // seed that generated these weights — enables variations
}
```

**Fixed inputs:** x, y, r (always 3 coordinate inputs, no nulls).
**Fixed output:** RGB (3 channels, sigmoid activation).

---

## Shader Codegen (`cppn-codegen.ts`)

`generateShader(config: CPPNConfig): string` produces a complete WGSL module with the exact architecture unrolled — no runtime branching.

### Uniform / storage layout

```wgsl
struct Params {
  resolution: vec2f,
  time: f32,
  _pad: f32,
  z: array<f32, MAX_Z_DIM>,  // MAX_Z_DIM = 32 (compile-time constant)
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> weights: array<f32>;
```

### Weight buffer layout (codegen and weight-gen share the same offset logic)

```
[w_x:   hidden0_width floats]              — coordinate x projection (no bias)
[w_y:   hidden0_width floats]              — coordinate y projection (no bias)
[w_r:   hidden0_width floats]              — coordinate r projection (no bias)
[w_z:   zDim × hidden0_width floats]       — z projection (no bias)
[w1:    hidden0_width × hidden1_width + hidden1_width floats]  — weight + bias
...
[w_out: hiddenN_width × 3 floats]          — output projection (no bias)
```

### Fragment shader structure (generated, unrolled)

```wgsl
@fragment fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  // 1. Compute normalised coordinates
  let aspect = params.resolution.x / params.resolution.y;
  let x = ((pos.x / params.resolution.x) * 2.0 - 1.0) * aspect * scale;
  let y =  (pos.y / params.resolution.y) * 2.0 - 1.0;
  let r = sqrt(x*x + y*y);

  // 2. Project each coordinate separately into first hidden layer, sum
  var h0: array<f32, HIDDEN0_WIDTH>;
  for (var i = 0u; i < HIDDEN0_WIDTH; i++) {
    h0[i] = x * weights[i]
           + y * weights[HIDDEN0_WIDTH + i]
           + r * weights[2*HIDDEN0_WIDTH + i]
           + dot(z_vec, weights_z_slice(i));  // z projection
  }
  // 3. Apply activation (unrolled per layer)
  h0 = tanh_vec(h0);  // or sin, cos, abs, sigmoid — per layer

  // 4. Subsequent hidden layers (matrix multiply + bias + activation, unrolled)
  // ...

  // 5. Output layer (no bias, sigmoid)
  let rgb = sigmoid(matmul_out(hN));
  return vec4f(rgb, 1.0);
}
```

Array sizes are compile-time literals in the generated code — no dynamic allocation.

---

## Z-Band System

### Per-frame computation

```
dimOffset[dim]  — random per-dimension phase, fixed at randomize time
z[dim] = band.amplitude * sin(2π * band.freq * t + band.phase + dimOffset[dim])
```

Dimensions are evenly distributed across bands: with zDim=16 and numBands=4, band 0 owns dims 0–3, band 1 owns dims 4–7, etc.

### Audio future-proofing

The controller exposes:
```typescript
setZBandAmplitude(bandIndex: number, value: number): void
```
The audio integration layer calls this each frame with FFT band energy — no structural changes needed.

---

## Controller (`cppn-controller.ts`)

### GPU buffers

| Buffer | Type | When rebuilt |
|--------|------|-------------|
| `paramsBuffer` | uniform | on init only; written every frame |
| `weightsBuffer` | storage, read | on architecture change or randomize |

### Recompile triggers (architecture changes)
1. Generate WGSL via `generateShader(config)`
2. `device.createShaderModule()`
3. `device.createRenderPipeline()`
4. Reallocate `weightsBuffer` to match new weight count
5. Randomize weights with current distribution + seed

All other operations (randomize weights, change distribution params, z animation, scale change) are buffer writes only — no recompile.

### Seeded PRNG

`mulberry32` (~5 lines) lives in `cppn-controller.ts`. All distribution samplers are built on top of it:
- **Normal:** Box-Muller transform
- **Uniform:** direct scale
- **Glorot:** uniform scaled by `√(6 / (fan_in + fan_out))`
- **Sparse:** uniform sample, zero-masked by sparsity threshold

Saving a preset captures `seed`. Pasting a seed and hitting Randomize replays the exact weight sequence.

### Frame loop
1. Compute `z[dim]` for all dims from band params + `dimOffset[dim]` + elapsed time
2. `writeBuffer(paramsBuffer, ...)` — resolution + pad + z values
3. Render pass: fullscreen quad (6 vertices, no vertex buffer)

---

## UI Panel (`cppn-panel.ts`)

Three tabs, same visual language as boids panel:

### Arch tab
- Layer stack rendered top-to-bottom
- Fixed header row: **Input (x, y, r)** — non-editable
- Per hidden layer row: width number input + activation dropdown + delete button
- Fixed footer row: **Output (RGB, sigmoid)** — non-editable
- "Add layer" button beneath the stack
- Shader recompiles automatically on any change

### Weights tab
- Distribution picker: `Normal` | `Uniform` | `Glorot` | `Sparse`
- Contextual param sliders (shown/hidden based on selection):
  - Normal: σ
  - Uniform: a
  - Glorot: scale
  - Sparse: sparsity + magnitude
- Seed field (editable — paste to restore; updates on randomize)
- "Randomize" button (prominent)

### Z tab
- Animate toggle (global on/off)
- Num bands selector: 2 / 3 / 4
- Per band: freq slider + amplitude slider + phase slider
- "Randomize offsets" button (reshuffles per-dim phase offsets)

---

## Admin Page (`src/pages/admin/cppn.astro`)

Mirrors `admin/boids.astro`:
- Canvas area (left) + sidebar (right)
- Sidebar tabs: **Params** (the three-tab panel above) + **Presets**
- Presets tab: list of presets with rename/delete/set-default, name input + seed display, "Save" button, "Write to disk" button
- `astro.config.mjs` gains `/api/admin/save-cppn-presets` endpoint that writes `src/data/cppn-presets.ts`

### Preset file format (`cppn-presets.ts`)

Auto-generated, same pattern as `boids-presets.ts`:
```typescript
// AUTO-GENERATED by /admin/cppn — do not edit manually
export const CPPN_PRESETS: CPPNPreset[] = [ ... ];
```

Weights arrays are serialized as plain JSON number arrays. For a typical 4-layer × 64-wide network this is ~16,000 numbers — acceptable for a static site.

---

## Default Behaviour & Gallery Integration

One preset is marked `isDefault: true`. The gallery page and any preview controller load this preset on init — providing the visual identity for the simulation card thumbnail and background.

The gallery page (`/gallery/cppn`) renders full-viewport with the floating control panel, matching the boids gallery experience.

---

## Out of Scope (this iteration)

- Audio input (mic or file) — z-band amplitude API is the hookup point
- Skip connections / non-linear architectures
- Fourier feature encoding
- Trainable coordinate grids
- High-res export
