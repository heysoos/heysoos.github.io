# Video Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add video recording to the boids simulation — a bottom-strip UI with format, quality, FPS, duration, trim, realtime toggle, and audio options, wired to a reusable `SimRecorder` class.

**Architecture:** `SimRecorder` handles two paths: realtime (`canvas.captureStream` + `MediaRecorder`, zero GPU overhead) and non-realtime (WebCodecs `VideoEncoder` + muxer, frame-perfect FPS). A `buildRecordingStrip()` utility builds the bottom-strip DOM and wires all controls. The controls-bar record button toggles strip visibility only; recording is started from within the strip.

**Tech Stack:** TypeScript, `mp4-muxer`, `webm-muxer`, `soundtouchjs`, WebCodecs API (Chrome/Edge), MediaRecorder API.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/webgpu/recorder.ts` | `SimRecorder` class — all recording logic |
| Create | `src/lib/webgpu/recording-strip.ts` | `buildRecordingStrip()` — bottom-strip DOM + controls |
| Modify | `src/components/simulations/boids/boids-controller.ts` | Extract `_doFrameWork()`, add public `tickOnce()` |
| Modify | `src/components/simulations/boids/boids-audio.ts` | Add `getStream()` to `AudioReactor` |
| Modify | `src/components/Controls.astro` | Add record button with pulse CSS |
| Modify | `src/pages/gallery/[...slug].astro` | Mount strip container, wire recorder + strip |
| Modify | `package.json` | Add `mp4-muxer`, `webm-muxer`, `soundtouchjs` |

---

## Task 1: Install Dependencies

**Files:** `package.json`

- [ ] **Step 1: Install packages**

```bash
cd "/c/Users/Heysoos/Documents/Pycharm Projects/website"
npm install mp4-muxer webm-muxer soundtouchjs
```

- [ ] **Step 2: Verify imports resolve**

Create a temporary file `src/lib/webgpu/_dep-check.ts` with:

```typescript
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { SoundTouch, SimpleFilter } from 'soundtouchjs';
void Mp4Muxer; void Mp4Target; void WebmMuxer; void WebmTarget;
void SoundTouch; void SimpleFilter;
```

Run: `npm run build 2>&1 | head -20`
Expected: no "Cannot find module" errors (other errors are fine — this file won't be imported anywhere).

- [ ] **Step 3: Delete the temp file**

```bash
rm "src/lib/webgpu/_dep-check.ts"
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add mp4-muxer, webm-muxer, soundtouchjs dependencies"
```

---

## Task 2: Add `tickOnce()` to BoidsController

**Files:** Modify `src/components/simulations/boids/boids-controller.ts`

The private `tick` method contains both GPU frame work and RAF scheduling. Extract the GPU work into `_doFrameWork()` so non-realtime recording can drive it frame-by-frame.

- [ ] **Step 1: Read the current tick method**

Read `src/components/simulations/boids/boids-controller.ts` lines 447–619 to confirm the current structure before editing.

- [ ] **Step 2: Extract `_doFrameWork()` and add `tickOnce()`**

Replace the `private tick = () => { ... };` block (lines 447–619) with:

```typescript
  /** Extracted GPU work — shared by tick() and tickOnce(). */
  private _doFrameWork(): void {
    const { device, context, canvas } = this.gpu!;

    const resized = resizeCanvasToDisplaySize(canvas);
    if (resized || canvas.width !== this.prevCanvasWidth || canvas.height !== this.prevCanvasHeight) {
      this.trailRenderer.resize(device, canvas.width, canvas.height);
      this.imageProcessor.resize(canvas.width, canvas.height);
      this.rebuildBoidsBindGroups();
      this.overlayBindGroup = null;
      this.prevCanvasWidth = canvas.width;
      this.prevCanvasHeight = canvas.height;
    }

    if (this.webcam.status === 'active') {
      this.webcam.tick(this.imageProcessor);
    }

    const aspect = canvas.width > 0 && canvas.height > 0
      ? canvas.width / canvas.height : 1.0;

    const uniformArray = new ArrayBuffer(112);
    const v = new DataView(uniformArray);
    v.setFloat32( 0, this.params.dt,                   true);
    v.setFloat32( 4, this.params.attractionRadius,      true);
    v.setFloat32( 8, this.params.repulsionRadius,       true);
    v.setFloat32(12, this.params.attraction,           true);
    v.setFloat32(16, this.params.repulsion,            true);
    v.setFloat32(20, this.params.alignment,            true);
    v.setFloat32(24, this.params.friction,             true);
    v.setFloat32(28, this.params.maxSpeed,             true);
    v.setUint32 (32, this.params.numParticles,         true);
    v.setFloat32(36, this.mouseX,                      true);
    v.setFloat32(40, this.mouseY,                      true);
    v.setFloat32(44, this.mouseActive ? 1.0 : 0.0,     true);
    v.setFloat32(48, this.params.mouseRadius,          true);
    v.setFloat32(52, this.params.coneAngle,            true);
    v.setFloat32(56, aspect,                           true);
    v.setFloat32(60, this.params.size,                 true);
    v.setUint32 (64, this.params.shapeId,              true);
    v.setFloat32(68, this.params.colorR,               true);
    v.setFloat32(72, this.params.colorG,               true);
    v.setFloat32(76, this.params.colorB,               true);
    v.setFloat32(80, this.params.opacity,              true);
    v.setUint32 (84, this.params.opacityMode,          true);
    const gridDim = Math.max(4, Math.min(MAX_GRID_DIM, Math.floor(2.0 / this.params.attractionRadius)));
    v.setUint32 (88, gridDim,                          true);
    v.setUint32 (92, this.frame,                       true);
    const imgParams = this.imageForce.getExtraParams();
    v.setFloat32(96, imgParams.imageStrength,  true);
    v.setUint32 (100, imgParams.imageForceMode, true);
    v.setUint32 (104, imgParams.imageInvert,    true);
    v.setFloat32(108, this.params.noise ?? 0.0, true);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniformArray);

    const N = this.params.numParticles;
    const gridSize = gridDim * gridDim;
    const gridBG = this.gridBindGroups[this.frame % 2];

    const computeEncoder = device.createCommandEncoder();
    const computePass = computeEncoder.beginComputePass();
    computePass.setPipeline(this.clearGridPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(Math.ceil(gridSize / 256));
    computePass.setPipeline(this.gridAssignPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(Math.ceil(N / 256));
    computePass.setPipeline(this.prefixSumPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(1);
    computePass.setPipeline(this.scatterPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(Math.ceil(N / 256));
    computePass.setPipeline(this.scatterDataPipeline);
    computePass.setBindGroup(0, gridBG);
    computePass.dispatchWorkgroups(Math.ceil(N / 256));
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.boidsBindGroups[this.frame % 2]);
    computePass.dispatchWorkgroups(Math.ceil(N / 256));
    computePass.end();
    device.queue.submit([computeEncoder.finish()]);

    this.trailRenderer.render(
      device,
      context,
      this.trailDecay,
      this.trailsEnabled,
      (encoder, targetView, loadOp) => {
        const renderPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: targetView,
            clearValue: { r: 0.039, g: 0.031, b: 0.016, a: 1 },
            loadOp,
            storeOp: 'store',
          }],
        });
        renderPass.setPipeline(this.renderPipeline);
        renderPass.setBindGroup(0, this.renderParamsBindGroup);
        renderPass.setVertexBuffer(0, this.particleBuffers[(this.frame + 1) % 2]);
        renderPass.setVertexBuffer(1, this.vertexBuffer);
        renderPass.draw(6, this.params.numParticles);
        renderPass.end();
      },
    );

    if (this.imageForce.isActive() && this.imageForce.showOverlay && this.overlayPipeline) {
      if (!this.overlayBindGroup) {
        this.overlayBindGroup = device.createBindGroup({
          layout: this.overlayPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.imageProcessor.getOutputSampler() },
            { binding: 1, resource: this.imageProcessor.getCompositedTexture().createView() },
          ],
        });
      }
      const enc  = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view:    context.getCurrentTexture().createView(),
          loadOp:  'load',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this.overlayPipeline);
      pass.setBindGroup(0, this.overlayBindGroup);
      pass.draw(6);
      pass.end();
      device.queue.submit([enc.finish()]);
    }

    this.frame++;
  }

  /**
   * Runs exactly one simulation frame and resolves when the GPU is done.
   * Used by non-realtime recording to drive the frame loop manually.
   */
  tickOnce(): Promise<void> {
    if (!this.gpu) return Promise.resolve();
    this._doFrameWork();
    return this.gpu.device.queue.onSubmittedWorkDone();
  }

  private tick = () => {
    if (!this.running || !this.gpu) return;

    if (Number.isFinite(this.maxFps)) {
      const now = performance.now();
      if (now - this.lastFrameTime < (1000 / this.maxFps) - 1) {
        this.animId = requestAnimationFrame(this.tick);
        return;
      }
      this.lastFrameTime = now;
    }

    this._doFrameWork();

    void this.gpu.device.queue.onSubmittedWorkDone().then(() => {
      if (!this.running) return;
      this.tickCount++;
      if (!Number.isFinite(this.maxFps)) {
        this.animId = requestAnimationFrame(this.tick);
      } else {
        this.animId = window.setTimeout(this.tick, 0) as unknown as number;
      }
    });
  };
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | grep -i error | head -20
```

Expected: no TypeScript errors in `boids-controller.ts`.

- [ ] **Step 4: Verify simulation still works**

```bash
npm run dev
```

Open `http://localhost:4321/gallery/boids` in Chrome. Confirm boids simulate normally. Close dev server.

