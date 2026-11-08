// src/lib/sim-page/scrub-panel.ts
// Phone control surface: a translucent grouped list of params on the left
// edge of the sim viewport, and the canvas itself as the scrub area. Tap a
// name to select it, then drag anywhere on the canvas: horizontal is coarse,
// vertical is fine. While a param is selected the list collapses to a chip
// (name, value, range) so the sim stays visible; a plain tap on the canvas
// or ‹ returns to the list. With the list closed the canvas is the sim's own
// pointer force, and a plain tap on it closes the list. Dragging sideways on
// a row scrubs that param in place (vertical still scrolls). Long-press a row (or
// tap the chip's name) to lock it. The card header (undo/redo, Presets,
// Randomize) stays put while the body scrolls; Presets swaps the body for
// the shared preset section inside the same card.

import type { UndoHistory } from '../presets/undo-history';
import type { ParamLocks } from '../presets/param-locks';
import type { ParamGroup, ParamSpec, NumSpec, EnumSpec, CustomRowApi } from './param-spec';
import { fmtParam as fmt, toSlider, fromSlider, sliderFrac } from './param-math';

export interface ScrubPanelOpts {
  /** Positioned ancestor of the canvas; the list and overlay are appended here. */
  host: HTMLElement;
  groups: ParamGroup[];
  get(key: string): number;
  set(key: string, value: number): void;
  /** The params object, for showIf predicates. */
  params: unknown;
  history?: UndoHistory;
  locks?: ParamLocks;
  /** Fills the in-card Presets view; returns a dispose function. */
  buildPresets?: (container: HTMLElement) => () => void;
  onRandomize?: () => void;
  /** Optional status text shown under an enum row (e.g. "permission denied"). */
  note?: (key: string) => string;
  /** Called by × and by a plain tap on the canvas while the list is open. */
  onClose?: () => void;
}

export interface ScrubPanelHandle {
  refresh(): void;
  /** Re-render the Presets view (after a preset load / save / rename). */
  rebuildPresets(): void;
  setVisible(on: boolean): void;
  isVisible(): boolean;
  dispose(): void;
}

const COARSE_PX = 220;      // horizontal travel for the full range
const ROW_PX = 240;         // same, for a drag that starts on a list row
const FINE_RATIO = 0.08;    // vertical travel is this fraction as sensitive
const LONG_PRESS_MS = 450;
const PRESS_SLOP = 8;

type Row = { spec: ParamSpec; el: HTMLElement; val?: HTMLElement; choices?: HTMLElement[]; select?: HTMLSelectElement };

