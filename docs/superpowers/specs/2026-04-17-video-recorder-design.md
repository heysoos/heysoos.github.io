# Video Recorder Design

**Date:** 2026-04-17
**Feature:** Simulation video recording for WebGPU simulations (starting with boids)

---

## Overview

Users can record the boids simulation canvas to a downloadable video file. A bottom-strip UI provides full recording controls (format, quality, FPS, duration, trim, realtime toggle, audio). A record button in the controls bar opens/closes the strip. Recording captures only the WebGPU canvas — no UI overlays appear in the output.

Two recording modes:

- **Realtime:** `canvas.captureStream()` + `MediaRecorder`. Records whatever the simulation produces in wall time. Zero GPU overhead. Works everywhere.
- **Non-realtime:** WebCodecs `VideoEncoder` + muxer. Steps the simulation at a fixed `dt = 1/targetFPS`, waits for GPU completion each frame, stamps frames with synthetic timestamps. Output is always exactly the target FPS regardless of GPU speed. Chrome/Edge only.

Output formats: **WebM** (VP8/VP9) and **MP4** (H.264). Both available in realtime mode; both available in non-realtime mode on supported browsers.

---

## Architecture

### New files

| File | Purpose |
|------|---------|
| `src/lib/webgpu/recorder.ts` | `SimRecorder` class — all recording logic, format-agnostic |
| `src/lib/webgpu/recording-strip.ts` | `buildRecordingStrip()` — builds and manages the bottom-strip DOM |

### Modified files

| File | Change |
|------|--------|
| `src/components/Controls.astro` | Add record button (●) with `data-action="record"` |
| `src/pages/gallery/[...slug].astro` | Mount strip container, instantiate `SimRecorder`, wire controls button, pass recorder to strip builder |
| `src/components/simulations/boids/boids-audio.ts` | Add `getStream(): MediaStream \| null` to `AudioReactor` |
| `src/components/simulations/boids/boids-controller.ts` | Add `tickOnce()` public method for non-realtime frame-by-frame driving |

### New dependencies

| Package | Size | Purpose |
|---------|------|---------|
| `mp4-muxer` | ~25 KB | Mux H.264 chunks into MP4 container |
| `webm-muxer` | ~20 KB | Mux VP9 chunks into WebM container (non-realtime path) |
| `soundtouchjs` | ~45 KB | Pitch-preserving time-stretch for audio sync in non-realtime mode |

All three are pure JS (no WASM), tree-shakeable, and only loaded when the recording strip is used.

---

## SimRecorder API

```typescript
interface RecordingOptions {
  format: 'webm' | 'mp4';
  videoBitsPerSecond: number;   // 2_500_000 | 8_000_000 | 20_000_000 | custom
  fpsHint: number;              // 30 | 60 | 0 (uncapped) — ignored in non-realtime
  maxDuration: number;          // seconds; 0 = unlimited
  trimStart: number;            // seconds to discard from the front of the recording
  realtime: boolean;            // true = captureStream path; false = WebCodecs path
  audioStream?: MediaStream;    // present = include audio track
}

class SimRecorder {
  getState(): 'idle' | 'recording'
  getRealDuration(): number          // wall-clock seconds elapsed since start()
  start(canvas: HTMLCanvasElement, opts: RecordingOptions): void
  stop(): Promise<Blob>
  onStop?: (blob: Blob, opts: RecordingOptions) => void
}
```

`SimRecorder` is simulation-agnostic. Any future simulator hands it a canvas — no other coupling.

---

## Recording Paths

### Realtime path

1. `canvas.captureStream(fpsHint)` → video `MediaStream`
2. If `audioStream` is provided: combine audio track + video track into a single `MediaStream`
3. Select codec:
   - WebM: `video/webm;codecs=vp9` (fallback `vp8`); with audio: `video/webm;codecs=vp9,opus`
   - MP4: `video/webm;codecs=h264` — MediaRecorder encodes H.264 in a WebM container; chunks are rewrapped into MP4 via `mp4-muxer` on stop
   - If MP4 codec unavailable (`MediaRecorder.isTypeSupported` returns false): surface error in strip, do not start
4. Collect `ondataavailable` chunks with wall-clock timestamps
5. On `stop()`:
   - Discard all chunks whose cumulative wall-clock offset is less than `trimStart` seconds (always retain chunk index 0 — it contains codec initialization data)
   - WebM: `new Blob(chunks, { type: 'video/webm' })`
   - MP4: feed chunks through `mp4-muxer`, return resulting blob
6. Auto-download blob; audio and video are naturally in sync (both real-time)

### Non-realtime path

Browser check: if `typeof VideoEncoder === 'undefined'`, disable the checkbox in the strip with tooltip: _"Non-realtime requires Chrome or Edge."_

1. Pause the simulation's RAF loop (`controller.stop()`)
2. Instantiate `VideoEncoder` + appropriate muxer (`mp4-muxer` or `webm-muxer`)
3. If `audioStream`: start a parallel audio-only `MediaRecorder` (codec: `audio/webm;codecs=opus`), collect audio chunks with timestamps
4. Frame loop (async, sequential):
   ```
   while (recording && frameCount < maxFrames) {
     controller.tickOnce()                     // new public method: one simulation step at dt = 1/targetFPS
     await device.queue.onSubmittedWorkDone()  // wait for GPU
     const frame = new VideoFrame(canvas, {
       timestamp: frameCount * (1_000_000 / targetFPS)  // microseconds
     })
     encoder.encode(frame)
     frame.close()
     frameCount++
   }
   ```
