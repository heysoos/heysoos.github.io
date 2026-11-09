// Phone inputs mode: a band over the bottom of the canvas (300px at rest,
// 440px while editing, never the full screen). Three views — list (rows +
// tiles, normalize toggle), edit (rendered field + the band's own keypad +
// function drawer, so the phone keyboard never opens) and generator
// (complexity · presets · two-level histogram). Gestures: swipe right from
// the left edge = back, swipe down on the header = close, swipe left on a
// row = delete, long-press a row / tile = lock.
import type { InputsApi } from './cppn-inputs-panel';
import { buildGeneratorBlock } from './cppn-generator-ui';
import { OPS, VARS, GROUP_COLORS, opByName, type ExprGroup } from './cppn-expr/optable';
import { paintThumb } from './cppn-expr/thumb';
import { MAX_INPUTS } from './cppn-expr/compile';
import { DICE_SVG } from '../../../lib/sim-page/icons';

export interface InputsBandApi extends InputsApi {
  /** ‹ from the list / edge swipe from the list: leave inputs mode (the scrub card returns). */
  onBack(): void;
  /** Header swipe-down: close the band entirely. */
  onClose(): void;
}

export interface InputsBandHandle {
  show(): void;
  hide(): void;
  isVisible(): boolean;
  refresh(): void;
  dispose(): void;
}

