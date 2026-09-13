# Field Boids — Design

A boids simulation that replaces particle–particle interaction with particle–field interaction, so it scales to physarum-scale particle counts (millions). Inspired by Sage Jensen's physarum transport networks and the Fluoddity engine (vector trail, sensor taps). The physics is standard boids; only the neighbour sum is replaced by a fixed stencil of texture taps over a density + momentum field.

## Model

Each frame every particle deposits a small gaussian splat of `(1, vx, vy)` into a field texture. The field therefore holds, per texel, local density ρ and local momentum m = Σv. Each particle then reads the field at a fixed set of sample points ("taps") and evaluates the same three boid sums the pairwise version does:

```
attract += ρ_k · dir_k / (r_k² + ε) · area_k     (cone taps, r ≤ attractionRadius)
align   += (m_k − ρ_k · v) · area_k               (cone taps)                 // = Σ (v_j − v)
repulse -= ρ_k · dir_k / (r_k² + ε) · area_k     (inner ring taps, r ≤ repulsionRadius)
```

`area_k` is the patch each tap represents; each tap samples the mip level whose texel footprint matches that patch, capped so the mip texel is at most half the tap radius (a coarser footprint quantises the force onto the mip grid and particles lock into a lattice). Each accumulated sum is divided by `max(neighbourCount, 1)` (mean-field normalisation) so slider values keep their meaning at any particle count; a single neighbour reproduces pairwise boids exactly. Because the sum is a mean, the `1/r²` kernels are scaled by the corresponding radius² so the force is O(1)·slider regardless of radius. The cone rings sit at ⅙, ½, ⅚ × attractionRadius (midpoint quadrature: the tap areas tile the sector exactly).

**Memory.** The field is multiplied by `memory ∈ [0, 1)` before deposit. `memory = 0` is pure instantaneous boids; higher values give a decaying physarum-style trail that particles also react to.

## Files

`src/components/simulations/field-boids/`

| File | Purpose |
|---|---|
| `field-boids-controller.ts` | WebGPU setup, buffers, textures, frame loop. Exports `FieldBoidsController` with `init/start/stop/reset` and public runtime params. |
| `field-boids-panel.ts` | `buildFieldBoidsPanel(container, controller, opts)` — minimal panel. |
| `field-boids.wgsl` | Sense + integrate compute pass. |
| `field-deposit.wgsl` | Instanced gaussian splat into the field (additive). |
| `field-view.wgsl` | Fullscreen quad vertex, decay pass, mip downsample, field display, point display. |

Plus: `src/data/field-boids-presets.ts` (auto-generated), `src/pages/admin/field-boids.astro`, save middleware in `astro.config.mjs`, `src/content/projects/field-boids.md`, controller registration in `src/pages/gallery/[...slug].astro`.

## Data

- Particle: `{ pos: vec2f, vel: vec2f }` (16 B). `MAX_PARTICLES = 2_000_000`, default 500 000. Positions in NDC `[-1, 1]²`, torus wrap (as boids).
- Field: two `rgba16float` textures (ping-pong A/B), 1024 texels on the long side, aspect matched to the canvas, full mip chain, linear filtering, repeat addressing. Channels `(ρ, mx, my, 0)`.
- Uniform `Params` mirrors boids' layout where fields overlap: deltaTime, attractionRadius, repulsionRadius, attraction, repulsion, alignment, friction, maxSpeed, numParticles, mouseX/Y/Active/Radius, coneAngle, aspect, tick, noise; plus memory, splatSize (texels), viewMode, exposure, fieldSize.

## Frame

1. **Decay** — fullscreen pass: `B = A × memory`. When `memory == 0`, skip the pass and clear `B` via `loadOp: "clear"` in the deposit pass.
2. **Deposit** — instanced quads (one per particle), `splatSize` texels wide, gaussian weight `w`, fragment output `(w, w·vx, w·vy, 0)`, blend `one + one`, into `B` level 0.
3. **Mips** — downsample blits `level n → n+1` on `B` (2×2 box via linear sample at texel corner).
4. **Sense + integrate** — compute, workgroup 64, one thread per particle. Taps read `B` with `textureSampleLevel`. Cone stencil: 3 rings at ⅙, ½, ⅚ × attractionRadius, 5 taps per ring spread across `±coneAngle` about the heading. Repulsion stencil: 6 taps on a ring at ½ × repulsionRadius, all directions. No centre tap (avoids self-interaction). LOD per tap = `log2(sqrt(patch area in texels))`, capped at `log2(tap radius in texels / 2)`, clamped to the mip range. Then friction, noise, mouse attraction, max-speed clamp, integrate, wrap — same formulas as `boids.wgsl`.
5. **Display** — `viewMode 0` (field): fullscreen pass, brightness = `1 − exp(−ρ · exposure)` tinted with theme accent; sub-mode hue-by-flow-direction using `atan2(my, mx)`. `viewMode 1` (points): instanced point draw straight to the swapchain, additive, low alpha, theme accent.
6. Swap A/B.

## Panel

Sections, following `panel-styles.ts` conventions from boids:

- **Simulation**: particle count, attraction radius, repulsion radius, attraction, repulsion, alignment, cone angle, friction, max speed, noise.
- **Field**: memory, splat size.
- **View**: mode (field / flow / points), exposure.
- Presets: dropdown from `FIELD_BOIDS_PRESETS`; editing via `/admin/field-boids`.

## Out of scope (v1)

Audio reactivity, shader editor, image/webcam force, XY pad, obstacles. Controller params are plain public properties so these can be added later the way boids does.

## Verification

- `npm run build` passes.
- Dev server: 500k particles run at 60 fps; flocking emerges from a random start; memory slider transitions smoothly to trail-like behaviour; all three views render; presets load and save through the admin page.