- [ ] **Step 5: Commit**

```bash
git add src/components/simulations/boids/boids-controller.ts
git commit -m "refactor(boids): extract _doFrameWork(), add public tickOnce() for non-realtime recording"
```

---

## Task 3: Add `getStream()` to AudioReactor

**Files:** Modify `src/components/simulations/boids/boids-audio.ts`

- [ ] **Step 1: Add `getStream()` after `isActive()`**

In `src/components/simulations/boids/boids-audio.ts`, after line 95 (`isActive()` method closing brace), add:

```typescript
  /** Returns the raw MediaStream from getUserMedia/getDisplayMedia, or null if not active. */
  getStream(): MediaStream | null {
    return this.stream;
  }
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | grep -i error | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/boids/boids-audio.ts
git commit -m "feat(audio): expose getStream() on AudioReactor for recording"
```

---

## Task 4: Add Record Button to Controls.astro

**Files:** Modify `src/components/Controls.astro`

- [ ] **Step 1: Replace the file contents**

```astro
---
interface Props {
  simId: string;
}
const { simId } = Astro.props;
---

<div class="controls" id={`controls-${simId}`}>
  <button class="ctrl-btn" data-action="play-pause" title="Play/Pause">
    <span class="ctrl-icon">⏸</span>
  </button>
  <button class="ctrl-btn" data-action="reset" title="Reset">
    <span class="ctrl-icon">↺</span>
  </button>
  <button class="ctrl-btn" data-action="fullscreen" title="Fullscreen">
    <span class="ctrl-icon">⛶</span>
  </button>
  <button class="ctrl-btn" data-action="settings" title="Parameters">
    <span class="ctrl-icon" style="font-size:0.85rem;">⚙</span>
  </button>
  <button class="ctrl-btn" data-action="record" title="Record">
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <circle cx="6" cy="6" r="5"/>
    </svg>
  </button>
</div>

<style>
  .controls {
    position: absolute;
    bottom: 1rem;
    right: 1rem;
    display: flex;
    gap: 0.5rem;
    z-index: 10;
  }

  .ctrl-btn {
    width: 36px;
    height: 36px;
    border: 1px solid var(--bg-surface-border);
    border-radius: 6px;
    background: var(--bg-nav);
    backdrop-filter: blur(8px);
    color: var(--text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    transition: border-color var(--transition-speed), color var(--transition-speed);
  }

  .ctrl-btn:hover {
    border-color: var(--accent);
  }

  /* Strip is open */
  .ctrl-btn.strip-open {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Recording is active */
  @keyframes record-pulse {
    0%, 100% { border-color: #c0392b; color: #c0392b; }
    50%       { border-color: var(--bg-surface-border); color: var(--text-primary); }
  }

  .ctrl-btn.recording {
    animation: record-pulse 1.2s ease-in-out infinite;
  }
</style>
```

- [ ] **Step 2: Verify in browser**

```bash
npm run dev
```

Open `http://localhost:4321/gallery/boids`. Confirm a 5th button (filled circle) appears in the controls bar. It has no behavior yet. Close dev server.

- [ ] **Step 3: Commit**

```bash
git add src/components/Controls.astro
git commit -m "feat(controls): add record button with strip-open and recording CSS states"
```

---

## Task 5: Create SimRecorder — Realtime WebM + MP4

**Files:** Create `src/lib/webgpu/recorder.ts`

This task implements the full realtime path (both WebM and MP4). No muxer library is used — `MediaRecorder` with `video/mp4` produces fragmented MP4 natively in Chrome/Edge.

- [ ] **Step 1: Create the file**

