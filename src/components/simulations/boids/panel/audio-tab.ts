// src/components/simulations/boids/panel/audio-tab.ts
// ─────────────────────────────────────────────────────────────────────────────
// Audio tab builder extracted from boids-panel.ts.
//   makeMatrixTrace()   — mini sparkline for matrix trace column (RingBufferCanvas)
//   makeTraceCanvas()   — full-size band amplitude trace canvas (RingBufferCanvas)
//   buildBandTab()      — per-band drawer: depth / gain / mode / range / trace
//   buildTotalTab()     — ∑ combined drawer tab
//   buildAudioTab()     — Audio tab: source, spectrum, matrix, drawers, viz loop
// ─────────────────────────────────────────────────────────────────────────────
import type { AudioReactor, BandKey, AudioMapping, BandSnapshot } from '../boids-audio';
import { BAND_COLORS, PARAM_META, MAPPABLE_PARAMS, drawAudioViz } from '../boids-audio';
import { RingBufferCanvas, makeTraceRenderer, makeMiniRenderer, TRACE_LEN } from './ring-buffer-canvas';
import { DrawerController } from './drawer-controller';
import { ResizeObserverPool } from './resize-observer-pool';
import { pillStyle, STYLES } from './panel-styles';

// ── Shared types ──────────────────────────────────────────────────────────────

/**
 * Groups the five Maps that bridge the Params tab indicator bars (paramIndicators)
 * and the Audio tab live updaters. Passed from buildBoidsPanel into buildAudioTab
 * so both sides share the same references.
 */
export interface AudioUpdaterMaps {
  paramIndicators:     Map<string, { wrap: HTMLElement; fill: HTMLElement }>;
  cellUpdaters:        Map<string, (amplitude: number) => void>;
  totalUpdaters:       Map<string, (snapshot: BandSnapshot, baseVal: number, modulatedVal: number) => void>;
  traceUpdaters:       Map<string, (amplitude: number) => void>;
  matrixTraceUpdaters: Map<string, (normalizedVal: number) => void>;
}

// ── Module-level constant ─────────────────────────────────────────────────────

/** Band order used consistently across the matrix header, rows, and drawers. */
const BAND_KEYS_ORDER: BandKey[] = ['bass', 'mid', 'presence', 'hi', 'volume'];

// ── Canvas utilities ──────────────────────────────────────────────────────────

/** Mini sparkline used in the matrix trace column. RingBufferCanvas backed, redraws on push(). */
function makeMatrixTrace(
  bandColor: string,
): { canvas: HTMLCanvasElement; push: (v: number) => void; disconnect: () => void } {
  const rbc = new RingBufferCanvas({
    render: makeMiniRenderer(bandColor),
    initialHeight: 16,
  });
  rbc.canvas.style.cssText = STYLES.matrixCanvas + 'width:100%;height:16px;';
  return {
    canvas:     rbc.canvas,
    push:       (v) => rbc.push(v),
    disconnect: () => rbc.disconnect(),
  };
}

/** Full-width trace canvas for a single band. Shows min/max/current labels.
 *  Height adapts to ~20% of the params-panel height (clamped to [TRACE_H, 160px]). */
function makeTraceCanvas(
  bandColor: string,
  registerDisconnect: (fn: () => void) => void,
): { canvas: HTMLCanvasElement; push: (v: number) => void } {
  const TRACE_H = 40;
  const rbc = new RingBufferCanvas({
    render: makeTraceRenderer(bandColor),
    initialHeight: TRACE_H,
    onResize: (w, currentH) => {
      const panelEl = rbc.canvas.closest?.('.params-panel') as HTMLElement | null;
      if (!panelEl) return undefined;
      const newH = Math.round(Math.min(160, Math.max(TRACE_H, panelEl.clientHeight * 0.20)));
      return newH !== currentH ? newH : undefined;
    },
  });
  registerDisconnect(() => rbc.disconnect());
  return { canvas: rbc.canvas, push: (v) => rbc.push(v) };
}

// ── Drawer content builders ───────────────────────────────────────────────────

// makeResetBtn — local copy (boids-panel.ts keeps the canonical version)
function makeResetBtn(slider: HTMLInputElement, defaultValue: number): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = '↺';
  btn.title = `Reset to ${defaultValue}`;
  btn.style.cssText = [
    'background:none;border:none;cursor:pointer;padding:0 1px;',
    'font-size:0.7rem;line-height:1;border-radius:2px;flex-shrink:0;',
    'color:var(--bg-surface-border);transition:color 0.1s;',
  ].join('');

  function sync(): void {
    const atDefault = Math.abs(parseFloat(slider.value) - defaultValue) < 0.001;
    btn.style.color = atDefault ? 'var(--bg-surface-border)' : 'var(--text-muted)';
  }

  slider.addEventListener('input', sync);
  sync();

  btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--accent)'; });
  btn.addEventListener('mouseleave', sync);
  btn.addEventListener('click', () => {
    slider.value = String(defaultValue);
    slider.dispatchEvent(new Event('input'));
  });

  return btn;
}

/**
 * Builds the content shown in the per-band tab of an open drawer row.
 * Registers a trace updater in traceUpdaters so updateAudioViz() can feed it.
 */
