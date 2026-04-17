// src/lib/webgpu/image-editor/image-panel-section.ts

import type { ImageProcessor }  from './image-processor';
import { ProcessingMode }       from './image-editor-types';
import { createFileInput, attachDropZone } from './image-uploader';

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

export interface ImagePanelSectionOpts {
  onOpenEditor:     () => void;
  onRebindGroups:   () => void;
  webcam:           WebcamSource;
  imageForce: {
    setEnabled:     (v: boolean) => void;
    setStrength:    (v: number)  => void;
    setForceMode:   (m: number)  => void;
    setInvert:      (v: boolean) => void;
    setShowOverlay: (v: boolean) => void;
    isActive:       () => boolean;
    getStrength:    () => number;
    getForceMode:   () => number;
    getInvert:      () => boolean;
    getEnabled:     () => boolean;
    showOverlay:    boolean;
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

  // ── Per-source saved params — initialised from live controller state ─
  // This ensures panel rebuilds (e.g. on preset load) don't reset tuned values.
  const isWebcamCurrentlyActive = opts.webcam.status === 'active';
  // Start on the tab that was active when panel was built; restores tab after preset-load rebuilds.
  let activeSource: 'static' | 'webcam' = isWebcamCurrentlyActive ? 'webcam' : 'static';

  const liveParams: SourceParams = {
    mode:       processor.params.mode,
    blurRadius: processor.params.blurRadius,
    threshold:  processor.params.threshold,
    invert:     processor.params.invert,
    strength:   opts.imageForce.getStrength(),
  };
  const defaultStaticParams: SourceParams = {
    mode: ProcessingMode.LuminanceAttract, blurRadius: 0, threshold: 0.5, invert: false, strength: 0.5,
  };
  const defaultWebcamParams: SourceParams = {
    mode: ProcessingMode.GradientAttract, blurRadius: 0, threshold: 0.5, invert: false, strength: 0.5,
  };
  // Current live state belongs to whichever source is active; the other gets defaults.
  let savedStaticParams: SourceParams = isWebcamCurrentlyActive ? defaultStaticParams : liveParams;
  let savedWebcamParams: SourceParams = isWebcamCurrentlyActive ? liveParams : defaultWebcamParams;

  // ── Label row (Image Force + enabled toggle) ──────────────────────
  const labelRow = document.createElement('div');
  labelRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:0.35rem;';
  const label = document.createElement('span');
  label.style.cssText = 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);';
  label.textContent = 'Image Force';
  const enableToggle = document.createElement('input');
  enableToggle.type    = 'checkbox';
  enableToggle.checked = opts.imageForce.getEnabled();
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
  staticPill.style.cssText = pillActiveStyle(activeSource === 'static');
  webcamPill.style.cssText = pillActiveStyle(activeSource === 'webcam');
  sourceRow.appendChild(staticPill);
  sourceRow.appendChild(webcamPill);
  section.appendChild(sourceRow);

  // ── Static area ──────────────────────────────────────────────────
  const staticArea = document.createElement('div');

  const THUMB_ASPECT = 101 / 180;
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width  = 180;
  thumbCanvas.height = 101;
  thumbCanvas.style.cssText = 'width:100%;border-radius:3px;border:1px solid var(--bg-surface-border);display:block;margin-bottom:0.4rem;cursor:pointer;';
  thumbCanvas.title = 'Click to open editor';
  thumbCanvas.addEventListener('click', opts.onOpenEditor);
  staticArea.appendChild(thumbCanvas);

  const thumbCtxStatic = thumbCanvas.getContext('webgpu') as GPUCanvasContext | null;
  // setThumbnailContext deferred below — needs thumbCtxWebcam to also exist first

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
  previewCanvas.style.cssText = 'width:100%;border-radius:3px;border:1px solid var(--bg-surface-border);display:block;margin-bottom:0.4rem;cursor:pointer;';
  const dpr = window.devicePixelRatio || 1;
  previewCanvas.title = 'Click to open editor';
  previewCanvas.addEventListener('click', opts.onOpenEditor);
  webcamArea.appendChild(previewCanvas);
  const thumbCtxWebcam = previewCanvas.getContext('webgpu') as GPUCanvasContext | null;

  // Initial thumbnail context set after populateCameraSelect is defined (see below)

  const camRow = document.createElement('div');
  camRow.style.cssText = 'display:flex;gap:4px;margin-bottom:0.35rem;align-items:center;overflow:hidden;';
  const camSelect = document.createElement('select');
  camSelect.style.cssText = 'flex:1;min-width:0;font-size:0.6rem;background:var(--bg-surface);border:1px solid var(--bg-surface-border);border-radius:3px;padding:2px 4px;color:var(--text-body);';
  const startStopBtn = document.createElement('button');
  startStopBtn.className = 'panel-close'; startStopBtn.textContent = '▶ Start';
  startStopBtn.style.cssText = 'flex-shrink:0;font-size:0.6rem;padding:3px 8px;white-space:nowrap;';
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
  let activeModeIdx = processor.params.mode;

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
    pill.style.cssText = i === activeModeIdx
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