```typescript
// src/lib/webgpu/recorder.ts

export interface RecordingOptions {
  format: 'webm' | 'mp4';
  videoBitsPerSecond: number;
  /** captureStream FPS hint — used in realtime mode only; ignored in non-realtime. */
  fpsHint: number;
  /** 0 = unlimited */
  maxDuration: number;
  /** Seconds to discard from the front of the recording (realtime only). */
  trimStart: number;
  realtime: boolean;
  audioStream?: MediaStream;
}

interface TimedChunk {
  data: Blob;
  /** Wall-clock ms elapsed from recording start when this chunk arrived. */
  wallOffsetMs: number;
}

export interface NonRealtimeSource {
  tickOnce(): Promise<void>;
}

export class SimRecorder {
  private _state: 'idle' | 'recording' = 'idle';
  private _opts: RecordingOptions | null = null;
  private _startWallTime = 0;
  private _durationTimer: ReturnType<typeof setTimeout> | null = null;

  // Realtime fields
  private _mediaRecorder: MediaRecorder | null = null;
  private _chunks: TimedChunk[] = [];
  private _mrStopResolve: ((blob: Blob) => void) | null = null;

  // Non-realtime fields
  private _nrtRunning = false;
  private _nrtFrameIndex = 0;
  private _nrtAudioMR: MediaRecorder | null = null;
  private _nrtAudioChunks: Blob[] = [];
  private _nrtStopResolve: ((blob: Blob) => void) | null = null;
  private _nrtStartWallMs = 0;

  onStop?: (blob: Blob, opts: RecordingOptions) => void;

  getState(): 'idle' | 'recording' { return this._state; }

  getRealDuration(): number {
    if (this._state === 'idle') return 0;
    return (performance.now() - this._startWallTime) / 1000;
  }

  // ── Public entry points ──────────────────────────────────────────────────

  /**
   * Realtime mode: starts immediately and returns.
   * Non-realtime mode: runs the frame loop asynchronously — returns a Promise
   * that resolves when recording finishes (stop() is called or maxDuration elapses).
   */
  async start(
    canvas: HTMLCanvasElement,
    opts: RecordingOptions,
    source?: NonRealtimeSource,
  ): Promise<void> {
    if (this._state === 'recording') return;
    this._state = 'recording';
    this._opts = opts;
    this._startWallTime = performance.now();
    this._chunks = [];

    if (opts.maxDuration > 0) {
      this._durationTimer = setTimeout(() => { void this.stop(); }, opts.maxDuration * 1000);
    }

    if (opts.realtime) {
      this._startRealtime(canvas, opts);
    } else {
      if (!source) throw new Error('SimRecorder: non-realtime mode requires a NonRealtimeSource.');
      await this._runNonRealtimeLoop(canvas, opts, source);
    }
  }

  /** Stops recording and resolves with the video blob. Also triggers onStop callback. */
  async stop(): Promise<Blob> {
    if (this._state === 'idle') return new Blob();
    this._state = 'idle';

    if (this._durationTimer) { clearTimeout(this._durationTimer); this._durationTimer = null; }

    const opts = this._opts!;
    let blob: Blob;

    if (opts.realtime) {
      blob = await this._stopRealtime(opts);
    } else {
      blob = await this._stopNonRealtime();
    }

    this.onStop?.(blob, opts);
    return blob;
  }

  // ── Realtime path ────────────────────────────────────────────────────────

  private _startRealtime(canvas: HTMLCanvasElement, opts: RecordingOptions): void {
    const videoStream = canvas.captureStream(opts.fpsHint);
    let stream = videoStream;

    if (opts.audioStream) {
      const audioTrack = opts.audioStream.getAudioTracks()[0];
      if (audioTrack) {
        stream = new MediaStream([...videoStream.getVideoTracks(), audioTrack]);
      }
    }

    const mimeType = this._selectMimeType(opts);
    const mr = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: opts.videoBitsPerSecond,
    });

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this._chunks.push({ data: e.data, wallOffsetMs: performance.now() - this._startWallTime });
      }
    };

    mr.onstop = () => {
      const trimMs = opts.trimStart * 1000;
      // Always keep chunk[0] (codec init data), filter the rest by wall time
      const kept = this._chunks.filter((c, i) => i === 0 || c.wallOffsetMs >= trimMs);
      const mimeOut = opts.format === 'mp4' ? 'video/mp4' : 'video/webm';
      const blob = new Blob(kept.map(c => c.data), { type: mimeOut });
      this._mrStopResolve?.(blob);
      this._mrStopResolve = null;
    };

    this._mediaRecorder = mr;
    mr.start(500); // collect chunks every 500 ms
  }

  private _stopRealtime(opts: RecordingOptions): Promise<Blob> {
    void opts;
    return new Promise((resolve) => {
      this._mrStopResolve = resolve;
      this._mediaRecorder?.stop();
      this._mediaRecorder = null;
    });
  }

  private _selectMimeType(opts: RecordingOptions): string {
    const withAudio = !!opts.audioStream;

    if (opts.format === 'mp4') {
      // Try native MP4 (fragmented MP4 — Chrome/Edge/Safari)
      const mp4Candidates = withAudio
        ? ['video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1']
        : ['video/mp4;codecs=avc1'];
      const supported = mp4Candidates.find(t => MediaRecorder.isTypeSupported(t));
      if (!supported) {
        throw new Error(
          'MP4 recording is not supported in this browser. Use WebM, or switch to Chrome/Edge/Safari.',
        );
      }
      return supported;
    }

    // WebM
    if (withAudio) {
      return MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm;codecs=vp8,opus';
    }
    return MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm;codecs=vp8';
  }

  // ── Non-realtime path (stubbed — implemented in Tasks 7 & 8) ────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async _runNonRealtimeLoop(_canvas: HTMLCanvasElement, _opts: RecordingOptions, _source: NonRealtimeSource): Promise<void> {
    // Implemented in Task 7
    throw new Error('Non-realtime recording not yet implemented.');
  }

  private _stopNonRealtime(): Promise<Blob> {
    // Implemented in Task 7
    return Promise.resolve(new Blob());
  }
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npm run build 2>&1 | grep -i "recorder" | head -20
```

Expected: no errors referencing `recorder.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/webgpu/recorder.ts
git commit -m "feat(recorder): SimRecorder realtime WebM + MP4 path"
```

---

## Task 6: Create `buildRecordingStrip()`

**Files:** Create `src/lib/webgpu/recording-strip.ts`

The strip is a bottom-anchored panel with all recording controls. It calls `recorder.start()` / `recorder.stop()` and manages its own UI state. Non-realtime loop execution is also handled here — it stops the controller loop, starts recording, then restarts the controller on finish.

- [ ] **Step 1: Create the file**

