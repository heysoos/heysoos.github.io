// src/components/simulations/cppn/cppn-network-rows.ts
// The phone card's layer stack: an "in" row, one row per hidden layer
// (index · width meter + number · activation chip), an "out" row, and
// − / + layer buttons.
//   · drag a row sideways            → scrub its width (recompiles when settled)
//   · drag the index cell up / down  → move the layer (its lock moves with it)
//   · tap the chip                   → next activation (live, no recompile)
//   · hold the chip, then slide      → scrub through activations
//   · long-press the row             → lock the layer (width, activation, position)

import type { CustomRowApi } from '../../../lib/sim-page/param-spec';
import { fmtParam, sliderFrac } from '../../../lib/sim-page/param-math';
import { ACT_NAMES, MAX_LAYERS, layerWidthSpec } from './cppn-spec';

const HOLD_MS = 320;          // chip hold before sliding scrubs activations
const SLOP = 8;
const ACT_STEP_PX = 26;       // slide distance per activation step
const stop = (e: Event) => e.stopPropagation();

export interface InputsRowOpts {
  /** The `in` row shows a filmstrip of the input thumbnails and opens the inputs page. */
  inputsRow?: {
    count(): number;
    /** Up to six 16px canvases (the row shows `+N` for the rest). */
    thumbs(): HTMLCanvasElement[];
    onOpen(): void;
  };
}

