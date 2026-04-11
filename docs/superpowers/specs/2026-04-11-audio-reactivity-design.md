# Audio Reactivity for Boids — Design Spec

**Date:** 2026-04-11
**Status:** Approved

---

## Overview

Add real-time audio reactivity to the Boids simulation. Frequency band amplitudes modulate simulation parameters (attraction/repulsion radii, force strengths, vision cone angle); total volume modulates time step / speed. A dedicated UI tab in the existing panel provides customisable mappings per band per parameter.

---

## Architecture

### Approach: Self-contained `AudioReactor` class

`AudioReactor` lives in `src/components/simulations/boids/boids-audio.ts`. It owns the entire Web Audio pipeline and mapping table. The `BoidsController` is **not modified** — audio modulation is applied to `controller.params` in-place by the panel's animation loop, before the controller writes uniforms to the GPU.

```
MediaStream (mic or system)
  → MediaStreamSourceNode
  → AnalyserNode
  → getByteFrequencyData() each frame
  → BandSnapshot { bass, mid, presence, hi, volume }
  → applyMappings(controller.params, snapshot)
  → controller tick writes modulated params to GPU
```

---

## AudioReactor (`boids-audio.ts`)

### Band definitions

| Band     | Frequency range | Colour token       |
|----------|-----------------|--------------------|
| bass     | 20–250 Hz       | `--band-bass` (red)   |
| mid      | 250–2000 Hz     | `--band-mid` (amber)  |
| presence | 2000–6000 Hz    | `--band-pres` (green) |
| hi       | 6000–20000 Hz   | `--band-hi` (blue)    |
| volume   | RMS full spectrum | `#b48cf0` (violet)  |

All band values are normalised to **0–1**.

### Public API

```ts
type BandKey = 'bass' | 'mid' | 'presence' | 'hi' | 'volume';

interface BandSnapshot {
  bass: number; mid: number; presence: number; hi: number; volume: number;
}

interface AudioMapping {
  param: keyof BoidsParams;
  band: BandKey;
  mode: 'add' | 'multiply';
  depth: number;   // 0–1, scales the modulation amount
  min: number;     // clamp floor (param-space units)
  max: number;     // clamp ceiling (param-space units)
  enabled: boolean;
}

class AudioReactor {
  mappings: AudioMapping[];

  start(source: 'microphone' | 'system'): Promise<void>;
  stop(): void;
  analyze(): BandSnapshot;             // call each frame
  getFrequencyData(): Uint8Array;      // raw FFT for visualiser canvas
  applyMappings(params: BoidsParams, snapshot: BandSnapshot): void;

  saveMappings(): void;                // persist to localStorage
  loadMappings(): void;                // restore from localStorage
}
```

### `applyMappings` logic

For each enabled mapping, read `baseParams` (a snapshot of `controller.params` taken at the **start** of each apply call, before any mapping mutates it) so modulations are always relative to the user's slider intent:

- **add mode:** `params[p] = clamp(base + band × depth × (max − min), min, max)`
- **multiply mode:** `params[p] = clamp(base × (1 + band × depth), min, max)`

### Mappable parameters

`attractionRadius`, `repulsionRadius`, `attraction`, `repulsion`, `alignment`, `friction`, `maxSpeed`, `coneAngle`, `dt`

### Persistence

Mappings are serialised to `localStorage` under key `boids-audio-mappings` as JSON. Loaded on `AudioReactor` construction. Saved whenever any mapping changes.

### Audio source

- **Microphone:** `navigator.mediaDevices.getUserMedia({ audio: true })`
- **System audio:** `navigator.mediaDevices.getDisplayMedia({ audio: true, video: false })`
  - Falls back gracefully with error status if browser/OS does not support it.

---

## Panel UI

### Tab bar

The existing panel header title ("Parameters") is replaced by a **three-tab bar**: `Params` | `Audio` | `Image`. Each tab body is a pre-built `div` toggled via `display: block / none`. The Image tab wraps the existing `buildImagePanelSection` content unchanged.

### Audio tab — layout (top to bottom)

1. **Source row**
   - Two pill buttons: `Microphone` / `System Audio`
   - Status dot: idle (dim) / listening (animated red pulse) / error (amber)
   - Error message shown inline on failure

2. **Spectrum visualiser**
   - `<canvas>` ~200 × 40 px, redrawn each frame
   - Bars coloured by band region (bass → mid → presence → hi)
   - Drawn by `drawAudioViz(canvas, reactor)` helper

3. **Band meters**
   - Four labelled amplitude bars: bass / mid / presence / hi / vol
   - Updated live each frame alongside the visualiser

4. **Mappings list**
   - One row per `AudioMapping` in `reactor.mappings`
   - Each row contains:
     - **Param dropdown** — lists all mappable `BoidsParams` keys (human-readable labels)
     - **Band selector** — five pill toggles: B / M / P / H / V (single-select per mapping)
     - **Mode toggle** — `+` (add) / `×` (multiply)
     - **Depth slider** — 0–1
     - **Min / Max inputs** — pre-filled from param's natural range; user-editable
     - **Remove button** (×)
   - Rows are created/destroyed reactively as mappings are added/removed

5. **"+ Add Mapping" button**
   - Appends a new `AudioMapping` with sensible defaults (first unmapped param, bass band, add, depth 0.5, param's full range)

### Visualiser animation

The panel sets up **two loops**:

1. **Mapping loop** — runs whenever the reactor is active (regardless of which tab is showing):
   1. `snapshot = reactor.analyze()`
   2. `reactor.applyMappings(controller.params, snapshot)`
   
   This ensures boids react to audio even when the user is browsing the Params or Image tab.

2. **Visualiser loop** — runs only when the Audio tab is visible:
   1. `drawAudioViz(vizCanvas, reactor)`
   2. Update band meter bar widths

Both loops are **separate** from the controller's own rAF loop — no coupling. The visualiser loop is started/stopped by tab switch; the mapping loop is started/stopped by `reactor.start()` / `reactor.stop()`.

---

## File changes

| File | Change |
|------|--------|
| `src/components/simulations/boids/boids-audio.ts` | **New** — `AudioReactor` class |
| `src/components/simulations/boids/boids-panel.ts` | Add tab bar; add Audio tab builder; wire `AudioReactor` |
| `src/pages/gallery/[...slug].astro` | Instantiate `AudioReactor`; pass to `buildBoidsPanel` |

`BoidsController` and all WGSL shaders are **unchanged**.

---

## Edge cases

- **Autoplay policy:** `AudioContext` is created inside the `start()` call which is always triggered by a user gesture (button click) — no issue.
- **System audio unavailable:** `getDisplayMedia` rejection is caught; status dot turns amber with inline message "Try Microphone instead."
- **Tab hidden:** `document.visibilitychange` pauses the visualiser rAF loop to avoid wasted work.
- **Mapping with no active reactor:** `applyMappings` is a no-op if the reactor is not started — sliders behave normally.
- **Param out of clamp range at rest:** min/max inputs are validated; `min < max` is enforced on blur.