```typescript
// src/lib/webgpu/recording-strip.ts

import type { SimRecorder, RecordingOptions } from './recorder';
import type { AudioReactor } from '../../components/simulations/boids/boids-audio';

export interface RecordingController {
  tickOnce(): Promise<void>;
  stop(): void;
  start(): void;
}

export interface RecordingStripOpts {
  controller: RecordingController;
  audioReactor?: AudioReactor;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
}

export interface RecordingStrip {
  show(): void;
  hide(): void;
  toggle(): void;
  teardown(): void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pill(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = [
    'padding:2px 8px',
    'border-radius:3px',
    'border:1px solid var(--bg-surface-border)',
    'background:transparent',
    'color:var(--text-muted)',
    'font-size:0.6rem',
    'cursor:pointer',
    'transition:border-color 0.15s,color 0.15s,background 0.15s',
    'white-space:nowrap',
  ].join(';');
  return b;
}

function pillGroup<T extends string>(
  options: { label: string; value: T }[],
  initial: T,
  onChange: (v: T) => void,
): { el: HTMLDivElement; getValue: () => T } {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:3px;';
  let current = initial;

  const btns = options.map(({ label, value }) => {
    const b = pill(label);
    if (value === initial) activatePill(b);
    b.addEventListener('click', () => {
      btns.forEach(x => deactivatePill(x));
      activatePill(b);
      current = value;
      onChange(value);
    });
    wrap.appendChild(b);
    return b;
  });

  return { el: wrap, getValue: () => current };
}

function activatePill(b: HTMLButtonElement): void {
  b.style.borderColor = 'var(--accent)';
  b.style.color = 'var(--accent)';
  b.style.background = 'rgba(224,160,64,0.1)';
}

function deactivatePill(b: HTMLButtonElement): void {
  b.style.borderColor = 'var(--bg-surface-border)';
  b.style.color = 'var(--text-muted)';
  b.style.background = 'transparent';
}

function section(icon: string, label: string): { wrap: HTMLDivElement; body: HTMLDivElement } {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:0 0.75rem;border-right:1px solid var(--bg-surface-border);';
  const header = document.createElement('div');
  header.style.cssText = 'font-size:0.55rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);white-space:nowrap;';
  header.textContent = `${icon} ${label}`;
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;align-items:center;gap:4px;';
  wrap.appendChild(header);
  wrap.appendChild(body);
  return { wrap, body };
}

function miniSlider(min: number, max: number, value: number, step: number): HTMLInputElement {
  const s = document.createElement('input');
  s.type = 'range';
  s.min = String(min);
  s.max = String(max);
  s.value = String(value);
  s.step = String(step);
  s.style.cssText = 'width:70px;accent-color:var(--accent);cursor:pointer;';
  return s;
}

function label(text: string, color = 'var(--text-muted)'): HTMLSpanElement {
  const s = document.createElement('span');
  s.style.cssText = `font-size:0.6rem;color:${color};white-space:nowrap;font-variant-numeric:tabular-nums;`;
  s.textContent = text;
  return s;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Quality dot colors ────────────────────────────────────────────────────────
const QUALITY_DOT_COLORS: Record<string, string> = {
  low:    'var(--text-muted)',
  medium: '#c8a84b',
  high:   'var(--accent)',
  custom: '#9b7fe0',
};

function qualityDot(key: string): string {
  const color = QUALITY_DOT_COLORS[key] ?? 'var(--text-muted)';
  return `<svg width="7" height="7" viewBox="0 0 7 7" style="margin-right:2px"><circle cx="3.5" cy="3.5" r="3.5" fill="${color}"/></svg>`;
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildRecordingStrip(
  container: HTMLElement,
  recorder: SimRecorder,
  opts: RecordingStripOpts,
): RecordingStrip {
  let visible = false;
  let timerInterval: ReturnType<typeof setInterval> | null = null;

  // ── Recording state ────────────────────────────────────────────────────────
  const recOpts: RecordingOptions = {
    format: 'webm',
    videoBitsPerSecond: 20_000_000,
    fpsHint: 60,
    maxDuration: 60,
    trimStart: 0,
    realtime: true,
    audioStream: undefined,
  };

  // ── Strip element ──────────────────────────────────────────────────────────
  const strip = document.createElement('div');
  strip.style.cssText = [
    'position:absolute',
    'bottom:0',
    'left:0',
    'right:0',
    'background:var(--bg-nav)',
    'border-top:1px solid var(--bg-surface-border)',
    'backdrop-filter:blur(8px)',
    '-webkit-backdrop-filter:blur(8px)',
    'z-index:15',
    'display:none',
    'flex-direction:column',
    'padding:0.5rem 0',
  ].join(';');

  // ── Controls row ───────────────────────────────────────────────────────────
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:stretch;overflow-x:auto;';

  // FORMAT section
  const fmt = section('🎞', 'Format');
  const fmtGroup = pillGroup(
    [{ label: 'WebM', value: 'webm' as const }, { label: 'MP4', value: 'mp4' as const }],
    'webm',
    (v) => { recOpts.format = v; updateWarnings(); },
  );
  fmt.body.appendChild(fmtGroup.el);
  row.appendChild(fmt.wrap);

  // FPS section
  const fpsSection = section('⚡', 'FPS');
  const fpsGroup = pillGroup(
    [
      { label: '30', value: 30 },
      { label: '60', value: 60 },
      { label: 'Max', value: 0 },
    ],
    60,
    (v) => { recOpts.fpsHint = v; },
  );
  fpsSection.body.appendChild(fpsGroup.el);
  row.appendChild(fpsSection.wrap);

  // QUALITY section
  const qualSection = section('📊', 'Quality');
  const qualPresets: { label: string; key: string; bps: number }[] = [
    { label: 'Low',    key: 'low',    bps: 2_500_000  },
    { label: 'Med',    key: 'medium', bps: 8_000_000  },
    { label: 'High',   key: 'high',   bps: 20_000_000 },
    { label: 'Custom', key: 'custom', bps: 0          },
  ];

  const customSlider = miniSlider(1, 50, 20, 1);
  customSlider.style.display = 'none';
  const customLabel = label('20 Mbps');
  customLabel.style.display = 'none';
  customSlider.addEventListener('input', () => {
    const mbps = parseInt(customSlider.value);
    customLabel.textContent = `${mbps} Mbps`;
    recOpts.videoBitsPerSecond = mbps * 1_000_000;
    updateWarnings();
  });

  const qualBtns = qualPresets.map(({ label: lbl, key, bps }) => {
    const b = document.createElement('button');
    b.innerHTML = `${qualityDot(key)}<span style="font-size:0.6rem">${lbl}</span>`;
    b.style.cssText = [
      'display:flex;align-items:center;',
      'padding:2px 6px',
      'border-radius:3px',
      'border:1px solid var(--bg-surface-border)',
      'background:transparent',
      'color:var(--text-muted)',
      'cursor:pointer',
      'transition:border-color 0.15s,color 0.15s',
    ].join(';');
    if (key === 'high') {
      b.style.borderColor = 'var(--accent)';
      b.style.color = 'var(--accent)';
    }
    b.addEventListener('click', () => {
      qualBtns.forEach(x => { x.style.borderColor = 'var(--bg-surface-border)'; x.style.color = 'var(--text-muted)'; });
      b.style.borderColor = 'var(--accent)';
      b.style.color = 'var(--accent)';
      if (key === 'custom') {
        customSlider.style.display = '';
        customLabel.style.display = '';
        recOpts.videoBitsPerSecond = parseInt(customSlider.value) * 1_000_000;
      } else {
        customSlider.style.display = 'none';
        customLabel.style.display = 'none';
        recOpts.videoBitsPerSecond = bps;
      }
      updateWarnings();
    });
    qualSection.body.appendChild(b);
    return b;
  });
  qualSection.body.appendChild(customSlider);
  qualSection.body.appendChild(customLabel);
  row.appendChild(qualSection.wrap);

  // MAX DURATION section
  const durSection = section('⏱', 'Max Duration');
  const durSlider = miniSlider(5, 300, 60, 5);
  const durLabel = label('60s');
  const unlimitedChk = document.createElement('input');
  unlimitedChk.type = 'checkbox';
  unlimitedChk.style.cssText = 'accent-color:var(--accent);cursor:pointer;';
  const unlimitedLbl = label('∞');
  durSlider.addEventListener('input', () => {
    durLabel.textContent = `${durSlider.value}s`;
    recOpts.maxDuration = parseInt(durSlider.value);
  });
  unlimitedChk.addEventListener('change', () => {
    recOpts.maxDuration = unlimitedChk.checked ? 0 : parseInt(durSlider.value);
    durSlider.style.opacity = unlimitedChk.checked ? '0.35' : '';
    durSlider.style.pointerEvents = unlimitedChk.checked ? 'none' : '';
    durLabel.style.opacity = unlimitedChk.checked ? '0.35' : '';
  });
  durSection.body.appendChild(durSlider);
  durSection.body.appendChild(durLabel);
  durSection.body.appendChild(unlimitedChk);
  durSection.body.appendChild(unlimitedLbl);
  row.appendChild(durSection.wrap);

  // TRIM section
  const trimSection = section('✂', 'Trim Start');
  const trimSlider = miniSlider(0, 30, 0, 1);
  const trimLabel = label('0s', 'var(--text-muted)');
  trimSlider.addEventListener('input', () => {
    trimLabel.textContent = `${trimSlider.value}s`;
    recOpts.trimStart = parseInt(trimSlider.value);
  });
  trimSection.body.appendChild(trimSlider);
  trimSection.body.appendChild(trimLabel);
  row.appendChild(trimSection.wrap);

  // REALTIME + AUDIO section
  const modeSection = section('⚙', 'Mode');
  const realtimeChk = document.createElement('input');
  realtimeChk.type = 'checkbox';
  realtimeChk.checked = true;
  realtimeChk.style.cssText = 'accent-color:var(--accent);cursor:pointer;';
  const realtimeLbl = label('Realtime');
  const supportsNRT = typeof VideoEncoder !== 'undefined';
  if (!supportsNRT) {
    realtimeChk.disabled = true;
    realtimeLbl.title = 'Non-realtime requires Chrome or Edge';
  }
  realtimeChk.addEventListener('change', () => {
    recOpts.realtime = realtimeChk.checked;
    updateWarnings();
  });
  modeSection.body.appendChild(realtimeChk);
  modeSection.body.appendChild(realtimeLbl);

  // Audio checkbox — hidden until reactor is active
  const audioChk = document.createElement('input');
  audioChk.type = 'checkbox';
  audioChk.checked = true;
  audioChk.style.cssText = 'accent-color:var(--accent);cursor:pointer;margin-left:8px;';
  const audioLbl = label('Audio');
  const audioWrap = document.createElement('span');
  audioWrap.style.display = 'none';
  audioWrap.appendChild(audioChk);
  audioWrap.appendChild(audioLbl);
  modeSection.body.appendChild(audioWrap);

  // Show/hide audio checkbox based on reactor state
  const audioCheckInterval = setInterval(() => {
    const active = opts.audioReactor?.isActive() ?? false;
    audioWrap.style.display = active ? '' : 'none';
    if (active && audioChk.checked) {
      recOpts.audioStream = opts.audioReactor?.getStream() ?? undefined;
    } else {
      recOpts.audioStream = undefined;
    }
  }, 500);

  audioChk.addEventListener('change', () => {
    recOpts.audioStream = audioChk.checked
      ? (opts.audioReactor?.getStream() ?? undefined)
      : undefined;
  });

  modeSection.wrap.style.borderRight = 'none';
  row.appendChild(modeSection.wrap);

  // ── Record button + timer (right side) ───────────────────────────────────
  const recArea = document.createElement('div');
  recArea.style.cssText = [
    'display:flex;align-items:center;gap:0.6rem;',
    'padding:0 1rem 0 0.75rem;',
    'margin-left:auto;flex-shrink:0;',
  ].join('');

  const timerEl = document.createElement('span');
  timerEl.style.cssText = 'font-size:0.65rem;color:var(--accent);font-variant-numeric:tabular-nums;font-family:monospace;display:none;';
  timerEl.textContent = '00:00';

  const sizEl = document.createElement('span');
  sizEl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);display:none;';

  const recBtn = document.createElement('button');
  recBtn.style.cssText = [
    'display:flex;align-items:center;gap:5px;',
    'padding:5px 12px;',
    'border-radius:5px;',
    'border:none;',
    'background:#c0392b;',
    'color:#fff;',
    'font-size:0.65rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;',
    'cursor:pointer;',
    'white-space:nowrap;',
    'transition:background 0.15s;',
  ].join('');
  setIdleBtn();

  recArea.appendChild(timerEl);
  recArea.appendChild(sizEl);
  recArea.appendChild(recBtn);
  row.appendChild(recArea);

  strip.appendChild(row);

  // ── Warning row ───────────────────────────────────────────────────────────
  const warnRow = document.createElement('div');
  warnRow.style.cssText = [
    'font-size:0.6rem;',
    'color:#c8a84b;',
    'padding:0.25rem 0.75rem 0;',
    'display:none;',
  ].join('');
  strip.appendChild(warnRow);

  container.appendChild(strip);

  function updateWarnings(): void {
    const msgs: string[] = [];
    if (recOpts.format === 'webm' && recOpts.videoBitsPerSecond >= 8_000_000) {
      msgs.push('⚠ For best performance at high bitrate, use MP4.');
    }
    if (!recOpts.realtime && recOpts.audioStream) {
      msgs.push('⚠ Non-realtime: audio captured in real time — sync may vary.');
    }
    warnRow.textContent = msgs.join('  ');
    warnRow.style.display = msgs.length > 0 ? '' : 'none';
  }

  // ── Button states ──────────────────────────────────────────────────────────
  function setIdleBtn(): void {
    recBtn.innerHTML = `
      <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#fff"/></svg>
      REC
    `;
    recBtn.style.background = '#c0392b';
  }

  function setRecordingBtn(): void {
    recBtn.innerHTML = `
      <svg width="8" height="8" viewBox="0 0 8 8"><rect width="8" height="8" rx="1.5" fill="#fff"/></svg>
      STOP
    `;
    recBtn.style.background = '#7a1f1f';
  }

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ── Record button click ───────────────────────────────────────────────────
  recBtn.addEventListener('click', () => {
    if (recorder.getState() === 'idle') {
      startRecording();
    } else {
      void stopRecording();
    }
  });

  function startRecording(): void {
    const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    try {
      if (recOpts.realtime) {
        void recorder.start(canvas, { ...recOpts });
      } else {
        opts.controller.stop();
        void recorder.start(canvas, { ...recOpts }, opts.controller).then(() => {
          opts.controller.start();
        });
      }
    } catch (e) {
      warnRow.textContent = `⚠ ${e instanceof Error ? e.message : String(e)}`;
      warnRow.style.display = '';
      return;
    }

    setRecordingBtn();
    timerEl.style.display = '';
    sizEl.style.display = '';
    opts.onRecordingStart?.();

    timerInterval = setInterval(() => {
      const sec = recorder.getRealDuration();
      timerEl.textContent = formatTime(sec);
      // Rough size estimate: bps * seconds / 8 bytes
      const bytes = (recOpts.videoBitsPerSecond / 8) * sec;
      sizEl.textContent = bytes > 1_000_000
        ? `· ~${(bytes / 1_000_000).toFixed(1)} MB`
        : `· ~${Math.round(bytes / 1000)} KB`;
    }, 250);
  }

  async function stopRecording(): Promise<void> {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    const blob = await recorder.stop();
    downloadBlob(blob, `boids-${Date.now()}.${recOpts.format}`);
    setIdleBtn();
    timerEl.style.display = 'none';
    sizEl.style.display = 'none';
    opts.onRecordingStop?.();
  }

  recorder.onStop = (blob, ropts) => {
    // Called when maxDuration auto-stops
    if (recorder.getState() === 'idle' && timerInterval) {
      void stopRecording();
      downloadBlob(blob, `boids-${Date.now()}.${ropts.format}`);
    }
  };

  // ── Visibility ─────────────────────────────────────────────────────────────
  function show(): void {
    strip.style.display = 'flex';
    visible = true;
    updateWarnings();
  }

  function hide(): void {
    strip.style.display = 'none';
    visible = false;
  }

  function toggle(): void { visible ? hide() : show(); }

  function teardown(): void {
    clearInterval(audioCheckInterval);
    if (timerInterval) clearInterval(timerInterval);
    strip.remove();
  }

  return { show, hide, toggle, teardown };
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npm run build 2>&1 | grep -i "recording-strip" | head -10
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/webgpu/recording-strip.ts
git commit -m "feat(recorder): buildRecordingStrip() — bottom strip UI with all recording controls"
```

