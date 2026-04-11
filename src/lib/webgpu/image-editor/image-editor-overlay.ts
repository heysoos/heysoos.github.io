// src/lib/webgpu/image-editor/image-editor-overlay.ts

import type { ImageProcessor } from './image-processor';
import { BrushMode, ProcessingMode } from './image-editor-types';
import type { BrushOptions, ImageTransform } from './image-editor-types';
import { createFileInput } from './image-uploader';

export interface OverlayOpts {
  onClose:          () => void;
  onRebindGroups:   () => void;
}

export function openImageEditorOverlay(processor: ImageProcessor, opts: OverlayOpts): () => void {
  // ── Root overlay ──────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:1000',
    'display:flex',
    'background:rgba(5,4,2,0.82)',
    'backdrop-filter:blur(2px)',
  ].join(';');
  document.body.appendChild(overlay);

  // ── Left sidebar ──────────────────────────────────────────────────
  const sidebar = document.createElement('div');
  sidebar.style.cssText = [
    'width:180px;flex-shrink:0',
    'background:#0f0c07',
    'border-right:1px solid #2a2418',
    'padding:12px 10px',
    'overflow-y:auto',
    'display:flex;flex-direction:column;gap:10px',
  ].join(';');
  overlay.appendChild(sidebar);

  // ── Right canvas area ─────────────────────────────────────────────
  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;';
  overlay.appendChild(canvasWrap);

  const editorCanvas = document.createElement('canvas');
  editorCanvas.style.cssText = 'width:100%;height:100%;display:block;';
  canvasWrap.appendChild(editorCanvas);

  // ── Brush cursor ──────────────────────────────────────────────────
  const brushCursor = document.createElement('div');
  brushCursor.style.cssText = 'position:absolute;pointer-events:none;border:1.5px solid rgba(255,255,255,0.55);border-radius:50%;display:none;';
  canvasWrap.appendChild(brushCursor);

  // ── State ─────────────────────────────────────────────────────────
  let currentBrush: BrushMode = BrushMode.Paint;
  let brushRadius   = 30;   // canvas pixels
  let brushSoftness = 0.7;
  let isPainting    = false;
  let showForce     = true;

  // Image transform dragging
  let isDraggingImg = false;
  let dragStartX = 0, dragStartY = 0;
  let dragStartTf: ImageTransform = { ...processor.transform };

  // Resize handle dragging
  type HandleId = 'tl'|'tc'|'tr'|'ml'|'mr'|'bl'|'bc'|'br';
  let isResizing = false;
  let resizeHandle: HandleId | null = null;
  let resizeStartTf: ImageTransform = { ...processor.transform };
  let resizeStartMx = 0, resizeStartMy = 0;

  // ── Sidebar helpers ───────────────────────────────────────────────
  const makeLabel = (text: string): HTMLElement => {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:0.58rem;color:#5a4a35;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px;';
    el.textContent = text;
    return el;
  };

  const makeBtn = (text: string, active = false): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = [
      'flex:1;padding:4px 0;border-radius:3px;font-family:inherit;font-size:0.62rem;cursor:pointer',
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
    inp.style.cssText = 'width:100%;margin-top:2px;';
    inp.addEventListener('input', () => {
      lbl.textContent = `${label}: ${Number(inp.value).toFixed(2)}`;
      cb(Number(inp.value));
    });
    row.appendChild(lbl); row.appendChild(inp);
    return row;
  };

  // ── Brush section ─────────────────────────────────────────────────
  sidebar.appendChild(makeLabel('Brush Mode'));
  const brushRow = document.createElement('div');
  brushRow.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;';

  const brushBtns: Record<BrushMode, HTMLButtonElement> = {
    [BrushMode.Paint]:      makeBtn('Paint',      true),
    [BrushMode.ErasePaint]: makeBtn('Erase',      false),
    [BrushMode.MaskImage]:  makeBtn('Mask Img',   false),
    [BrushMode.Blur]:       makeBtn('Blur',        false),
  };

  const selectBrush = (mode: BrushMode) => {
    currentBrush = mode;
    Object.entries(brushBtns).forEach(([m, btn]) => {
      const active = m === mode;
      btn.style.background = active ? '#1e2818' : '#1a1610';
      btn.style.borderColor = active ? '#40c0a0' : '#2a2418';
      btn.style.color       = active ? '#80e0c8' : '#7a6a50';
    });
    // Disable Mask Image if no image loaded
    brushBtns[BrushMode.MaskImage].disabled = !processor.hasImage;
    brushBtns[BrushMode.MaskImage].style.opacity = processor.hasImage ? '1' : '0.35';
  };

  Object.entries(brushBtns).forEach(([mode, btn]) => {
    btn.addEventListener('click', () => selectBrush(mode as BrushMode));
    brushRow.appendChild(btn);
  });
  sidebar.appendChild(brushRow);

  sidebar.appendChild(makeSlider('Size', 5, 200, brushRadius, 1, v => { brushRadius = v; }));
  sidebar.appendChild(makeSlider('Softness', 0, 1, brushSoftness, 0.01, v => { brushSoftness = v; }));

  // ── Processing section ────────────────────────────────────────────
  sidebar.appendChild(makeLabel('Processing'));

  sidebar.appendChild(makeSlider('Blur radius', 0, 20, processor.params.blurRadius, 0.5,
    v => processor.setBlurRadius(v)));

  sidebar.appendChild(makeSlider('Threshold', 0, 1, processor.params.threshold, 0.01,
    v => processor.setThreshold(v)));

  const invertRow = document.createElement('div');
  invertRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
  const invertLbl = document.createElement('span');
  invertLbl.style.cssText = 'font-size:0.6rem;color:#7a6a50;';
  invertLbl.textContent = 'Invert';
  const invertChk = document.createElement('input');
  invertChk.type    = 'checkbox';
  invertChk.checked = processor.params.invert;
  invertChk.addEventListener('change', () => processor.setInvert(invertChk.checked));
  invertRow.appendChild(invertLbl); invertRow.appendChild(invertChk);
  sidebar.appendChild(invertRow);

  // ── Fit presets ───────────────────────────────────────────────────
  sidebar.appendChild(makeLabel('Fit Preset'));
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
      const tf = tfFn();
      processor.setTransform(tf);
      renderEditorCanvas();
    });
    fitRow.appendChild(btn);
  });
  sidebar.appendChild(fitRow);

  // ── Load image / Reset / Clear ─────────────────────────────────────
  const fileInput = createFileInput((bmp) => {
    processor.loadImage(bmp);
    opts.onRebindGroups();
    selectBrush(currentBrush);
  });
  document.body.appendChild(fileInput);

  const loadBtn = makeBtn('Load Image');
  loadBtn.addEventListener('click', () => fileInput.click());
  loadBtn.style.width = '100%';
  sidebar.appendChild(loadBtn);

  const resetPaintBtn = makeBtn('Reset Paint');
  resetPaintBtn.addEventListener('click', () => processor.resetPaint());
  resetPaintBtn.style.width = '100%';
  sidebar.appendChild(resetPaintBtn);

  const clearImgBtn = makeBtn('Clear Image');
  clearImgBtn.addEventListener('click', () => {
    processor.clearImage();
    opts.onRebindGroups();
    selectBrush(currentBrush);
  });
  clearImgBtn.style.width = '100%';
  sidebar.appendChild(clearImgBtn);

  // ── Force overlay toggle + Done button ────────────────────────────
  const forceToggleBtn = makeBtn('Show Force', true);
  forceToggleBtn.style.width = '100%';
  forceToggleBtn.addEventListener('click', () => {
    showForce = !showForce;
    forceToggleBtn.style.background   = showForce ? '#1e2818' : '#1a1610';
    forceToggleBtn.style.borderColor  = showForce ? '#40c0a0' : '#2a2418';
    forceToggleBtn.style.color        = showForce ? '#80e0c8' : '#7a6a50';
    renderEditorCanvas();
  });
  sidebar.appendChild(forceToggleBtn);

  const doneBtn = document.createElement('button');
  doneBtn.textContent = 'Done';
  doneBtn.style.cssText = 'margin-top:auto;padding:6px;width:100%;background:var(--accent);color:var(--bg-primary);border:none;border-radius:4px;font-family:inherit;font-size:0.72rem;cursor:pointer;';
  doneBtn.addEventListener('click', close);
  sidebar.appendChild(doneBtn);

  // ── Editor canvas: 2D rendering of transform/handles/force ────────
  function getCanvasRect() { return editorCanvas.getBoundingClientRect(); }

  function resizeEditorCanvas() {
    const r = getCanvasRect();
    editorCanvas.width  = Math.round(r.width);
    editorCanvas.height = Math.round(r.height);
    renderEditorCanvas();
  }

  function renderEditorCanvas() {
    const ctx = editorCanvas.getContext('2d');
    if (!ctx) return;
    const { width: cw, height: ch } = editorCanvas;
    ctx.clearRect(0, 0, cw, ch);

    const tf = processor.transform;

    // Draw image bounds
    if (processor.hasImage) {
      ctx.strokeStyle = 'rgba(224,160,64,0.5)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(tf.offsetX, tf.offsetY, tf.scaleX, tf.scaleY);
    }

    // Draw handles
    if (processor.hasImage) {
      drawHandles(ctx, tf);
    }

    // "no force" zones
    ctx.font      = '10px monospace';
    ctx.fillStyle = 'rgba(90,74,53,0.6)';
    ctx.textAlign = 'center';
    if (tf.offsetY > 20) ctx.fillText('no force', cw / 2, tf.offsetY / 2);
    const botY = tf.offsetY + tf.scaleY;
    if (botY < ch - 20) ctx.fillText('no force', cw / 2, botY + (ch - botY) / 2);
  }

  const HANDLE_SIZE = 8;
  const handles: Array<{ id: HandleId; ax: number; ay: number }> = [
    { id: 'tl', ax: 0,   ay: 0   }, { id: 'tc', ax: 0.5, ay: 0   }, { id: 'tr', ax: 1,   ay: 0   },
    { id: 'ml', ax: 0,   ay: 0.5 },                                   { id: 'mr', ax: 1,   ay: 0.5 },
    { id: 'bl', ax: 0,   ay: 1   }, { id: 'bc', ax: 0.5, ay: 1   }, { id: 'br', ax: 1,   ay: 1   },
  ];

  function drawHandles(ctx: CanvasRenderingContext2D, tf: ImageTransform) {
    ctx.fillStyle = '#e0c060';
    handles.forEach(({ ax, ay }) => {
      const hx = tf.offsetX + ax * tf.scaleX - HANDLE_SIZE / 2;
      const hy = tf.offsetY + ay * tf.scaleY - HANDLE_SIZE / 2;
      ctx.fillRect(hx, hy, HANDLE_SIZE, HANDLE_SIZE);
    });
  }

  function hitHandle(mx: number, my: number, tf: ImageTransform): HandleId | null {
    for (const { id, ax, ay } of handles) {
      const hx = tf.offsetX + ax * tf.scaleX;
      const hy = tf.offsetY + ay * tf.scaleY;
      if (Math.abs(mx - hx) < HANDLE_SIZE + 2 && Math.abs(my - hy) < HANDLE_SIZE + 2) return id;
    }
    return null;
  }

  function hitImage(mx: number, my: number, tf: ImageTransform): boolean {
    return mx >= tf.offsetX && mx <= tf.offsetX + tf.scaleX &&
           my >= tf.offsetY && my <= tf.offsetY + tf.scaleY;
  }

  // Canvas-relative mouse coords
  function canvasXY(e: MouseEvent): [number, number] {
    const r = editorCanvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ── Mouse events: brush painting ──────────────────────────────────
  editorCanvas.addEventListener('mousedown', (e) => {
    const [mx, my] = canvasXY(e);
    const tf = processor.transform;

    // Check resize handles first
    const h = hitHandle(mx, my, tf);
    if (h && processor.hasImage) {
      isResizing = true; resizeHandle = h;
      resizeStartTf = { ...tf };
      resizeStartMx = mx; resizeStartMy = my;
      return;
    }

    // Check image drag
    if (hitImage(mx, my, tf) && processor.hasImage) {
      isDraggingImg = true;
      dragStartX = mx; dragStartY = my;
      dragStartTf = { ...tf };
      return;
    }

    // Else: brush stroke
    isPainting = true;
    applyBrushAt(mx, my);
  });

  editorCanvas.addEventListener('mousemove', (e) => {
    const [mx, my] = canvasXY(e);

    // Update brush cursor
    const sz = brushRadius * 2;
    brushCursor.style.display = 'block';
    brushCursor.style.width   = sz + 'px';
    brushCursor.style.height  = sz + 'px';
    brushCursor.style.left    = (mx - brushRadius) + 'px';
    brushCursor.style.top     = (my - brushRadius) + 'px';

    if (isResizing && resizeHandle) {
      applyResize(mx, my);
      return;
    }
    if (isDraggingImg) {
      processor.setTransform({
        ...processor.transform,
        offsetX: dragStartTf.offsetX + (mx - dragStartX),
        offsetY: dragStartTf.offsetY + (my - dragStartY),
      });
      renderEditorCanvas();
      return;
    }
    if (isPainting) applyBrushAt(mx, my);
  });

  const stopAll = () => { isPainting = false; isDraggingImg = false; isResizing = false; resizeHandle = null; };
  editorCanvas.addEventListener('mouseup',    stopAll);
  editorCanvas.addEventListener('mouseleave', () => { brushCursor.style.display = 'none'; stopAll(); });

  function applyBrushAt(mx: number, my: number) {
    const brushOpts: BrushOptions = { mode: currentBrush, x: mx, y: my, radius: brushRadius, softness: brushSoftness };
    processor.brushStroke(brushOpts);
    renderEditorCanvas();
  }

  function applyResize(mx: number, my: number) {
    const dx = mx - resizeStartMx;
    const dy = my - resizeStartMy;
    const tf  = { ...resizeStartTf };
    const id  = resizeHandle!;

    if (id.includes('l')) { tf.offsetX += dx; tf.scaleX -= dx; }
    if (id.includes('r')) { tf.scaleX  += dx; }
    if (id.includes('t')) { tf.offsetY += dy; tf.scaleY -= dy; }
    if (id.includes('b')) { tf.scaleY  += dy; }

    // Clamp: minimum size 20px
    if (tf.scaleX < 20 || tf.scaleY < 20) return;
    processor.setTransform(tf);
    renderEditorCanvas();
  }

  // ── Fit transform helpers ──────────────────────────────────────────
  function fitTransform(mode: string): ImageTransform {
    const cw = editorCanvas.width  || editorCanvas.clientWidth;
    const ch = editorCanvas.height || editorCanvas.clientHeight;
    const imgAspect = processor.imageWidth / processor.imageHeight || 16/9;
    const canvasAspect = cw / ch;
    let iw: number, ih: number;
    if (mode === 'fill') {
      if (imgAspect > canvasAspect) { ih = ch; iw = ih * imgAspect; }
      else { iw = cw; ih = iw / imgAspect; }
    } else if (mode === 'contain') {
      if (imgAspect > canvasAspect) { iw = cw; ih = iw / imgAspect; }
      else { ih = ch; iw = ih * imgAspect; }
    } else if (mode === 'width')  { iw = cw; ih = iw / imgAspect; }
    else if (mode === 'height')   { ih = ch; iw = ih * imgAspect; }
    else                          { iw = Math.min(cw, processor.imageWidth || cw); ih = iw / imgAspect; }
    return { offsetX: (cw - iw) / 2, offsetY: (ch - ih) / 2, scaleX: iw, scaleY: ih };
  }

  // ── Cleanup / close ───────────────────────────────────────────────
  function close() {
    fileInput.remove();
    overlay.remove();
    resizeObserver.disconnect();
    opts.onClose();
  }

  const resizeObserver = new ResizeObserver(resizeEditorCanvas);
  resizeObserver.observe(canvasWrap);
  resizeEditorCanvas();
  selectBrush(BrushMode.Paint);

  return close;
}
