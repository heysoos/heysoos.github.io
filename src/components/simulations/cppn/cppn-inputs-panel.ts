// Desktop inputs page: the panel body swapped in when the Network block's
// `in` row is clicked. Header (‹ · INPUTS · ⚄ Randomize inputs · ×), then the
// generator block, an `INPUTS · N of 8` line with the normalize toggle, one
// row per input (thumbnail · mono field with autocomplete · status · ×),
// `+ add input` and a variables line. Edits apply live (bytecode upload);
// an undo entry is recorded when a field is left.
import type { InputCompileResult } from './cppn-controller';
import type { GenSettings } from './cppn-expr/generator';
import { OPS, VARS, VAR_DESC, CONSTS, opByName } from './cppn-expr/optable';
import { paintThumb } from './cppn-expr/thumb';
import { buildGeneratorBlock } from './cppn-generator-ui';
import { DICE_SVG } from '../../../lib/sim-page/icons';
import { MAX_INPUTS } from './cppn-expr/compile';

export interface InputsApi {
  inputs(): string[];
  setInput(i: number, src: string): InputCompileResult;
  addInput(): void;
  removeInput(i: number): void;
  /** Last compile result per slot. */
  results(): readonly InputCompileResult[];
  normalize(): boolean;
  setNormalize(on: boolean): void;
  isLocked(i: number): boolean;
  setLocked(i: number, on: boolean): void;
  genSettings(): GenSettings;
  setGenSettings(s: GenSettings): void;
  randomizeInputs(): void;
  /** Record one undo entry. */
  commit(label: string): void;
  back(): void;
  /** Current time / pointer for thumbnails of dynamic expressions. */
  dynamicVars?(): { t: number; px: number; py: number };
}

export interface InputsPageHandle { refresh(): void; dispose(): void }

const fmtRange = (lo: number, hi: number) => `${lo.toFixed(2)} … ${hi.toFixed(2)}`;