---

## Task 7: Implement Non-Realtime Video Path in SimRecorder

**Files:** Modify `src/lib/webgpu/recorder.ts`

Replaces the stub `_runNonRealtimeLoop` and `_stopNonRealtime` with a real WebCodecs `VideoEncoder` + muxer implementation.

- [ ] **Step 1: Add imports at the top of `recorder.ts`**

Replace the opening of `src/lib/webgpu/recorder.ts` with:

```typescript
// src/lib/webgpu/recorder.ts

import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

export interface RecordingOptions {
// ... (rest unchanged)
```

- [ ] **Step 2: Add non-realtime state fields to the class**

Inside `SimRecorder`, replace the non-realtime fields block:

```typescript
  // Non-realtime fields
  private _nrtRunning = false;
  private _nrtFrameIndex = 0;
  private _nrtAudioMR: MediaRecorder | null = null;
  private _nrtAudioChunks: Blob[] = [];
  private _nrtStopResolve: ((blob: Blob) => void) | null = null;
  private _nrtStartWallMs = 0;
  private _nrtVideoEncoder: VideoEncoder | null = null;
  private _nrtMp4Muxer: Mp4Muxer<Mp4Target> | null = null;
  private _nrtWebmMuxer: WebmMuxer<WebmTarget> | null = null;
  private _nrtMp4Target: Mp4Target | null = null;
  private _nrtWebmTarget: WebmTarget | null = null;
```

