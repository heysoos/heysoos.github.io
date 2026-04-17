# Boids XY Pad — Forces Panel Redesign

**Date:** 2026-04-17
**Scope:** Replace the eight individual force sliders in the Params panel's Forces section with four interactive 2D XY pads. All other sections (Appearance, Simulation, Perception) are unchanged.

---

## Problem

The Forces section currently has eight separate sliders (Attraction, Repulsion, Attraction Radius, Repulsion Radius, Alignment, Friction, Max Speed, Noise). These parameters are deeply coupled — changing Attraction without adjusting Repulsion rarely produces interesting results. Sliders obscure these relationships and feel disconnected from the organic, fluid nature of the simulation.

---

## Design

### Four XY Pads replacing the Forces sliders

Each pad controls two semantically paired parameters simultaneously. The 2×2 grid layout is:

| Top-left | Top-right |
|---|---|
| Attraction ↔ Repulsion | Attr Radius ↔ Rep Radius |
| **Bottom-left** | **Bottom-right** |
| Alignment ↔ Noise | Max Speed ↔ Friction |

Attraction/Repulsion and their radii are adjacent (top row) because they describe the same physical interaction at different scales.

### Label placement

Each pad uses **diagonal corner chips**:
- **Y-axis label** (icon + name): top-left corner chip
- **X-axis label** (icon + name): bottom-right corner chip

Labels are horizontal, never rotated. They sit on a frosted dark background (`rgba(10,8,4,0.82)` + `backdrop-filter: blur`) so they remain legible over the trace.

### Value readouts

Values are **not** below the pad. Instead they project onto their respective axis edges, tracking the dot:
- **X value**: floats along the top edge at the dot's horizontal position
- **Y value**: floats along the right edge at the dot's vertical position

Faint tick lines extend from the dot to each edge, making the projection relationship explicit.

### Icons (chosen set)

| Parameter | Icon concept | Symbol ID |
|---|---|---|
| Attraction | Bold inward chevrons, two particles | `ic-attract` |
| Repulsion | Radial burst from centre dot | `ic-repulse` |
| Alignment | Three parallel arrows with arrowheads | `ic-align` |
| Noise | Zigzag waveform | `ic-noise` |
| Max Speed | Arrow with motion streak lines | `ic-speed` |
| Friction | Wavy line over ground strokes | `ic-friction` |
| Attr/Rep Radius | Concentric dashed circles with particles | `ic-radius` |

SVG icons are defined as `<symbol>` elements in a shared sprite. All use `currentColor` and a `24×24` viewBox. Rendered at 12–13px inside chips.

### Audio reactivity trace

When audio is active, each pad draws a fading history path on a `<canvas>` overlay (z-index 0, beneath the chips):

- **Time window:** 6.5 seconds of history kept
- **Fade:** opacity is `pow(t, 1.3) * 0.65 * (0.25 + 0.75 * totalMag)` where `t` is normalised age (0 = oldest, 1 = newest) and `totalMag` is the combined modulation magnitude that frame
- **Colour:** Option B — blended across active band colours proportional to their amplitude. Bass = amber (`#c08030`), Mid = teal (`#30a0b8`), High = rose (`#b03060`). When a single band dominates you get a pure colour; when multiple bands co-drive the same pad the trace blends. This is honest about the multi-band situation rather than picking a winner.
- **Tip glow:** last 400ms gets a blurred wider stroke for a trailing-light effect, scaled by `totalMag`
- **Width:** 1–2.8px, growing toward the tip

`totalMag` per history point = `sum(amplitude_i × gain_i)` across all active mappings whose target param belongs to this pad's parameter pair, normalised to [0, 1].

### Dot

- 9px filled circle, accent colour
- `box-shadow: 0 0 7px var(--accent-glow), 0 0 0 1.5px var(--bg-surface)` (halo separates it from trace)
- Draggable; `baseX`/`baseY` updated on drag, audio drift offset from there

---

## What does NOT change

- Appearance section: Size, Opacity, Opacity Mode, Shape, Color, Trails — all unchanged
- Simulation section: Time Step, Particles — unchanged, no icons added
- Perception section: Vision Cone, Mouse Radius — unchanged sliders, no icons
- Audio tab: unchanged
- Image tab: unchanged
- Audio indicator bars under sliders (for params that remain as sliders): unchanged

---

## Implementation sketch

### `boids-panel.ts`

Replace the `addSlider` calls in the Forces block with a new `buildForcesPads(parent, controller, updMaps)` function that:

1. Creates a `<div class="pads-grid">` with `display:grid; grid-template-columns:1fr 1fr; gap:8px`
2. Calls `buildXYPad(container, defX, defY, controller)` four times
3. Returns `{ teardown, updateAudioViz }` handles

### `buildXYPad(container, xDef, yDef, controller)`

```ts
interface XYPadDef {
  paramKey: string;          // controller.params key
  label:    string;          // display name
  iconId:   string;          // SVG symbol href
  min:      number;
  max:      number;
  scale:    'linear' | 'log';
}
```

Responsibilities:
- Creates pad DOM (surface, canvas, dot, chips, value readouts, tick lines)
- Wires mousedown drag → updates both params on `controller.params`
- Returns `updateTrace(snapshot: BandSnapshot, mappings: AudioMapping[])` so the audio loop can push new history points

### Audio trace update

Called from `updateAudioViz` in the panel (same rAF loop as existing indicator bars):

```ts
// Compute totalMag for this pad's two params
const mag = mappings
  .filter(m => m.enabled && (m.param === xDef.paramKey || m.param === yDef.paramKey))
  .reduce((sum, m) => sum + Math.min(1, snapshot[m.band] * (m.gain ?? 1)), 0);

// Normalise to [0,1]
const normMag = Math.min(1, mag);

// Current (audio-modulated) position in normalised [0,1] space
const nx = toNorm(controller.params[xDef.paramKey], xDef);
const ny = toNorm(controller.params[yDef.paramKey], yDef);

history.push({ x: nx, y: ny, bands: bandAmplitudes, mag: normMag, ts: performance.now() });
```

`bandAmplitudes` is the per-band amplitude array used for colour blending.

`toNorm` maps a raw param value to [0,1] in the pad's coordinate space:
```ts
function toNorm(v: number, def: XYPadDef): number {
  if (def.scale === 'log') {
    return (Math.log(Math.max(v, def.min)) - Math.log(def.min)) / (Math.log(def.max) - Math.log(def.min));
  }
  return (v - def.min) / (def.max - def.min);
}
```

### CSS additions to `[...slug].astro`

```css
.params-panel :global(.pads-grid) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 2px;
}
.params-panel :global(.pad-surf) {
  position: relative; aspect-ratio: 1; width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--bg-surface-border);
  border-radius: 4px; cursor: crosshair; overflow: hidden;
}
/* … axis-chip, chip-y-label, chip-x-label, val-y, val-x, tick-y, tick-x … */
```

---

## Open questions

- **Reset behaviour:** double-click on pad to reset both params to preset values? Or keep the existing ↺ reset approach per-param somehow?
- **Log scale params:** Attraction Radius and Repulsion Radius currently use linear scale — should the pad normalise them logarithmically like the old sliders did?