export function buildInputsPage(container: HTMLElement, api: InputsApi): InputsPageHandle {
  container.classList.add('fb-panel');
  const disposers: Array<() => void> = [];

  // ── header ──
  const head = document.createElement('div');
  head.className = 'fb-head';
  head.innerHTML = `<button class="h-back" title="Back to parameters">‹</button><span class="h-title">Inputs</span><span style="flex:1"></span><button class="h-random" title="Fresh expressions for every unlocked input">${DICE_SVG}<span>Randomize inputs</span></button>`;
  container.appendChild(head);
  head.querySelector('.h-back')!.addEventListener('click', () => api.back());
  head.querySelector('.h-random')!.addEventListener('click', () => { api.randomizeInputs(); refresh(); });

  const scroll = document.createElement('div');
  scroll.className = 'fb-scroll';
  container.appendChild(scroll);

  // ── generator ──
  const genHost = document.createElement('div');
  genHost.className = 'inputs-gen';
  scroll.appendChild(genHost);
  const gen = buildGeneratorBlock(genHost, { settings: () => api.genSettings(), onChange: (s) => api.setGenSettings(s), compact: false });
  disposers.push(() => gen.dispose());

  // ── inputs head: count + normalize ──
  const ihead = document.createElement('div');
  ihead.className = 'inputs-head';
  ihead.innerHTML = `<span class="inputs-count"></span><button class="norm-toggle" title="Map each input channel to −1 … 1 over the unit square">normalize</button>`;
  scroll.appendChild(ihead);
  const countEl = ihead.querySelector<HTMLElement>('.inputs-count')!;
  const normBtn = ihead.querySelector<HTMLButtonElement>('.norm-toggle')!;
  normBtn.addEventListener('click', () => { api.setNormalize(!api.normalize()); api.commit('Normalize'); refresh(); });

  // ── rows ──
  const rowsEl = document.createElement('div');
  rowsEl.className = 'inputs-rows';
  scroll.appendChild(rowsEl);
  const addBtn = document.createElement('button');
  addBtn.className = 'inputs-add';
  addBtn.textContent = '+ add input';
  addBtn.addEventListener('click', () => { api.addInput(); api.commit('Add input'); refresh(); focusRow(api.inputs().length - 1); });
  scroll.appendChild(addBtn);
  const vars = document.createElement('div');
  vars.className = 'inputs-vars';
  vars.innerHTML = `variables &nbsp;${VARS.map(v => `<b data-var="${v}" title="${VAR_DESC[v]}">${v}</b>`).join(' ')} <b data-var="pi" title="π">pi</b><br><small>x, y ∈ −1 … 1 · r radius · a angle · t time (wraps every 60 s) · px, py pointer. Click to insert.</small>`;
  scroll.appendChild(vars);
  let lastFocused: HTMLInputElement | null = null;
  vars.querySelectorAll<HTMLElement>('b[data-var]').forEach(b => b.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const inp = (document.activeElement instanceof HTMLInputElement && rowsEl.contains(document.activeElement)) ? document.activeElement : lastFocused ?? rows[rows.length - 1]?.inp;
    if (!inp) return;
    const p = inp.selectionStart ?? inp.value.length;
    const txt = b.dataset.var!;
    inp.value = inp.value.slice(0, p) + txt + inp.value.slice(p);
    inp.selectionStart = inp.selectionEnd = p + txt.length;
    inp.dispatchEvent(new Event('input'));
    inp.focus();
  }));

  type Row = { el: HTMLElement; inp: HTMLInputElement; msg: HTMLElement; thumb: HTMLCanvasElement; big: boolean; dirty: boolean };
  let rows: Row[] = [];

  function buildRow(i: number): Row {
    const el = document.createElement('div');
    el.className = 'inputs-row';
    el.innerHTML = `<canvas class="thumb" width="32" height="32" title="Click to enlarge"></canvas><button class="lock" title="Lock: keep through Randomize"></button>
      <div class="field"><input class="expr" spellcheck="false" autocomplete="off" autocapitalize="off"><div class="msg"></div></div>
      <button class="del" title="Remove input">×</button>`;
    const inp = el.querySelector<HTMLInputElement>('.expr')!;
    const msg = el.querySelector<HTMLElement>('.msg')!;
    const thumb = el.querySelector<HTMLCanvasElement>('.thumb')!;
    const row: Row = { el, inp, msg, thumb, big: false, dirty: false };
    inp.value = api.inputs()[i] ?? '';
    inp.addEventListener('input', () => {
      row.dirty = true;
      const r = api.setInput(i, inp.value);
      paintRowStatus(row, r);
      paintThumbFor(row, i);
      refreshFilmstripOnly();
    });
    inp.addEventListener('focus', () => { lastFocused = inp; });
    inp.addEventListener('blur', () => { if (row.dirty) { row.dirty = false; api.commit('Input'); } });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !acOpen(inp)) inp.blur(); });
    attachExprAutocomplete(inp, { onInput: () => inp.dispatchEvent(new Event('input')) });
    thumb.addEventListener('click', (e) => {
      if (e.altKey) { api.setLocked(i, !api.isLocked(i)); refresh(); return; }
      row.big = !row.big;
      el.classList.toggle('big', row.big);
      thumb.width = thumb.height = row.big ? 96 : 32;
      paintThumbFor(row, i);
    });
    el.querySelector('.lock')!.addEventListener('click', () => { api.setLocked(i, !api.isLocked(i)); refresh(); });
    el.querySelector('.del')!.addEventListener('click', () => { api.removeInput(i); api.commit('Remove input'); refresh(); });
    el.addEventListener('click', (e) => { if (e.altKey && e.target === el) { api.setLocked(i, !api.isLocked(i)); refresh(); } });
    return row;
  }

  function paintRowStatus(row: Row, r: InputCompileResult | undefined): void {
    if (!r) { row.msg.textContent = ''; return; }
    row.el.classList.toggle('bad', !r.ok);
    row.msg.textContent = r.ok
      ? `range ${fmtRange(r.range.lo, r.range.hi)}${api.normalize() ? '  → −1 … 1' : ''}`
      : `${r.error.msg}  ·  at ${r.error.pos + 1}`;
  }
  function paintThumbFor(row: Row, i: number): void {
    const d = api.dynamicVars?.() ?? { t: 0, px: 0, py: 0 };
    paintThumb(row.thumb, api.inputs()[i] ?? '', { normalize: api.normalize(), ...d });
  }
  let onFilmstrip: (() => void) | null = null;
  function refreshFilmstripOnly(): void { onFilmstrip?.(); }

  function focusRow(i: number): void { rows[i]?.inp.focus(); rows[i]?.inp.select(); }

  function refresh(): void {
    gen.refresh();
    const list = api.inputs();
    const results = api.results();
    countEl.textContent = `inputs · ${list.length} of ${MAX_INPUTS}`;
    normBtn.classList.toggle('on', api.normalize());
    if (rows.length !== list.length) {
      rowsEl.innerHTML = '';
      rows = list.map((_, i) => { const r = buildRow(i); rowsEl.appendChild(r.el); return r; });
    }
    rows.forEach((row, i) => {
      if (document.activeElement !== row.inp && row.inp.value !== list[i]) row.inp.value = list[i];
      row.el.classList.toggle('locked', api.isLocked(i));
      paintRowStatus(row, results[i]);
      paintThumbFor(row, i);
    });
    addBtn.disabled = list.length >= MAX_INPUTS;
  }

  // Dynamic thumbnails (t / pointer) repaint slowly while the page is visible.
  const timer = window.setInterval(() => {
    if (!container.isConnected || container.offsetParent === null) return;
    rows.forEach((row, i) => { if (/\b(t|px|py)\b/.test(api.inputs()[i] ?? '')) paintThumbFor(row, i); });
  }, 400);
  disposers.push(() => clearInterval(timer));

  refresh();
  return {
    refresh,
    dispose() { for (const d of disposers) d(); container.innerHTML = ''; },
    /** @internal the panel hooks the filmstrip refresh here */
    set onInputsEdited(fn: (() => void) | null) { onFilmstrip = fn; },
  } as InputsPageHandle & { onInputsEdited: (() => void) | null };
}