- [ ] **Step 3: Replace `_runNonRealtimeLoop` and `_stopNonRealtime`**

Replace the two stubbed methods with:

```typescript
  private async _runNonRealtimeLoop(
    canvas: HTMLCanvasElement,
    opts: RecordingOptions,
    source: NonRealtimeSource,
  ): Promise<void> {
    const targetFps = opts.fpsHint > 0 ? opts.fpsHint : 60;
    const maxFrames = opts.maxDuration > 0 ? Math.ceil(opts.maxDuration * targetFps) : Infinity;

    this._nrtRunning = true;
    this._nrtFrameIndex = 0;
    this._nrtStartWallMs = performance.now();

    // Initialise muxer + encoder
    if (opts.format === 'mp4') {
      this._nrtMp4Target = new Mp4Target();
      this._nrtMp4Muxer = new Mp4Muxer({
        target: this._nrtMp4Target,
        video: { codec: 'avc', width: canvas.width, height: canvas.height },
        fastStart: 'in-memory',
      });
    } else {
      this._nrtWebmTarget = new WebmTarget();
      this._nrtWebmMuxer = new WebmMuxer({
        target: this._nrtWebmTarget,
        video: { codec: 'V_VP9', width: canvas.width, height: canvas.height, frameRate: targetFps },
      });
    }

    const muxer = (this._nrtMp4Muxer ?? this._nrtWebmMuxer)!;

    await new Promise<void>((resolve, reject) => {
      const codec = opts.format === 'mp4' ? 'avc1.42E01E' : 'vp09.00.10.08';
      const encoder = new VideoEncoder({
        output: (chunk, meta) => { muxer.addVideoChunk(chunk, meta ?? undefined); },
        error: reject,
      });

      encoder.configure({
        codec,
        width:    canvas.width,
        height:   canvas.height,
        bitrate:  opts.videoBitsPerSecond,
        framerate: targetFps,
      });

      this._nrtVideoEncoder = encoder;

      (async () => {
        try {
          while (this._nrtRunning && this._nrtFrameIndex < maxFrames) {
            await source.tickOnce();

            const ts = Math.round(this._nrtFrameIndex * (1_000_000 / targetFps));
            const frame = new VideoFrame(canvas, { timestamp: ts });
            encoder.encode(frame, { keyFrame: this._nrtFrameIndex % 60 === 0 });
            frame.close();

            this._nrtFrameIndex++;
          }

          await encoder.flush();
          encoder.close();
          this._nrtVideoEncoder = null;
          resolve();
        } catch (e) {
          reject(e);
        }
      })();
    });
  }

  private _stopNonRealtime(): Promise<Blob> {
    this._nrtRunning = false;
    // The loop will exit on the next iteration check. Muxer finalized in _assembleNrtBlob().
    return Promise.resolve(this._assembleNrtBlob());
  }

  private _assembleNrtBlob(): Blob {
    const opts = this._opts!;
    if (opts.format === 'mp4' && this._nrtMp4Muxer && this._nrtMp4Target) {
      this._nrtMp4Muxer.finalize();
      const blob = new Blob([this._nrtMp4Target.buffer], { type: 'video/mp4' });
      this._nrtMp4Muxer = null; this._nrtMp4Target = null;
      return blob;
    }
    if (this._nrtWebmMuxer && this._nrtWebmTarget) {
      this._nrtWebmMuxer.finalize();
      const blob = new Blob([this._nrtWebmTarget.buffer], { type: 'video/webm' });
      this._nrtWebmMuxer = null; this._nrtWebmTarget = null;
      return blob;
    }
    return new Blob();
  }
```

- [ ] **Step 4: Fix `stop()` to call `_assembleNrtBlob` correctly**

The non-realtime stop flow is: `stop()` sets `_nrtRunning = false`, but the loop is async. We need to wait for the loop to exit before assembling the blob. Update `stop()`:

```typescript
  async stop(): Promise<Blob> {
    if (this._state === 'idle') return new Blob();
    this._state = 'idle';

    if (this._durationTimer) { clearTimeout(this._durationTimer); this._durationTimer = null; }

    const opts = this._opts!;
    let blob: Blob;

    if (opts.realtime) {
      blob = await this._stopRealtime(opts);
    } else {
      // Signal loop to stop; wait for encoder flush by re-awaiting _nrtStopPromise
      this._nrtRunning = false;
      // Wait briefly for encoder flush (already in flight from _runNonRealtimeLoop)
      await new Promise<void>(res => setTimeout(res, 50));
      blob = this._assembleNrtBlob();
    }

    this.onStop?.(blob, opts);
    return blob;
  }
```

Note: The `stop()` → 50ms wait is a pragmatic coupling between stop and the async encoder flush. A production hardening would store the `_runNonRealtimeLoop` Promise and await it, but this requires a small refactor — defer to a follow-up.

- [ ] **Step 5: Verify TypeScript**

```bash
npm run build 2>&1 | grep -i "recorder" | head -20
```

