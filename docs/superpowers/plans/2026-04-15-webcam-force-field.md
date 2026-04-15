# Webcam Force Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live webcam source to the boids Image tab, with configurable frame-rate throttling, independent processing params per source (static/webcam), and mirror toggle.

**Architecture:** A new `BoidsWebcam` class manages `getUserMedia`, the hidden `HTMLVideoElement`, frame throttling, and a mirroring canvas. `ImageProcessor` gains one `writeVideoFrame(source)` method that copies a video/canvas frame to GPU and re-runs the existing processing pipeline. The boids shader and `BoidsImageForce` are untouched — they still read the same `processedTexture` at bindings 7/8.

**Tech Stack:** TypeScript, WebGPU (`copyExternalImageToTexture`), Canvas 2D API (mirror flip), Astro/browser

---

## File Map

| File | Change |
|---|---|
| `src/lib/webgpu/image-editor/image-processor.ts` | Add `writeVideoFrame(source)` method |
| `src/components/simulations/boids/boids-webcam.ts` | **New** — `BoidsWebcam` class |
| `src/components/simulations/boids/boids-controller.ts` | Add `readonly webcam`, call `webcam.tick()` in render loop, destroy |
| `src/lib/webgpu/image-editor/image-panel-section.ts` | Full rewrite — source toggle, webcam UI, per-source params, blur/threshold sliders |
| `src/components/simulations/boids/boids-panel.ts` | Pass `webcam: controller.webcam` to `buildImagePanelSection` |

---

## Task 1: Add `writeVideoFrame()` to `ImageProcessor`

**Files:**
- Modify: `src/lib/webgpu/image-editor/image-processor.ts` (before the `destroy()` method at line 500)

- [ ] **Step 1: Add the method**

Insert this method between `getCompositedTexture()` and `destroy()` in `image-processor.ts`:

```ts
writeVideoFrame(source: HTMLVideoElement | HTMLCanvasElement): void {
  // Skip if video not ready yet
  if (source instanceof HTMLVideoElement && source.readyState < 2 /* HAVE_CURRENT_DATA */) return;

  const { device } = this;
  const w = source instanceof HTMLVideoElement ? source.videoWidth  : (source as HTMLCanvasElement).width;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : (source as HTMLCanvasElement).height;
  if (w === 0 || h === 0) return;

  // Reallocate sourceTexture only when dimensions change (once on start, rare after)
  if (!this.hasImage || this.imageWidth !== w || this.imageHeight !== h) {
    this.sourceTexture.destroy();
    this.sourceTexture = device.createTexture({
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage: TEX_USAGE_COMPUTE_IN | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.imageWidth  = w;
    this.imageHeight = h;
    this.hasImage    = true;
    this._applyContainTransform();
  }

  try {
    device.queue.copyExternalImageToTexture(
      { source: source as HTMLVideoElement, flipY: false },
      { texture: this.sourceTexture },
      [w, h],
    );
  } catch {
    return; // frame skipped on GPU error
  }

  this._triggerReprocess();
}
```

- [ ] **Step 2: Verify build**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
npm run build
```

Expected: build succeeds with no TypeScript errors related to `image-processor.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/webgpu/image-editor/image-processor.ts
git commit -m "feat(image): add writeVideoFrame() to ImageProcessor"
```

---

## Task 2: Create `BoidsWebcam` class

**Files:**
- Create: `src/components/simulations/boids/boids-webcam.ts`

- [ ] **Step 1: Create the file**

```ts
// src/components/simulations/boids/boids-webcam.ts

import type { ImageProcessor } from '../../../lib/webgpu/image-editor/image-processor';
import { ProcessingMode, type ProcessingParams } from '../../../lib/webgpu/image-editor/image-editor-types';

export class BoidsWebcam {
  status: 'idle' | 'active' | 'error' = 'idle';
  lastError = '';
  targetFps = 30;
  mirrored  = true;

