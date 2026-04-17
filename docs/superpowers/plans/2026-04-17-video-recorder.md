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
| Modify | `src/components/simulations/boids/boids-controller.ts` | Add public `tickOnce()` (tick already decomposed into `_preFrameSetup`, `_packUniforms`, `_runComputePasses`, `_renderFrame`) |
| Modify | `src/components/simulations/boids/boids-audio.ts` | Add `getStream()` to `AudioReactor` |
| Modify | `src/components/Controls.astro` | Add record button with pulse CSS |
| Modify | `src/lib/sim-page/sim-setup/boids.ts` | Return `{ reactor: AudioReactor }` instead of `void` |
| Modify | `src/lib/sim-page/sim-setup/index.ts` | Return `{ hasPanel: boolean; audioReactor?: AudioReactor }` instead of `boolean` |
| Modify | `src/pages/gallery/[...slug].astro` | Mount strip container, wire recorder + strip using returned `audioReactor` |
| Modify | `package.json` | `mp4-muxer`, `webm-muxer`, `soundtouchjs` (already installed, needs commit) |

---

## Task 1: Commit Already-Installed Dependencies

**Files:** `package.json`, `package-lock.json`

The three packages (`mp4-muxer`, `webm-muxer`, `soundtouchjs`) are already present in `package.json` and installed in `node_modules` — they were installed but never committed.

- [ ] **Step 1: Verify packages are in package.json**

```bash
node -e "const p = require('./package.json'); const keys = Object.keys(p.dependencies || {}); console.log(keys.filter(k => ['mp4-muxer','webm-muxer','soundtouchjs'].includes(k)))"
```