// ── Autocomplete ───────────────────────────────────────────────────
type Cand = { k: string; d: string; fn: boolean };
const CANDS: Cand[] = [
  ...OPS.map(o => ({ k: o.name, d: o.desc, fn: true })),
  ...VARS.map(v => ({ k: v, d: VAR_DESC[v], fn: false })),
  ...Object.keys(CONSTS).map(k => ({ k, d: k === 'pi' ? '3.14159…' : '2.71828…', fn: false })),
];
const acOpen = (inp: HTMLInputElement) => !!inp.parentElement?.querySelector('.expr-ac');

function wordAt(inp: HTMLInputElement): { w: string; s: number; p: number } {
  const v = inp.value, p = inp.selectionStart ?? v.length;
  let s = p;
  while (s > 0 && /[A-Za-z0-9_]/.test(v[s - 1])) s--;
  return { w: v.slice(s, p), s, p };
}
/** Which function call is the caret inside, and which argument. */
function openFn(inp: HTMLInputElement): { name: string; arg: number } | null {
  const v = inp.value.slice(0, inp.selectionStart ?? inp.value.length);
  let depth = 0, commas = 0;
  for (let i = v.length - 1; i >= 0; i--) {
    const c = v[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) {
        let s = i; while (s > 0 && /[A-Za-z0-9_]/.test(v[s - 1])) s--;
        const name = v.slice(s, i);
        return opByName(name) ? { name, arg: commas } : null;
      }
      depth--;
    } else if (c === ',' && depth === 0) commas++;
  }
  return null;
}

/**
 * Prefix list of functions and variables under the field (↑↓, Tab/Enter,
 * Esc), a signature hint inside a call with the current argument marked,
 * `name()` inserted with the caret inside, and `)` stepping over an
 * existing `)` — the same bracket behaviour as the phone keypad.
 */
export function attachExprAutocomplete(inp: HTMLInputElement, o: { onInput(): void }): void {
  let box: HTMLElement | null = null, sig: HTMLElement | null = null, cands: Cand[] = [], sel = 0;
  const host = inp.parentElement!;
  const close = () => { box?.remove(); box = null; sig?.remove(); sig = null; cands = []; };
  const show = () => {
    close();
    const { w } = wordAt(inp);
    cands = w.length ? CANDS.filter(c => c.k.startsWith(w.toLowerCase()) && c.k !== w).slice(0, 7) : [];
    if (cands.length) {
      box = document.createElement('div');
      box.className = 'expr-ac';
      sel = 0;
      cands.forEach((c, i) => {
        const d = document.createElement('div');
        d.innerHTML = `<span class="n"><em>${c.k.slice(0, w.length)}</em>${c.k.slice(w.length)}${c.fn ? '(' : ''}</span><span class="d">${c.d}</span>`;
        if (i === 0) d.className = 'sel';
        d.addEventListener('mousedown', (e) => { e.preventDefault(); accept(i); });
        box!.appendChild(d);
      });
      host.appendChild(box);
      return;
    }
    const of = openFn(inp);
    if (of) {
      const def = opByName(of.name)!;
      const parts = def.sig.slice(of.name.length + 1, -1).split(', ');
      sig = document.createElement('div');
      sig.className = 'expr-sig';
      sig.innerHTML = `${of.name}(${parts.map((p, i) => (i === of.arg ? `<em>${p}</em>` : p)).join(', ')}) &nbsp;<span class="d">${def.desc}</span>`;
      host.appendChild(sig);
    }
  };
  const accept = (i: number) => {
    const c = cands[i]; if (!c) return;
    const { s, p } = wordAt(inp), v = inp.value;
    const ins = c.k + (c.fn ? '()' : '');
    inp.value = v.slice(0, s) + ins + v.slice(p);
    const caret = s + c.k.length + (c.fn ? 1 : 0);
    inp.selectionStart = inp.selectionEnd = caret;
    close();
    o.onInput();
    inp.focus();
    show();
  };
  inp.addEventListener('input', show);
  inp.addEventListener('click', show);
  inp.addEventListener('blur', () => setTimeout(close, 120));
  inp.addEventListener('keydown', (e) => {
    // `)` over an existing `)` steps past it (auto-closed brackets)
    if (e.key === ')' && inp.selectionStart === inp.selectionEnd && inp.value[inp.selectionStart ?? -1] === ')') {
      e.preventDefault();
      const p = (inp.selectionStart ?? 0) + 1;
      inp.selectionStart = inp.selectionEnd = p;
      show();
      return;
    }
    if (!box) { if (e.key === 'Escape') close(); return; }
    if (e.key === 'ArrowDown') sel = (sel + 1) % cands.length;
    else if (e.key === 'ArrowUp') sel = (sel - 1 + cands.length) % cands.length;
    else if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); accept(sel); return; }
    else if (e.key === 'Escape') { close(); return; }
    else return;
    e.preventDefault();
    [...box.children].forEach((d, i) => d.classList.toggle('sel', i === sel));
  });
}
