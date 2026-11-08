// src/lib/sim-page/meter-row.ts
// Desktop one-line param row: name left, value right, and a faint fill
// behind the row showing where the value sits in its range. Drag anywhere
// on the row to scrub (shift = fine); click the number, ctrl-click the row
// or double-click the value to type it; alt-click toggles the lock. The wheel is left alone so it scrolls the panel.

import type { UndoHistory } from '../presets/undo-history';
import type { ParamLockBinding } from '../presets/param-locks';
import { fmtParam, fromSlider, sliderFrac, toSlider, type NumRange } from './param-math';

export interface MeterRowOpts extends NumRange {
  label: string;
  get(): number;
  set(v: number): void;
  history?: UndoHistory;
  lock?: ParamLockBinding;
  /** Called after any change; the default refreshes this row only. */
  onChange?: () => void;
}

export interface MeterRowHandle {
  el: HTMLElement;
  refresh(): void;
  dispose(): void;
}

const ROW_PX = 240;         // horizontal travel for the full range
const FINE = 0.12;          // shift: this fraction as sensitive
const SLOP = 4;

export function createMeterRow(container: HTMLElement, o: MeterRowOpts): MeterRowHandle {
  const row = document.createElement('div');
  row.className = 'meter-row';
  row.innerHTML = `<span class="n"><i class="lk"></i>${o.label}</span><span class="v" tabindex="0"></span>`;
  container.appendChild(row);
  const valEl = row.querySelector<HTMLElement>('.v')!;

  const refresh = () => {
    const v = o.get();
    valEl.textContent = fmtParam(o, v);
    row.style.setProperty('--f', sliderFrac(o, v).toFixed(4));
    row.classList.toggle('locked', o.lock?.locks.isLocked(o.lock.key) ?? false);
  };

  const commit = (v: number) => {
    o.set(v);
    o.onChange?.();
    refresh();
  };

  // ── Drag to scrub ──
  let id = -1, x0 = 0, s0 = 0, active = false, suppressClick = false, downOnValue = false;
  row.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.altKey || (e.target as HTMLElement).tagName === 'INPUT') return;
    id = e.pointerId; x0 = e.clientX; active = false;
    // Capture retargets the later click to the row, so remember the press target here.
    downOnValue = !!(e.target as HTMLElement).closest('.v');
    s0 = toSlider(o, o.get());
    try { row.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  });
  row.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0;
    if (!active) {
      if (Math.abs(dx) < SLOP) return;
      active = true; suppressClick = true;
      row.classList.add('dragging');
      o.history?.beginGesture(o.label);
    }
    e.preventDefault();
    const range = toSlider(o, o.max) - toSlider(o, o.min);
    const k = e.shiftKey ? FINE : 1;
    const s = Math.min(toSlider(o, o.max), Math.max(toSlider(o, o.min), s0 + (dx / ROW_PX) * range * k));
    o.set(fromSlider(o, s));
    o.history?.touch();
    o.onChange?.();
    refresh();
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = -1;
    if (active) { active = false; row.classList.remove('dragging'); o.history?.endGesture(); }
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);

  // ── Click: alt locks, ctrl/cmd (or a plain click on the number) types ──
  row.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    if (e.altKey && o.lock) { e.preventDefault(); o.lock.locks.toggle(o.lock.key); refresh(); return; }
    if (e.ctrlKey || e.metaKey || downOnValue) { e.preventDefault(); edit(); }
  });

  // ── Double-click the value to type it ──
  function edit(): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'v-edit';
    input.value = fmtParam(o, o.get()).replace(/ /g, '');
    valEl.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = (apply: boolean) => {
      if (done) return; done = true;
      if (apply) {
        const n = parseFloat(input.value.replace(/[^\d.eE+-]/g, ''));
        if (Number.isFinite(n)) { o.history?.endGesture(); commit(fromSlider(o, toSlider(o, Math.min(o.max, Math.max(o.min, n))))); o.history?.push(o.label); }
      }
      input.replaceWith(valEl);
      refresh();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  valEl.addEventListener('dblclick', (e) => { e.stopPropagation(); edit(); });
  valEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') edit(); });

  const unsub = o.lock?.locks.subscribe(refresh);
  refresh();
  return { el: row, refresh, dispose() { unsub?.(); row.remove(); } };
}