Expected: `[ 'mp4-muxer', 'soundtouchjs', 'webm-muxer' ]`

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add mp4-muxer, webm-muxer, soundtouchjs dependencies"
```

---

## Task 2: Add `tickOnce()` to BoidsController

**Files:** Modify `src/components/simulations/boids/boids-controller.ts`

The controller's `tick` method has already been decomposed into `_preFrameSetup()`, `_packUniforms(aspect)`, `_runComputePasses(device, N, gridDim, gridSize)`, and `_renderFrame(device, context, N)`. `tickOnce()` just calls these in the same sequence — without RAF/setTimeout scheduling.

- [ ] **Step 1: Read the current tick method to confirm structure**

Read `src/components/simulations/boids/boids-controller.ts` around lines 599–634 to confirm the existing private method names match.

- [ ] **Step 2: Add `tickOnce()` after the `tick` arrow function**

After the closing `};` of `private tick = () => { ... };`, insert:

```typescript
  /**
   * Runs exactly one simulation frame and resolves when the GPU is done.
   * Used by non-realtime recording to drive the frame loop manually.
   */
  tickOnce(): Promise<void> {
    if (!this.gpu) return Promise.resolve();
    const { device, context, aspect } = this._preFrameSetup();
    device.queue.writeBuffer(this.uniformBuffer, 0, this._packUniforms(aspect));
    const N = this.params.numParticles;
    const gridDim  = Math.max(4, Math.min(MAX_GRID_DIM, Math.floor(2.0 / this.params.attractionRadius)));
    const gridSize = gridDim * gridDim;
    this._runComputePasses(device, N, gridDim, gridSize);
    this._renderFrame(device, context, N);
    this.frame++;
    return this.gpu.device.queue.onSubmittedWorkDone();
  }
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | grep -i error | head -20
```

Expected: no TypeScript errors in `boids-controller.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/components/simulations/boids/boids-controller.ts
git commit -m "feat(boids): add public tickOnce() for non-realtime recording"
```

---

## Task 3: Add `getStream()` to AudioReactor

**Files:** Modify `src/components/simulations/boids/boids-audio.ts`

- [ ] **Step 1: Add `getStream()` after `isActive()`**

In `src/components/simulations/boids/boids-audio.ts`, after the `isActive()` method closing brace (around line 95), add:

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

This task implements the full realtime path (both WebM and MP4). `MediaRecorder` with `video/mp4;codecs=avc1` produces fragmented MP4 natively in Chrome/Edge/Safari — no muxer library needed for realtime MP4.

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
  private _nrtStartWallMs = 0;

  /** Populated after a non-realtime recording; ratio > 1.5 means audio was significantly stretched. */
  lastStretchRatio = 1.0;

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
      this._nrtRunning = false;
      // Wait briefly for encoder flush (already in flight from _runNonRealtimeLoop)
      await new Promise<void>(res => setTimeout(res, 50));
      blob = this._assembleNrtBlob();
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

  private _stopRealtime(_opts: RecordingOptions): Promise<Blob> {
    return new Promise((resolve) => {
      this._mrStopResolve = resolve;
      this._mediaRecorder?.stop();
      this._mediaRecorder = null;
    });
  }

  private _selectMimeType(opts: RecordingOptions): string {
    const withAudio = !!opts.audioStream;

    if (opts.format === 'mp4') {
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

  private _assembleNrtBlob(): Blob {
    // Implemented in Task 7
    return new Blob();
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

function pillGroup<T extends string | number>(
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

function section(icon: string, lbl: string): { wrap: HTMLDivElement; body: HTMLDivElement } {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:0 0.75rem;border-right:1px solid var(--bg-surface-border);';
  const header = document.createElement('div');
  header.style.cssText = 'font-size:0.55rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);white-space:nowrap;';
  header.textContent = `${icon} ${lbl}`;
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

function lbl(text: string, color = 'var(--text-muted)'): HTMLSpanElement {
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
  const customLbl = lbl('20 Mbps');
  customLbl.style.display = 'none';
  customSlider.addEventListener('input', () => {
    const mbps = parseInt(customSlider.value);
    customLbl.textContent = `${mbps} Mbps`;
    recOpts.videoBitsPerSecond = mbps * 1_000_000;
    updateWarnings();
  });

  const qualBtns = qualPresets.map(({ label: qLabel, key, bps }) => {
    const b = document.createElement('button');
    b.innerHTML = `${qualityDot(key)}<span style="font-size:0.6rem">${qLabel}</span>`;
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
        customLbl.style.display = '';
        recOpts.videoBitsPerSecond = parseInt(customSlider.value) * 1_000_000;
      } else {
        customSlider.style.display = 'none';
        customLbl.style.display = 'none';
        recOpts.videoBitsPerSecond = bps;
      }
      updateWarnings();
    });
    qualSection.body.appendChild(b);
    return b;
  });
  qualSection.body.appendChild(customSlider);
  qualSection.body.appendChild(customLbl);
  row.appendChild(qualSection.wrap);

  // MAX DURATION section
  const durSection = section('⏱', 'Max Duration');
  const durSlider = miniSlider(5, 300, 60, 5);
  const durLbl = lbl('60s');
  const unlimitedChk = document.createElement('input');
  unlimitedChk.type = 'checkbox';
  unlimitedChk.style.cssText = 'accent-color:var(--accent);cursor:pointer;';
  const unlimitedLbl = lbl('∞');
  durSlider.addEventListener('input', () => {
    durLbl.textContent = `${durSlider.value}s`;
    recOpts.maxDuration = parseInt(durSlider.value);
  });
  unlimitedChk.addEventListener('change', () => {
    recOpts.maxDuration = unlimitedChk.checked ? 0 : parseInt(durSlider.value);
    durSlider.style.opacity = unlimitedChk.checked ? '0.35' : '';
    durSlider.style.pointerEvents = unlimitedChk.checked ? 'none' : '';
    durLbl.style.opacity = unlimitedChk.checked ? '0.35' : '';
  });
  durSection.body.appendChild(durSlider);
  durSection.body.appendChild(durLbl);
  durSection.body.appendChild(unlimitedChk);
  durSection.body.appendChild(unlimitedLbl);
  row.appendChild(durSection.wrap);

  // TRIM section
  const trimSection = section('✂', 'Trim Start');
  const trimSlider = miniSlider(0, 30, 0, 1);
  const trimLbl = lbl('0s', 'var(--text-muted)');
  trimSlider.addEventListener('input', () => {
    trimLbl.textContent = `${trimSlider.value}s`;
    recOpts.trimStart = parseInt(trimSlider.value);
  });
  trimSection.body.appendChild(trimSlider);
  trimSection.body.appendChild(trimLbl);
  row.appendChild(trimSection.wrap);

  // REALTIME + AUDIO section
  const modeSection = section('⚙', 'Mode');
  const realtimeChk = document.createElement('input');
  realtimeChk.type = 'checkbox';
  realtimeChk.checked = true;
  realtimeChk.style.cssText = 'accent-color:var(--accent);cursor:pointer;';
  const realtimeLbl = lbl('Realtime');
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
  const audioLbl = lbl('Audio');
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
    if (!recOpts.realtime && recorder.lastStretchRatio > 1.5) {
      warnRow.textContent = `⚠ Audio quality was affected (${recorder.lastStretchRatio.toFixed(1)}× stretch). Lower target FPS for better results.`;
      warnRow.style.display = '';
    }
    opts.onRecordingStop?.();
  }

  recorder.onStop = (_blob, _ropts) => {
    // Called when maxDuration auto-stops — UI cleanup
    if (recorder.getState() === 'idle' && timerInterval) {
      void stopRecording();
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

Replaces the stub `_runNonRealtimeLoop` and `_assembleNrtBlob` with a real WebCodecs `VideoEncoder` + muxer implementation.

- [ ] **Step 1: Add imports at the top of `recorder.ts`**

Replace the opening comment line of `src/lib/webgpu/recorder.ts` with:

```typescript
// src/lib/webgpu/recorder.ts