type View = 'list' | 'edit' | 'generator';
const LONG_PRESS_MS = 480;
const SLOP = 8;
const EDGE_PX = 28, BACK_PX = 70, CLOSE_PX = 60;
const KEYS: string[][] = [
  ['x', 'y', 'r', 'a', 't', 'px', 'py'],
  ['7', '8', '9', '(', ')', ',', '^'],
  ['4', '5', '6', '+', '−', '×', '÷'],
  ['1', '2', '3', '.', '←', '→', '⌫'],
  ['0', 'pi', 'ƒ', 'done'],
];
const VAR_RE = /^(x|y|r|a|t|px|py|pi|e)$/;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function createInputsBand(host: HTMLElement, api: InputsBandApi): InputsBandHandle {
  const band = document.createElement('div');
  band.className = 'inputs-band';
  band.hidden = true;
  band.innerHTML = `
    <div class="band-edge"></div>
    <div class="band-head">
      <button class="b-back" aria-label="Back">‹</button><span class="b-title">Inputs</span>
      <span class="look-segmented b-views"><button data-view="list" class="on">list</button><button data-view="generator">generator</button></span>
      <span style="flex:1"></span>
      <button class="b-random" title="Fresh expressions for every unlocked input">${DICE_SVG}<span>inputs</span></button>
    </div>
    <div class="band-body">
      <div class="band-view v-list"></div>
      <div class="band-view v-edit" hidden></div>
      <div class="band-view v-generator" hidden></div>
    </div>`;
  host.appendChild(band);
  const head = band.querySelector<HTMLElement>('.band-head')!;
  const vList = band.querySelector<HTMLElement>('.v-list')!;
  const vEdit = band.querySelector<HTMLElement>('.v-edit')!;
  const vGen = band.querySelector<HTMLElement>('.v-generator')!;
  const viewBtns = [...band.querySelectorAll<HTMLButtonElement>('.b-views button')];
  let view: View = 'list';
  let visible = false;
  const vibrate = () => { try { navigator.vibrate?.(8); } catch { /* not allowed */ } };
  const dyn = () => api.dynamicVars?.() ?? { t: 0, px: 0, py: 0 };

  function setView(v: View): void {
    if (view === 'edit' && v !== 'edit') finishEdit();
    view = v;
    vList.hidden = v !== 'list'; vEdit.hidden = v !== 'edit'; vGen.hidden = v !== 'generator';
    band.classList.toggle('edit', v === 'edit');
    viewBtns.forEach(b => b.classList.toggle('on', b.dataset.view === (v === 'edit' ? 'list' : v)));
    if (v === 'list') renderList();
    if (v === 'generator') gen.refresh();
  }
  viewBtns.forEach(b => b.addEventListener('click', () => setView(b.dataset.view as View)));
  band.querySelector('.b-random')!.addEventListener('click', () => { api.randomizeInputs(); refresh(); });
  band.querySelector('.b-back')!.addEventListener('click', () => goBack());

  function goBack(): void {
    if (view === 'generator' && gen.openGroup()) { gen.closeGroup(); return; }
    if (view === 'edit') { setView('list'); return; }
    if (view === 'generator') { setView('list'); return; }
    slideOut('x', () => api.onBack());
  }
  function slideOut(axis: 'x' | 'y', then: () => void): void {
    band.style.transition = 'transform 0.25s ease';
    band.style.transform = axis === 'x' ? 'translateX(110%)' : 'translateY(120%)';
    window.setTimeout(() => { band.style.transition = ''; band.style.transform = ''; hide(); then(); }, 260);
  }

  // ── List view ──
  function renderList(): void {
    const list = api.inputs();
    const results = api.results();
    const d = dyn();
    vList.innerHTML = `<div class="band-two"><div class="band-rows"></div><div class="band-side"><div class="band-sect"><span>all inputs</span><button class="norm-toggle">normalize</button></div><div class="band-tiles"></div><div class="band-hint">tap a row to edit · hold to lock · swipe left to delete</div></div></div>`;
    const rowsEl = vList.querySelector<HTMLElement>('.band-rows')!;
    const tilesEl = vList.querySelector<HTMLElement>('.band-tiles')!;
    const normBtn = vList.querySelector<HTMLButtonElement>('.norm-toggle')!;
    normBtn.classList.toggle('on', api.normalize());
    normBtn.addEventListener('click', () => { api.setNormalize(!api.normalize()); api.commit('Normalize'); renderList(); });
    list.forEach((src, i) => {
      const r = results[i];
      const row = document.createElement('div');
      row.className = 'band-row' + (api.isLocked(i) ? ' locked' : '');
      row.innerHTML = `<canvas width="24" height="24"></canvas><div class="band-row-txt"><div class="f">${src ? esc(src) : '<span class="dim">empty</span>'}</div><div class="m">${r ? (r.ok ? `${r.range.lo.toFixed(2)} … ${r.range.hi.toFixed(2)}${api.normalize() ? ' → −1 … 1' : ''}` : `<span class="err">${esc(r.error.msg)}</span>`) : ''}</div></div><div class="lk">🔒</div><button class="swipe">delete</button>`;
      paintThumb(row.querySelector('canvas')!, src, { normalize: api.normalize(), ...d });
      attachRowGestures(row, i);
      rowsEl.appendChild(row);
      const tile = document.createElement('canvas');
      tile.width = tile.height = 40;
      tile.className = api.isLocked(i) ? 'locked' : '';
      paintThumb(tile, src, { normalize: api.normalize(), ...d });
      attachTileGestures(tile, i);
      tilesEl.appendChild(tile);
    });
    const add = document.createElement('button');
    add.className = 'band-add';
    add.textContent = '+ add input';
    add.disabled = list.length >= MAX_INPUTS;
    add.addEventListener('click', () => { api.addInput(); api.commit('Add input'); openEdit(api.inputs().length - 1); });
    rowsEl.appendChild(add);
  }
  function attachRowGestures(row: HTMLElement, i: number): void {
    let x0 = 0, moved = false, timer = 0, id = -1;
    row.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.swipe')) return;
      id = e.pointerId; x0 = e.clientX; moved = false;
      timer = window.setTimeout(() => { timer = 0; api.setLocked(i, !api.isLocked(i)); vibrate(); renderList(); }, LONG_PRESS_MS);
    });
    row.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > SLOP) { moved = true; if (timer) { clearTimeout(timer); timer = 0; } }
      if (dx < -40) row.classList.add('rev');
      if (dx > 20) row.classList.remove('rev');
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      if (timer) { clearTimeout(timer); timer = 0; if (!moved) { if (row.classList.contains('rev')) row.classList.remove('rev'); else openEdit(i); } }
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', (e) => { if (e.pointerId === id) { id = -1; clearTimeout(timer); timer = 0; } });
    row.querySelector('.swipe')!.addEventListener('click', (e) => { e.stopPropagation(); if (api.inputs().length <= 1) return; api.removeInput(i); api.commit('Remove input'); renderList(); });
    row.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  function attachTileGestures(tile: HTMLElement, i: number): void {
    let timer = 0, fired = false;
    tile.addEventListener('pointerdown', () => { fired = false; timer = window.setTimeout(() => { fired = true; api.setLocked(i, !api.isLocked(i)); vibrate(); renderList(); }, LONG_PRESS_MS); });
    const cancel = () => clearTimeout(timer);
    tile.addEventListener('pointermove', cancel); tile.addEventListener('pointercancel', cancel);
    tile.addEventListener('pointerup', () => { clearTimeout(timer); if (!fired) openEdit(i); });
    tile.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ── Edit view ──
  let cur = -1, src = '', caret = 0, dirty = false;
  vEdit.innerHTML = `
    <div class="band-ed">
      <div><div class="band-field" tabindex="0"></div><div class="band-sig"></div></div>
      <div><canvas class="band-thumb" width="48" height="48"></canvas><div class="band-range"></div></div>
    </div>
    <div class="band-kp"></div>
    <div class="band-drawer" hidden><div class="band-drawer-head">functions <button class="d-close">close</button></div><div class="band-drawer-groups"></div></div>`;
  const field = vEdit.querySelector<HTMLElement>('.band-field')!;
  const sigEl = vEdit.querySelector<HTMLElement>('.band-sig')!;
  const edThumb = vEdit.querySelector<HTMLCanvasElement>('.band-thumb')!;
  const edRange = vEdit.querySelector<HTMLElement>('.band-range')!;
  const kp = vEdit.querySelector<HTMLElement>('.band-kp')!;
  const drawer = vEdit.querySelector<HTMLElement>('.band-drawer')!;
  for (const row of KEYS) for (const k of row) {
    const b = document.createElement('button');
    b.textContent = k === 'ƒ' ? 'ƒ(…)' : k;
    b.className = VAR_RE.test(k) ? 'v' : /^[0-9.]$/.test(k) ? '' : k === 'ƒ' ? 'fn' : k === 'done' ? 'done' : /←|→|⌫/.test(k) ? 'dim' : 'op';
    b.addEventListener('click', () => key(k));
    kp.appendChild(b);
  }
  // function drawer: every function grouped and colour-coded
  const groupsEl = drawer.querySelector<HTMLElement>('.band-drawer-groups')!;
  const DRAWER_GROUPS: Array<[string, ExprGroup, string]> = [['smooth', 'smooth', GROUP_COLORS.smooth], ['discrete', 'discrete', GROUP_COLORS.discrete], ['typed only', 'typed', GROUP_COLORS.spatial]];
  for (const [name, grp, col] of DRAWER_GROUPS) {
    const g = document.createElement('div');
    g.className = 'band-drawer-grp';
    g.innerHTML = `<h5 style="color:${col}">${name}</h5>`;
    const box = document.createElement('div');
    box.className = 'band-drawer-fns';
    for (const op of OPS.filter(o => o.group === grp)) {
      const b = document.createElement('button');
      b.style.setProperty('--col', col);
      b.innerHTML = `${op.name}(<small>${esc(op.desc)}</small>`;
      b.addEventListener('click', () => { implicitMul(); insert(op.name + '()'); caret--; drawer.hidden = true; renderField(); });
      box.appendChild(b);
    }
    g.appendChild(box);
    groupsEl.appendChild(g);
  }
  drawer.querySelector('.d-close')!.addEventListener('click', () => { drawer.hidden = true; });
  // tap in the field moves the caret to the nearest character
  field.addEventListener('pointerdown', (e) => {
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (!range) return;
    let pos = 0;
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node === range.startContainer) { pos += range.startOffset; caret = Math.min(src.length, pos); renderField(); return; }
      pos += node.textContent?.length ?? 0;
    }
  });

  function openEdit(i: number): void {
    cur = i; src = api.inputs()[i] ?? ''; caret = src.length; dirty = false;
    setView('edit');
    renderField();
  }
  function finishEdit(): void {
    if (cur >= 0 && dirty) { api.commit('Input'); dirty = false; }
    drawer.hidden = true;
    cur = -1;
  }
  function insert(t: string): void { src = src.slice(0, caret) + t + src.slice(caret); caret += t.length; }
  /** A variable or function after a digit, `)` or another variable gets a `*` first. */
  function implicitMul(): void {
    const before = src.slice(0, caret);
    const lastWord = before.split(/[^A-Za-z]/).pop() ?? '';
    if (/[0-9.)]$/.test(before) || VAR_RE.test(lastWord)) insert('*');
  }
  function openFn(): { name: string; arg: number } | null {
    const v = src.slice(0, caret);
    let depth = 0, commas = 0;
    for (let i = v.length - 1; i >= 0; i--) {
      const c = v[i];
      if (c === ')') depth++;
      else if (c === '(') {
        if (depth === 0) { let s = i; while (s > 0 && /[A-Za-z0-9_]/.test(v[s - 1])) s--; const name = v.slice(s, i); return opByName(name) ? { name, arg: commas } : null; }
        depth--;
      } else if (c === ',' && depth === 0) commas++;
    }
    return null;
  }
  function key(k: string): void {
    if (k === '⌫') { if (caret > 0) { src = src.slice(0, caret - 1) + src.slice(caret); caret--; } }
    else if (k === '←') caret = Math.max(0, caret - 1);
    else if (k === '→') caret = Math.min(src.length, caret + 1);
    else if (k === ')') { if (src[caret] === ')') caret++; else insert(')'); }
    else if (k === 'ƒ') { drawer.hidden = false; return; }
    else if (k === 'done') { setView('list'); return; }
    else if (VAR_RE.test(k)) { implicitMul(); insert(k); }
    else if (k === '×') insert('*'); else if (k === '÷') insert('/'); else if (k === '−') insert('-');
    else insert(k);
    renderField();
  }
  function renderField(): void {
    if (cur < 0) return;
    const ghost = openFn() && src[caret] !== ')' && !closes(src.slice(caret)) ? '<span class="gh">)</span>' : '';
    field.innerHTML = esc(src.slice(0, caret)) + '<span class="caret"></span>' + esc(src.slice(caret)) + ghost;
    const res = api.setInput(cur, src);
    dirty = true;
    field.classList.toggle('bad', !res.ok);
    paintThumb(edThumb, src, { normalize: api.normalize(), ...dyn() });
    edRange.textContent = res.ok ? `${res.range.lo.toFixed(2)} … ${res.range.hi.toFixed(2)}` : '—';
    const of = openFn();
    if (of) {
      const def = opByName(of.name)!;
      const parts = def.sig.slice(of.name.length + 1, -1).split(', ');
      sigEl.className = 'band-sig';
      sigEl.innerHTML = `${of.name}(${parts.map((p, i) => (i === of.arg ? `<em>${p}</em>` : p)).join(', ')})  <span class="d">${esc(def.desc)}</span>`;
    } else if (!res.ok) { sigEl.className = 'band-sig err'; sigEl.textContent = `${res.error.msg} · at ${res.error.pos + 1}`; }
    else { sigEl.className = 'band-sig'; sigEl.textContent = ''; }
  }
  const closes = (rest: string) => { let d = 0; for (const c of rest) { if (c === '(') d++; else if (c === ')') { if (d === 0) return true; d--; } } return false; };

  // ── Generator view ──
  const genBlock = buildGeneratorBlock(vGen, { settings: () => api.genSettings(), onChange: (s) => api.setGenSettings(s), compact: true });
  const gen = {
    refresh: () => genBlock.refresh(),
    openGroup: () => !!vGen.querySelector<HTMLElement>('.gen-back:not([hidden])'),
    closeGroup: () => vGen.querySelector<HTMLButtonElement>('.gen-back')?.click(),
  };

  // ── Gestures: edge swipe right = back, header swipe down = close ──
  let g0: { x: number; y: number; edge: boolean; head: boolean; id: number } | null = null;
  band.addEventListener('pointerdown', (e) => {
    const r = band.getBoundingClientRect();
    // The histogram's first bar sits in the edge zone: painting wins there (‹ all groups / ‹ remain).
    const edge = e.clientX - r.left < EDGE_PX && !(e.target as HTMLElement).closest('.gen-hist');
    const onHead = !!(e.target as HTMLElement).closest('.band-head') && !(e.target as HTMLElement).closest('button');
    if (!edge && !onHead) return;
    g0 = { x: e.clientX, y: e.clientY, edge, head: onHead, id: e.pointerId };
    try { band.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    band.classList.add('swiping');
    if (edge) { e.stopPropagation(); e.preventDefault(); }
  }, { capture: true });
  band.addEventListener('pointermove', (e) => {
    if (!g0 || e.pointerId !== g0.id) return;
    const dx = e.clientX - g0.x, dy = e.clientY - g0.y;
    if (g0.edge && dx > 0) band.style.transform = `translateX(${dx * 0.6}px)`;
    if (g0.head && dy > 0) band.style.transform = `translateY(${dy * 0.8}px)`;
  });
  const gEnd = (e: PointerEvent) => {
    if (!g0 || e.pointerId !== g0.id) return;
    const dx = e.clientX - g0.x, dy = e.clientY - g0.y;
    band.classList.remove('swiping');
    band.style.transform = '';
    const { edge, head: onHead } = g0;
    g0 = null;
    if (edge && dx > BACK_PX) goBack();
    else if (onHead && dy > CLOSE_PX) { if (view === 'edit') finishEdit(); slideOut('y', () => api.onClose()); }
  };
  band.addEventListener('pointerup', gEnd);
  band.addEventListener('pointercancel', gEnd);
  void head;

  function refresh(): void {
    if (!visible) return;
    if (view === 'list') renderList();
    else if (view === 'edit') { if (cur >= api.inputs().length) setView('list'); else renderField(); }
    else gen.refresh();
  }
  function show(): void { visible = true; band.hidden = false; host.classList.add('band-open'); setView('list'); }
  function hide(): void { if (view === 'edit') finishEdit(); visible = false; band.hidden = true; host.classList.remove('band-open'); }

  // Dynamic thumbnails repaint slowly while the list is up.
  const timer = window.setInterval(() => {
    if (!visible || view !== 'list') return;
    if (api.inputs().some(s => /\b(t|px|py)\b/.test(s))) renderList();
  }, 700);

  return {
    show, hide, refresh,
    isVisible: () => visible,
    dispose() { clearInterval(timer); genBlock.dispose(); band.remove(); host.classList.remove('band-open'); },
  };
}

export { VARS };