export function renderNetworkRows(container: HTMLElement, api: CustomRowApi, rowClass = 'scrub-row', opts: InputsRowOpts = {}): { refresh(): void } {
  container.className += ' cppn-layers';
  const stack = document.createElement('div');
  const foot = document.createElement('div');
  foot.className = 'cppn-layer-pm';
  foot.innerHTML = `<button class="pm-minus">− layer</button><button class="pm-plus">+ layer</button>`;
  container.append(stack, foot);
  const minus = foot.querySelector<HTMLButtonElement>('.pm-minus')!;
  const plus = foot.querySelector<HTMLButtonElement>('.pm-plus')!;
  const count = () => Math.max(1, Math.min(MAX_LAYERS, Math.round(api.get('layers'))));
  minus.addEventListener('click', () => {
    const n = count();
    if (n <= 1) return;
    api.set('layers', n - 1);
    api.commit('Remove layer');
  });
  plus.addEventListener('click', () => {
    const n = count();
    if (n >= MAX_LAYERS) return;
    api.set('layers', n + 1);
    api.commit('Add layer');
  });

  // ── Reorder: read the stack, move one layer, write it back with its lock ──
  type L = { width: number; act: number; lockW: boolean; lockA: boolean };
  const readStack = (): L[] => Array.from({ length: count() }, (_, i) => ({
    width: api.get(`layer${i}Width`), act: api.get(`layer${i}Act`),
    lockW: api.isLocked(`layer${i}Width`), lockA: api.isLocked(`layer${i}Act`),
  }));
  const writeStack = (ls: L[]): void => {
    ls.forEach((l, i) => {
      api.set(`layer${i}Width`, l.width);
      api.set(`layer${i}Act`, l.act);
      api.setLocked(`layer${i}Width`, l.lockW);
      api.setLocked(`layer${i}Act`, l.lockA);
    });
  };
  function moveLayer(from: number, to: number): void {
    if (from === to) return;
    const ls = readStack();
    const [l] = ls.splice(from, 1);
    ls.splice(to, 0, l);
    writeStack(ls);
    api.commit('Move layer');
  }

  type LayerRow = { el: HTMLElement; val: HTMLElement; chip: HTMLElement };
  let rows: LayerRow[] = [];
  let built = -1;

  const ioRow = (label: string, text: string): HTMLElement => {
    const r = document.createElement('div');
    r.className = 'cppn-layer io';
    r.innerHTML = `<span class="ix">${label}</span><span class="w">${text}</span>`;
    return r;
  };

  function attachReorder(ix: HTMLElement, row: HTMLElement, index: number): void {
    let id = -1, y0 = 0, active = false, target = index;
    ix.addEventListener('pointerdown', (e) => {
      stop(e);                                   // keep the row's width drag / long-press out of it
      id = e.pointerId; y0 = e.clientY; active = false; target = index;
      try { ix.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    });
    ix.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dy = e.clientY - y0;
      if (!active) {
        if (Math.abs(dy) < SLOP) return;
        active = true;
        row.classList.add('moving');
      }
      e.preventDefault();
      const h = row.getBoundingClientRect().height + 2;
      target = Math.max(0, Math.min(count() - 1, index + Math.round(dy / h)));
      row.style.transform = `translateY(${dy}px)`;
      rows.forEach((r, i) => r.el.classList.toggle('drop-target', active && i === target && i !== index));
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      row.style.transform = '';
      row.classList.remove('moving');
      rows.forEach(r => r.el.classList.remove('drop-target'));
      if (active) { active = false; moveLayer(index, target); }
    };
    ix.addEventListener('pointerup', end);
    ix.addEventListener('pointercancel', end);
    ix.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Tap = next activation. Hold, then slide = scrub through them (each
  // ACT_STEP_PX of travel is one step; horizontal or vertical both work).
  function attachChip(chip: HTMLElement, index: number): void {
    const key = `layer${index}Act`;
    let id = -1, x0 = 0, y0 = 0, timer = 0, scrubbing = false, start = 0, swallow = false;
    const cancelTimer = () => { if (timer) { clearTimeout(timer); timer = 0; } };
    chip.addEventListener('pointerdown', (e) => {
      stop(e);
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; scrubbing = false; swallow = false;
      start = Math.round(api.get(key));
      try { chip.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      cancelTimer();
      timer = window.setTimeout(() => {
        timer = 0; scrubbing = true; swallow = true;
        chip.classList.add('scrubbing');
        try { navigator.vibrate?.(8); } catch { /* not allowed */ }
      }, HOLD_MS);
    });
    chip.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - x0, dy = -(e.clientY - y0);
      if (!scrubbing) {
        if (timer && (Math.abs(dx) > SLOP || Math.abs(dy) > SLOP)) { cancelTimer(); swallow = true; }   // a drag, not a tap
        return;
      }
      e.preventDefault();
      const travel = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      const n = ACT_NAMES.length;
      const v = (((start + Math.round(travel / ACT_STEP_PX)) % n) + n) % n;
      if (v !== Math.round(api.get(key))) { api.set(key, v); api.refresh(); }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1; cancelTimer();
      chip.classList.remove('scrubbing');
      if (scrubbing) { scrubbing = false; if (Math.round(api.get(key)) !== start) api.commit('Activation'); }
    };
    chip.addEventListener('pointerup', end);
    chip.addEventListener('pointercancel', end);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (swallow) { swallow = false; return; }
      api.set(key, (Math.round(api.get(key)) + 1) % ACT_NAMES.length);
      api.commit('Activation');
    });
    chip.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  let inRow: HTMLElement | null = null;
  function buildInRow(): HTMLElement {
    const ir = opts.inputsRow;
    if (!ir) return ioRow('in', 'x · y · r · z<sub>16</sub>');
    const r = document.createElement('button');
    r.className = 'cppn-layer io in';
    r.title = 'Edit the input expressions';
    r.innerHTML = `<span class="ix">in</span><span class="strip"></span><span class="go"></span>`;
    // Long-press (phone) / alt-click (desktop) locks every input expression (`group:Inputs`).
    api.attachLongPress(r, 'group:Inputs');
    let pressed = 0;
    r.addEventListener('pointerdown', () => { pressed = performance.now(); });
    r.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.altKey) { api.setLocked('group:Inputs', !api.isLocked('group:Inputs')); api.refresh(); return; }
      const held = pressed && performance.now() - pressed > 400;   // the long-press already fired
      pressed = 0;
      if (held) return;
      ir.onOpen();
    });
    return r;
  }
  function refreshInRow(): void {
    const ir = opts.inputsRow;
    if (!ir || !inRow) return;
    const strip = inRow.querySelector<HTMLElement>('.strip')!;
    strip.innerHTML = '';
    const thumbs = ir.thumbs();
    thumbs.slice(0, 6).forEach(c => strip.appendChild(c));
    const n = ir.count();
    if (n > 6) { const m = document.createElement('span'); m.className = 'more'; m.textContent = `+${n - 6}`; strip.appendChild(m); }
    inRow.querySelector<HTMLElement>('.go')!.textContent = `${n} input${n === 1 ? '' : 's'} · z16 ›`;
    inRow.classList.toggle('locked', api.isLocked('group:Inputs'));
  }

  function build(n: number): void {
    stack.innerHTML = '';
    rows = [];
    inRow = buildInRow();
    stack.appendChild(inRow);
    for (let i = 0; i < n; i++) {
      const spec = layerWidthSpec(i);
      const r = document.createElement('div');
      r.className = `cppn-layer ${rowClass}`;
      r.innerHTML = `<span class="ix" title="Drag to reorder">${i + 1}</span><span class="w"><i class="lk"></i>width <b class="v"></b></span><button class="chip"></button>`;
      const ix = r.querySelector<HTMLElement>('.ix')!;
      const chip = r.querySelector<HTMLButtonElement>('.chip')!;
      api.attachRowDrag(r, spec);
      api.attachLongPress(r, spec.key);
      attachReorder(ix, r, i);
      attachChip(chip, i);
      stack.appendChild(r);
      rows.push({ el: r, val: r.querySelector<HTMLElement>('.v')!, chip });
    }
    stack.appendChild(ioRow('out', 'rgb · sigmoid'));
    built = n;
  }

  function refresh(): void {
    const n = count();
    if (n !== built) build(n);
    refreshInRow();
    rows.forEach((row, i) => {
      const spec = layerWidthSpec(i);
      const v = api.get(spec.key);
      row.val.textContent = fmtParam(spec, v);
      row.el.style.setProperty('--f', sliderFrac(spec, v).toFixed(4));
      row.el.classList.toggle('locked', api.isLocked(spec.key) || api.isLocked(`layer${i}Act`));
      row.chip.textContent = `${ACT_NAMES[Math.round(api.get(`layer${i}Act`))] ?? 'tanh'} ›`;
    });
    minus.disabled = n <= 1;
    plus.disabled = n >= MAX_LAYERS;
  }

  refresh();
  return { refresh };
}