  const { row: strengthRow, input: strengthInput } = makeSlider('Strength', 0, 2, liveParams.strength,   0.01, v => opts.imageForce.setStrength(v));
  const { row: blurRow,     input: blurInput }     = makeSlider('Blur',     0, 10, liveParams.blurRadius, 0.5,  v => processor.setBlurRadius(v));
  const { row: threshRow,   input: threshInput }   = makeSlider('Threshold',0, 1,  liveParams.threshold,  0.01, v => processor.setThreshold(v));
  sharedDiv.appendChild(strengthRow);
  sharedDiv.appendChild(blurRow);
  sharedDiv.appendChild(threshRow);

  const overlayRow = document.createElement('div');
  overlayRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:0.3rem;';
  const overlayLbl = document.createElement('span');
  overlayLbl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
  overlayLbl.textContent = 'Show image';
  const overlayChk = document.createElement('input');
  overlayChk.type = 'checkbox'; overlayChk.checked = opts.imageForce.showOverlay;
  overlayChk.addEventListener('change', () => opts.imageForce.setShowOverlay(overlayChk.checked));
  overlayRow.appendChild(overlayLbl); overlayRow.appendChild(overlayChk);
  sharedDiv.appendChild(overlayRow);

  const invertRow = document.createElement('div');
  invertRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:0.3rem;';
  const invertLbl = document.createElement('span');
  invertLbl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
  invertLbl.textContent = 'Invert';
  const invertChk = document.createElement('input');
  invertChk.type = 'checkbox'; invertChk.checked = opts.imageForce.getInvert();
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
  // Tracks whether the webcam was running when we last switched away from it,
  // so we can auto-restart it when the user switches back to the Webcam tab.
  let wasWebcamRunning = false;

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
      wasWebcamRunning = opts.webcam.status === 'active';
      opts.webcam.stop();
      // Only clear the source texture if webcam was running (it overwrote the static image).
      // If webcam was never started, sourceTexture still holds the loaded static image — preserve it.
      if (wasWebcamRunning) processor.clearImage();
      opts.onRebindGroups();
      if (thumbCtxStatic) processor.setThumbnailContext(thumbCtxStatic);
      applyParams(savedStaticParams);
    } else {
      // Don't set the webcam thumbnail context here — that would blit the current processedTexture
      // (which may contain the static image) into the webcam preview canvas. Set it only when
      // the webcam actually starts and begins writing frames.
      applyParams(savedWebcamParams);
      await populateCameraSelect(); // repopulate from cache (or enumerate if first visit)
      // Auto-restart webcam if it was running when user switched away
      if (wasWebcamRunning) {
        void opts.webcam.start(opts.webcam.activeCameraId || undefined).then(() => {
          if (thumbCtxWebcam) processor.setThumbnailContext(thumbCtxWebcam);
          opts.onRebindGroups();
          refreshUI();
        }).catch(() => refreshUI());
      }
    }
    refreshUI();
  }

  staticPill.addEventListener('click', () => void switchSource('static'));
  webcamPill.addEventListener('click', () => void switchSource('webcam'));

  // ── Camera population ─────────────────────────────────────────────
  async function populateCameraSelect(): Promise<void> {
    // Enumerate only when cache is empty; always repopulate the <select> from cache.
    if (opts.webcam.availableCameras.length === 0) {
      await opts.webcam.enumerateCameras();
    }
    camSelect.innerHTML = '';
    for (const cam of opts.webcam.availableCameras) {
      const opt = document.createElement('option');
      opt.value       = cam.deviceId;
      opt.textContent = cam.label || `Camera ${camSelect.options.length + 1}`;
      camSelect.appendChild(opt);
    }
    if (opts.webcam.activeCameraId) camSelect.value = opts.webcam.activeCameraId;
  }

  // ── Initial thumbnail context (deferred so populateCameraSelect is in scope) ─
  // Set the thumbnail context for whichever tab is active on panel build.
  if (activeSource === 'webcam') {
    if (thumbCtxWebcam) processor.setThumbnailContext(thumbCtxWebcam);
    // Populate camera list from cache (webcam was running so list already has data)
    void populateCameraSelect();
  } else {
    if (thumbCtxStatic) processor.setThumbnailContext(thumbCtxStatic);
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
        if (thumbCtxWebcam) processor.setThumbnailContext(thumbCtxWebcam);
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

  // ── Resize: keep canvas pixel buffers in sync with CSS width ─────────────
  function resizeThumb(canvas: HTMLCanvasElement, ctx: GPUCanvasContext | null, isActive: boolean): void {
    const w = canvas.clientWidth;
    if (w <= 0) return;
    const h = Math.round(w * THUMB_ASPECT);
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = `${h}px`;
    if (isActive && ctx) {
      processor.setThumbnailContext(ctx);
    }
  }

  const thumbRo = new ResizeObserver(() => {
    resizeThumb(thumbCanvas,   thumbCtxStatic, activeSource === 'static');
    resizeThumb(previewCanvas, thumbCtxWebcam, activeSource === 'webcam');
  });
  thumbRo.observe(thumbCanvas);
  thumbRo.observe(previewCanvas);

  return () => {
    thumbRo.disconnect();
    cleanupDrop();
    fileInput.remove();
    section.remove();
  };
}