  params: ProcessingParams = {
    mode:       ProcessingMode.GradientAttract,
    blurRadius: 0,
    threshold:  0.5,
    invert:     false,
  };

  availableCameras: MediaDeviceInfo[] = [];
  activeCameraId: string | null = null;

  private video:       HTMLVideoElement | null = null;
  private stream:      MediaStream | null = null;
  private lastFrameTime = 0;

  // Canvas used to draw a horizontally-flipped frame when mirrored = true
  private mirrorCanvas = document.createElement('canvas');
  private mirrorCtx:   CanvasRenderingContext2D | null = null;

  async enumerateCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.availableCameras = devices.filter(d => d.kind === 'videoinput');
    return this.availableCameras;
  }

  async start(cameraId?: string): Promise<void> {
    this.stop();
    await this.enumerateCameras();

    const id = cameraId ?? this.activeCameraId ?? undefined;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: id ? { deviceId: { exact: id } } : true,
    });

    const track = this.stream.getVideoTracks()[0];
    this.activeCameraId = track.getSettings().deviceId ?? null;

    this.video = document.createElement('video');
    this.video.srcObject  = this.stream;
    this.video.playsInline = true;
    this.video.muted      = true;
    await this.video.play();

    this.mirrorCtx = this.mirrorCanvas.getContext('2d');

    track.addEventListener('ended', () => {
      this.lastError = 'Camera disconnected';
      this.stop();
      this.status = 'error';
    });

    this.status = 'active';
    this.lastFrameTime = 0;
  }

  stop(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video  = null;
    if (this.status !== 'error') this.status = 'idle';
  }

  tick(processor: ImageProcessor): void {
    if (!this.video || this.status !== 'active') return;
    const now = performance.now();
    if (now - this.lastFrameTime < 1000 / this.targetFps) return;
    this.lastFrameTime = now;
    processor.writeVideoFrame(this._getFrameSource());
  }

  private _getFrameSource(): HTMLVideoElement | HTMLCanvasElement {
    if (!this.mirrored) return this.video!;
    const w = this.video!.videoWidth;
    const h = this.video!.videoHeight;
    if (this.mirrorCanvas.width  !== w) this.mirrorCanvas.width  = w;
    if (this.mirrorCanvas.height !== h) this.mirrorCanvas.height = h;
    const ctx = this.mirrorCtx!;
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(this.video!, -w, 0);
    ctx.restore();
    return this.mirrorCanvas;
  }

  destroy(): void {
    this.stop();
    this.status = 'idle';
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: no TypeScript errors in `boids-webcam.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/boids/boids-webcam.ts
git commit -m "feat(boids): add BoidsWebcam class"
```

---

## Task 3: Wire `BoidsWebcam` into `BoidsController`

**Files:**
- Modify: `src/components/simulations/boids/boids-controller.ts`

- [ ] **Step 1: Add import + property**

At the top of `boids-controller.ts`, add the import after the existing boids imports:

```ts
import { BoidsWebcam } from './boids-webcam';
```

In the `BoidsController` class body, add after line 112 (`readonly imageForce = new BoidsImageForce();`):

```ts
readonly webcam = new BoidsWebcam();
```

- [ ] **Step 2: Call `webcam.tick()` in the render loop**

In the `tick` arrow function, add the webcam tick call immediately after the canvas resize block (after the `rebuildBoidsBindGroups()` call and before writing the uniform buffer). Find this block around line 437:

```ts
      this.prevCanvasWidth  = canvas.width;
      this.prevCanvasHeight = canvas.height;
    }
```

Add immediately after:

```ts
    // ── Webcam frame capture ──────────────────────────────────────────
    if (this.webcam.status === 'active') {
      this.webcam.tick(this.imageProcessor);
    }
```

- [ ] **Step 3: Add `webcam.destroy()` to `destroy()`**

The current `destroy()` at line 619:

```ts
  destroy(): void {
    this.imageProcessor.destroy();
    this.imageForce.destroy();
  }
```

Replace with:

```ts
  destroy(): void {
    this.webcam.destroy();
    this.imageProcessor.destroy();
    this.imageForce.destroy();
  }
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: no TypeScript errors in `boids-controller.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/components/simulations/boids/boids-controller.ts
git commit -m "feat(boids): wire BoidsWebcam into controller tick and destroy"
```

---

## Task 4: Rewrite `image-panel-section.ts` with source toggle and webcam UI

**Files:**
- Modify: `src/lib/webgpu/image-editor/image-panel-section.ts` (full rewrite)

This task restructures the Image tab panel to support two sources (Static / Webcam) with independent processing params.

- [ ] **Step 1: Replace the file contents**

```ts
// src/lib/webgpu/image-editor/image-panel-section.ts

import type { ImageProcessor }  from './image-processor';
import type { BoidsWebcam }     from '../../components/simulations/boids/boids-webcam';
import { ProcessingMode }       from './image-editor-types';
import { createFileInput, attachDropZone } from './image-uploader';

export interface ImagePanelSectionOpts {
  onOpenEditor:     () => void;
  onRebindGroups:   () => void;
  webcam:           BoidsWebcam;
  imageForce: {
    setEnabled:     (v: boolean) => void;
    setStrength:    (v: number)  => void;
    setForceMode:   (m: number)  => void;
    setInvert:      (v: boolean) => void;
    setShowOverlay: (v: boolean) => void;
    isActive:       () => boolean;
  };
}

// Per-source state saved when switching away from a source
type SourceParams = {
  mode: ProcessingMode; blurRadius: number; threshold: number; invert: boolean; strength: number;
};

export function buildImagePanelSection(
  container: HTMLElement,
  processor: ImageProcessor,
  opts:      ImagePanelSectionOpts,
): () => void {

  // ── Section wrapper ──────────────────────────────────────────────
  const section = document.createElement('div');
  section.style.cssText = 'border-top:1px solid var(--bg-surface-border);padding:0.5rem 0.6rem;';
  container.appendChild(section);

  // ── Per-source saved params ──────────────────────────────────────
  let activeSource: 'static' | 'webcam' = 'static';
  let savedStaticParams: SourceParams = {
    mode: ProcessingMode.LuminanceAttract, blurRadius: 0, threshold: 0.5, invert: false, strength: 0.5,
  };
  let savedWebcamParams: SourceParams = {
    mode: ProcessingMode.GradientAttract, blurRadius: 0, threshold: 0.5, invert: false, strength: 0.5,
  };

  // ── Label row (Image Force + enabled toggle) ──────────────────────
  const labelRow = document.createElement('div');
  labelRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:0.35rem;';
  const label = document.createElement('span');
  label.style.cssText = 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);';
  label.textContent = 'Image Force';
  const enableToggle = document.createElement('input');
  enableToggle.type    = 'checkbox';
  enableToggle.checked = true;
  enableToggle.title   = 'Enable/disable image force';
  enableToggle.addEventListener('change', () => opts.imageForce.setEnabled(enableToggle.checked));
  labelRow.appendChild(label);
  labelRow.appendChild(enableToggle);
  section.appendChild(labelRow);

  // ── Source toggle row ────────────────────────────────────────────
  const sourceRow = document.createElement('div');
  sourceRow.style.cssText = 'display:flex;gap:4px;margin-bottom:0.4rem;';

  const staticPill = document.createElement('button');
  const webcamPill = document.createElement('button');

  function pillActiveStyle(active: boolean): string {
    return active
      ? 'flex:1;font-size:0.6rem;padding:2px 6px;border-radius:10px;background:var(--accent);color:var(--bg-primary);border:1px solid transparent;cursor:pointer;'
      : 'flex:1;font-size:0.6rem;padding:2px 6px;border-radius:10px;background:transparent;color:var(--text-muted);border:1px solid var(--bg-surface-border);cursor:pointer;';
  }

  staticPill.textContent = '📷 Static';
  webcamPill.textContent = '🎥 Webcam';
  staticPill.style.cssText = pillActiveStyle(true);
  webcamPill.style.cssText = pillActiveStyle(false);
  sourceRow.appendChild(staticPill);
  sourceRow.appendChild(webcamPill);
  section.appendChild(sourceRow);

  // ── Static area ──────────────────────────────────────────────────
  const staticArea = document.createElement('div');

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width  = 180;
  thumbCanvas.height = 101;
  thumbCanvas.style.cssText = 'width:100%;border-radius:3px;border:1px solid var(--bg-surface-border);display:block;margin-bottom:0.4rem;cursor:pointer;';
  thumbCanvas.title = 'Click to open editor';
  thumbCanvas.addEventListener('click', opts.onOpenEditor);
  staticArea.appendChild(thumbCanvas);

  const thumbCtxStatic = thumbCanvas.getContext('webgpu') as GPUCanvasContext | null;
  if (thumbCtxStatic) processor.setThumbnailContext(thumbCtxStatic);

  const fileInput = createFileInput((bmp) => {
    processor.loadImage(bmp);
    opts.onRebindGroups();
    refreshUI();
  });
  document.body.appendChild(fileInput);

  const staticBtnRow = document.createElement('div');
  staticBtnRow.style.cssText = 'display:flex;gap:4px;margin-bottom:0.4rem;';
  const loadBtn = document.createElement('button');
  loadBtn.className = 'panel-close'; loadBtn.textContent = 'Load Image';
  loadBtn.style.cssText = 'flex:1;font-size:0.65rem;padding:3px 6px;';
  loadBtn.addEventListener('click', () => fileInput.click());
  const paintBtn = document.createElement('button');
  paintBtn.className = 'panel-close'; paintBtn.textContent = 'Paint';
  paintBtn.style.cssText = 'flex:1;font-size:0.65rem;padding:3px 6px;';
  paintBtn.addEventListener('click', opts.onOpenEditor);
  staticBtnRow.appendChild(loadBtn); staticBtnRow.appendChild(paintBtn);
  staticArea.appendChild(staticBtnRow);

  const staticActionRow = document.createElement('div');
  staticActionRow.style.cssText = 'display:flex;gap:4px;margin-bottom:0.4rem;';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'panel-close'; clearBtn.textContent = 'Clear Image';
  clearBtn.style.cssText = 'flex:1;font-size:0.6rem;padding:3px 6px;display:none;';
  clearBtn.addEventListener('click', () => {
    processor.clearImage(); opts.onRebindGroups(); refreshUI();
  });
  const resetBtn = document.createElement('button');
  resetBtn.className = 'panel-close'; resetBtn.textContent = 'Reset Paint';
  resetBtn.style.cssText = 'flex:1;font-size:0.6rem;padding:3px 6px;display:none;';
  resetBtn.addEventListener('click', () => { processor.resetPaint(); refreshUI(); });
  staticActionRow.appendChild(clearBtn); staticActionRow.appendChild(resetBtn);
  staticArea.appendChild(staticActionRow);
  section.appendChild(staticArea);

  // ── Webcam area ──────────────────────────────────────────────────
  const webcamArea = document.createElement('div');
  webcamArea.style.display = 'none';

  const previewCanvas = document.createElement('canvas');
  previewCanvas.width  = 180;
  previewCanvas.height = 101;
  previewCanvas.style.cssText = 'width:100%;border-radius:3px;border:1px solid var(--bg-surface-border);display:block;margin-bottom:0.4rem;';
  webcamArea.appendChild(previewCanvas);
  const thumbCtxWebcam = previewCanvas.getContext('webgpu') as GPUCanvasContext | null;

  const camRow = document.createElement('div');
  camRow.style.cssText = 'display:flex;gap:4px;margin-bottom:0.35rem;align-items:center;';
  const camSelect = document.createElement('select');
  camSelect.style.cssText = 'flex:1;font-size:0.6rem;background:var(--bg-surface);border:1px solid var(--bg-surface-border);border-radius:3px;padding:2px 4px;color:var(--text-body);';
  const startStopBtn = document.createElement('button');
  startStopBtn.className = 'panel-close'; startStopBtn.textContent = '▶ Start';
  startStopBtn.style.cssText = 'font-size:0.6rem;padding:3px 8px;white-space:nowrap;';
  camRow.appendChild(camSelect); camRow.appendChild(startStopBtn);
  webcamArea.appendChild(camRow);

  const fpsRow = document.createElement('div');
  fpsRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:0.3rem;';
  const fpsLbl = document.createElement('span');
  fpsLbl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);min-width:52px;';
  fpsLbl.textContent = 'Capture fps';
  const fpsInput = document.createElement('input');
  fpsInput.type = 'range'; fpsInput.min = '5'; fpsInput.max = '60'; fpsInput.step = '1'; fpsInput.value = '30';
  fpsInput.style.cssText = 'flex:1;';
  const fpsVal = document.createElement('span');
  fpsVal.style.cssText = 'font-size:0.58rem;color:var(--text-muted);min-width:22px;';
  fpsVal.textContent = '30';
  fpsInput.addEventListener('input', () => {
    opts.webcam.targetFps = Number(fpsInput.value);
    fpsVal.textContent    = fpsInput.value;
  });
  fpsRow.appendChild(fpsLbl); fpsRow.appendChild(fpsInput); fpsRow.appendChild(fpsVal);
  webcamArea.appendChild(fpsRow);

  const mirrorRow = document.createElement('div');
  mirrorRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:0.3rem;';
  const mirrorLbl = document.createElement('span');
  mirrorLbl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
  mirrorLbl.textContent = 'Mirror';
  const mirrorChk = document.createElement('input');
  mirrorChk.type = 'checkbox'; mirrorChk.checked = true;
  mirrorChk.addEventListener('change', () => { opts.webcam.mirrored = mirrorChk.checked; });
  mirrorRow.appendChild(mirrorLbl); mirrorRow.appendChild(mirrorChk);
  webcamArea.appendChild(mirrorRow);

  const webcamErrorMsg = document.createElement('div');
  webcamErrorMsg.style.cssText = 'font-size:0.62rem;color:#e05060;margin-bottom:4px;display:none;word-break:break-word;';
  webcamArea.appendChild(webcamErrorMsg);
  section.appendChild(webcamArea);

  // ── Shared processing section ────────────────────────────────────
  const sharedDiv = document.createElement('div');
  sharedDiv.style.cssText = 'border-top:1px solid var(--bg-surface-border);padding-top:0.4rem;margin-top:0.1rem;';

  // Mode pills
  const modeNames = ['Attract', 'Repel', 'Grad Flow', 'Grad Edge', 'Threshold', 'SDF'];
  const pillRow = document.createElement('div');
  pillRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:0.4rem;';
  let activeModeIdx = 0;

  function setActivePill(idx: number): void {
    activeModeIdx = idx;
    pillRow.querySelectorAll('button').forEach((b, i) => {
      const btn = b as HTMLButtonElement;
      if (i === idx) {
        btn.style.background = 'var(--accent)'; btn.style.color = 'var(--bg-primary)'; btn.style.border = '1px solid transparent';
      } else {
        btn.style.background = 'transparent'; btn.style.color = 'var(--text-muted)'; btn.style.border = '1px solid var(--bg-surface-border)';
      }
    });
  }

  modeNames.forEach((name, i) => {
    const pill = document.createElement('button');
    pill.textContent = name;
    pill.style.cssText = i === 0
      ? 'font-size:0.58rem;padding:2px 6px;border-radius:10px;background:var(--accent);color:var(--bg-primary);border:1px solid transparent;cursor:pointer;'
      : 'font-size:0.58rem;padding:2px 6px;border-radius:10px;background:transparent;color:var(--text-muted);border:1px solid var(--bg-surface-border);cursor:pointer;';
    pill.addEventListener('click', () => {
      setActivePill(i);
      opts.imageForce.setForceMode(i);
      processor.setMode(i as ProcessingMode);
    });
    pillRow.appendChild(pill);
  });
  sharedDiv.appendChild(pillRow);

  // Generic slider helper — returns input element for value-syncing on source switch
  function makeSlider(
    labelText: string, min: number, max: number, val: number, step: number,
    cb: (v: number) => void,
  ): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:0.3rem;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);min-width:52px;';
    lbl.textContent = labelText;
    const inp = document.createElement('input');
    inp.type  = 'range'; inp.min = String(min); inp.max = String(max);
    inp.step  = String(step); inp.value = String(val);
    inp.style.cssText = 'flex:1;';
    const valSpan = document.createElement('span');
    valSpan.style.cssText = 'font-size:0.58rem;color:var(--text-muted);min-width:30px;text-align:right;';
    valSpan.textContent = String(val);
    inp.addEventListener('input', () => {
      cb(Number(inp.value));
      valSpan.textContent = Number(inp.value).toFixed(step < 1 ? 2 : 0);
    });
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(valSpan);
    return { row, input: inp };
  }

  const { row: strengthRow, input: strengthInput } = makeSlider('Strength', 0, 2, 0.5, 0.01, v => opts.imageForce.setStrength(v));
  const { row: blurRow,     input: blurInput }     = makeSlider('Blur',     0, 10, 0,   0.5,  v => processor.setBlurRadius(v));
  const { row: threshRow,   input: threshInput }   = makeSlider('Threshold',0, 1,  0.5, 0.01, v => processor.setThreshold(v));
  sharedDiv.appendChild(strengthRow);
  sharedDiv.appendChild(blurRow);
  sharedDiv.appendChild(threshRow);

  const overlayRow = document.createElement('div');
  overlayRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:0.3rem;';
  const overlayLbl = document.createElement('span');
  overlayLbl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
  overlayLbl.textContent = 'Show image';
  const overlayChk = document.createElement('input');
  overlayChk.type = 'checkbox'; overlayChk.checked = true;
  overlayChk.addEventListener('change', () => opts.imageForce.setShowOverlay(overlayChk.checked));
  overlayRow.appendChild(overlayLbl); overlayRow.appendChild(overlayChk);
  sharedDiv.appendChild(overlayRow);

  const invertRow = document.createElement('div');
  invertRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:0.3rem;';
  const invertLbl = document.createElement('span');
  invertLbl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
  invertLbl.textContent = 'Invert';
  const invertChk = document.createElement('input');
  invertChk.type = 'checkbox';
  invertChk.addEventListener('change', () => {
    opts.imageForce.setInvert(invertChk.checked);
    processor.setInvert(invertChk.checked);
  });
  invertRow.appendChild(invertLbl); invertRow.appendChild(invertChk);
  sharedDiv.appendChild(invertRow);
  section.appendChild(sharedDiv);

  // ── Drop zone on thumbnail ────────────────────────────────────────
  const cleanupDrop = attachDropZone(thumbCanvas, (bmp) => {
    processor.loadImage(bmp);
    opts.onRebindGroups();
    refreshUI();
  });

  // ── Param helpers ─────────────────────────────────────────────────
  function readCurrentParams(): SourceParams {
    return {
      mode:       activeModeIdx as ProcessingMode,
      blurRadius: Number(blurInput.value),
      threshold:  Number(threshInput.value),
      invert:     invertChk.checked,
      strength:   Number(strengthInput.value),
    };
  }

  function applyParams(p: SourceParams): void {
    processor.setMode(p.mode);
    processor.setBlurRadius(p.blurRadius);
    processor.setThreshold(p.threshold);
    processor.setInvert(p.invert);
    opts.imageForce.setForceMode(p.mode);
    opts.imageForce.setInvert(p.invert);
    opts.imageForce.setStrength(p.strength);
    // Sync UI controls
    setActivePill(p.mode);
    blurInput.value     = String(p.blurRadius);
    threshInput.value   = String(p.threshold);
    strengthInput.value = String(p.strength);
    invertChk.checked   = p.invert;
  }

  // ── Source switching ──────────────────────────────────────────────
  async function switchSource(to: 'static' | 'webcam'): Promise<void> {
    if (to === activeSource) return;

    // Save leaving source's params
    if (activeSource === 'static') {
      savedStaticParams = readCurrentParams();
    } else {
      savedWebcamParams = readCurrentParams();
    }
    activeSource = to;

    if (to === 'static') {
      opts.webcam.stop();
      processor.clearImage();
      opts.onRebindGroups();
      if (thumbCtxStatic) processor.setThumbnailContext(thumbCtxStatic);
      applyParams(savedStaticParams);
    } else {
      if (thumbCtxWebcam) processor.setThumbnailContext(thumbCtxWebcam);
      applyParams(savedWebcamParams);
      if (opts.webcam.availableCameras.length === 0) await populateCameraSelect();
    }
    refreshUI();
  }

  staticPill.addEventListener('click', () => void switchSource('static'));
  webcamPill.addEventListener('click', () => void switchSource('webcam'));

  // ── Camera population ─────────────────────────────────────────────
  async function populateCameraSelect(): Promise<void> {
    await opts.webcam.enumerateCameras();
    camSelect.innerHTML = '';
    for (const cam of opts.webcam.availableCameras) {
      const opt = document.createElement('option');
      opt.value       = cam.deviceId;
      opt.textContent = cam.label || `Camera ${camSelect.options.length + 1}`;
      camSelect.appendChild(opt);
    }
  }

  // ── Start / Stop button ───────────────────────────────────────────
  startStopBtn.addEventListener('click', () => {
    if (opts.webcam.status === 'active') {
      opts.webcam.stop();
      processor.clearImage();
      opts.onRebindGroups();
      refreshUI();
    } else {
      const cameraId = camSelect.value || undefined;
      void opts.webcam.start(cameraId).then(() => {
        opts.onRebindGroups();
        refreshUI();
      }).catch(() => {
        refreshUI();
      });
    }
  });

  // ── refreshUI ─────────────────────────────────────────────────────
  function refreshUI(): void {
    const isWebcam = activeSource === 'webcam';
    staticArea.style.display = isWebcam ? 'none' : '';
    webcamArea.style.display = isWebcam ? '' : 'none';
    staticPill.style.cssText = pillActiveStyle(!isWebcam);
    webcamPill.style.cssText = pillActiveStyle(isWebcam);

    clearBtn.style.display = processor.hasImage ? '' : 'none';
    resetBtn.style.display = processor.hasPaint ? '' : 'none';

    if (isWebcam) {
      const isActive = opts.webcam.status === 'active';
      startStopBtn.textContent   = isActive ? '■ Stop' : '▶ Start';
      startStopBtn.style.color   = isActive ? 'var(--accent)' : '';
      startStopBtn.style.borderColor = isActive ? 'var(--accent)' : '';
      webcamErrorMsg.style.display   = opts.webcam.status === 'error' ? '' : 'none';
      webcamErrorMsg.textContent     = opts.webcam.lastError;
      if (opts.webcam.activeCameraId) camSelect.value = opts.webcam.activeCameraId;
    }

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

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: no TypeScript errors. If the import path for `BoidsWebcam` produces an error ("relative import from lib into components"), move the import type to be resolved through the opts interface instead:

Alternative (avoids cross-boundary import): replace the `BoidsWebcam` import with an inline interface:

```ts
// Replace the BoidsWebcam import with this inline interface at the top of image-panel-section.ts:
interface WebcamSource {
  status:           'idle' | 'active' | 'error';
  lastError:        string;
  targetFps:        number;
  mirrored:         boolean;
  availableCameras: MediaDeviceInfo[];
  activeCameraId:   string | null;
  start:            (cameraId?: string) => Promise<void>;
  stop:             () => void;
  enumerateCameras: () => Promise<MediaDeviceInfo[]>;
}
// And change `webcam: BoidsWebcam` to `webcam: WebcamSource` in ImagePanelSectionOpts
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/webgpu/image-editor/image-panel-section.ts
git commit -m "feat(image): add webcam source toggle, independent per-source params, blur/threshold sliders"
```

---

## Task 5: Thread `webcam` through `boids-panel.ts`

**Files:**
- Modify: `src/components/simulations/boids/boids-panel.ts` (line ~450)

- [ ] **Step 1: Pass `webcam` into `buildImagePanelSection`**

Find the `buildImagePanelSection` call at approximately line 450 in `boids-panel.ts`:

```ts
  buildImagePanelSection(imageBody, controller.imageProcessor, {
    onOpenEditor: () => {
      const viewport = document.getElementById('sim-viewport') ?? document.body;
      openImageEditorOverlay(controller.imageProcessor, {
        onClose:        () => { /* overlay closed */ },
        onRebindGroups: () => controller.rebuildBoidsBindGroups(),
        onSetForceMode: (m) => controller.imageForce.setForceMode(m),
      }, viewport);
    },
    onRebindGroups: () => controller.rebuildBoidsBindGroups(),
    imageForce: controller.imageForce,
  });
```

Replace with:

```ts
  buildImagePanelSection(imageBody, controller.imageProcessor, {
    onOpenEditor: () => {
      const viewport = document.getElementById('sim-viewport') ?? document.body;
      openImageEditorOverlay(controller.imageProcessor, {
        onClose:        () => { /* overlay closed */ },
        onRebindGroups: () => controller.rebuildBoidsBindGroups(),
        onSetForceMode: (m) => controller.imageForce.setForceMode(m),
      }, viewport);
    },
    onRebindGroups: () => controller.rebuildBoidsBindGroups(),
    webcam:     controller.webcam,
    imageForce: controller.imageForce,
  });
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: clean build with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/boids/boids-panel.ts
git commit -m "feat(boids): pass webcam into image panel section"
```

---

## Task 6: Integration test

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Open `http://localhost:4321` (or whatever port Astro uses) and navigate to the boids gallery page.

- [ ] **Step 2: Test source toggle**

1. Open the side panel → Image tab
2. Confirm the `📷 Static` / `🎥 Webcam` pills appear at the top
3. Confirm the existing static image controls (Load Image, Paint, thumbnail) are visible
4. Click `🎥 Webcam` — confirm the webcam area replaces the static area, processing controls remain

- [ ] **Step 3: Test webcam start/stop**

1. In Webcam mode, click `▶ Start`
2. Browser should prompt for camera permission — allow it
3. The camera selector should populate with available cameras
4. The `▶ Start` button should become `■ Stop` in accent colour
5. The live preview canvas should begin showing the processed webcam feed
6. Boids should respond to the webcam feed (e.g., with Grad Edge mode, edges in the webcam image attract/repel boids)
7. Click `■ Stop` — webcam stops, button reverts to `▶ Start`

- [ ] **Step 4: Test independent params**

1. In Static mode: set mode to `Attract`, strength to 0.8
2. Switch to Webcam mode — confirm mode resets to its own setting (Grad Edge, 0.5)
3. Change webcam mode to `Threshold`, strength to 1.5
4. Switch back to Static — confirm mode is back to `Attract`, strength 0.8
5. Switch back to Webcam — confirm `Threshold`, strength 1.5 is restored

- [ ] **Step 5: Test fps slider and mirror**

1. With webcam active, drag fps slider to 5 — boid force field should update noticeably less often
2. Toggle Mirror checkbox off/on — the processed feed should flip horizontally

- [ ] **Step 6: Test error handling**

1. Start webcam, then physically disconnect camera (or revoke permission in browser) — confirm error message appears
2. Refresh and deny camera permission — confirm red error message appears below Start button

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat(boids): webcam force field — live video source with independent params and mirror"
```
