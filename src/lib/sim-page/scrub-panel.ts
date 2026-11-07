// src/lib/sim-page/scrub-panel.ts
// Phone control surface: a translucent grouped list of params on the left
// edge of the sim viewport, and the canvas itself as the scrub area. Tap a
// name to select it, then drag anywhere on the canvas: horizontal is coarse,
// vertical is fine. A readout floats above the finger. "Touch" (or tapping
// the active name again) deselects, and the canvas goes back to being the
// sim's own pointer force. Long-press a row to lock it.

import type { UndoHistory } from '../presets/undo-history';
import type { ParamLocks } from '../presets/param-locks';
import type { ParamGroup, ParamSpec, NumSpec } from '../../components/simulations/field-boids/field-boids-spec';

export interface ScrubPanelOpts {
  /** Positioned ancestor of the canvas; the list and overlay are appended here. */
  host: HTMLElement;
  groups: ParamGroup[];
  get(key: string): number;
  set(key: string, value: number): void;
  history?: UndoHistory;
  locks?: ParamLocks;
}

export interface ScrubPanelHandle {
  refresh(): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

const COARSE_PX = 220;      // horizontal travel for the full range
const FINE_RATIO = 0.08;    // vertical travel is this fraction as sensitive
const LONG_PRESS_MS = 450;
const PRESS_SLOP = 8;

function fmt(spec: NumSpec, v: number): string {
  if (spec.int || spec.step >= 1) return String(Math.round(v));
  const dec = String(spec.step).split('.')[1]?.length ?? 2;
  return v.toFixed(dec);
}

function toSlider(spec: NumSpec, v: number): number {
  return spec.scale === 'log' ? Math.log(Math.max(v, spec.min)) : v;
}
function fromSlider(spec: NumSpec, s: number): number {
  let v = spec.scale === 'log' ? Math.exp(s) : s;
  v = Math.round(v / spec.step) * spec.step;
  if (spec.int) v = Math.round(v);
  return Math.min(spec.max, Math.max(spec.min, v));
}

export function createScrubPanel(opts: ScrubPanelOpts): ScrubPanelHandle {
  const { host, groups, get, set, history, locks } = opts;

  const list = document.createElement('div');
  list.className = 'scrub-list';
  const overlay = document.createElement('div');
  overlay.className = 'scrub-overlay';
  overlay.innerHTML = `
    <div class="scrub-guide">
      <div class="g-h"></div><div class="g-v"></div><div class="g-ticks"></div>
      <div class="g-read"><small></small><span class="g-val"></span><div class="g-bar"><i></i></div></div>
    </div>
    <div class="scrub-hint"></div>`;
  host.append(list, overlay);
  const guide = overlay.querySelector<HTMLElement>('.scrub-guide')!;
  const readName = guide.querySelector<HTMLElement>('small')!;
  const readVal = guide.querySelector<HTMLElement>('.g-val')!;
  const readBar = guide.querySelector<HTMLElement>('.g-bar i')!;
  const ticks = guide.querySelector<HTMLElement>('.g-ticks')!;
  const hint = overlay.querySelector<HTMLElement>('.scrub-hint')!;
  ticks.innerHTML = Array.from({ length: 11 }, (_, i) =>
    `<i style="left:${(i - 5) * 22}px;height:${i === 5 ? 12 : 7}px;top:${i === 5 ? -6 : -3}px"></i>`).join('');

  let cur: NumSpec | null = null;
  const rows: Array<{ spec: ParamSpec; el: HTMLElement; val?: HTMLElement; chips?: HTMLElement[] }> = [];

  // ── List ──
  const touchRow = document.createElement('button');
  touchRow.className = 'scrub-row touch';
  touchRow.textContent = '☝ Touch';
  touchRow.addEventListener('click', () => { select(null); });
  list.appendChild(touchRow);

  for (const g of groups) {
    const h = document.createElement('h6');
    h.textContent = g.name;
    list.appendChild(h);
    for (const spec of g.items) {
      if (spec.kind === 'num') {
        const row = document.createElement('button');
        row.className = 'scrub-row';
        row.innerHTML = `<span class="n"><i class="lk"></i>${spec.label}</span><span class="v"></span>`;
        row.addEventListener('click', () => select(cur === spec ? null : spec));
        list.appendChild(row);
        rows.push({ spec, el: row, val: row.querySelector<HTMLElement>('.v')! });
        attachLongPress(row, spec.key as string);
      } else {
        const wrap = document.createElement('div');
        wrap.className = 'scrub-enum';
        wrap.innerHTML = `<span class="n"><i class="lk"></i>${spec.label}</span>`;
        const chipRow = document.createElement('div');
        chipRow.className = 'chips';
        const chips = spec.names.map((name, i) => {
          const c = document.createElement('button');
          c.textContent = name;
          c.addEventListener('click', () => {
            set(spec.key as string, i);
            history?.push(spec.label);
            refresh();
          });
          chipRow.appendChild(c);
          return c;
        });
        wrap.appendChild(chipRow);
        list.appendChild(wrap);
        rows.push({ spec, el: wrap, chips });
        attachLongPress(wrap, spec.key as string);
      }
    }
  }

  function attachLongPress(el: HTMLElement, key: string): void {
    if (!locks) return;
    let timer = 0, x = 0, y = 0;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = 0; } };
    el.addEventListener('pointerdown', (e) => {
      x = e.clientX; y = e.clientY; cancel();
      timer = window.setTimeout(() => {
        timer = 0;
        locks.toggle(key);
        try { navigator.vibrate?.(12); } catch { /* not allowed */ }
      }, LONG_PRESS_MS);
    });
    el.addEventListener('pointermove', (e) => { if (timer && (Math.abs(e.clientX - x) > PRESS_SLOP || Math.abs(e.clientY - y) > PRESS_SLOP)) cancel(); });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function select(spec: NumSpec | null): void {
    cur = spec;
    overlay.classList.toggle('armed', !!cur);
    refresh();
  }