export function createScrubPanel(opts: ScrubPanelOpts): ScrubPanelHandle {
  const { host, groups, get, set, history, locks } = opts;
  const params = opts.params as never;

  const list = document.createElement('div');
  list.className = 'scrub-list';
  const scroll = document.createElement('div');
  scroll.className = 'scrub-scroll';
  const body = document.createElement('div');
  body.className = 'scrub-body';
  const presetsEl = document.createElement('div');
  presetsEl.className = 'scrub-presets';
  presetsEl.hidden = true;
  scroll.append(body, presetsEl);
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
  let visible = true;
  const rows: Row[] = [];

  // ── Header: undo / redo · presets · close ──
  const head = document.createElement('div');
  head.className = 'scrub-head';
  head.innerHTML = `<button class="h-undo" aria-label="Undo">↶</button><button class="h-redo" aria-label="Redo">↷</button><button class="h-presets">Presets ›</button><button class="h-random">⚄ Randomize</button>`;
  list.append(head, scroll);
  let presetsMode = false;
  let disposePresets: (() => void) | null = null;
  const presetsBtn = head.querySelector<HTMLButtonElement>('.h-presets')!;
  function rebuildPresets(): void {
    disposePresets?.(); disposePresets = null;
    presetsEl.innerHTML = '';
    if (opts.buildPresets && presetsMode) disposePresets = opts.buildPresets(presetsEl);
  }
  function setPresetsMode(on: boolean): void {
    presetsMode = on;
    list.classList.toggle('presets-mode', on);
    body.hidden = on;
    presetsEl.hidden = !on;
    presetsBtn.textContent = on ? '‹ Params' : 'Presets ›';
    rebuildPresets();
    scroll.scrollTop = 0;
  }
  const undoBtn = head.querySelector<HTMLButtonElement>('.h-undo')!;
  const redoBtn = head.querySelector<HTMLButtonElement>('.h-redo')!;
  undoBtn.addEventListener('click', () => history?.undo());
  redoBtn.addEventListener('click', () => history?.redo());
  presetsBtn.addEventListener('click', () => setPresetsMode(!presetsMode));
  head.querySelector('.h-random')!.addEventListener('click', () => { opts.onRandomize?.(); refresh(); });
  const refreshHistory = () => {
    undoBtn.disabled = !history?.canUndo();
    redoBtn.disabled = !history?.canRedo();
  };

  // Selecting a param collapses the list to this chip so the canvas is
  // visible while scrubbing. ‹ or a plain tap on the canvas returns to the list.
  const chip = document.createElement('div');
  chip.className = 'scrub-chip';
  chip.innerHTML = `<div class="c-top"><button class="c-back" aria-label="All params">‹</button><span class="c-name"></span><i class="lk"></i></div>
    <div class="c-val"></div><div class="c-bar"><i></i></div><div class="c-range"><span class="c-min"></span><span class="c-max"></span></div>`;
  chip.hidden = true;
  host.appendChild(chip);
  const chipName = chip.querySelector<HTMLElement>('.c-name')!;
  const chipVal = chip.querySelector<HTMLElement>('.c-val')!;
  const chipBar = chip.querySelector<HTMLElement>('.c-bar i')!;
  chip.querySelector('.c-back')!.addEventListener('click', () => select(null));
  chip.querySelector<HTMLElement>('.c-top')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.c-back')) return;
    if (cur && locks) locks.toggle(cur.key as string);
  });

  const groupNotes: Array<{ g: ParamGroup; el: HTMLElement }> = [];
  const customBlocks: Array<{ refresh(): void }> = [];
  const customApi: CustomRowApi = {
    get, set,
    commit: (label) => { history?.push(label); refresh(); },
    attachRowDrag: (row, spec) => attachRowDrag(row, spec),
    attachLongPress: (el, key) => attachLongPress(el, key),
    isLocked: (key) => locks?.isLocked(key) ?? false,
    refresh: () => refresh(),
  };
  for (const g of groups) {
    const h = document.createElement('h6');
    h.textContent = g.name;
    body.appendChild(h);
    if (g.note) {
      const n = document.createElement('small');
      n.className = 'scrub-group-note';
      body.appendChild(n);
      groupNotes.push({ g, el: n });
    }
    if (g.render) {
      const c = document.createElement('div');
      c.className = 'scrub-custom';
      body.appendChild(c);
      customBlocks.push(g.render(c, customApi));
    }
    for (const spec of g.items) {
      if (spec.kind === 'num') {
        const row = document.createElement('button');
        row.className = 'scrub-row';
        row.innerHTML = `<span class="n"><i class="lk"></i>${spec.label}</span><span class="v"></span>`;
        row.addEventListener('click', () => { if (!swallowClick) select(cur === spec ? null : spec); swallowClick = false; });
        body.appendChild(row);
        rows.push({ spec, el: row, val: row.querySelector<HTMLElement>('.v')! });
        attachLongPress(row, spec.key as string);
        attachRowDrag(row, spec);
      } else {
        rows.push(buildEnum(spec));
      }
    }
  }

  function buildEnum(spec: EnumSpec): Row {
    const wrap = document.createElement('div');
    wrap.className = `scrub-enum ui-${spec.ui}`;
    wrap.innerHTML = `<span class="n"><i class="lk"></i>${spec.label}</span>`;
    const note = document.createElement('small');
    note.className = 'note';
    const pick = (i: number) => {
      set(spec.key as string, i);
      history?.push(spec.label);
      refresh();
    };
    const row: Row = { spec, el: wrap };
    if (spec.ui === 'cycle') {
      // Same one-line shape as a numeric row: label left, current name right.
      const btn = document.createElement('button');
      btn.className = 'scrub-row scrub-cycle';
      btn.innerHTML = `<span class="n"><i class="lk"></i>${spec.label}</span><span class="v"></span>`;
      btn.addEventListener('click', () => pick((Math.round(get(spec.key as string)) + 1) % spec.names.length));
      body.appendChild(btn);
      attachLongPress(btn, spec.key as string);
      return { spec, el: btn, val: btn.querySelector<HTMLElement>('.v')! };
    }
    if (spec.ui === 'select') {
      const sel = document.createElement('select');
      spec.names.forEach((name, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = name; sel.appendChild(o); });
      sel.addEventListener('change', () => pick(+sel.value));
      wrap.appendChild(sel);
      row.select = sel;
      wrap.appendChild(note);
    } else {
      const bar = document.createElement('div');
      bar.className = spec.ui === 'swatches' ? 'swatches' : 'segmented';
      row.choices = spec.names.map((name, i) => {
        const c = document.createElement('button');
        if (spec.ui === 'swatches') { c.className = 'sw'; c.title = name; c.style.background = spec.colors?.[i] ?? 'currentColor'; }
        else c.textContent = name;
        c.addEventListener('click', () => pick(i));
        bar.appendChild(c);
        return c;
      });
      wrap.appendChild(bar);
      wrap.appendChild(note);
    }
    body.appendChild(wrap);
    attachLongPress(wrap, spec.key as string);
    return row;
  }

  // Sideways drag on a row: a mini slider. The tap-to-select click is
  // swallowed once a drag has started; the long-press cancels itself on slop.
  let swallowClick = false;
  function attachRowDrag(row: HTMLElement, spec: NumSpec): void {
    let id = -1, x0 = 0, y0 = 0, s0 = 0, active = false;
    row.addEventListener('pointerdown', (e) => {
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; active = false;
      swallowClick = false;   // a touch drag fires no click, so never carry the flag over
      s0 = toSlider(spec, get(spec.key as string));
      // Capture at once: the finger leaves the 25px row long before the
      // drag is recognised. A vertical pan still cancels (touch-action: pan-y).
      try { row.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    });
    row.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (!active) {
        if (Math.abs(dx) < PRESS_SLOP || Math.abs(dx) < Math.abs(dy)) return;
        active = true; swallowClick = true;
        row.classList.add('dragging');
        history?.beginGesture(spec.label);
      }
      e.preventDefault();
      const range = toSlider(spec, spec.max) - toSlider(spec, spec.min);
      const s = Math.min(toSlider(spec, spec.max), Math.max(toSlider(spec, spec.min), s0 + (dx / ROW_PX) * range));
      set(spec.key as string, fromSlider(spec, s));
      history?.touch();
      refresh();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      if (active) { active = false; row.classList.remove('dragging'); history?.endGesture(); }
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', (e) => { end(e); swallowClick = false; });
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
    list.hidden = !visible || !!cur;
    chip.hidden = !visible || !cur;
    refresh();
  }

  const frac = sliderFrac;

  function refresh(): void {
    for (const r of rows) {
      const locked = locks?.isLocked(r.spec.key as string) ?? false;
      r.el.classList.toggle('locked', locked);
      r.el.hidden = r.spec.showIf ? !r.spec.showIf(params) : false;
      const v = get(r.spec.key as string);
      if (r.spec.kind === 'num') {
        r.el.classList.toggle('on', r.spec === cur);
        r.val!.textContent = fmt(r.spec, v);
        r.el.style.setProperty('--f', frac(r.spec, v).toFixed(4));   // value meter behind the row
      } else if (r.spec.ui === 'cycle') {
        r.val!.textContent = r.spec.names[Math.round(v)] ?? '';
      } else if (r.select) {
        r.select.value = String(v);
      } else {
        r.choices!.forEach((c, i) => c.classList.toggle('on', i === v));
      }
      if (r.spec.kind === 'enum' && r.spec.ui !== 'cycle') {
        const n = r.el.querySelector<HTMLElement>('.note')!;
        n.textContent = opts.note?.(r.spec.key as string) ?? '';
        n.hidden = !n.textContent;
      }
    }
    if (cur?.showIf && !cur.showIf(params)) { select(null); return; }
    if (cur) {
      const v = get(cur.key as string);
      chipName.textContent = cur.label;
      chipVal.textContent = fmt(cur, v);
      chipBar.style.transform = `scaleX(${frac(cur, v)})`;
      chip.querySelector<HTMLElement>('.c-min')!.textContent = fmt(cur, cur.min);
      chip.querySelector<HTMLElement>('.c-max')!.textContent = fmt(cur, cur.max);
      chip.classList.toggle('locked', locks?.isLocked(cur.key as string) ?? false);
    }
    for (const { g, el } of groupNotes) el.textContent = g.note!();
    for (const b of customBlocks) b.refresh();
    hint.innerHTML = '<b>◀ ▶</b> coarse · <b>▲ ▼</b> fine · tap to finish';
    refreshHistory();
  }

  // ── Scrub gesture on the overlay (only receives events while armed) ──
  let dragId = -1, sx = 0, sy = 0, ss = 0, moved = false;
  const place = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    guide.style.setProperty('--x', `${e.clientX - r.left}px`);
    guide.style.setProperty('--y', `${e.clientY - r.top}px`);
  };
  const showRead = (v: number) => {
    if (!cur) return;
    readName.textContent = cur.label.toUpperCase();
    readVal.textContent = fmt(cur, v);
    readBar.style.transform = `scaleX(${frac(cur, v)})`;
  };
  overlay.addEventListener('pointerdown', (e) => {
    if (!cur || dragId !== -1) return;
    dragId = e.pointerId; sx = e.clientX; sy = e.clientY; moved = false;
    ss = toSlider(cur, get(cur.key as string));
    try { overlay.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    history?.beginGesture(cur.label);
    place(e); showRead(get(cur.key as string));
    e.preventDefault();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId || !cur) return;
    e.preventDefault();
    const range = toSlider(cur, cur.max) - toSlider(cur, cur.min);
    const dx = e.clientX - sx, dy = -(e.clientY - sy);
    if (!moved && Math.abs(dx) < PRESS_SLOP && Math.abs(dy) < PRESS_SLOP) return;
    if (!moved) { moved = true; guide.classList.add('show'); }
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
    if (!moved) select(null);          // plain tap: done with this param
  };
  overlay.addEventListener('pointerup', end);
  overlay.addEventListener('pointercancel', end);
  // iOS: stop the page from treating the drag as a scroll or long-press.
  overlay.addEventListener('touchstart', (e) => { if (cur) e.preventDefault(); }, { passive: false });
  overlay.addEventListener('touchmove', (e) => { if (cur) e.preventDefault(); }, { passive: false });
  overlay.addEventListener('contextmenu', (e) => e.preventDefault());

  // A plain tap on the canvas (no drag) while the list is open closes it.
  let tapId = -1, tx = 0, ty = 0, tt = 0;
  host.addEventListener('pointerdown', (e) => {
    if (!visible || cur || (e.target as HTMLElement).tagName !== 'CANVAS') return;
    tapId = e.pointerId; tx = e.clientX; ty = e.clientY; tt = performance.now();
  });
  host.addEventListener('pointerup', (e) => {
    if (e.pointerId !== tapId) return;
    tapId = -1;
    if (Math.abs(e.clientX - tx) < PRESS_SLOP && Math.abs(e.clientY - ty) < PRESS_SLOP && performance.now() - tt < 350) opts.onClose?.();
  });
  host.addEventListener('pointercancel', () => { tapId = -1; });

  const unsubLocks = locks?.subscribe(refresh);
  const unsubHistory = history?.subscribe(refreshHistory);
  refresh();

  return {
    refresh,
    rebuildPresets,
    isVisible: () => visible,
    setVisible(on) { visible = on; overlay.hidden = !on; select(null); },
    dispose() { unsubLocks?.(); unsubHistory?.(); disposePresets?.(); list.remove(); chip.remove(); overlay.remove(); },
  };
}
