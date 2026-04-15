# Webcam Force Field — Design Spec

**Date:** 2026-04-15
**Feature:** Live webcam input as a force-field source for the boids simulation

---

## Overview

Add a webcam source to the existing Image tab in the boids panel. Users can toggle between a static image and a live webcam feed as the input to the image-processing pipeline. The processed video frame drives the same force-field mechanism already used by static images — no changes to the boids shader or force bindings are required.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where does webcam live? | Source toggle inside existing Image tab | One fewer tab; image and webcam share processing controls |
| Processing params | Independent per source | Users can tune mode/blur/strength separately for webcam vs static |
| Frame update | Throttled, configurable fps (default 30) | Reduces GPU upload cost at high particle counts |
| Architecture | Thin `BoidsWebcam` class + one new method on `ImageProcessor` | Follows existing `BoidsImageForce` adapter pattern; zero duplication of GPU pipeline |

---

## Architecture

```
getUserMedia → HTMLVideoElement
        │
        ▼
BoidsWebcam.tick()          ← called from BoidsController.tick() each frame
        │  (throttled to targetFps)
        ▼
ImageProcessor.writeVideoFrame(video)   ← new method (1 addition)
        │
        ▼
existing pipeline: composite → blur → mode (luminance/gradient/threshold/SDF)
        │
        ▼
processedTexture (rgba8unorm)
        │
        ▼
BoidsImageForce — bindings 7 & 8        ← unchanged
        │
        ▼
boids.wgsl — force applied to particles ← unchanged
```

The boids shader, `BoidsImageForce`, and all existing GPU compute pipelines are untouched. The webcam feed is just a new way to populate `sourceTexture` inside `ImageProcessor`.

---

## Components

### `ImageProcessor` — one new method

```ts
writeVideoFrame(video: HTMLVideoElement): void
```

- Checks `video.readyState >= HAVE_CURRENT_DATA`; returns early if not ready
- Reallocates `sourceTexture` only when `video.videoWidth / videoHeight` changes (rare — typically once on start)
- Uses `device.queue.copyExternalImageToTexture({ source: video }, ...)` — synchronous, no `ImageBitmap` allocation
- Sets `hasImage = true` so `BoidsImageForce.isActive()` returns true
- Calls `_triggerReprocess()` to re-run composite → blur → mode pipeline

### `BoidsWebcam` — new file: `src/components/simulations/boids/boids-webcam.ts`

```ts
export class BoidsWebcam {
  status: 'idle' | 'active' | 'error'
  lastError: string
  targetFps: number               // default 30
  mirrored: boolean               // default true
  params: ProcessingParams        // independent copy; default mode = GradientEdge
  availableCameras: MediaDeviceInfo[]
  activeCameraId: string | null

  async start(cameraId?: string): Promise<void>
  stop(): void
  async enumerateCameras(): Promise<MediaDeviceInfo[]>
  tick(processor: ImageProcessor): void  // call each render frame
  destroy(): void
}
```

**`tick()` logic:**
```
elapsed = now - lastFrameTime
if elapsed < 1000 / targetFps → return (throttle)
lastFrameTime = now
processor.writeVideoFrame(this.video)
```

**`start()` logic:**
1. Call `enumerateCameras()` and populate `availableCameras`
2. Call `getUserMedia({ video: { deviceId: cameraId } })`
3. Create `HTMLVideoElement`, assign stream, call `video.play()`
4. Listen for `track.onended` → set `status = 'error'`, call `stop()`
5. Set `status = 'active'`

### `BoidsController` — minimal additions

```ts
readonly webcam = new BoidsWebcam()

// In init():
//   webcam shares this.imageProcessor — no new GPU resources needed

// In tick():
if (this.webcam.status === 'active') {
  this.webcam.tick(this.imageProcessor);
}

// In destroy():
this.webcam.destroy();
```

### `image-panel-section.ts` — extended

**New `opts` fields:**
```ts
webcam: BoidsWebcam
onRebindGroups: () => void   // already exists
```

**Source toggle:** Two pills at the top — `📷 Static` / `🎥 Webcam`. Clicking swaps:
- The input area (thumbnail+Load/Paint ↔ live preview+camera controls)
- The active `ProcessingParams` bound to all sliders (save current → restore other)
- Calls `processor.setMode/setBlurRadius/setThreshold/setInvert` with the restored params

**Static section (shown when source = Static):**
- Thumbnail canvas (existing)
- Load Image / Paint buttons (existing)
- Clear Image / Reset Paint buttons (existing)

**Webcam section (shown when source = Webcam):**
- Live preview canvas (same size as thumbnail, green border when active, rendered via `processor.renderThumbnail()` each tick)
- Camera selector `<select>` populated from `webcam.availableCameras` (calls `enumerateCameras()` on first switch to Webcam)
- Start / Stop button (toggles `webcam.start()` / `webcam.stop()`)
- Error message div (red, shown when `webcam.status === 'error'`)
- Capture fps slider (5–60, step 1, default 30)
- Mirror toggle checkbox

**Shared processing section (always visible below the source area):**
- Force mode pills: Attract / Repel / Grad Flow / Grad Edge / Threshold / SDF
- Strength slider (0–2)
- Blur radius slider (0–10)
- Invert checkbox
- Show image checkbox

---

## Panel UI States

```
┌─────────────────────────────────┐
│ [📷 Static]  [🎥 Webcam]  ☑ on │  ← source toggle + enabled
├─────────────────────────────────┤
│                                 │
│   [thumbnail / live preview]    │  ← switches per source
│                                 │
│  Static:  [Load Image] [Paint]  │  ← source-specific controls
│  Webcam:  [camera ▾] [▶ Start]  │
│           fps:──●── 30  ☑ Mirror│
│           ● Camera Name Active  │
├─────────────────────────────────┤
│  FORCE MODE                     │  ← always visible, independent params
│  [Attract][Repel][Grad Flow]... │
│  Strength ──●──────── 0.5       │
│  Blur     ────●────── 2         │
│  Invert ☐    Show img ☑         │
└─────────────────────────────────┘
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Camera permission denied | `status = 'error'`, error message shown below Start button |
| Camera disconnected mid-stream | `track.onended` fires → `stop()`, `status = 'error'` |
| Frame not ready (`readyState < HAVE_CURRENT_DATA`) | `writeVideoFrame` returns early; frame skipped silently |
| `copyExternalImageToTexture` throws | Caught, frame skipped; render loop continues |

All patterns match the existing `AudioReactor` error handling in the Audio tab.

---

## Files Changed

| File | Change |
|---|---|
| `src/lib/webgpu/image-editor/image-processor.ts` | Add `writeVideoFrame(video)` method |
| `src/lib/webgpu/image-editor/image-panel-section.ts` | Add source toggle, webcam UI section, param swapping |
| `src/components/simulations/boids/boids-webcam.ts` | **New** — `BoidsWebcam` class |
| `src/components/simulations/boids/boids-controller.ts` | Add `webcam` property, call `webcam.tick()` in render loop |
| `src/lib/webgpu/image-editor/image-editor-types.ts` | No change expected |
| `src/lib/webgpu/image-editor/image-editor-overlay.ts` | No change |
| `src/components/simulations/boids/boids-panel.ts` | Pass `webcam` into `buildImagePanelSection` opts |
| `src/pages/gallery/[...slug].astro` | No change |

**No changes to:** `boids.wgsl`, `boids-image-force.ts`, any other shaders.

---

## Out of Scope

- Background segmentation / person matting
- Recording / saving webcam output
- Using webcam in simulations other than boids
- Audio-reactive mapping of webcam parameters