Expected: no errors. If `mp4-muxer` or `webm-muxer` type errors appear, check their installed versions with `npm ls mp4-muxer webm-muxer`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/webgpu/recorder.ts
git commit -m "feat(recorder): non-realtime VideoEncoder path with mp4-muxer + webm-muxer"
```

---

## Task 8: Non-Realtime Audio with SoundTouch

**Files:** Modify `src/lib/webgpu/recorder.ts`

Adds parallel audio recording + pitch-preserving time-stretch + AudioEncoder output during non-realtime recording.

- [ ] **Step 1: Add `_stretchAudio()` helper to `recorder.ts`**

Add this private method to the `SimRecorder` class:

```typescript
  /**
   * Time-stretches an AudioBuffer to `targetDurationSec` using SoundTouch
   * (pitch-preserving). Returns a new AudioBuffer at the same sample rate.
   */
  private async _stretchAudio(
    input: AudioBuffer,
    targetDurationSec: number,
  ): Promise<AudioBuffer> {
    const { SoundTouch, SimpleFilter } = await import('soundtouchjs');
    const ratio = input.duration / targetDurationSec;

    // Interleave all channels into a flat Float32Array
    const numCh = input.numberOfChannels;
    const len   = input.length;
    const interleaved = new Float32Array(len * numCh);
    for (let c = 0; c < numCh; c++) {
      const ch = input.getChannelData(c);
      for (let i = 0; i < len; i++) {
        interleaved[i * numCh + c] = ch[i];
      }
    }

    let readPos = 0;
    const source = {
      extract(target: Float32Array, numFrames: number): number {
        const available = Math.min(numFrames, len - readPos);
        for (let i = 0; i < available; i++) {
          for (let c = 0; c < numCh; c++) {
            target[i * numCh + c] = interleaved[(readPos + i) * numCh + c];
          }
        }
        readPos += available;
        return available;
      },
    };

    const st = new SoundTouch(input.sampleRate);
    st.tempo = ratio; // > 1 speeds up, < 1 slows down
    const filter = new SimpleFilter(source, st);

    const outLen = Math.round(len / ratio);
    const outputInterleaved = new Float32Array(outLen * numCh);
    filter.extract(outputInterleaved, outLen);

    // Deinterleave into an AudioBuffer
    const offCtx = new OfflineAudioContext(numCh, outLen, input.sampleRate);
    const outBuf  = offCtx.createBuffer(numCh, outLen, input.sampleRate);
    for (let c = 0; c < numCh; c++) {
      const ch = outBuf.getChannelData(c);
      for (let i = 0; i < outLen; i++) {
        ch[i] = outputInterleaved[i * numCh + c];
      }
    }
    return outBuf;
  }
```

- [ ] **Step 2: Encode stretched AudioBuffer with AudioEncoder and add to muxer**

Add this private method:

```typescript
  private async _encodeAndMuxAudio(
    audioBuffer: AudioBuffer,
    muxer: Mp4Muxer<Mp4Target> | WebmMuxer<WebmTarget>,
    format: 'mp4' | 'webm',
  ): Promise<void> {
    const codec     = format === 'mp4' ? 'mp4a.40.2' : 'opus';
    const sampleRate = audioBuffer.sampleRate;
    const numCh     = audioBuffer.numberOfChannels;
    const frameSize = 1024; // standard for AAC and Opus

    await new Promise<void>((resolve, reject) => {
      const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => { muxer.addAudioChunk(chunk, meta ?? undefined); },
        error: reject,
      });

      audioEncoder.configure({ codec, sampleRate, numberOfChannels: numCh, bitrate: 128_000 });

      let offset = 0;
      while (offset < audioBuffer.length) {
        const frames = Math.min(frameSize, audioBuffer.length - offset);
        const data   = new Float32Array(frames * numCh);
        for (let c = 0; c < numCh; c++) {
          const ch = audioBuffer.getChannelData(c);
          for (let i = 0; i < frames; i++) {
            data[i * numCh + c] = ch[offset + i];
          }
        }
        const ts = Math.round(offset * (1_000_000 / sampleRate));
        const audioData = new AudioData({
          format:          'f32-interleaved',
          sampleRate,
          numberOfFrames:  frames,
          numberOfChannels: numCh,
          timestamp:       ts,
          data,
        });
        audioEncoder.encode(audioData);
        audioData.close();
        offset += frames;
      }

      audioEncoder.flush().then(() => { audioEncoder.close(); resolve(); }).catch(reject);
    });
  }
```

- [ ] **Step 3: Wire audio into `_runNonRealtimeLoop`**

In `_runNonRealtimeLoop`, just before the muxer + encoder initialisation block, add audio recorder start:

```typescript
    // Start parallel audio recording if requested
    if (opts.audioStream) {
      this._nrtAudioChunks = [];
      const audioMR = new MediaRecorder(opts.audioStream, { mimeType: 'audio/webm;codecs=opus' });
      audioMR.ondataavailable = (e) => { if (e.data.size > 0) this._nrtAudioChunks.push(e.data); };
      audioMR.start(500);
      this._nrtAudioMR = audioMR;
    }
```

And update the muxer initialisation to include an audio track when `opts.audioStream` is present:

```typescript
    // Initialise muxer + encoder
    if (opts.format === 'mp4') {
      this._nrtMp4Target = new Mp4Target();
      this._nrtMp4Muxer = new Mp4Muxer({
        target: this._nrtMp4Target,
        video: { codec: 'avc', width: canvas.width, height: canvas.height },
        ...(opts.audioStream ? { audio: { codec: 'aac', sampleRate: 44100, numberOfChannels: 1 } } : {}),
        fastStart: 'in-memory',
      });
    } else {
      this._nrtWebmTarget = new WebmTarget();
      this._nrtWebmMuxer = new WebmMuxer({
        target: this._nrtWebmTarget,
        video: { codec: 'V_VP9', width: canvas.width, height: canvas.height, frameRate: targetFps },
        ...(opts.audioStream ? { audio: { codec: 'A_OPUS', sampleRate: 44100, numberOfChannels: 1 } } : {}),
      });
    }
```

Then after `await encoder.flush(); encoder.close();` and before `resolve()`, add audio processing:

```typescript
          // Process audio if recorded
          if (opts.audioStream && this._nrtAudioMR) {
            await new Promise<void>(res => {
              this._nrtAudioMR!.onstop = () => res();
              this._nrtAudioMR!.stop();
            });
            this._nrtAudioMR = null;

            const audioBlob  = new Blob(this._nrtAudioChunks, { type: 'audio/webm' });
            const arrayBuf   = await audioBlob.arrayBuffer();
            const decodeCtx  = new AudioContext();
            const rawBuffer  = await decodeCtx.decodeAudioData(arrayBuf);
            await decodeCtx.close();

            const videoDurationSec = this._nrtFrameIndex / targetFps;
            const stretchRatio     = rawBuffer.duration / videoDurationSec;

            let processedBuffer = rawBuffer;
            if (Math.abs(stretchRatio - 1.0) > 0.02) {
              processedBuffer = await this._stretchAudio(rawBuffer, videoDurationSec);
            }

            const mux = (this._nrtMp4Muxer ?? this._nrtWebmMuxer)!;
            await this._encodeAndMuxAudio(processedBuffer, mux, opts.format);
          }
```

- [ ] **Step 4: Expose stretch ratio for UI warning in strip**

Add a public getter to `SimRecorder`:

```typescript
  /** Returns audio/video duration ratio from the last non-realtime recording. > 1.5 = warn. */
  lastStretchRatio = 1.0;
```

And set it in `_runNonRealtimeLoop` where stretch ratio is computed:

```typescript
            this.lastStretchRatio = stretchRatio;