function buildBandTab(
  mapping: AudioMapping,
  reactor: AudioReactor,
  traceUpdaters: Map<string, (amplitude: number) => void>,
  registerDisconnect: (fn: () => void) => void,
): HTMLDivElement {
  const body = document.createElement('div');
  body.style.cssText = 'padding:6px 8px;';
  const color = BAND_COLORS[mapping.band];

  function row(label: string, content: HTMLElement): void {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:0.55rem;color:var(--text-muted);min-width:30px;';
    lbl.textContent = label;
    r.appendChild(lbl);
    r.appendChild(content);
    body.appendChild(r);
  }

  function makeSlider(min: number, max: number, step: number, value: number): { el: HTMLInputElement; valEl: HTMLSpanElement } {
    const el = document.createElement('input');
    el.type  = 'range';
    el.min   = String(min);
    el.max   = String(max);
    el.step  = String(step);
    el.value = String(value);
    el.style.cssText = `flex:1;accent-color:${color};`;
    const valEl = document.createElement('span');
    valEl.style.cssText = `font-size:0.6rem;color:${color};min-width:28px;text-align:right;font-variant-numeric:tabular-nums;`;
    valEl.textContent = value.toFixed(2);
    return { el, valEl };
  }

  // Depth
  const { el: depthSlider, valEl: depthVal } = makeSlider(0, 1, 0.01, mapping.depth);
  depthSlider.addEventListener('input', () => {
    mapping.depth = parseFloat(depthSlider.value);
    depthVal.textContent = mapping.depth.toFixed(2);
    reactor.saveMappings();
  });
  const depthWrap = document.createElement('div');
  depthWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;';
  depthWrap.appendChild(depthSlider);
  depthWrap.appendChild(depthVal);
  depthWrap.appendChild(makeResetBtn(depthSlider, 0.5));
  row('Depth', depthWrap);

  // Gain
  const { el: gainSlider, valEl: gainVal } = makeSlider(0, 4, 0.05, mapping.gain ?? 1.0);
  gainSlider.addEventListener('input', () => {
    mapping.gain = parseFloat(gainSlider.value);
    gainVal.textContent = mapping.gain.toFixed(2);
    reactor.saveMappings();
  });
  const gainWrap = document.createElement('div');
  gainWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;';
  gainWrap.appendChild(gainSlider);
  gainWrap.appendChild(gainVal);
  gainWrap.appendChild(makeResetBtn(gainSlider, 1.0));
  row('Gain', gainWrap);

  // Mode
  const modeBtn = document.createElement('button');
  modeBtn.style.cssText = [
    'padding:1px 6px;border-radius:3px;font-size:0.65rem;cursor:pointer;',
    'border:1px solid var(--bg-surface-border);background:transparent;color:var(--text-muted);',
  ].join('');
  function modeBtnLabel(mode: typeof mapping.mode): string {
    return mode === 'add' ? '+ add' : mode === 'subtract' ? '− sub' : '× mul';
  }
  modeBtn.textContent = modeBtnLabel(mapping.mode);
  modeBtn.addEventListener('click', () => {
    mapping.mode = mapping.mode === 'add' ? 'subtract' : mapping.mode === 'subtract' ? 'multiply' : 'add';
    modeBtn.textContent = modeBtnLabel(mapping.mode);
    reactor.saveMappings();
  });
  row('Mode', modeBtn);

  // Min / Max
  const minMaxRow = document.createElement('div');
  minMaxRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;';
  const inputStyle = [
    'width:48px;background:var(--bg-surface);color:var(--text-body);',
    'border:1px solid var(--bg-surface-border);border-radius:3px;',
    'font-size:0.62rem;padding:1px 3px;text-align:right;',
  ].join('');

  const minLabel = document.createElement('span');
  minLabel.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
  minLabel.textContent = 'Min';
  const minInput = document.createElement('input');
  minInput.type = 'text'; minInput.value = String(mapping.min); minInput.style.cssText = inputStyle;
  minInput.addEventListener('blur', () => {
    const v = parseFloat(minInput.value);
    if (!isNaN(v) && v < mapping.max) { mapping.min = v; reactor.saveMappings(); }
    else minInput.value = String(mapping.min);
  });
  minInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') minInput.blur(); });

  const maxLabel = document.createElement('span');
  maxLabel.style.cssText = 'font-size:0.6rem;color:var(--text-muted);margin-left:4px;';
  maxLabel.textContent = 'Max';
  const maxInput = document.createElement('input');
  maxInput.type = 'text'; maxInput.value = String(mapping.max); maxInput.style.cssText = inputStyle;
  maxInput.addEventListener('blur', () => {
    const v = parseFloat(maxInput.value);
    if (!isNaN(v) && v > mapping.min) { mapping.max = v; reactor.saveMappings(); }
    else maxInput.value = String(mapping.max);
  });
  maxInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') maxInput.blur(); });

  minMaxRow.appendChild(minLabel); minMaxRow.appendChild(minInput);
  minMaxRow.appendChild(maxLabel); minMaxRow.appendChild(maxInput);
  body.appendChild(minMaxRow);

  // Trace canvas — registered so updateAudioViz() can push amplitude values
  const { canvas: traceCanvas, push: pushTrace } = makeTraceCanvas(color, registerDisconnect);
  body.appendChild(traceCanvas);
  traceUpdaters.set(`${String(mapping.param)}::${mapping.band}`, pushTrace);

  return body;
}

/**
 * Builds the ∑ combined tab shown when a param has 2+ band mappings.
 * Registers a totalUpdater so updateAudioViz() can push per-frame values.
 * Call registerUpdater() after inserting the body into the DOM.
 */
