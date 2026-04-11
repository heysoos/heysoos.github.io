// src/lib/webgpu/image-editor/image-editor-overlay.ts

import type { ImageProcessor } from './image-processor';
import { BrushMode } from './image-editor-types';
import type { BrushOptions, ImageTransform } from './image-editor-types';
import { createFileInput } from './image-uploader';

export interface OverlayOpts {
  onClose:          () => void;
  onRebindGroups:   () => void;
  onSetForceMode?:  (mode: number) => void;
}

/**
 * Opens the image editor overlay.
 * @param container — mount point; should be the sim-viewport element so the editor
 *   canvas covers exactly the same pixels as the boids canvas. Defaults to document.body.
 */
export function openImageEditorOverlay(
  processor: ImageProcessor,
  opts: OverlayOpts,
  container: HTMLElement = document.body,
): () => void {
  const useFixed = container === document.body;

  // ── Root overlay ──────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    `position:${useFixed ? 'fixed' : 'absolute'};inset:0;z-index:100`,
    'pointer-events:none',  // children opt-in with pointer-events:auto
  ].join(';');
  container.appendChild(overlay);

  // Background WebGPU canvas — shows composited image or force field
  const previewCanvas = document.createElement('canvas');
  previewCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  overlay.appendChild(previewCanvas);

  // Foreground 2D canvas — interaction, handles, bounds
  const editorCanvas = document.createElement('canvas');
  editorCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:auto;cursor:crosshair;';
  overlay.appendChild(editorCanvas);

  // Brush cursor circle
  const brushCursor = document.createElement('div');
  brushCursor.style.cssText = 'position:absolute;pointer-events:none;border:1.5px solid rgba(255,255,255,0.6);border-radius:50%;display:none;';
  overlay.appendChild(brushCursor);

  // ── Sidebar (floats over canvas, same spot as params-panel) ───────
  const sidebar = document.createElement('div');
  sidebar.style.cssText = [
    'position:absolute;top:1rem;right:1rem',
    'width:220px;max-height:calc(100% - 2rem)',
    'background:var(--bg-nav,#0f0c07)',
    'border:1px solid var(--bg-surface-border,#2a2418)',
    'border-radius:var(--border-radius,4px)',
    'backdrop-filter:blur(8px)',
    'padding:0.75rem',
    'overflow-y:auto',
    'display:flex;flex-direction:column;gap:8px',
    'pointer-events:auto',
    'z-index:10',
  ].join(';');
  overlay.appendChild(sidebar);

  // ── State ─────────────────────────────────────────────────────────
  type EditorMode = BrushMode | 'move';
  let currentMode: EditorMode = BrushMode.Paint;
  let brushRadius   = 30;   // CSS pixels
  let brushSoftness = 0.7;
  let isPainting    = false;
  let showForce     = true;

  let isDraggingImg  = false;
  let dragStartCSS_X = 0, dragStartCSS_Y = 0;
  let dragStartTf: ImageTransform = { ...processor.transform };

  type HandleId = 'tl'|'tc'|'tr'|'ml'|'mr'|'bl'|'bc'|'br';
  let isResizing    = false;
  let resizeHandle: HandleId | null = null;
  let resizeStartTf: ImageTransform = { ...processor.transform };
  let resizeStartCSS_X = 0, resizeStartCSS_Y = 0;

  // ── Coordinate helpers ────────────────────────────────────────────
  // editorCanvas.width  = processor.canvasWidth  (set in resizeEditorCanvas)
  // editorCanvas.height = processor.canvasHeight
  // So canvas pixel coords == texture pixel coords — no scaling needed.
  // We only need CSS→canvas conversion (for DPR).

  /** Mouse position in texture/canvas pixels. */
  function canvasXY(e: MouseEvent): [number, number] {
    const r = editorCanvas.getBoundingClientRect();
    const sx = editorCanvas.width  / r.width;
    const sy = editorCanvas.height / r.height;
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy];
  }

  /** Mouse position in CSS pixels (for UI elements like the cursor div). */
  function cssXY(e: MouseEvent): [number, number] {
    const r = editorCanvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Scale: CSS pixels → texture pixels (≈ device pixel ratio). */
  function cssToTex(): number {
    return editorCanvas.width / editorCanvas.clientWidth;
  }

  // Convert a transform (texture-pixel space) to canvas-pixel space for 2D drawing.
  // Since editorCanvas.width == processor.canvasWidth, this is an identity.
  // Kept for clarity and to survive future DPR changes.
  function tfToCanvas(tf: ImageTransform): ImageTransform {
    const sx = editorCanvas.width  / (processor.canvasWidth  || editorCanvas.width);
    const sy = editorCanvas.height / (processor.canvasHeight || editorCanvas.height);
    return { offsetX: tf.offsetX * sx, offsetY: tf.offsetY * sy, scaleX: tf.scaleX * sx, scaleY: tf.scaleY * sy };
  }

  // ── Sidebar helpers ───────────────────────────────────────────────
  const makeLabel = (text: string): HTMLElement => {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:0.58rem;color:var(--text-muted,#5a4a35);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:1px;';
    el.textContent = text;
    return el;
  };

  const makeBtn = (text: string, active = false): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = [
      'flex:1;padding:3px 0;border-radius:3px;font-family:inherit;font-size:0.62rem;cursor:pointer',
      active
        ? 'background:#1e2818;border:1px solid #40c0a0;color:#80e0c8'
        : 'background:#1a1610;border:1px solid #2a2418;color:#7a6a50',
    ].join(';');
    return b;
  };

  const makeSlider = (label: string, min: number, max: number, val: number, step: number, cb: (v: number) => void): HTMLElement => {
    const row = document.createElement('div');
    const lbl = makeLabel(`${label}: ${val.toFixed(2)}`);
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = String(min); inp.max = String(max);
    inp.step = String(step); inp.value = String(val);
    inp.style.cssText = 'width:100%;margin-top:2px;accent-color:var(--accent);';
    inp.addEventListener('input', () => {
      lbl.textContent = `${label}: ${Number(inp.value).toFixed(2)}`;
      cb(Number(inp.value));
    });
    row.appendChild(lbl); row.appendChild(inp);
    return row;
  };

  // ── Tool buttons ──────────────────────────────────────────────────
  sidebar.appendChild(makeLabel('Tool'));
  const modeRow = document.createElement('div');
  modeRow.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;';

  const allModes: Array<[EditorMode, string]> = [
    [BrushMode.Paint,      'Paint'],
    [BrushMode.ErasePaint, 'Erase'],
    [BrushMode.MaskImage,  'Mask'],
    [BrushMode.Blur,       'Blur'],
    ['move',               'Move'],
  ];

  const modeBtns = new Map<EditorMode, HTMLButtonElement>();
  allModes.forEach(([mode, label]) => {
    const btn = makeBtn(label, mode === BrushMode.Paint);
    modeBtns.set(mode, btn);
    btn.addEventListener('click', () => selectMode(mode));
    modeRow.appendChild(btn);
  });
  sidebar.appendChild(modeRow);

  function selectMode(mode: EditorMode) {
    currentMode = mode;
    modeBtns.forEach((btn, m) => {
      const active = m === mode;
      btn.style.background  = active ? '#1e2818' : '#1a1610';
      btn.style.borderColor = active ? '#40c0a0' : '#2a2418';
      btn.style.color       = active ? '#80e0c8' : '#7a6a50';
    });
    const maskBtn = modeBtns.get(BrushMode.MaskImage)!;
    maskBtn.disabled      = !processor.hasImage;
    maskBtn.style.opacity = processor.hasImage ? '1' : '0.35';
    editorCanvas.style.cursor = mode === 'move' ? 'default' : 'crosshair';
    if (mode === 'move') brushCursor.style.display = 'none';
  }

  sidebar.appendChild(makeSlider('Size', 5, 200, brushRadius, 1, v => { brushRadius = v; }));
  sidebar.appendChild(makeSlider('Softness', 0, 1, brushSoftness, 0.01, v => { brushSoftness = v; }));

  // ── Force mode ────────────────────────────────────────────────────
  sidebar.appendChild(makeLabel('Force Mode'));
  const forceModeRow = document.createElement('div');
  forceModeRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;';
  const forceModeNames = ['Attract', 'Repel', 'Grad Flow', 'Grad Edge', 'Threshold', 'SDF'];
  const forceModeBtns: HTMLButtonElement[] = [];
  let currentForceMode = processor.params.mode;

  const selectForceMode = (i: number) => {
    currentForceMode = i;
    forceModeBtns.forEach((b, idx) => {
      const active = idx === i;
      b.style.background  = active ? '#1e2818' : '#1a1610';
      b.style.borderColor = active ? '#40c0a0' : '#2a2418';
      b.style.color       = active ? '#80e0c8' : '#7a6a50';
    });
    processor.setMode(i as import('./image-editor-types').ProcessingMode);
    opts.onSetForceMode?.(i);
    renderPreview();
  };

  forceModeNames.forEach((name, i) => {
    const btn = makeBtn(name, i === currentForceMode);
    btn.addEventListener('click', () => selectForceMode(i));
    forceModeBtns.push(btn);
    forceModeRow.appendChild(btn);
  });
  sidebar.appendChild(forceModeRow);

  // ── Processing ────────────────────────────────────────────────────
  sidebar.appendChild(makeLabel('Processing'));
  sidebar.appendChild(makeSlider('Blur radius', 0, 20, processor.params.blurRadius, 0.5,
    v => { processor.setBlurRadius(v); renderPreview(); }));
  sidebar.appendChild(makeSlider('Threshold', 0, 1, processor.params.threshold, 0.01,
    v => { processor.setThreshold(v); renderPreview(); }));

  // ── Fit presets ───────────────────────────────────────────────────
  sidebar.appendChild(makeLabel('Fit'));
  const fitRow = document.createElement('div');
  fitRow.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;';
  const fits: Array<[string, () => ImageTransform]> = [
    ['Fill',    () => fitTransform('fill')],
    ['Contain', () => fitTransform('contain')],
    ['Fit W',   () => fitTransform('width')],
    ['Fit H',   () => fitTransform('height')],
    ['1:1',     () => fitTransform('original')],
  ];
  fits.forEach(([name, tfFn]) => {
    const btn = makeBtn(name);
    btn.addEventListener('click', () => {
      processor.setTransform(tfFn());
      renderEditorCanvas();
      renderPreview();
    });
    fitRow.appendChild(btn);
  });
  sidebar.appendChild(fitRow);

  // ── Load / Reset / Clear ──────────────────────────────────────────
  const fileInput = createFileInput((bmp) => {
    processor.loadImage(bmp);
    opts.onRebindGroups();
    selectMode(currentMode);
    renderEditorCanvas();
    renderPreview();
  });
  document.body.appendChild(fileInput);

  const loadBtn = makeBtn('Load Image');
  loadBtn.addEventListener('click', () => fileInput.click());
  loadBtn.style.width = '100%';
  sidebar.appendChild(loadBtn);

  const resetPaintBtn = makeBtn('Reset Paint');
  resetPaintBtn.addEventListener('click', () => { processor.resetPaint(); renderPreview(); });
  resetPaintBtn.style.width = '100%';
  sidebar.appendChild(resetPaintBtn);

  const clearImgBtn = makeBtn('Clear Image');
  clearImgBtn.addEventListener('click', () => {
    processor.clearImage();
    opts.onRebindGroups();
    selectMode(currentMode);
    renderEditorCanvas();
    renderPreview();
  });
  clearImgBtn.style.width = '100%';
  sidebar.appendChild(clearImgBtn);

  // ── Show Force toggle ─────────────────────────────────────────────
  const forceToggleBtn = makeBtn('Show Force', true);
  forceToggleBtn.style.width = '100%';
  forceToggleBtn.addEventListener('click', () => {
    showForce = !showForce;
    forceToggleBtn.style.background  = showForce ? '#1e2818' : '#1a1610';
    forceToggleBtn.style.borderColor = showForce ? '#40c0a0' : '#2a2418';
    forceToggleBtn.style.color       = showForce ? '#80e0c8' : '#7a6a50';
    renderPreview();
  });
  sidebar.appendChild(forceToggleBtn);

  const doneBtn = document.createElement('button');
  doneBtn.textContent = 'Done';
  doneBtn.style.cssText = 'margin-top:auto;padding:6px;width:100%;background:var(--accent);color:var(--bg-primary);border:none;border-radius:4px;font-family:inherit;font-size:0.72rem;cursor:pointer;';
  doneBtn.addEventListener('click', close);
  sidebar.appendChild(doneBtn);

  // ── Preview rendering ─────────────────────────────────────────────
  function initPreviewContext() {
    const ctx = previewCanvas.getContext('webgpu') as GPUCanvasContext | null;
    if (ctx) processor.setPreviewContext(ctx);
  }

  function renderPreview() {
    processor.renderPreview(showForce);
  }

  // ── Editor canvas ─────────────────────────────────────────────────
  function resizeEditorCanvas() {
    // Match GPU texture dimensions exactly so pixel coords need no scaling.
    const tw = processor.canvasWidth;
    const th = processor.canvasHeight;
    editorCanvas.width  = tw > 0 ? tw : Math.round(editorCanvas.clientWidth);
    editorCanvas.height = th > 0 ? th : Math.round(editorCanvas.clientHeight);
    previewCanvas.width  = editorCanvas.width;
    previewCanvas.height = editorCanvas.height;
    initPreviewContext();
    renderPreview();
    renderEditorCanvas();
  }

  function renderEditorCanvas() {
    const ctx = editorCanvas.getContext('2d');
    if (!ctx) return;
    const { width: cw, height: ch } = editorCanvas;
    ctx.clearRect(0, 0, cw, ch);

    if (processor.hasImage) {
      const ctf = tfToCanvas(processor.transform);
      ctx.strokeStyle = 'rgba(224,160,64,0.6)';
      ctx.lineWidth   = cssToTex();  // 1 CSS pixel width
      ctx.strokeRect(ctf.offsetX, ctf.offsetY, ctf.scaleX, ctf.scaleY);
      drawHandles(ctx, ctf);
    }
  }

  const HANDLE_PX = 8; // logical pixels (will be scaled by cssToTex)
  const handles: Array<{ id: HandleId; ax: number; ay: number }> = [
    { id: 'tl', ax: 0,   ay: 0   }, { id: 'tc', ax: 0.5, ay: 0   }, { id: 'tr', ax: 1,   ay: 0   },
    { id: 'ml', ax: 0,   ay: 0.5 },                                   { id: 'mr', ax: 1,   ay: 0.5 },
    { id: 'bl', ax: 0,   ay: 1   }, { id: 'bc', ax: 0.5, ay: 1   }, { id: 'br', ax: 1,   ay: 1   },
  ];

  function drawHandles(ctx: CanvasRenderingContext2D, ctf: ImageTransform) {
    const s = HANDLE_PX * cssToTex();
    ctx.fillStyle = '#e0c060';
    handles.forEach(({ ax, ay }) => {
      ctx.fillRect(ctf.offsetX + ax * ctf.scaleX - s / 2, ctf.offsetY + ay * ctf.scaleY - s / 2, s, s);
    });
  }

  // Hit testing in canvas-pixel space
  function hitHandle(mx: number, my: number): HandleId | null {
    const ctf = tfToCanvas(processor.transform);
    const s = (HANDLE_PX + 4) * cssToTex();
    for (const { id, ax, ay } of handles) {
      const hx = ctf.offsetX + ax * ctf.scaleX;
      const hy = ctf.offsetY + ay * ctf.scaleY;
      if (Math.abs(mx - hx) < s && Math.abs(my - hy) < s) return id;
    }
    return null;
  }

  function hitImage(mx: number, my: number): boolean {
    const ctf = tfToCanvas(processor.transform);
    return mx >= ctf.offsetX && mx <= ctf.offsetX + ctf.scaleX &&
           my >= ctf.offsetY && my <= ctf.offsetY + ctf.scaleY;
  }

  // ── Mouse events ──────────────────────────────────────────────────
  editorCanvas.addEventListener('mousedown', (e) => {
    const [mx, my] = canvasXY(e);  // texture/canvas pixels

    if (currentMode === 'move' && processor.hasImage) {
      const h = hitHandle(mx, my);
      if (h) {
        isResizing = true; resizeHandle = h;
        resizeStartTf = { ...processor.transform };
        [resizeStartCSS_X, resizeStartCSS_Y] = cssXY(e);
        return;
      }
      if (hitImage(mx, my)) {
        isDraggingImg = true;
        [dragStartCSS_X, dragStartCSS_Y] = cssXY(e);
        dragStartTf = { ...processor.transform };
        return;
      }
      return;
    }

    isPainting = true;
    applyBrushAt(mx, my);
  });

  editorCanvas.addEventListener('mousemove', (e) => {
    const [cx, cy] = cssXY(e);     // CSS pixels for cursor display
    const [mx, my] = canvasXY(e);  // texture pixels for logic

    if (currentMode !== 'move') {
      const sz = brushRadius * 2;
      brushCursor.style.display = 'block';
      brushCursor.style.width   = sz + 'px';
      brushCursor.style.height  = sz + 'px';
      brushCursor.style.left    = (cx - brushRadius) + 'px';
      brushCursor.style.top     = (cy - brushRadius) + 'px';
    } else {
      brushCursor.style.display = 'none';
    }

    if (isResizing && resizeHandle) {
      applyResize(cx, cy);  // resize uses CSS delta
      return;
    }
    if (isDraggingImg) {
      const dpr = cssToTex();
      processor.setTransform({
        ...dragStartTf,
        offsetX: dragStartTf.offsetX + (cx - dragStartCSS_X) * dpr,
        offsetY: dragStartTf.offsetY + (cy - dragStartCSS_Y) * dpr,
      });
      renderEditorCanvas();
      renderPreview();
      return;
    }
    if (isPainting) applyBrushAt(mx, my);
  });

  const stopAll = () => { isPainting = false; isDraggingImg = false; isResizing = false; resizeHandle = null; };
  editorCanvas.addEventListener('mouseup',    stopAll);
  editorCanvas.addEventListener('mouseleave', () => { brushCursor.style.display = 'none'; stopAll(); });

  function applyBrushAt(mx: number, my: number) {
    // mx, my already in texture/canvas pixels; brush radius converted from CSS
    const brushOpts: BrushOptions = {
      mode:     currentMode as BrushMode,
      x:        mx,
      y:        my,
      radius:   brushRadius * cssToTex(),
      softness: brushSoftness,
    };
    processor.brushStroke(brushOpts);
    renderEditorCanvas();
    renderPreview();
  }

  function applyResize(cssMx: number, cssMy: number) {
    const dpr  = cssToTex();
    const dtx  = (cssMx - resizeStartCSS_X) * dpr;
    const dty  = (cssMy - resizeStartCSS_Y) * dpr;
    const tf   = { ...resizeStartTf };
    const id   = resizeHandle!;
    if (id.includes('l')) { tf.offsetX += dtx; tf.scaleX -= dtx; }
    if (id.includes('r')) { tf.scaleX  += dtx; }
    if (id.includes('t')) { tf.offsetY += dty; tf.scaleY -= dty; }
    if (id.includes('b')) { tf.scaleY  += dty; }
    if (tf.scaleX < 20 || tf.scaleY < 20) return;
    processor.setTransform(tf);
    renderEditorCanvas();
    renderPreview();
  }

  // Fit helpers — always in texture-pixel space
  function fitTransform(mode: string): ImageTransform {
    const cw = processor.canvasWidth  || editorCanvas.clientWidth;
    const ch = processor.canvasHeight || editorCanvas.clientHeight;
    const imgAspect    = processor.imageWidth / processor.imageHeight || 16 / 9;
    const canvasAspect = cw / ch;
    let iw: number, ih: number;
    if (mode === 'fill') {
      if (imgAspect > canvasAspect) { ih = ch; iw = ih * imgAspect; }
      else                          { iw = cw; ih = iw / imgAspect; }
    } else if (mode === 'contain') {
      if (imgAspect > canvasAspect) { iw = cw; ih = iw / imgAspect; }
      else                          { ih = ch; iw = ih * imgAspect; }
    } else if (mode === 'width')  { iw = cw; ih = iw / imgAspect; }
    else if (mode === 'height')   { ih = ch; iw = ih * imgAspect; }
    else                          { iw = Math.min(cw, processor.imageWidth || cw); ih = iw / imgAspect; }
    return { offsetX: (cw - iw) / 2, offsetY: (ch - ih) / 2, scaleX: iw, scaleY: ih };
  }

  // ── Cleanup ───────────────────────────────────────────────────────
  function close() {
    processor.clearPreviewContext();
    fileInput.remove();
    overlay.remove();
    resizeObserver.disconnect();
    opts.onClose();
  }

  const resizeObserver = new ResizeObserver(resizeEditorCanvas);
  resizeObserver.observe(container);
  resizeEditorCanvas();
  selectMode(BrushMode.Paint);

  return close;
}
