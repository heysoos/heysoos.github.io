// Phone inputs mode: a band over the bottom of the canvas (300px at rest,
// sized to its content while editing, never the full screen). Three views —
// list (rows + tiles, normalize toggle), edit (a real text field for the
// phone's own keyboard, plus variable and function chips; a function chip
// wraps the selection) and generator (complexity · presets · two-level
// histogram). Gestures: swipe left = next tab, swipe right = back, swipe
// down or tap outside = close, long-press a row / tile = lock.
import { termAt } from './cppn-expr/term-select';
import type { InputsApi } from './cppn-inputs-panel';
import { buildGeneratorBlock } from './cppn-generator-ui';
import { OPS, VARS, VAR_DESC, GROUP_COLORS, opByName, type ExprGroup } from './cppn-expr/optable';
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
const BACK_PX = 70, CLOSE_PX = 60;
const VAR_RE = /^(x|y|r|a|t|px|py|pi|e)$/;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function createInputsBand(host: HTMLElement, api: InputsBandApi): InputsBandHandle {
  const band = document.createElement('div');
  band.className = 'inputs-band';
  band.hidden = true;
  band.innerHTML = `
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
  const body = band.querySelector<HTMLElement>('.band-body')!;
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
    requestAnimationFrame(markScrollers);
    if (v === 'generator') gen.refresh();
  }
  viewBtns.forEach(b => b.addEventListener('click', () => { const v = b.dataset.view as View; if (v !== view) { settle(v === 'generator' ? 'left' : 'right'); setView(v); } }));
  band.querySelector('.b-random')!.addEventListener('click', () => { api.randomizeInputs(); refresh(); });
  band.querySelector('.b-back')!.addEventListener('click', () => goBack());

  function goBack(): void {
    if (view === 'generator' && gen.openGroup()) { gen.closeGroup(); return; }
    if (view === 'edit') { setView('list'); return; }
    if (view === 'generator') { setView('list'); return; }
    hide(); api.onBack();
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
    // keep both columns' scroll across the rebuild
    const prevScroll = [...vList.querySelectorAll<HTMLElement>('.band-two > div')].map(el => el.scrollTop);
    vList.innerHTML = `<div class="band-two"><div class="band-rows"></div><div class="band-side"><div class="band-sect"><span>all inputs</span><button class="norm-toggle">normalize</button></div><div class="band-tiles"></div><div class="band-hint">tap a row to edit · hold to lock · × removes</div></div></div>`;
    const rowsEl = vList.querySelector<HTMLElement>('.band-rows')!;
    const tilesEl = vList.querySelector<HTMLElement>('.band-tiles')!;
    const normBtn = vList.querySelector<HTMLButtonElement>('.norm-toggle')!;
    normBtn.classList.toggle('on', api.normalize());
    normBtn.addEventListener('click', () => { api.setNormalize(!api.normalize()); api.commit('Normalize'); renderList(); });
    list.forEach((src, i) => {
      const r = results[i];
      const row = document.createElement('div');
      row.className = 'band-row' + (api.isLocked(i) ? ' locked' : '');
      row.innerHTML = `<canvas width="24" height="24"></canvas><div class="band-row-txt"><div class="f">${src ? esc(src) : '<span class="dim">empty</span>'}</div><div class="m">${r ? (r.ok ? `${r.range.lo.toFixed(2)} … ${r.range.hi.toFixed(2)}${api.normalize() ? ' → −1 … 1' : ''}` : `<span class="err">${esc(r.error.msg)}</span>`) : ''}</div></div><div class="lk"></div><button class="swipe" aria-label="Remove input" title="Remove input">×</button>`;
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
    add.addEventListener('click', () => {
      // a fresh random expression, no editor: tap the row to change it
      api.addInput(); api.commit('Add input');
      const rowsNow = vList.querySelector<HTMLElement>('.band-rows');
      if (rowsNow) rowsNow.scrollTop = rowsNow.scrollHeight;   // the new row (and + add) in view
    });
    rowsEl.appendChild(add);
    [...vList.querySelectorAll<HTMLElement>('.band-two > div')].forEach((el, k) => { if (prevScroll[k]) el.scrollTop = prevScroll[k]; });
    // mark now, not on the next timer tick: touch-action is read when the
    // finger lands, so an unmarked list ignores the first drag
    if (visible) markScrollers();
  }
  function attachRowGestures(row: HTMLElement, i: number): void {
    // A tap opens the editor from the click, not the pointerup: the touch's
    // compatibility mousedown comes after pointerup and would blur a field
    // focused there, so the keyboard would never come up.
    let x0 = 0, y0 = 0, moved = false, timer = 0, id = -1, tap = false;
    row.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.swipe')) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; moved = false; tap = false;
      timer = window.setTimeout(() => { timer = 0; api.setLocked(i, !api.isLocked(i)); vibrate(); renderList(); }, LONG_PRESS_MS);
    });
    row.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      // any drag (a scroll as much as a swipe) means this was not a tap
      if (Math.hypot(e.clientX - x0, e.clientY - y0) > SLOP) { moved = true; if (timer) { clearTimeout(timer); timer = 0; } }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      if (timer) { clearTimeout(timer); timer = 0; tap = !moved; }
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('click', () => { if (tap) { tap = false; openEdit(i); } });
    row.addEventListener('pointercancel', (e) => { if (e.pointerId === id) { id = -1; clearTimeout(timer); timer = 0; } });
    row.querySelector('.swipe')!.addEventListener('click', (e) => { e.stopPropagation(); if (api.inputs().length <= 1) return; api.removeInput(i); api.commit('Remove input'); renderList(); });
    row.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  function attachTileGestures(tile: HTMLElement, i: number): void {
    let timer = 0, fired = false, moved = false, x0 = 0, y0 = 0, tap = false;
    tile.addEventListener('pointerdown', (e) => { fired = false; moved = false; tap = false; x0 = e.clientX; y0 = e.clientY; timer = window.setTimeout(() => { fired = true; api.setLocked(i, !api.isLocked(i)); vibrate(); renderList(); }, LONG_PRESS_MS); });
    tile.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > SLOP) { moved = true; clearTimeout(timer); } });
    tile.addEventListener('pointercancel', () => { moved = true; clearTimeout(timer); });
    tile.addEventListener('pointerup', () => { clearTimeout(timer); tap = !fired && !moved; });
    tile.addEventListener('click', () => { if (tap) { tap = false; openEdit(i); } });   // see attachRowGestures
    tile.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ── Edit view: a real text field (the phone's own keyboard, selection,
  // cut/paste) plus chips for what a keyboard lacks: the variables and the
  // functions. A function chip wraps the current selection, or opens `fn(|)`.
  let cur = -1, dirty = false;
  vEdit.innerHTML = `
    <div class="band-ed">
      <div><textarea class="band-field" rows="2" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off" enterkeyhint="done" placeholder="expression in x y r a t px py"></textarea><div class="band-sig"></div></div>
      <div><canvas class="band-thumb" width="48" height="48"></canvas><div class="band-range"></div></div>
    </div>
    <div class="band-chips">
      <div class="band-vars"></div>
      <div class="band-fns"></div>
      <div class="band-ed-actions"><span class="band-ed-hint">tap a function or bracket to select its term, then a function to wrap it</span><button class="done">done</button></div>
    </div>`;
  const field = vEdit.querySelector<HTMLTextAreaElement>('.band-field')!;
  const sigEl = vEdit.querySelector<HTMLElement>('.band-sig')!;
  const edThumb = vEdit.querySelector<HTMLCanvasElement>('.band-thumb')!;
  const edRange = vEdit.querySelector<HTMLElement>('.band-range')!;
  const varsEl = vEdit.querySelector<HTMLElement>('.band-vars')!;
  const fnsEl = vEdit.querySelector<HTMLElement>('.band-fns')!;
  const keepFocus = (b: HTMLElement) => b.addEventListener('pointerdown', (e) => e.preventDefault());   // chips never steal the keyboard
  for (const v of [...VARS, 'pi', 'e']) {
    const b = document.createElement('button');
    b.textContent = v; b.className = 'v'; b.title = (VAR_DESC as Record<string, string>)[v] ?? (v === 'pi' ? 'π' : "Euler's number");
    keepFocus(b);
    b.addEventListener('click', () => { const [a, z] = sel(); const before = field.value.slice(0, a); const t = (needsMul(before) ? '*' : '') + v; replaceRange(a, z, t, a + t.length); });
    varsEl.appendChild(b);
  }
  const CHIP_GROUPS: Array<[ExprGroup, string]> = [['smooth', GROUP_COLORS.smooth], ['discrete', GROUP_COLORS.discrete], ['typed', GROUP_COLORS.spatial]];
  for (const [grp, col] of CHIP_GROUPS) {
    for (const op of OPS.filter(o => o.group === grp)) {
      const b = document.createElement('button');
      b.className = 'f'; b.style.setProperty('--col', col); b.textContent = op.name; b.title = `${op.sig} — ${op.desc}`;
      keepFocus(b);
      b.addEventListener('click', () => {
        const [a, z] = sel();
        const inner = field.value.slice(a, z);
        const before = field.value.slice(0, a);
        const t = (needsMul(before) ? '*' : '') + op.name + '(' + inner + ')';
        // caret: inside the parens when nothing was wrapped, after them otherwise
        const caret = inner ? a + t.length : a + t.length - 1;
        replaceRange(a, z, t, caret);
      });
      fnsEl.appendChild(b);
    }
  }
  const doneBtn = vEdit.querySelector<HTMLButtonElement>('.done')!;
  keepFocus(doneBtn);
  doneBtn.addEventListener('click', () => setView('list'));

  const sel = (): [number, number] => [Math.min(field.selectionStart, field.selectionEnd), Math.max(field.selectionStart, field.selectionEnd)];
  /** A variable or function right after a digit, `)` or a variable reads as a product. */
  const needsMul = (before: string): boolean => { const last = before.split(/[^A-Za-z]/).pop() ?? ''; return /[0-9.)]$/.test(before) || VAR_RE.test(last); };
  function replaceRange(a: number, z: number, text: string, caret: number): void {
    field.setRangeText(text, a, z, 'end');
    field.setSelectionRange(caret, caret);
    field.focus({ preventScroll: true });
    onEdited();
  }
  field.addEventListener('input', onEdited);
  field.addEventListener('keydown', (e) => {
    e.stopPropagation();   // page keys (P / R / H / ?) stay out while typing
    if (e.key === 'Enter') { e.preventDefault(); setView('list'); }
    else if (e.key === 'Escape') { e.preventDefault(); setView('list'); }
  });
  // where the caret sits decides which signature to show
  field.addEventListener('selectionchange', () => renderStatus());
  field.addEventListener('click', () => { renderStatus(); window.setTimeout(selectTermOnTap, 0); });
  // Tap-to-select: the first tap on a function name or a paren selects the
  // whole term (to wrap it or delete it); a tap inside that selection is a
  // plain caret again. The timeout lets the browser place its caret first.
  let termSel: [number, number] | null = null;
  function selectTermOnTap(): void {
    const a = field.selectionStart, z = field.selectionEnd;
    if (a !== z) { termSel = null; return; }   // the phone's own selection (double tap, long press)
    if (termSel && a >= termSel[0] && a <= termSel[1]) { termSel = null; return; }
    termSel = termAt(field.value, a);
    if (termSel) { field.setSelectionRange(termSel[0], termSel[1]); renderStatus(); }
  }
  field.addEventListener('input', () => { termSel = null; });
  field.addEventListener('keyup', () => renderStatus());

  function openEdit(i: number): void {
    cur = i; dirty = false;
    field.value = api.inputs()[i] ?? '';
    setView('edit');
    renderField();   // thumbnail, range and signature for the opened expression
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
    termSel = null;
  }
  function finishEdit(): void {
    if (cur >= 0 && dirty) { api.commit('Input'); dirty = false; }
    cur = -1;
  }
  function onEdited(): void {
    if (cur < 0) return;
    const res = api.setInput(cur, field.value);
    dirty = true;
    field.classList.toggle('bad', !res.ok);
    paintThumb(edThumb, field.value, { normalize: api.normalize(), ...dyn() });
    edRange.textContent = res.ok ? `${res.range.lo.toFixed(2)} … ${res.range.hi.toFixed(2)}` : '—';
    renderStatus(res);
  }
  function openFn(): { name: string; arg: number } | null {
    const v = field.value.slice(0, field.selectionStart);
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
  function renderStatus(res = cur >= 0 ? api.results()[cur] : undefined): void {
    if (cur < 0) return;
    const of = openFn();
    if (of) {
      const def = opByName(of.name)!;
      const parts = def.sig.slice(of.name.length + 1, -1).split(', ');
      sigEl.className = 'band-sig';
      sigEl.innerHTML = `${of.name}(${parts.map((p, i) => (i === of.arg ? `<em>${p}</em>` : p)).join(', ')})  <span class="d">${esc(def.desc)}</span>`;
    } else if (res && !res.ok) { sigEl.className = 'band-sig err'; sigEl.textContent = `${res.error.msg} · at ${res.error.pos + 1}`; }
    else { sigEl.className = 'band-sig'; sigEl.textContent = ''; }
  }
  /** Used by refresh(): the field re-reads the source after an outside change (a Randomize) unless mid-edit. */
  function renderField(): void {
    if (cur < 0) return;
    const now = api.inputs()[cur] ?? '';
    if (!dirty && field.value !== now) field.value = now;
    paintThumb(edThumb, field.value, { normalize: api.normalize(), ...dyn() });
    const res = api.results()[cur];
    edRange.textContent = res?.ok ? `${res.range.lo.toFixed(2)} … ${res.range.hi.toFixed(2)}` : '—';
    field.classList.toggle('bad', !!res && !res.ok);
    renderStatus(res);
  }

  // The phone keyboard covers the bottom of the layout viewport; lift the band above it.
  const vv = window.visualViewport;
  const onViewport = (): void => {
    if (!vv) return;
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    band.style.setProperty('--kb', `${covered}px`);
  };
  vv?.addEventListener('resize', onViewport); vv?.addEventListener('scroll', onViewport);

  // ── Generator view ──
  const genBlock = buildGeneratorBlock(vGen, { settings: () => api.genSettings(), onChange: (s) => api.setGenSettings(s), compact: true });
  const gen = {
    refresh: () => genBlock.refresh(),
    openGroup: () => !!vGen.querySelector<HTMLElement>('.gen-back:not([hidden])'),
    closeGroup: () => vGen.querySelector<HTMLButtonElement>('.gen-back')?.click(),
  };

  // ── Gestures: edge swipe right = back, header swipe down = close ──
  // Whole-band swipes. Horizontal = tabs: left goes forward (list → generator),
  // right goes back (generator → list, edit → list, list → main card); the
  // band does not slide sideways, the view just switches on release. Down =
  // close everything (the band follows the finger), only when the touched
  // list is at its scroll top so a scrolled list still scrolls. Horizontal
  // controls (histogram, complexity meter, text field) keep their own drags.
  const EXCLUDE = '.gen-hist, .gen-complexity, .meter-row, input, textarea, .band-field';
  let g0: { x: number; y: number; id: number; axis: 'x' | 'y' | null } | null = null;
  band.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest(EXCLUDE)) return;
    g0 = { x: e.clientX, y: e.clientY, id: e.pointerId, axis: null };
  }, { capture: true });
  band.addEventListener('pointermove', (e) => {
    if (!g0 || e.pointerId !== g0.id) return;
    const dx = e.clientX - g0.x, dy = e.clientY - g0.y;
    if (!g0.axis) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) g0.axis = 'x';
      else if (dy > 12 && dy > Math.abs(dx) * 1.2 && scrollTopOf(e.target as HTMLElement) <= 0) g0.axis = 'y';
      else return;
      try { band.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      band.classList.add('swiping');
    }
    if (g0.axis === 'y') band.style.transform = `translateY(${Math.max(0, dy) * 0.8}px)`;
    else {
      // the content leans with the finger and the tab it is heading for lights up
      const target = dx < 0 ? forwardView() : backView();
      const k = target ? 1 : 0.3;   // nowhere to go: a stiff nudge only
      body.style.transform = `translateX(${dx * 0.35 * k}px)`;
      body.style.opacity = String(Math.max(0.45, 1 - Math.abs(dx) / 360));
      const past = Math.abs(dx) > BACK_PX;
      viewBtns.forEach(b => b.classList.toggle('target', past && !!target && b.dataset.view === (target === 'edit' ? 'list' : target)));
      band.classList.toggle('to-card', past && dx > 0 && !target && view === 'list');
    }
  }, { capture: true });
  const gEnd = (e: PointerEvent) => {
    if (!g0 || e.pointerId !== g0.id) return;
    const dx = e.clientX - g0.x, dy = e.clientY - g0.y;
    const { axis } = g0;
    g0 = null;
    if (!axis) return;
    band.classList.remove('swiping', 'to-card');
    band.style.transform = '';
    viewBtns.forEach(b => b.classList.remove('target'));
    if (axis === 'x') {
      const go = dx > BACK_PX ? backView() : dx < -BACK_PX ? forwardView() : null;
      if (go) { settle(dx < 0 ? 'left' : 'right'); setView(go); }
      else if (dx > BACK_PX && view === 'list') { body.style.transform = ''; body.style.opacity = ''; goBack(); }
      else { body.style.transition = 'transform 0.18s ease, opacity 0.18s ease'; body.style.transform = ''; body.style.opacity = ''; window.setTimeout(() => { body.style.transition = ''; }, 190); }
    } else if (axis === 'y' && dy > CLOSE_PX) closeBand('y');
  };
  /** The view a forward (left) swipe lands on, or null when there is none. */
  function forwardView(): View | null { return view === 'list' || view === 'edit' ? 'generator' : null; }
  /** The view a back (right) swipe lands on, or null when it leaves the band (list → card). */
  function backView(): View | null { return view === 'generator' || view === 'edit' ? 'list' : null; }
  /** After a tab swipe: the new view enters from the side the finger was heading. */
  function settle(dir: 'left' | 'right'): void {
    body.style.transition = 'none';
    body.style.transform = `translateX(${dir === 'left' ? 28 : -28}px)`;
    body.style.opacity = '0.4';
    void body.offsetWidth;   // commit the start position before the transition
    window.setTimeout(() => {
      body.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
      body.style.transform = ''; body.style.opacity = '';
      window.setTimeout(() => { body.style.transition = ''; }, 210);
    }, 16);
  }
  function goForward(): void { const v = forwardView(); if (v) setView(v); }
  function scrollTopOf(el: HTMLElement): number {
    let n: HTMLElement | null = el;
    while (n && n !== band) { if (n.scrollHeight > n.clientHeight + 1 && getComputedStyle(n).overflowY !== 'visible') return n.scrollTop; n = n.parentElement; }
    return 0;
  }
  /** Lists that overflow get `can-scroll` (touch-action: pan-y); the rest leave vertical swipes to the band. */
  function markScrollers(): void {
    for (const el of band.querySelectorAll<HTMLElement>('.band-two > div, .band-drawer, .band-view')) el.classList.toggle('can-scroll', el.scrollHeight > el.clientHeight + 1);
  }
  function closeBand(axis: 'x' | 'y'): void { if (view === 'edit') finishEdit(); slideOut(axis, () => api.onClose()); }
  // A plain tap anywhere outside the band (canvas, write-up) closes it; the control bar handles itself.
  let t0: { x: number; y: number; id: number; t: number } | null = null;
  const outside = (e: PointerEvent) => !band.contains(e.target as Node) && !(e.target as HTMLElement).closest('.ctrl-btn, [data-action]');
  const onDocDown = (e: PointerEvent) => { t0 = visible && outside(e) ? { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() } : null; };
  const onDocUp = (e: PointerEvent) => {
    if (!t0 || e.pointerId !== t0.id) return;
    const ok = Math.abs(e.clientX - t0.x) < 8 && Math.abs(e.clientY - t0.y) < 8 && performance.now() - t0.t < 350;
    t0 = null;
    if (ok && visible) closeBand('y');
  };
  document.addEventListener('pointerdown', onDocDown, { capture: true });
  document.addEventListener('pointerup', onDocUp, { capture: true });
  band.addEventListener('pointerup', gEnd, { capture: true });
  band.addEventListener('pointercancel', gEnd, { capture: true });
  void head;

  function refresh(): void {
    if (!visible) return;
    if (view === 'list') renderList();
    else if (view === 'edit') { if (cur >= api.inputs().length) setView('list'); else renderField(); }
    else gen.refresh();
  }
  function show(): void { visible = true; band.hidden = false; host.classList.add('band-open'); setView('list'); requestAnimationFrame(markScrollers); }
  function hide(): void { if (view === 'edit') finishEdit(); visible = false; band.hidden = true; host.classList.remove('band-open'); }

  // Dynamic thumbnails repaint slowly while the list is up.
  const timer = window.setInterval(() => {
    markScrollers();
    if (!visible || view !== 'list') return;
    // repaint in place: a rebuild would reset the scroll and drop a revealed delete / a drag
    const d = dyn(); const list = api.inputs();
    const rowCanvases = vList.querySelectorAll<HTMLCanvasElement>('.band-row canvas');
    const tiles = vList.querySelectorAll<HTMLCanvasElement>('.band-tiles canvas');
    list.forEach((src, i) => {
      if (!/\b(t|px|py)\b/.test(src)) return;
      if (rowCanvases[i]) paintThumb(rowCanvases[i], src, { normalize: api.normalize(), ...d });
      if (tiles[i]) paintThumb(tiles[i], src, { normalize: api.normalize(), ...d });
    });
  }, 700);

  return {
    show, hide, refresh,
    isVisible: () => visible,
    dispose() { clearInterval(timer); vv?.removeEventListener('resize', onViewport); vv?.removeEventListener('scroll', onViewport); genBlock.dispose(); band.remove(); host.classList.remove('band-open'); document.removeEventListener('pointerdown', onDocDown, { capture: true }); document.removeEventListener('pointerup', onDocUp, { capture: true }); },
  };
}

export { VARS };