import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
```

- [ ] **Step 2: Add non-realtime muxer fields to the class**

Inside `SimRecorder`, add these fields to the non-realtime fields block:

```typescript
  private _nrtVideoEncoder: VideoEncoder | null = null;
  private _nrtMp4Muxer: Mp4Muxer<Mp4Target> | null = null;
  private _nrtWebmMuxer: WebmMuxer<WebmTarget> | null = null;
  private _nrtMp4Target: Mp4Target | null = null;
  private _nrtWebmTarget: WebmTarget | null = null;
```

- [ ] **Step 3: Replace `_runNonRealtimeLoop` stub**

Replace the stub method with:

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

    // Initialise muxer
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
```

- [ ] **Step 4: Replace `_assembleNrtBlob` stub**

```typescript
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
    // @ts-ignore — soundtouchjs ships no types
    const { SoundTouch, SimpleFilter } = await import('soundtouchjs');
    const ratio = input.duration / targetDurationSec;

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
    st.tempo = ratio;
    const filter = new SimpleFilter(source, st);

    const outLen = Math.round(len / ratio);
    const outputInterleaved = new Float32Array(outLen * numCh);
    filter.extract(outputInterleaved, outLen);

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

- [ ] **Step 2: Add `_encodeAndMuxAudio()` helper**

```typescript
  private async _encodeAndMuxAudio(
    audioBuffer: AudioBuffer,
    muxer: Mp4Muxer<Mp4Target> | WebmMuxer<WebmTarget>,
    format: 'mp4' | 'webm',
  ): Promise<void> {
    const codec      = format === 'mp4' ? 'mp4a.40.2' : 'opus';
    const sampleRate = audioBuffer.sampleRate;
    const numCh      = audioBuffer.numberOfChannels;
    const frameSize  = 1024;

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
          format:           'f32-interleaved',
          sampleRate,
          numberOfFrames:   frames,
          numberOfChannels: numCh,
          timestamp:        ts,
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

Just before the muxer initialisation block in `_runNonRealtimeLoop`, add:

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

Update the muxer initialisation to include an audio track when `opts.audioStream` is present:

```typescript
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

After `await encoder.flush(); encoder.close(); this._nrtVideoEncoder = null;` and before `resolve()`, add:

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
            this.lastStretchRatio  = rawBuffer.duration / videoDurationSec;

            let processedBuffer = rawBuffer;
            if (Math.abs(this.lastStretchRatio - 1.0) > 0.02) {
              processedBuffer = await this._stretchAudio(rawBuffer, videoDurationSec);
            }

            const mux = (this._nrtMp4Muxer ?? this._nrtWebmMuxer)!;
            await this._encodeAndMuxAudio(processedBuffer, mux, opts.format);
          }
```

- [ ] **Step 4: Verify TypeScript**

```bash
npm run build 2>&1 | grep -i error | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webgpu/recorder.ts
git commit -m "feat(recorder): non-realtime audio — soundtouchjs time-stretch + AudioEncoder mux"
```

---

## Task 9: Expose AudioReactor and Wire Everything

**Files:**
- Modify `src/lib/sim-page/sim-setup/boids.ts` — return `{ reactor: AudioReactor }` instead of `void`
- Modify `src/lib/sim-page/sim-setup/index.ts` — return `{ hasPanel: boolean; audioReactor?: AudioReactor }` instead of `boolean`
- Modify `src/pages/gallery/[...slug].astro` — mount strip, wire recorder + strip

### Part A: Update `setupBoids` to return the reactor

- [ ] **Step 1: Change `setupBoids` return type in `boids.ts`**

In `src/lib/sim-page/sim-setup/boids.ts`, change the function signature from:

```typescript
export async function setupBoids(
  ctrl: BoidsController,
  panelContent: HTMLElement,
  panel: HTMLElement,
  shaderPanelEl: HTMLElement,
): Promise<void> {
  const reactor = new AudioReactor();
```

To:

```typescript
export async function setupBoids(
  ctrl: BoidsController,
  panelContent: HTMLElement,
  panel: HTMLElement,
  shaderPanelEl: HTMLElement,
): Promise<{ reactor: AudioReactor }> {
  const reactor = new AudioReactor();
```

And change the final line of the function (currently it has no return) to:

```typescript
  return { reactor };
```

Add `return { reactor };` just before the closing `}` of `setupBoids`.

- [ ] **Step 2: Update `setupSim` in `index.ts`**

In `src/lib/sim-page/sim-setup/index.ts`, change the import to include `AudioReactor`:

```typescript
import type { AudioReactor } from '../../../components/simulations/boids/boids-audio';
```

Change the return type from `Promise<boolean>` to `Promise<{ hasPanel: boolean; audioReactor?: AudioReactor }>`:

```typescript
export async function setupSim(
  sim: string,
  ctrl: AnyController,
  panelContent: HTMLElement,
  panel: HTMLElement,
  shaderPanelEl: HTMLElement,
): Promise<{ hasPanel: boolean; audioReactor?: AudioReactor }> {
```

Update each case to return the new shape:

```typescript
  switch (sim) {
    case 'boids': {
      const { reactor } = await setupBoids(ctrl as BoidsController, panelContent, panel, shaderPanelEl);
      return { hasPanel: true, audioReactor: reactor };
    }
    case 'cppn':
      await setupCPPN(ctrl as CPPNController, panelContent, panel);
      return { hasPanel: true };
    case 'nca':
      setupNCA(ctrl as NCAController, panelContent, panel);
      return { hasPanel: true };
    default:
      return { hasPanel: false };
  }
```

### Part B: Wire in `[...slug].astro`

- [ ] **Step 3: Add imports to the `<script>` block**

At the top of the `<script>` section in `src/pages/gallery/[...slug].astro`, add:

```typescript
  import { SimRecorder } from '../../lib/webgpu/recorder';
  import { buildRecordingStrip } from '../../lib/webgpu/recording-strip';
```

- [ ] **Step 4: Add strip container div to the HTML**

In the Astro template (before `<script>`), inside the `sim-viewport` div, add after `<Controls simId={sim} />`:

```html
<div id="recording-strip-container" style="position:absolute;bottom:0;left:0;right:0;z-index:15;"></div>
```

- [ ] **Step 5: Wire the recorder after `setupSim`**

In the `<script>` block, change the existing call:

```typescript
        const hasPanel = await setupSim(sim, controller, panelContent, panel, shaderPanelEl);
```

To:

```typescript
        const { hasPanel, audioReactor } = await setupSim(sim, controller, panelContent, panel, shaderPanelEl);

        // ── Recording strip ──────────────────────────────────────────────────
        const recorder       = new SimRecorder();
        const stripContainer = document.getElementById('recording-strip-container') as HTMLElement;
        const recordBtn      = document.querySelector(`#controls-${sim} [data-action="record"]`) as HTMLElement | null;

        const recordingStrip = buildRecordingStrip(stripContainer, recorder, {
          controller,
          audioReactor,
          onRecordingStart: () => {
            recordBtn?.classList.add('recording');
            recordBtn?.classList.remove('strip-open');
          },
          onRecordingStop: () => {
            recordBtn?.classList.remove('recording');
          },
        });

        document.addEventListener('pagehide', () => {
          recordingStrip.teardown();
          if (recorder.getState() === 'recording') void recorder.stop();
        }, { once: true });
```

- [ ] **Step 6: Wire the record button in the controls click handler**

In the `controls?.addEventListener('click', ...)` block, add after `else if (action === 'settings' && hasPanel)`:

```typescript
          } else if (action === 'record') {
            recordingStrip.toggle();
            if (recorder.getState() === 'idle') {
              recordBtn?.classList.toggle('strip-open');
            }
```

- [ ] **Step 7: Verify build**

```bash
npm run build 2>&1 | grep -i error | head -20
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/sim-page/sim-setup/boids.ts src/lib/sim-page/sim-setup/index.ts src/pages/gallery/[...slug].astro
git commit -m "feat(gallery): wire SimRecorder + buildRecordingStrip, expose AudioReactor from setupBoids"
```

---

## Task 10: Manual Integration Tests

**Files:** None — browser verification only.

Open `http://localhost:4321/gallery/boids` in **Chrome** for each test.

- [ ] **Test 1: Controls bar button — strip toggle**

Click the ● record button. Strip appears from bottom. Click again — strip hides.
Expected: `strip-open` class on button when open; strip hidden when closed.

- [ ] **Test 2: Realtime WebM recording**

Open strip → format = WebM, quality = Low, FPS = 30, duration = 10s, trim = 0, realtime = ✓.
Click REC. Timer counts up. At 10s auto-stops and a `.webm` file downloads.
Open the file in Chrome — should play back boids video with no UI overlay.

- [ ] **Test 3: Realtime MP4 recording**

Format = MP4, 5s max, click REC → let it auto-stop. `.mp4` downloads.
Open in VLC or Chrome — should play correctly.

- [ ] **Test 4: Trim start**

Format = WebM, max = 20s, trim = 5s. Click REC, wait 20s. Download should contain ~15s of footage (first 5s discarded).

- [ ] **Test 5: Audio recording**

Enable mic in Audio tab → audio indicator turns green. Open strip — "Audio" checkbox appears.
Check Audio. Start a 5s WebM recording while making noise. Download and play — audio should be present.

- [ ] **Test 6: Non-realtime recording (Chrome only)**

Uncheck Realtime. FPS = 30, 5s max. Click REC — simulation slows on screen. After it completes, `.webm` downloads. Play the file — should be exactly 30fps for 5 seconds.

- [ ] **Test 7: Non-realtime + audio (Chrome only)**

Realtime unchecked, audio checked. 5s. Download and play — audio and video should be aligned.

- [ ] **Test 8: MP4 not supported warning (Firefox)**

Open in Firefox. Clicking REC with MP4 format should show `⚠ MP4 recording is not supported in this browser` in the strip. WebM should work normally.

- [ ] **Step 9: Commit test completion**

```bash
git add -A
git commit -m "feat: video recorder — realtime + non-realtime, WebM + MP4, audio, bottom strip UI"
```

---

## Notes

- **`_stopNonRealtime` timing gap:** The 50ms await in `stop()` for non-realtime is pragmatic. If the encoder flush takes longer than 50ms, the muxer may not be fully finalised. A follow-up can store the loop Promise and await it properly.
- **`setupBoids` return value:** Changing `setupBoids` to return `{ reactor }` is a clean improvement over the old `window.__activeStrip` workaround — the reactor is always available when the strip is built.
- **Firefox + MP4:** Firefox does not support `video/mp4` in `MediaRecorder`. The error is surfaced in the strip UI.
- **`sim-canvas` coupling:** `buildRecordingStrip` reads the canvas via `document.getElementById('sim-canvas')`. This is intentional — it matches the ID in `[...slug].astro` and keeps the strip implementation simple.
