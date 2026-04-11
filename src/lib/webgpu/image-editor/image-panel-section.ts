// src/lib/webgpu/image-editor/image-panel-section.ts

import type { ImageProcessor }  from './image-processor';
import { ProcessingMode } from './image-editor-types';
import { createFileInput, attachDropZone } from './image-uploader';

export interface ImagePanelSectionOpts {
  onOpenEditor:     () => void;
  onRebindGroups:   () => void;  // called after image load/clear so controller rebuilds bind groups
  imageForce:       {
    setEnabled:     (v: boolean) => void;
    setStrength:    (v: number)  => void;
    setForceMode:   (m: number)  => void;
    setInvert:      (v: boolean) => void;
    setShowOverlay: (v: boolean) => void;
    isActive:       () => boolean;
  };
}

export function buildImagePanelSection(
  container:  HTMLElement,
  processor:  ImageProcessor,
  opts:       ImagePanelSectionOpts,
): () => void  // returns cleanup fn
{
  const section = document.createElement('div');
  section.style.cssText = 'border-top:1px solid var(--bg-surface-border);padding:0.5rem 0.6rem;';
  container.appendChild(section);

  // ── Label row ─────────────────────────────────────────────────────
  const labelRow = document.createElement('div');
  labelRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:0.35rem;';
  const label = document.createElement('span');
  label.style.cssText = 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);';
  label.textContent = 'Image Force';
  const enableToggle = document.createElement('input');
  enableToggle.type    = 'checkbox';
  enableToggle.checked = true;
  enableToggle.title   = 'Enable/disable image force';
  enableToggle.addEventListener('change', () => {
    opts.imageForce.setEnabled(enableToggle.checked);
  });
  labelRow.appendChild(label);
  labelRow.appendChild(enableToggle);
  section.appendChild(labelRow);

  // ── Thumbnail canvas ───────────────────────────────────────────────
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width  = 180;
  thumbCanvas.height = 101;  // ~16:9
  thumbCanvas.style.cssText = 'width:100%;border-radius:3px;border:1px solid var(--bg-surface-border);display:block;margin-bottom:0.4rem;cursor:pointer;';
  thumbCanvas.title = 'Click to open editor';
  thumbCanvas.addEventListener('click', opts.onOpenEditor);
  section.appendChild(thumbCanvas);

  // Wire thumbnail to processor — must be done after section is in DOM
  const thumbCtx = thumbCanvas.getContext('webgpu') as GPUCanvasContext | null;
  if (thumbCtx) {
    processor.setThumbnailContext(thumbCtx);
  }

  // ── Load image / paint buttons ─────────────────────────────────────
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:4px;margin-bottom:0.4rem;';

  const fileInput = createFileInput((bmp, _name) => {
    processor.loadImage(bmp);
    opts.onRebindGroups();
    refreshUI();
  });
  document.body.appendChild(fileInput);

  const loadBtn = document.createElement('button');
  loadBtn.className   = 'panel-close';
  loadBtn.textContent = 'Load Image';
  loadBtn.style.cssText = 'flex:1;font-size:0.65rem;padding:3px 6px;';
  loadBtn.addEventListener('click', () => fileInput.click());

  const paintBtn = document.createElement('button');
  paintBtn.className   = 'panel-close';
  paintBtn.textContent = 'Paint';
  paintBtn.style.cssText = 'flex:1;font-size:0.65rem;padding:3px 6px;';
  paintBtn.addEventListener('click', opts.onOpenEditor);

  btnRow.appendChild(loadBtn);
  btnRow.appendChild(paintBtn);
  section.appendChild(btnRow);

  // ── Force mode pills ───────────────────────────────────────────────
  const modeNames = ['Attract','Repel','Grad Flow','Grad Edge','Threshold','SDF'];
  const pillRow = document.createElement('div');
  pillRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:0.4rem;';
  modeNames.forEach((name, i) => {
    const pill = document.createElement('button');
    pill.textContent = name;
    pill.dataset.mode = String(i);
    pill.style.cssText = 'font-size:0.58rem;padding:2px 6px;border-radius:10px;border:1px solid var(--bg-surface-border);background:transparent;color:var(--text-muted);cursor:pointer;';
    if (i === 0) {
      pill.style.background = 'var(--accent)';
      pill.style.color      = 'var(--bg-primary)';
      pill.style.border     = '1px solid transparent';
    }
    pill.addEventListener('click', () => {
      pillRow.querySelectorAll('button').forEach((b) => {
        const btn = b as HTMLButtonElement;
        btn.style.background = 'transparent';
        btn.style.color      = 'var(--text-muted)';
        btn.style.border     = '1px solid var(--bg-surface-border)';
      });
      pill.style.background = 'var(--accent)';
      pill.style.color      = 'var(--bg-primary)';
      pill.style.border     = '1px solid transparent';
      opts.imageForce.setForceMode(i);
      processor.setMode(i as ProcessingMode);
    });
    pillRow.appendChild(pill);
  });
  section.appendChild(pillRow);

  // ── Strength slider ────────────────────────────────────────────────
  const makeSlider = (labelText: string, min: number, max: number, val: number, step: number, cb: (v: number) => void) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:0.3rem;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);min-width:48px;';
    lbl.textContent = labelText;
    const inp = document.createElement('input');
    inp.type  = 'range'; inp.min = String(min); inp.max = String(max);
    inp.step  = String(step); inp.value = String(val);
    inp.style.cssText = 'flex:1;';
    inp.addEventListener('input', () => cb(Number(inp.value)));
    row.appendChild(lbl); row.appendChild(inp);
    section.appendChild(row);
  };

  makeSlider('Strength', 0, 2, 0.5, 0.01, v => opts.imageForce.setStrength(v));

  // ── Show overlay toggle ────────────────────────────────────────────
  const overlayRow = document.createElement('div');
  overlayRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:0.3rem;';
  const overlayLbl = document.createElement('span');
  overlayLbl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
  overlayLbl.textContent   = 'Show image';
  const overlayChk = document.createElement('input');
  overlayChk.type    = 'checkbox';
  overlayChk.checked = true;
  overlayChk.addEventListener('change', () => {
    opts.imageForce.setShowOverlay(overlayChk.checked);
  });
  overlayRow.appendChild(overlayLbl);
  overlayRow.appendChild(overlayChk);
  section.appendChild(overlayRow);

  // ── Invert toggle ──────────────────────────────────────────────────
  const invertRow = document.createElement('div');
  invertRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:0.3rem;';
  const invertLbl = document.createElement('span');
  invertLbl.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
  invertLbl.textContent   = 'Invert';
  const invertChk = document.createElement('input');
  invertChk.type = 'checkbox';
  invertChk.addEventListener('change', () => {
    opts.imageForce.setInvert(invertChk.checked);
  });
  invertRow.appendChild(invertLbl);
  invertRow.appendChild(invertChk);
  section.appendChild(invertRow);

  // ── Clear / Reset buttons ──────────────────────────────────────────
  const actionRow = document.createElement('div');
  actionRow.style.cssText = 'display:flex;gap:4px;margin-top:0.2rem;';
  const clearBtn = document.createElement('button');
  clearBtn.className   = 'panel-close';
  clearBtn.textContent = 'Clear Image';
  clearBtn.style.cssText = 'flex:1;font-size:0.6rem;padding:3px 6px;';
  clearBtn.addEventListener('click', () => {
    processor.clearImage();
    opts.onRebindGroups();
    refreshUI();
  });
  const resetBtn = document.createElement('button');
  resetBtn.className   = 'panel-close';
  resetBtn.textContent = 'Reset Paint';
  resetBtn.style.cssText = 'flex:1;font-size:0.6rem;padding:3px 6px;';
  resetBtn.addEventListener('click', () => {
    processor.resetPaint();
    refreshUI();
  });
  actionRow.appendChild(clearBtn);
  actionRow.appendChild(resetBtn);
  section.appendChild(actionRow);

  // Drop zone on the thumbnail
  const cleanupDrop = attachDropZone(thumbCanvas, (bmp) => {
    processor.loadImage(bmp);
    opts.onRebindGroups();
    refreshUI();
  });

  function refreshUI() {
    clearBtn.style.display  = processor.hasImage  ? '' : 'none';
    resetBtn.style.display  = processor.hasPaint  ? '' : 'none';
    processor.renderThumbnail();
  }
  refreshUI();

  return () => {
    cleanupDrop();
    fileInput.remove();
    section.remove();
  };
}