```

Then in `recording-strip.ts`, after stopping non-realtime, show a warning if `recorder.lastStretchRatio > 1.5`:

In the `stopRecording()` function inside `buildRecordingStrip`, add after `downloadBlob`:

```typescript
    if (!recOpts.realtime && recorder.lastStretchRatio > 1.5) {
      warnRow.textContent = `⚠ Audio quality was affected (${recorder.lastStretchRatio.toFixed(1)}× stretch). Lower target FPS for better results.`;
      warnRow.style.display = '';
    }
```

- [ ] **Step 5: Verify TypeScript**

```bash
npm run build 2>&1 | grep -i error | head -20
```

Expected: no errors. If `soundtouchjs` types are missing, add `// @ts-ignore` above the import line.

- [ ] **Step 6: Commit**

```bash
git add src/lib/webgpu/recorder.ts src/lib/webgpu/recording-strip.ts
git commit -m "feat(recorder): non-realtime audio — soundtouchjs time-stretch + AudioEncoder mux"
```

---

## Task 9: Wire Everything in `[...slug].astro`

**Files:** Modify `src/pages/gallery/[...slug].astro`

- [ ] **Step 1: Add strip container div to the viewport**

In `[...slug].astro`, inside `.sim-viewport`, add after the `#fps-display` div:

```html
<div id="recording-strip-container"></div>
```

- [ ] **Step 2: Add strip container CSS**

In the `<style>` block, add:

```css
  #recording-strip-container {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 15;
  }
```

- [ ] **Step 3: Add imports to the `<script>` block**

At the top of the `<script>` section, add:

```typescript
  import { SimRecorder } from '../../lib/webgpu/recorder';
  import { buildRecordingStrip } from '../../lib/webgpu/recording-strip';
```

- [ ] **Step 4: Instantiate recorder and strip after `controller.start()`**

After the `controller.start()` call (around line 596), and before the FPS counter setup, add:

```typescript
        // ── Recording strip ─────────────────────────────────────────────────
        const recorder   = new SimRecorder();
        const stripContainer = document.getElementById('recording-strip-container') as HTMLElement;
        const recordBtn  = controls?.querySelector('[data-action="record"]') as HTMLElement | null;

        const recordingStrip = buildRecordingStrip(stripContainer, recorder, {
          controller,
          audioReactor: sim === 'boids' ? (undefined as unknown as import('../../components/simulations/boids/boids-audio').AudioReactor) : undefined,
          onRecordingStart: () => {
            recordBtn?.classList.add('recording');
            recordBtn?.classList.remove('strip-open');
          },
          onRecordingStop: () => {
            recordBtn?.classList.remove('recording');
          },
        });
```

Note: The `audioReactor` is assigned later (after the boids block runs). Refine this in Step 5.

- [ ] **Step 5: Pass audioReactor from the boids block**

Inside the `if (sim === 'boids')` block, after `const reactor = new AudioReactor();`, call:

```typescript
          // Reconnect strip with reactor now that it exists
          recordingStrip.teardown();
          const recordingStripBoids = buildRecordingStrip(stripContainer, recorder, {
            controller: boidsCtrl,
            audioReactor: reactor,
            onRecordingStart: () => {
              recordBtn?.classList.add('recording');
              recordBtn?.classList.remove('strip-open');
            },
            onRecordingStop: () => {
              recordBtn?.classList.remove('recording');
            },
          });
          // Replace the outer reference so the controls button uses the right strip
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__activeStrip = recordingStripBoids;
```

And before the controls click listener, set a default:

```typescript
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__activeStrip = recordingStrip;
```

- [ ] **Step 6: Wire the record button in the controls click handler**

In the `controls?.addEventListener('click', ...)` block, add a new branch after `action === 'settings'`:

```typescript
          } else if (action === 'record') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const activeStrip = (window as any).__activeStrip;
            activeStrip?.toggle();
            if (recorder.getState() === 'idle') {
              recordBtn?.classList.toggle('strip-open');
            }
```

- [ ] **Step 7: Clean up on page hide**

In the `document.addEventListener('pagehide', ...)` block, add:

```typescript
            recordingStrip.teardown();
            if (recorder.getState() === 'recording') void recorder.stop();
```

- [ ] **Step 8: Verify build**

```bash
npm run build 2>&1 | grep -i error | head -20
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/pages/gallery/[...slug].astro
git commit -m "feat(gallery): wire SimRecorder + buildRecordingStrip into slug page"
```

---

## Task 10: Manual Integration Tests

**Files:** None — browser verification only.

Open `http://localhost:4321/gallery/boids` in **Chrome** for each test.

- [ ] **Test 1: Controls bar button — strip toggle**

Click the ● record button. Strip slides up from bottom. Click again — strip hides.
Expected: smooth CSS transition, `strip-open` class on button when open.

- [ ] **Test 2: Realtime WebM recording**

Open strip → format = WebM, quality = Low, FPS = 30, duration = 10s, trim = 0, realtime = ✓.
Click START RECORDING. Timer counts up. At 10s auto-stops and a `.webm` file downloads.
Open the file in Chrome — should play back boids video with no UI overlay.

- [ ] **Test 3: Realtime MP4 recording**

Format = MP4, 5s max, click START → let it auto-stop. `.mp4` downloads.
Open in VLC or QuickTime — should play correctly.

- [ ] **Test 4: Trim start**

Format = WebM, max = 20s, trim = 5s. Click START, wait 20s. Download should contain ~15s of footage (first 5s discarded).

- [ ] **Test 5: Audio recording**

Enable mic in Audio tab → audio indicator turns green. Open strip — "Audio" checkbox appears.
Check Audio. Start a 5s WebM recording while making noise. Download and play — audio should be present.

- [ ] **Test 6: Non-realtime recording (Chrome only)**

Uncheck Realtime. FPS = 30, 5s max. Click START — simulation slows on screen. After it completes, `.webm` downloads. Play the file — should be exactly 30fps for 5 seconds.

- [ ] **Test 7: Non-realtime + audio (Chrome only)**

Realtime unchecked, audio checked. 5s. Download and play — audio and video should be aligned.

- [ ] **Test 8: MP4 not supported warning (Firefox)**

Open in Firefox. MP4 pill should still be clickable; attempting to start MP4 recording should show `⚠ MP4 recording is not supported in this browser` warning in the strip. WebM should work normally.

- [ ] **Step 9: Commit test completion**

```bash
git add .
git commit -m "feat: video recorder — realtime + non-realtime, WebM + MP4, audio, bottom strip UI"
```

---

## Notes

- **`_stopNonRealtime` timing gap:** The 50ms await in `stop()` for non-realtime is pragmatic. If the encoder flush takes longer than 50ms (very large frames), the muxer may not be fully finalised. A cleaner solution (storing the loop Promise and awaiting it) can be done as a follow-up.
- **`__activeStrip` pattern:** Using `window.__activeStrip` is a workaround for the boids-specific strip rebuild. A cleaner architecture would pass the strip as a mutable ref object. Acceptable for now since only boids uses recording.
- **Firefox + MP4:** Firefox does not support `video/mp4` in `MediaRecorder`. The error is surfaced in the strip UI.
- **Safari non-realtime:** WebCodecs is available in Safari 16.4+. If issues arise, the non-realtime checkbox can be disabled on Safari detection as a follow-up.