5. On `stop()`:
   - `await encoder.flush()` → finalize video muxer
   - If audio: stop audio `MediaRecorder`, decode audio chunks into `AudioBuffer`
     - Stretch ratio = `videoDuration / audioDuration`
     - Apply `soundtouchjs` pitch-preserving time-stretch at computed ratio
     - Encode stretched audio via `AudioEncoder` → feed into muxer audio track
   - Resume simulation RAF loop (`controller.start()`)
6. Return combined blob

**Audio stretch ratio warning:** if the ratio exceeds 1.5 (sim running at less than 67% of target speed), display in strip: _"Audio quality may be affected — try lowering target FPS."_

---

## Audio Recording

- The strip shows an **"Include audio"** checkbox only when `AudioReactor.isActive()` returns true (mic permission granted and audio tab enabled). Hidden otherwise.
- `AudioReactor` gains a `getStream(): MediaStream | null` method that exposes its underlying `getUserMedia` stream.
- The slug page passes `reactor.getStream()` to `SimRecorder.start()` as `audioStream` when the checkbox is checked.
- **Realtime + audio:** single `MediaStream` (video + audio tracks) → `MediaRecorder` → one file. Naturally in sync.
- **Non-realtime + audio:** video and audio encoded separately then muxed together. Audio is time-stretched via `soundtouchjs` to match video duration. A warning in the strip explains the sync caveat before recording starts.

---

## UI

### Controls bar button

Added to `Controls.astro` as a fifth `ctrl-btn`:

- **Icon:** SVG filled circle (⏺), 10px radius
- **At rest:** `var(--text-primary)`
- **Strip open:** `var(--accent)`
- **Recording active:** red (`#c0392b`), CSS `@keyframes` pulse animation
- **Behavior:** toggles strip open/closed; never directly starts/stops recording

### Bottom strip

A horizontal bar anchored to the bottom edge of `sim-viewport`, slides up with `transform: translateY(100%)` → `translateY(0)` transition (200ms ease-out). Same card aesthetic as the params panel: `var(--bg-nav)` background, `backdrop-filter: blur(8px)`, `1px solid var(--bg-surface-border)` border (top edge only), `z-index: 15`.

Strip layout (left → right), all on one row with labeled sections:

```
| 🎞 FORMAT       | ⚡ FPS           | 📊 QUALITY                      | ⏱ MAX     | ✂ TRIM  | [RECORD] |
| [WebM] [MP4]   | [30] [60] [Max] | [●Low] [●Med] [●High] [──●──]  | [─●──60s] | [─●──0s] |          |
```

Below the controls row, a slim secondary row (shown contextually):
- WebM + quality ≥ 8 Mbps: _"⚠ For best performance at high bitrate, use MP4."_
- Non-realtime mode active: _"⚠ Audio captured in real time — quality may vary if sim runs below target FPS."_ (only when audio checkbox is checked)
- Non-realtime, stretch ratio > 1.5 during recording: _"⚠ Audio quality may be affected — try lowering target FPS."_

**Color coding:**

| Element | Color |
|---------|-------|
| Format pills (inactive) | `var(--bg-surface-border)` |
| Format pills (active) | `var(--accent)` |
| Quality dot — Low | `var(--text-muted)` dim circle |
| Quality dot — Medium | `#c8a84b` warm yellow |
| Quality dot — High | `var(--accent)` bright |
| FPS pills | same as format pills |
| Duration / Trim sliders | accent-colored thumb |
| ✂ Trim label | `var(--text-muted)` (signals "discard") |
| Realtime checkbox | `accent-color: var(--accent)` |
| Include audio checkbox | `accent-color: var(--accent)` |

**Record button (right end of strip):**

- **Idle:** red background (`#c0392b`), white text, SVG filled-circle icon + `REC`
- **Recording:** dark background, white text, SVG filled-square icon + `STOP`, button border pulses red
- **Timer:** `00:12 · ~1.4 MB` appears left of the button during recording, monospace, `var(--accent)` color

### Settings summary

| Control | Options | Default |
|---------|---------|---------|
| Format | WebM / MP4 | WebM |
| Quality | Low (2.5 Mbps) / Med (8 Mbps) / High (20 Mbps) / Custom (slider 1–50 Mbps) | High |
| FPS cap | 30 / 60 / Max | 60 |
| Max duration | slider 5s–300s + Unlimited toggle | 60s |
| Trim start | slider 0–30s | 0s |
| Realtime | checkbox | checked |
| Include audio | checkbox (hidden if audio inactive) | checked |

---

## File Download

On `stop()`, auto-download is triggered:

```typescript
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `boids-${Date.now()}.${format}`;
a.click();
URL.revokeObjectURL(url);
```

Filename format: `boids-{unix-timestamp}.webm` or `boids-{unix-timestamp}.mp4`.

---

## Browser Compatibility

| Feature | Chrome | Edge | Firefox | Safari |
|---------|--------|------|---------|--------|
| Realtime WebM | ✅ | ✅ | ✅ | ✅ |
| Realtime MP4 | ✅ | ✅ | ❌ (fallback msg) | ✅ |
| Non-realtime (WebCodecs) | ✅ | ✅ | ❌ (checkbox disabled) | ✅ 16.4+ |
| Audio recording | ✅ | ✅ | ✅ | ✅ |

---

## Reusability

`SimRecorder` and `buildRecordingStrip` are simulation-agnostic. To wire up a future simulator:
1. Instantiate `SimRecorder`
2. Call `buildRecordingStrip(container, recorder, { controller, getAudioStream? })`
3. Wire the controls-bar record button to `strip.toggle()`

No boids-specific code lives in either utility file.