  function refresh(): void {
    touchRow.classList.toggle('on', !cur);
    for (const r of rows) {
      const locked = locks?.isLocked(r.spec.key as string) ?? false;
      r.el.classList.toggle('locked', locked);
      if (r.spec.kind === 'num') {
        r.el.classList.toggle('on', r.spec === cur);
        r.val!.textContent = fmt(r.spec, get(r.spec.key as string));
      } else {
        const v = get(r.spec.key as string);
        r.chips!.forEach((c, i) => c.classList.toggle('on', i === v));
      }
    }
    hint.innerHTML = cur
      ? `<b>${cur.label}</b> · ◀ ▶ coarse · ▲ ▼ fine`
      : 'touch mode · drag to attract';
  }

  // ── Scrub gesture on the overlay (only receives events while armed) ──
  let dragId = -1, sx = 0, sy = 0, ss = 0;
  const place = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    guide.style.setProperty('--x', `${e.clientX - r.left}px`);
    guide.style.setProperty('--y', `${e.clientY - r.top}px`);
  };
  const showRead = (v: number) => {
    if (!cur) return;
    readName.textContent = cur.label.toUpperCase();
    readVal.textContent = fmt(cur, v);
    const t = (toSlider(cur, v) - toSlider(cur, cur.min)) / (toSlider(cur, cur.max) - toSlider(cur, cur.min));
    readBar.style.transform = `scaleX(${Math.max(0, Math.min(1, t))})`;
  };
  overlay.addEventListener('pointerdown', (e) => {
    if (!cur || dragId !== -1) return;
    dragId = e.pointerId; sx = e.clientX; sy = e.clientY;
    ss = toSlider(cur, get(cur.key as string));
    try { overlay.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    history?.beginGesture(cur.label);
    place(e); showRead(get(cur.key as string));
    guide.classList.add('show');
    e.preventDefault();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId || !cur) return;
    e.preventDefault();
    const range = toSlider(cur, cur.max) - toSlider(cur, cur.min);
    const dx = e.clientX - sx, dy = -(e.clientY - sy);
    const s = ss + (dx / COARSE_PX) * range + (dy / COARSE_PX) * range * FINE_RATIO;
    const v = fromSlider(cur, Math.min(toSlider(cur, cur.max), Math.max(toSlider(cur, cur.min), s)));
    set(cur.key as string, v);
    history?.touch();
    place(e); showRead(v); refresh();
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return;
    dragId = -1;
    guide.classList.remove('show');
    history?.endGesture();
  };
  overlay.addEventListener('pointerup', end);
  overlay.addEventListener('pointercancel', end);

  const unsubLocks = locks?.subscribe(refresh);
  refresh();

  return {
    refresh,
    setVisible(on) { list.hidden = !on; overlay.hidden = !on; if (!on) select(null); },
    dispose() { unsubLocks?.(); list.remove(); overlay.remove(); },
  };
}