function buildTotalTab(
  param: string,
  reactor: AudioReactor,
  totalUpdaters: Map<string, (snapshot: BandSnapshot, baseVal: number, modulatedVal: number) => void>,
  registerDisconnect: (fn: () => void) => void,
): { body: HTMLDivElement; registerUpdater: () => void } {
  const dpr = window.devicePixelRatio || 1;
  const TRACE_W   = 184;
  let STACKED_H = 40; // grows with panel height via stackRo
  const resolvedTextBody = getComputedStyle(document.documentElement)
    .getPropertyValue('--text-body').trim() || 'rgba(232,224,208,0.9)';
  const meta     = PARAM_META[param];
  const mappings = reactor.mappings
    .filter(m => String(m.param) === param)
    .sort((a, b) => BAND_KEYS_ORDER.indexOf(a.band) - BAND_KEYS_ORDER.indexOf(b.band));

  const body = document.createElement('div');
  body.style.cssText = 'padding:6px 8px;';

  // ── Live value header ─────────────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:baseline;gap:6px;margin-bottom:4px;';
  const liveVal = document.createElement('span');
  liveVal.style.cssText = 'font-size:0.75rem;font-variant-numeric:tabular-nums;color:var(--text-body);font-weight:600;min-width:32px;';
  liveVal.textContent = '—';
  const baseValEl = document.createElement('span');
  baseValEl.style.cssText = 'font-size:0.58rem;color:var(--text-muted);';
  baseValEl.textContent = 'base —';
  const deltaEl = document.createElement('span');
  deltaEl.style.cssText = 'font-size:0.58rem;margin-left:auto;font-variant-numeric:tabular-nums;';
  deltaEl.textContent = '';
  header.appendChild(liveVal);
  header.appendChild(baseValEl);
  header.appendChild(deltaEl);
  body.appendChild(header);

  // ── Range bar ─────────────────────────────────────────────────────────
  const rangeRow = document.createElement('div');
  rangeRow.style.cssText = 'display:flex;align-items:center;gap:5px;margin-bottom:4px;';
  const rangeLbl = document.createElement('span');
  rangeLbl.style.cssText = 'font-size:0.52rem;color:var(--text-muted);min-width:28px;';
  rangeLbl.textContent = 'range';
  const rangeWrap = document.createElement('div');
  rangeWrap.style.cssText = 'flex:1;position:relative;';
  const rangeTrack = document.createElement('div');
  rangeTrack.style.cssText = 'height:5px;background:var(--bg-surface-border);border-radius:3px;overflow:hidden;';
  const rangeFill = document.createElement('div');
  rangeFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,var(--accent),var(--text-body));opacity:0.5;border-radius:3px;';
  rangeTrack.appendChild(rangeFill);
  const rangeCursor = document.createElement('div');
  rangeCursor.style.cssText = 'position:absolute;top:-1px;width:2px;height:7px;background:var(--text-body);border-radius:1px;box-shadow:0 0 3px var(--text-body);transform:translateX(-1px);left:0%;';
  const rangeMinMax = document.createElement('div');
  rangeMinMax.style.cssText = 'display:flex;justify-content:space-between;font-size:0.5rem;color:var(--text-muted);margin-top:1px;font-variant-numeric:tabular-nums;';
  rangeMinMax.innerHTML = `<span>${meta.min}</span><span class="range-cur-lbl" style="color:var(--text-body);">—</span><span>${meta.max}</span>`;
  const rangeCurLbl = rangeMinMax.querySelector<HTMLSpanElement>('.range-cur-lbl')!;
  rangeWrap.appendChild(rangeTrack);
  rangeWrap.appendChild(rangeCursor);
  rangeWrap.appendChild(rangeMinMax);
  rangeRow.appendChild(rangeLbl);
  rangeRow.appendChild(rangeWrap);
  body.appendChild(rangeRow);

  // ── Stacked trace canvas ──────────────────────────────────────────────
  const stackCanvas = document.createElement('canvas');
  stackCanvas.width  = TRACE_W * dpr;
  stackCanvas.height = STACKED_H * dpr;
  stackCanvas.style.cssText = `width:100%;height:${STACKED_H}px;display:block;border-radius:2px;background:#06050a;margin-bottom:3px;`;
  body.appendChild(stackCanvas);

  // Legend
  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;font-size:0.5rem;margin-bottom:5px;';
  for (const m of mappings) {
    const s = document.createElement('span');
    s.style.color = BAND_COLORS[m.band];
    s.textContent = `— ${m.band}`;
    legend.appendChild(s);
  }
  const combSpan = document.createElement('span');
  combSpan.style.cssText = 'color:var(--text-body);font-weight:600;';
  combSpan.textContent = '— combined';
  legend.appendChild(combSpan);
  body.appendChild(legend);

  // ── Contributions breakdown ───────────────────────────────────────────
  const contribSection = document.createElement('div');
  contribSection.style.cssText = 'border-top:1px solid var(--bg-surface-border);padding-top:5px;';
  const contribLbl = document.createElement('div');
  contribLbl.style.cssText = 'font-size:0.5rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:3px;';
  contribLbl.textContent = 'contributions';
  contribSection.appendChild(contribLbl);
  function contribModeLabel(mode: AudioMapping['mode']): string {
    return mode === 'add' ? '+add' : mode === 'subtract' ? '−sub' : '×mul';
  }
  const contribRows: { fill: HTMLElement; valEl: HTMLElement; modeEl: HTMLElement }[] = [];
  for (const m of mappings) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:3px;';
    const swatch = document.createElement('div');
    swatch.style.cssText = `width:6px;height:6px;border-radius:50%;background:${BAND_COLORS[m.band]};flex-shrink:0;`;
    const name = document.createElement('span');
    name.style.cssText = `font-size:0.52rem;color:${BAND_COLORS[m.band]};min-width:30px;`;
    name.textContent = m.band;
    const modeEl = document.createElement('span');
    modeEl.style.cssText = 'font-size:0.5rem;color:var(--text-muted);min-width:22px;cursor:pointer;user-select:none;';
    modeEl.title = 'Click to cycle mode';
    modeEl.textContent = contribModeLabel(m.mode);
    modeEl.addEventListener('mouseenter', () => { modeEl.style.color = 'var(--text-body)'; });
    modeEl.addEventListener('mouseleave', () => { modeEl.style.color = 'var(--text-muted)'; });
    modeEl.addEventListener('click', () => {
      m.mode = m.mode === 'add' ? 'subtract' : m.mode === 'subtract' ? 'multiply' : 'add';
      modeEl.textContent = contribModeLabel(m.mode);
      reactor.saveMappings();
    });
    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'flex:1;height:3px;background:var(--bg-surface-border);border-radius:2px;';
    const barFill = document.createElement('div');
    barFill.style.cssText = `height:100%;width:0%;background:${BAND_COLORS[m.band]};border-radius:2px;`;
    barWrap.appendChild(barFill);
    const valEl = document.createElement('span');
    valEl.style.cssText = `font-size:0.5rem;color:${BAND_COLORS[m.band]};min-width:32px;text-align:right;font-variant-numeric:tabular-nums;`;
    valEl.textContent = '—';
    row.appendChild(swatch); row.appendChild(name); row.appendChild(modeEl);
    row.appendChild(barWrap); row.appendChild(valEl);
    contribSection.appendChild(row);
    contribRows.push({ fill: barFill, valEl, modeEl });
  }
  body.appendChild(contribSection);

  // Per-band ring buffers for stacked trace
  const bandBuffers = mappings.map(() => new Float32Array(TRACE_LEN));
  const combinedBuffer = new Float32Array(TRACE_LEN);
  let tracePtr = 0;

  let stackPanelObserved = false;
  const stackRo = new ResizeObserver(() => {
    const w = stackCanvas.clientWidth;
    if (w > 0) stackCanvas.width = Math.round(w * dpr);

    const panelEl = stackCanvas.closest?.('.params-panel') as HTMLElement | null;
    if (panelEl && !stackPanelObserved) { stackRo.observe(panelEl); stackPanelObserved = true; }
    if (panelEl) {
      const newH = Math.round(Math.min(180, Math.max(40, panelEl.clientHeight * 0.22)));
      if (newH !== STACKED_H) {
        STACKED_H = newH;
        stackCanvas.style.height = `${STACKED_H}px`;
        stackCanvas.height = Math.round(STACKED_H * dpr);
      }
    }
    drawStackedTrace();
  });
  stackRo.observe(stackCanvas);
  registerDisconnect(() => stackRo.disconnect());

  function drawStackedTrace(): void {
    const ctx = stackCanvas.getContext('2d');
    if (!ctx) return;
    const W = Math.round(stackCanvas.width / dpr), H = STACKED_H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const innerH = H - 2;
    // Show as many history samples as CSS pixels wide.
    const vLen = Math.min(TRACE_LEN, Math.max(2, W));
    const startOff = TRACE_LEN - vLen;
    // Helper: draw one trace buffer across W pixels with interpolation when stretched.
    function drawTraceLine(getBuf: (j: number) => number): void {
      ctx.beginPath();
      if (vLen <= W) {
        for (let x = 0; x < W; x++) {
          const t  = (x / Math.max(1, W - 1)) * (vLen - 1);
          const i0 = Math.floor(t), i1 = Math.min(vLen - 1, i0 + 1);
          const v  = getBuf(i0) * (1 - (t - i0)) + getBuf(i1) * (t - i0);
          const y  = H - Math.min(1, Math.max(0, v)) * innerH - 1;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      } else {
        for (let j = 0; j < vLen; j++) {
          const x = (j / (vLen - 1)) * W;
          const y = H - Math.min(1, Math.max(0, getBuf(j))) * innerH - 1;
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Individual band traces (faint)
    mappings.forEach((m, i) => {
      ctx.strokeStyle = BAND_COLORS[m.band];
      ctx.lineWidth   = 1;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.globalAlpha = 0.45;
      drawTraceLine(j => bandBuffers[i][(tracePtr + startOff + j) % TRACE_LEN]);
    });
    // Combined trace (bright)
    ctx.strokeStyle = resolvedTextBody;
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.globalAlpha = 0.9;
    drawTraceLine(j => combinedBuffer[(tracePtr + startOff + j) % TRACE_LEN]);
    ctx.globalAlpha = 1;
  }

  function registerUpdater(): void {
    totalUpdaters.set(param, (snapshot: BandSnapshot, baseVal: number, modulatedVal: number) => {
      // Live value header
      const delta = modulatedVal - baseVal;
      liveVal.textContent   = modulatedVal.toFixed(3);
      baseValEl.textContent = `base ${baseVal.toFixed(3)}`;
      deltaEl.textContent   = (delta >= 0 ? '+' : '') + delta.toFixed(3);
      deltaEl.style.color   = delta >= 0 ? '#80d060' : '#e05060';

      // Range bar
      const rangeSpan = meta.max - meta.min;
      const fraction  = rangeSpan > 0 ? Math.max(0, Math.min(1, (modulatedVal - meta.min) / rangeSpan)) : 0;
      rangeFill.style.width   = `${fraction * 100}%`;
      rangeCursor.style.left  = `${fraction * 100}%`;
      rangeCurLbl.textContent = modulatedVal.toFixed(3);

      // Per-band contributions
      mappings.forEach((m, i) => {
        const signal      = Math.min(1, snapshot[m.band] * (m.gain ?? 1));
        const mappingMeta = PARAM_META[String(m.param)];
        let contribution: number;
        let barFraction: number;
        // Keep modeEl in sync — mode may have changed via the band tab's mode button
        contribRows[i].modeEl.textContent = contribModeLabel(m.mode);
        if (m.mode === 'add' || m.mode === 'subtract') {
          const sign   = m.mode === 'subtract' ? -1 : 1;
          contribution = sign * signal * m.depth * (m.max - m.min);
          barFraction  = Math.min(1, Math.abs(contribution) / Math.max(0.001, mappingMeta.max - mappingMeta.min));
          contribRows[i].valEl.textContent = (contribution >= 0 ? '+' : '') + contribution.toFixed(3);
        } else {
          contribution = 1 + signal * m.depth;
          barFraction  = Math.min(1, (contribution - 1) / 2);
          contribRows[i].valEl.textContent = `×${contribution.toFixed(3)}`;
        }
        (contribRows[i].fill as HTMLElement).style.width = `${barFraction * 100}%`;

        // Push to per-band ring buffer (normalised amplitude)
        bandBuffers[i][tracePtr] = signal;
      });

      // Combined: normalise modulated value to 0–1 within param range
      const normModulated = rangeSpan > 0 ? Math.max(0, Math.min(1, (modulatedVal - meta.min) / rangeSpan)) : 0;
      combinedBuffer[tracePtr] = normModulated;
      tracePtr = (tracePtr + 1) % TRACE_LEN;

      drawStackedTrace();
    });
  }

  return { body, registerUpdater };
}

// ── Audio tab builder ─────────────────────────────────────────────────────────

export function buildAudioTab(
  container: HTMLElement,
  reactor: AudioReactor,
  updMaps: AudioUpdaterMaps,
  registerDisconnect: (fn: () => void) => void,
): { start: () => void; stop: () => void } {

  // Do NOT set display here — it's managed by switchTab (setting display:flex
  // would overwrite the display:none set during tab body creation, causing Audio
  // content to bleed into the Params tab on initial render).
  container.style.overflowX = 'hidden';

  const dpr = window.devicePixelRatio || 1;

  // ── Source row ────────────────────────────────────────────────────────
  const sourceSection = document.createElement('div');
  sourceSection.style.cssText = 'padding:8px 8px 6px;border-bottom:1px solid var(--bg-surface-border);';

  const sourceLabel = document.createElement('div');
  sourceLabel.style.cssText = 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:5px;';
  sourceLabel.textContent = 'Audio Source';

  const sourceBtnRow = document.createElement('div');
  sourceBtnRow.style.cssText = 'display:flex;align-items:center;gap:5px;';

  const micBtn = document.createElement('button');
  micBtn.textContent = 'Microphone';
  micBtn.style.cssText = pillStyle(false);

  const sysBtn = document.createElement('button');
  sysBtn.textContent = 'System Audio';
  sysBtn.style.cssText = pillStyle(false);

  // Status dot
  const statusDot = document.createElement('span');
  statusDot.style.cssText = [
    'width:7px;height:7px;border-radius:50%;',
    'display:inline-block;margin-left:auto;',
    'background:var(--text-muted);transition:background 0.2s;',
  ].join('');

  const errorMsg = document.createElement('div');
  errorMsg.style.cssText = 'font-size:0.62rem;color:#e05060;margin-top:4px;display:none;word-break:break-word;';

  function updateStatus(): void {
    if (reactor.status === 'active') {
      statusDot.style.background = 'var(--accent)';
      statusDot.style.boxShadow  = '0 0 4px var(--accent)';
      micBtn.style.cssText = pillStyle(reactor.activeSourceKind === 'microphone');
      sysBtn.style.cssText = pillStyle(reactor.activeSourceKind === 'system');
      errorMsg.style.display = 'none';
    } else if (reactor.status === 'error') {
      statusDot.style.background = '#e05060';
      statusDot.style.boxShadow  = 'none';
      errorMsg.textContent = reactor.lastError;
      errorMsg.style.display = 'block';
      micBtn.style.cssText = pillStyle(false);
      sysBtn.style.cssText = pillStyle(false);
    } else {
      statusDot.style.background = 'var(--text-muted)';
      statusDot.style.boxShadow  = 'none';
      micBtn.style.cssText = pillStyle(false);
      sysBtn.style.cssText = pillStyle(false);
      errorMsg.style.display = 'none';
    }
  }

  async function startSource(kind: 'microphone' | 'system'): Promise<void> {
    if (reactor.isActive()) {
      if (reactor.activeSourceKind === kind) {
        // Clicking the already-active source toggles it off
        reactor.stop();
        updateStatus();
        return;
      }
      // Clicking a different source: stop current and switch
      reactor.stop();
    }
    try {
      await reactor.start(kind);
    } catch { /* error already stored in reactor.lastError */ }
    updateStatus();
  }

  micBtn.addEventListener('click', () => void startSource('microphone'));
  sysBtn.addEventListener('click', () => void startSource('system'));

  sourceBtnRow.appendChild(micBtn);
  sourceBtnRow.appendChild(sysBtn);
  sourceBtnRow.appendChild(statusDot);

  // Global strength slider
  const globalStrRow = document.createElement('div');
  globalStrRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;';
  const globalStrLbl = document.createElement('span');
  globalStrLbl.style.cssText = 'font-size:0.55rem;color:var(--text-muted);min-width:44px;';
  globalStrLbl.textContent = 'Strength';
  const globalStrSlider = document.createElement('input');
  globalStrSlider.type = 'range';
  globalStrSlider.min  = '0';
  globalStrSlider.max  = '2';
  globalStrSlider.step = '0.01';
  globalStrSlider.value = String(reactor.globalStrength);
  globalStrSlider.style.cssText = 'flex:1;accent-color:var(--accent);';
  const globalStrVal = document.createElement('span');
  globalStrVal.style.cssText = 'font-size:0.6rem;color:var(--accent);min-width:26px;text-align:right;font-variant-numeric:tabular-nums;';
  globalStrVal.textContent = reactor.globalStrength.toFixed(2);
  globalStrSlider.addEventListener('input', () => {
    reactor.globalStrength = parseFloat(globalStrSlider.value);
    globalStrVal.textContent = reactor.globalStrength.toFixed(2);
    reactor.saveGlobal();
  });
  globalStrRow.appendChild(globalStrLbl);
  globalStrRow.appendChild(globalStrSlider);
  globalStrRow.appendChild(globalStrVal);
  globalStrRow.appendChild(makeResetBtn(globalStrSlider, 1.0));

  sourceSection.appendChild(sourceLabel);
  sourceSection.appendChild(sourceBtnRow);
  sourceSection.appendChild(errorMsg);
  sourceSection.appendChild(globalStrRow);
  container.appendChild(sourceSection);

  // Sync UI to current reactor state (reactor may already be active from a prior panel build)
  updateStatus();

  // ── Spectrum canvas ───────────────────────────────────────────────────
  const canvasSection = document.createElement('div');
  canvasSection.style.cssText = 'padding:6px 8px 4px;border-bottom:1px solid var(--bg-surface-border);';

  const vizCanvas = document.createElement('canvas');
  vizCanvas.width  = 184;
  vizCanvas.height = 40;
  vizCanvas.style.cssText = 'width:100%;height:40px;display:block;border-radius:2px;background:#06050a;';
  canvasSection.appendChild(vizCanvas);

  // Keep vizCanvas pixel buffer in sync with its CSS size on panel resize.
  // When the panel grows vertically, expand the viz up to a W/2.5 aspect-ratio cap —
  // but only after all fixed content (source, meters, mappings table) is fully visible.
  const panelEl = container.parentElement?.parentElement as HTMLElement | null;

  function updateVizSize(): void {
    const w = vizCanvas.clientWidth;
    if (w <= 0) return;
    vizCanvas.width = Math.round(w * dpr);

    if (panelEl) {
      const tabBarEl = container.parentElement?.firstElementChild as HTMLElement | null;
      const tabBarH  = tabBarEl ? tabBarEl.offsetHeight : 36;
      // Total space available inside the panel for all tab content
      const availH = panelEl.clientHeight
        - 22       /* drag handle */
        - tabBarH  /* tab button row */
        - (sourceSection.offsetHeight || 80)
        - (metersRow.offsetHeight || 25)
        - (mappingsSection.offsetHeight || 200)
        - 24;      /* canvasSection padding + breathing room */
      const maxFromAR = w / 2.5;
      const newH = Math.min(maxFromAR, Math.max(40, availH));
      if (Math.abs(newH - vizCanvas.clientHeight) >= 1) {
        vizCanvas.style.height = `${newH}px`;
        vizCanvas.height = Math.round(newH * dpr);
      }
    }
  }

  const vizRo = new ResizeObserver(updateVizSize);
  vizRo.observe(vizCanvas);
  if (panelEl) vizRo.observe(panelEl);
  registerDisconnect(() => vizRo.disconnect());

  // Band traces
  const metersRow = document.createElement('div');
  metersRow.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:3px;margin-top:5px;';

  const BAND_KEYS: BandKey[] = ['bass', 'mid', 'presence', 'hi', 'volume'];
  const BAND_LABELS: Record<BandKey, string> = {
    bass: 'bass', mid: 'mid', presence: 'pres', hi: 'hi', volume: 'vol',
  };

  // Push functions for the band traces — called in the animation loop below
  const bandPush: Partial<Record<BandKey, (v: number) => void>> = {};

  function makeBandTrace(band: BandKey): { canvas: HTMLCanvasElement; push: (v: number) => void } {
    const buf = new Float32Array(TRACE_LEN);
    let ptr = 0;
    const TRACE_W = 184;
    const TRACE_H = 32;
    let trH = TRACE_H;
    let panelObserved = false;

    const canvas = document.createElement('canvas');
    canvas.width  = TRACE_W * dpr;
    canvas.height = 14 * dpr;
    canvas.style.cssText = `width:100%;height:14px;display:block;border-radius:2px;background:#06050a;`;

    function draw(): void {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const vLen = Math.min(TRACE_LEN, Math.max(2, W));
      const startOff = TRACE_LEN - vLen;
      ctx.strokeStyle = BAND_COLORS[band];
      ctx.lineWidth   = 1.5 * dpr;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      if (vLen <= W) {
        for (let x = 0; x < W; x++) {
          const t  = (x / Math.max(1, W - 1)) * (vLen - 1);
          const i0 = Math.floor(t);
          const i1 = Math.min(vLen - 1, i0 + 1);
          const v  = buf[(ptr + startOff + i0) % TRACE_LEN] * (1 - (t - i0))
                   + buf[(ptr + startOff + i1) % TRACE_LEN] * (t - i0);
          const y  = H - v * (H - 2) - 1;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      } else {
        for (let i = 0; i < vLen; i++) {
          const idx = (ptr + startOff + i) % TRACE_LEN;
          const x = (i / (vLen - 1)) * W;
          const y = H - buf[idx] * (H - 2) - 1;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const ro = new ResizeObserver(() => {
      const panelEl = canvas.closest?.('.params-panel') as HTMLElement | null;
      if (panelEl && !panelObserved) { ro.observe(panelEl); panelObserved = true; }
      if (panelEl) {
        const newH = Math.round(Math.min(36, Math.max(14, panelEl.clientHeight * 0.04)));
        if (newH !== trH) {
          trH = newH;
          canvas.style.height = `${trH}px`;
          canvas.height = Math.round(trH * dpr);
        }
      }
      const newW = Math.round(canvas.clientWidth * dpr);
      if (newW > 0 && newW !== canvas.width) canvas.width = newW;
      draw();
    });
    ro.observe(canvas);
    registerDisconnect(() => ro.disconnect());

    function push(v: number): void {
      buf[ptr] = v;
      ptr = (ptr + 1) % TRACE_LEN;
      draw();
    }

    return { canvas, push };
  }

  for (const band of BAND_KEYS) {
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';

    const { canvas: traceCanvas, push } = makeBandTrace(band);
    bandPush[band] = push;

    const label = document.createElement('div');
    label.style.cssText = `font-size:0.55rem;color:${BAND_COLORS[band]};letter-spacing:0.04em;`;
    label.textContent = BAND_LABELS[band];

    col.appendChild(traceCanvas);
    col.appendChild(label);
    metersRow.appendChild(col);
  }

  canvasSection.appendChild(metersRow);
  container.appendChild(canvasSection);

  // ── Mappings section ──────────────────────────────────────────────────
  const mappingsSection = document.createElement('div');
  mappingsSection.style.cssText = 'padding:0;';

  const mappingsHeader = document.createElement('div');
  mappingsHeader.style.cssText = 'display:flex;align-items:center;padding:5px 8px 3px;';
  const mappingsLabel = document.createElement('div');
  mappingsLabel.style.cssText = 'font-size:0.55rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);flex:1;';
  mappingsLabel.textContent = 'Mappings';
  mappingsHeader.appendChild(mappingsLabel);
  mappingsSection.appendChild(mappingsHeader);

  // Matrix table — table-layout:fixed + colgroup for fully predictable column widths.
  // param (38%) | trace (remaining) | 5 × band (18px each)
  const matrixTable = document.createElement('table');
  matrixTable.style.cssText = 'width:100%;table-layout:fixed;border-collapse:collapse;';

  // colgroup pins every column so widths scale deterministically as the panel resizes.
  // param: fixed 115px (fits longest label "Attraction Radius" at 0.57rem with padding)
  // trace: absorbs all remaining space
  // bands: 30px each — wide enough to be comfortably clickable
  const cg = document.createElement('colgroup');
  const paramCol = document.createElement('col');
  paramCol.style.width = '115px';
  cg.appendChild(paramCol);
  cg.appendChild(document.createElement('col')); // trace: absorbs remaining space
  for (let i = 0; i < 5; i++) {
    const c = document.createElement('col');
    c.style.width = '10%';
    cg.appendChild(c);
  }
  matrixTable.appendChild(cg);

  // thead — band column headers
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const paramTh = document.createElement('th');
  paramTh.style.cssText = 'text-align:left;padding-left:8px;font-size:0.5rem;color:transparent;user-select:none;';
  paramTh.textContent = '-';
  headerRow.appendChild(paramTh);
  const traceTh = document.createElement('th');
  traceTh.style.cssText = 'padding:0;';
  headerRow.appendChild(traceTh);
  const BAND_ABBR: Record<BandKey, string> = { bass: 'B', mid: 'M', presence: 'P', hi: 'H', volume: 'V' };
  for (const band of BAND_KEYS_ORDER) {
    const th = document.createElement('th');
    th.style.cssText = `font-size:0.5rem;text-transform:uppercase;letter-spacing:0.06em;padding:2px 0;text-align:center;color:${BAND_COLORS[band]};`;
    th.textContent = BAND_ABBR[band];
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  matrixTable.appendChild(thead);

  const tbody = document.createElement('tbody');
  matrixTable.appendChild(tbody);
  mappingsSection.appendChild(matrixTable);
  container.appendChild(mappingsSection);

  // Drawer state — open/close/disconnect managed by DrawerController;
  // drawerTr tracks the table row DOM element separately.
  const drawer = new DrawerController();
  let drawerTr: HTMLTableRowElement | null = null;

  // Persistent sparkline objects — survive rebuildMatrix() so ring buffers are not wiped
  const matTraceCache = new Map<string, { canvas: HTMLCanvasElement; push: (v: number) => void }>();

  function rebuildMatrix(): void {
    updMaps.cellUpdaters.clear();
    updMaps.totalUpdaters.clear();
    updMaps.traceUpdaters.clear();
    updMaps.matrixTraceUpdaters.clear();
    tbody.innerHTML = '';
    drawer.close();
    drawerTr = null;

    for (const paramKey of MAPPABLE_PARAMS) {
      const param = String(paramKey);
      const meta  = PARAM_META[param];
      if (!meta) continue;

      const activeMappings = reactor.mappings.filter(m => String(m.param) === param);
      const hasAny = activeMappings.length > 0;

      const tr = document.createElement('tr');
      tr.style.cssText = 'cursor:pointer;transition:background 0.1s;';
      tr.addEventListener('mouseenter', () => { if (!drawer.isOpen(param)) tr.style.background = 'rgba(255,255,255,0.03)'; });
      tr.addEventListener('mouseleave', () => { if (!drawer.isOpen(param)) tr.style.background = ''; });

      // Param label cell — truncates with ellipsis; click opens/closes the drawer
      const nameTd = document.createElement('td');
      nameTd.title = meta.label;
      nameTd.style.cssText = [
        `font-size:0.57rem;padding:3px 4px 3px 8px;`,
        `white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`,
        `color:${hasAny ? 'var(--text-body)' : 'var(--text-muted)'};`,
        `opacity:${hasAny ? '1' : '0.5'};`,
        `cursor:${hasAny ? 'pointer' : 'default'};`,
      ].join('');
      nameTd.textContent = meta.label;
      nameTd.addEventListener('click', () => {
        if (!hasAny) return;
        if (drawer.isOpen(param)) {
          closeDrawer();
        } else {
          const firstBand = [...activeMappings].sort(
            (a, b) => BAND_KEYS_ORDER.indexOf(a.band) - BAND_KEYS_ORDER.indexOf(b.band)
          )[0].band;
          openDrawer(param, firstBand);
        }
      });
      tr.appendChild(nameTd);

      // Trace column — sparkline of combined modulation for this param
      const traceTd = document.createElement('td');
      traceTd.style.cssText = 'padding:1px 1px;vertical-align:middle;';
      if (hasAny) {
        // Reuse cached trace so the ring buffer survives rebuildMatrix() calls
        if (!matTraceCache.has(param)) {
          matTraceCache.set(param, makeMatrixTrace(BAND_COLORS[
            reactor.mappings.find(m => String(m.param) === param)!.band
          ]));
        }
        const { canvas: traceCanvas, push } = matTraceCache.get(param)!;
        traceTd.appendChild(traceCanvas);
        updMaps.matrixTraceUpdaters.set(param, push);
      } else {
        matTraceCache.delete(param);
      }
      tr.appendChild(traceTd);

      // Band cells
      for (const band of BAND_KEYS_ORDER) {
        const td = document.createElement('td');
        td.style.cssText = 'text-align:center;padding:3px 0;cursor:pointer;transition:background 0.1s;';
        td.addEventListener('mouseenter', () => { td.style.background = 'rgba(255,255,255,0.06)'; });
        td.addEventListener('mouseleave', () => { td.style.background = ''; });

        const mapping = activeMappings.find(m => m.band === band) ?? null;
        td.addEventListener('click', () => {
          // Remember which drawer was open so we can restore it after rebuild
          const wasOpenParam = drawer.isOpen(param) ? param
            : MAPPABLE_PARAMS.map(String).find(p => drawer.isOpen(p)) ?? null;

          if (mapping) {
            // Filled dot → toggle OFF (remove mapping)
            const idx = reactor.mappings.findIndex(m => String(m.param) === param && m.band === band);
            if (idx !== -1) reactor.mappings.splice(idx, 1);
            reactor.saveMappings();
          } else {
            // Empty dot → toggle ON (add mapping)
            const meta = PARAM_META[param];
            reactor.mappings.push({
              param: paramKey,
              band,
              mode: 'add',
              depth: 0.5,
              gain: 1.0,
              min: meta.min,
              max: meta.max,
              enabled: true,
            });
            reactor.saveMappings();
          }

          rebuildMatrix();

          // Restore drawer — band cell clicks must never change drawer open/close state.
          if (wasOpenParam !== null) {
            const remaining = reactor.mappings.filter(m => String(m.param) === wasOpenParam);
            if (remaining.length > 0) {
              const bandToOpen = [...remaining].sort(
                (a, b) => BAND_KEYS_ORDER.indexOf(a.band) - BAND_KEYS_ORDER.indexOf(b.band)
              )[0].band;
              openDrawer(wasOpenParam, bandToOpen);
            }
          }
        });

        const cellDiv = document.createElement('div');
        cellDiv.style.cssText = 'display:inline-flex;flex-direction:column;align-items:center;gap:1px;padding:2px;border-radius:3px;';

        const dot = document.createElement('div');
        dot.style.cssText = 'width:9px;height:9px;border-radius:50%;display:block;';
        if (mapping) {
          dot.style.background = BAND_COLORS[band];
          dot.style.border     = `1px solid ${BAND_COLORS[band]}`;
          dot.style.boxShadow  = `0 0 4px ${BAND_COLORS[band]}aa`;
        } else {
          dot.style.background = `${BAND_COLORS[band]}28`;
          dot.style.border     = `1px solid ${BAND_COLORS[band]}70`;
        }
        cellDiv.appendChild(dot);

        // Live amplitude bar beneath dot (only for mapped cells)
        const liveBar = document.createElement('div');
        liveBar.style.cssText = `width:${mapping ? '12px' : '0'};height:2px;background:var(--bg-surface-border);border-radius:1px;overflow:hidden;`;
        const liveFill = document.createElement('div');
        liveFill.style.cssText = `height:100%;width:0%;background:${BAND_COLORS[band]};border-radius:1px;`;
        liveBar.appendChild(liveFill);
        cellDiv.appendChild(liveBar);

        if (mapping) {
          const key = `${param}::${band}`;
          updMaps.cellUpdaters.set(key, (amplitude: number) => {
            liveFill.style.width = `${Math.round(amplitude * 100)}%`;
          });
        }

        td.appendChild(cellDiv);
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }
  }

  rebuildMatrix();

  // ── Drawer helpers ────────────────────────────────────────────────────

  function openDrawer(param: string, activeBand: BandKey): void {
    // Close any existing drawer first (handles cleanup of updaters + row highlight)
    closeDrawer();

    const activeMappings = reactor.mappings.filter(m => String(m.param) === param);
    const multiMapping   = activeMappings.length >= 2;

    // Find the param <tr> in tbody (exclude drawer rows to prevent index desync)
    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr:not(.audio-drawer-row)'));
    const paramIdx = MAPPABLE_PARAMS.findIndex(p => String(p) === param);
    const paramTr  = rows[paramIdx];
    if (!paramTr) return;

    paramTr.style.background = 'var(--bg-surface)';

    // Build the drawer <tr>
    const tr = document.createElement('tr');
    tr.className = 'audio-drawer-row';
    const td = document.createElement('td');
    td.colSpan = 7; // param + trace + 5 bands
    td.style.cssText = 'padding:0;border-top:1px solid var(--bg-surface-border);border-bottom:1px solid var(--bg-surface-border);';

    // Per-param strength row — sits above the tab strip, always visible
    const paramStrRow = document.createElement('div');
    paramStrRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--bg-surface-border);background:var(--bg-primary);';
    const paramStrLbl = document.createElement('span');
    paramStrLbl.style.cssText = 'font-size:0.55rem;color:var(--text-muted);min-width:44px;';
    paramStrLbl.textContent = 'Strength';
    const paramStrSlider = document.createElement('input');
    paramStrSlider.type = 'range';
    paramStrSlider.min  = '0';
    paramStrSlider.max  = '2';
    paramStrSlider.step = '0.01';
    const curParamStr = reactor.paramStrengths[param] ?? 1.0;
    paramStrSlider.value = String(curParamStr);
    paramStrSlider.style.cssText = 'flex:1;accent-color:var(--accent);';
    const paramStrVal = document.createElement('span');
    paramStrVal.style.cssText = 'font-size:0.6rem;color:var(--accent);min-width:26px;text-align:right;font-variant-numeric:tabular-nums;';
    paramStrVal.textContent = curParamStr.toFixed(2);
    paramStrSlider.addEventListener('input', () => {
      reactor.paramStrengths[param] = parseFloat(paramStrSlider.value);
      paramStrVal.textContent = reactor.paramStrengths[param].toFixed(2);
      reactor.saveGlobal();
    });
    paramStrRow.appendChild(paramStrLbl);
    paramStrRow.appendChild(paramStrSlider);
    paramStrRow.appendChild(paramStrVal);
    paramStrRow.appendChild(makeResetBtn(paramStrSlider, 1.0));
    td.appendChild(paramStrRow);

    // Tab strip
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;border-bottom:1px solid var(--bg-surface-border);background:var(--bg-primary);';

    const drawerTabBodies: Record<string, HTMLDivElement> = {};
    // Default to ∑ tab when multiple mappings exist; otherwise show the requested band
    let activeTabKey: string = multiMapping ? '∑' : activeBand;

    function switchDrawerTab(key: string): void {
      activeTabKey = key;
      for (const [k, t] of Object.entries(drawerTabBodies)) {
        t.style.display = k === key ? 'block' : 'none';
      }
      tabs.querySelectorAll<HTMLButtonElement>('[data-tabkey]').forEach(btn => {
        const isActive = btn.dataset['tabkey'] === key;
        const bColor   = btn.dataset['bandcolor'] ?? 'var(--text-body)';
        btn.style.borderBottomColor = isActive ? bColor : 'transparent';
        btn.style.color = isActive ? bColor : 'var(--text-muted)';
        btn.classList.toggle('active-tab', isActive);
      });
    }

    function makeTabBtn(label: string, key: string, color: string, removable = false): HTMLButtonElement {
      const btn = document.createElement('button');
      btn.dataset['tabkey']    = key;
      btn.dataset['bandcolor'] = color;
      btn.style.cssText = [
        'flex:1;padding:4px 4px 4px 6px;font-size:0.52rem;',
        'cursor:pointer;border:none;background:transparent;',
        'border-bottom:2px solid transparent;transition:color 0.1s;',
        `color:var(--text-muted);`,
        removable ? 'display:flex;align-items:center;gap:3px;' : 'text-align:center;',
      ].join('');

      if (removable) {
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        labelSpan.style.cssText = 'flex:1;text-align:center;';
        const xSpan = document.createElement('span');
        xSpan.textContent = '×';
        xSpan.title = 'Remove mapping';
        xSpan.style.cssText = 'font-size:0.8rem;line-height:1;opacity:0.4;padding:0 2px;border-radius:2px;flex-shrink:0;';
        xSpan.addEventListener('mouseenter', () => { xSpan.style.opacity = '1'; xSpan.style.color = '#e05060'; });
        xSpan.addEventListener('mouseleave', () => { xSpan.style.opacity = '0.4'; xSpan.style.color = ''; });
        xSpan.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = reactor.mappings.findIndex(m => String(m.param) === param && m.band === (key as BandKey));
          if (idx !== -1) reactor.mappings.splice(idx, 1);
          reactor.saveMappings();
          closeDrawer();
          rebuildMatrix();
          const remaining = reactor.mappings.filter(m => String(m.param) === param);
          if (remaining.length > 0) openDrawer(param, remaining[0].band);
        });
        btn.appendChild(labelSpan);
        btn.appendChild(xSpan);
      } else {
        btn.textContent = label;
      }

      btn.addEventListener('click', () => switchDrawerTab(key));
      return btn;
    }

    // Band tabs — sorted by BAND_KEYS_ORDER so tabs always match matrix column order
    const sortedMappings = [...activeMappings].sort(
      (a, b) => BAND_KEYS_ORDER.indexOf(a.band) - BAND_KEYS_ORDER.indexOf(b.band)
    );

    // Use DrawerController to manage disconnect lifecycle; build all content into td
    drawer.open(param, td, (_body) => {
      const drawerDisconnects: Array<() => void> = [];
      const drawerRegister = (fn: () => void) => drawerDisconnects.push(fn);

      for (const m of sortedMappings) {
        const btn  = makeTabBtn(`● ${m.band}`, m.band, BAND_COLORS[m.band], true);
        tabs.appendChild(btn);
        const body = buildBandTab(m, reactor, updMaps.traceUpdaters, drawerRegister);
        body.style.display = 'none';
        drawerTabBodies[m.band] = body;
      }

      // ∑ total tab (only when 2+ mappings)
      if (multiMapping) {
        const totalBtn = makeTabBtn('∑ total', '∑', 'var(--text-body)', false);
        tabs.appendChild(totalBtn);
        const { body: totalBody, registerUpdater } = buildTotalTab(param, reactor, updMaps.totalUpdaters, drawerRegister);
        totalBody.style.display = 'none';
        drawerTabBodies['∑'] = totalBody;
        registerUpdater();
      }

      td.appendChild(tabs);
      for (const body of Object.values(drawerTabBodies)) td.appendChild(body);

      switchDrawerTab(activeTabKey);

      return drawerDisconnects;
    });

    tr.appendChild(td);
    // Insert after paramTr
    paramTr.insertAdjacentElement('afterend', tr);
    drawerTr = tr;
  }

  function closeDrawer(): void {
    // Find the currently open param to clean up updaters and row highlight
    const openParam = MAPPABLE_PARAMS.map(String).find(p => drawer.isOpen(p)) ?? null;

    drawer.close();

    if (drawerTr) {
      drawerTr.remove();
      drawerTr = null;
    }
    if (openParam) {
      updMaps.totalUpdaters.delete(openParam);
      reactor.mappings
        .filter(m => String(m.param) === openParam)
        .forEach(m => updMaps.traceUpdaters.delete(`${openParam}::${m.band}`));
      const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr:not(.audio-drawer-row)'));
      const paramIdx = MAPPABLE_PARAMS.findIndex(p => String(p) === openParam);
      const paramTr  = rows[paramIdx];
      if (paramTr) paramTr.style.background = '';
    }
  }

  // ── Visualiser rAF loop (runs only when Audio tab is visible) ─────────
  let vizRafId = 0;

  function startViz(): void {
    cancelAnimationFrame(vizRafId);
    let wasActive = false;
    function loop(): void {
      if (reactor.isActive()) {
        wasActive = true;
        const snapshot = reactor.analyze();
        // analyze() must be called first — it populates freqData that drawAudioViz reads
        drawAudioViz(vizCanvas, reactor);
        for (const band of BAND_KEYS) {
          bandPush[band]?.(snapshot[band]);
        }
      } else if (wasActive) {
        // Only clear once after going inactive — skip redundant work on subsequent idle frames
        wasActive = false;
        const ctx2d = vizCanvas.getContext('2d');
        if (ctx2d) ctx2d.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
      }
      vizRafId = requestAnimationFrame(loop);
    }
    vizRafId = requestAnimationFrame(loop);
  }

  function stopViz(): void {
    cancelAnimationFrame(vizRafId);
    drawer.dispose();
  }

  return { start: startViz, stop: stopViz };
}
