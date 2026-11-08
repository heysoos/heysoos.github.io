// src/components/simulations/cppn/cppn-panel.ts
// Desktop CPPN panel, built from the same spec as the phone card so both
// have the same layout: a pinned header (undo · redo · ⚄ Randomize · ×),
// the preset section, then group bands — Network (layer stack), Weights,
// Motion, View, Device — as one-line meter rows. Drag a row to scrub
// (shift = fine), click the number to type, alt-click to lock.
//
// The gallery page passes a flat get/set (sim-setup/cppn.ts); the admin
// page passes a controller and gets a direct binding derived from it.

import type { CPPNController } from './cppn-controller';
import type { CPPNPreset } from './cppn-types';
import type { ParamGroup, NumSpec, EnumSpec, CustomRowApi } from '../../../lib/sim-page/param-spec';
import type { UndoHistory } from '../../../lib/presets/undo-history';
import type { ParamLocks } from '../../../lib/presets/param-locks';
import { createMeterRow, attachMeterDrag, type MeterRowHandle } from '../../../lib/sim-page/meter-row';
import { pillStyle } from '../boids/panel/panel-styles';
import { CPPN_GROUPS, configFromFlat, isArchKey, isWeightKey, toFlat, type CPPNFlatParams, type FlatKey } from './cppn-spec';
import { renderNetworkRows } from './cppn-network-rows';
import { DICE_SVG, UNDO_SVG, REDO_SVG } from '../../../lib/sim-page/icons';
import { makeCustomSwatch } from '../../../lib/sim-page/custom-swatch';

export interface CPPNPanelOpts {
  /** Groups to render; defaults to CPPN_GROUPS with the layer stack attached. */
  groups?: ParamGroup<string>[];
  /** Flat params object for showIf predicates (a live proxy is fine). */
  params?: unknown;
  get?: (key: string) => number;
  set?: (key: string, value: number) => void;
  history?: UndoHistory;
  locks?: ParamLocks;
  /** Gallery page: renders the shared preset section. */
  buildPresets?: (container: HTMLElement) => void;
  onRandomize?: () => void;
  onClose?: () => void;
  // Admin page: plain preset pills.
  presets?: CPPNPreset[];
  activePresetId?: string;
  onPresetLoad?: (preset: CPPNPreset) => void;
}

/** The same builder, for any sim whose desktop panel is its spec groups
 *  (header: undo · redo · Randomize · ×; presets; group bands; meter rows). */
export { buildCPPNPanel as buildSpecPanel };
export type SpecPanelOpts = CPPNPanelOpts;
export type SpecPanelHandle = CPPNPanelHandle;

export interface CPPNPanelHandle {
  refresh(): void;
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Direct binding for pages without a preset manager (admin): edits apply
 *  to the controller at once; architecture edits recompile immediately. */
function directBinding(ctrl: CPPNController): { get(k: string): number; set(k: string, v: number): void; params: CPPNFlatParams } {
  const flat = () => toFlat(ctrl.config, ctrl.seed, ctrl.isAnimating);
  return {
    get: (k) => flat()[k as FlatKey] as number,
    set: (k, v) => {
      const f = { ...flat(), [k]: v } as CPPNFlatParams;
      if (k === 'animate') { ctrl.setAnimate(v !== 0); return; }
      const config = configFromFlat(ctrl.config, f);
      if (isArchKey(k) && !k.endsWith('Act')) { void ctrl.setLayers(config.layers); ctrl.config = { ...ctrl.config, ...config }; return; }
      ctrl.config = config;
      if (isWeightKey(k)) ctrl.randomizeWeights(f.seed);
    },
    params: new Proxy({}, { get: (_t, k) => flat()[k as FlatKey] }) as CPPNFlatParams,
  };
}

export function buildCPPNPanel(
  container: HTMLElement,
  ctrlOrOpts: CPPNController | CPPNPanelOpts,
  maybeOpts: CPPNPanelOpts = {},
): CPPNPanelHandle {
  const ctrl = 'config' in ctrlOrOpts ? (ctrlOrOpts as CPPNController) : null;
  const opts: CPPNPanelOpts = ctrl ? maybeOpts : (ctrlOrOpts as CPPNPanelOpts);
  const direct = ctrl && !(opts.get && opts.set) ? directBinding(ctrl) : null;
  const get = opts.get ?? direct!.get;
  const set = opts.set ?? direct!.set;
  const params = opts.params ?? direct?.params;
  const { history, locks } = opts;
  const groups: ParamGroup<string>[] = opts.groups ?? CPPN_GROUPS.map(g => g.name === 'Network' ? { ...g, render: renderNetworkRows } : g);

  container.innerHTML = '';
  container.classList.add('fb-panel');   // column: fixed header, then the scrolling part
  const disposers: Array<() => void> = [];
  const refreshers: Array<() => void> = [];

  // ── Pinned header: undo · redo · Randomize · × ──
  const head = document.createElement('div');
  head.className = 'fb-head';
  const mkBtn = (text: string, cls: string, title?: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = cls; b.innerHTML = text; if (title) b.title = title;
    head.appendChild(b);
    return b;
  };
  const undoBtn = mkBtn(UNDO_SVG, 'h-undo', 'Undo');
  const redoBtn = mkBtn(REDO_SVG, 'h-redo', 'Redo');
  const randomBtn = mkBtn(`${DICE_SVG}<span>Randomize</span>`, 'h-random', 'Random architecture, weights and motion (locked rows kept)');
  head.appendChild(el('span', 'flex:1;'));
  if (opts.onClose) mkBtn('×', 'h-close', 'Close').addEventListener('click', opts.onClose);
  container.appendChild(head);
  undoBtn.addEventListener('click', () => history?.undo());
  redoBtn.addEventListener('click', () => history?.redo());
  const refreshHist = () => {
    undoBtn.disabled = !history?.canUndo();
    redoBtn.disabled = !history?.canRedo();
    undoBtn.title = history?.undoLabel() ? `Undo ${history.undoLabel()}` : 'Nothing to undo';
    redoBtn.title = history?.redoLabel() ? `Redo ${history.redoLabel()}` : 'Nothing to redo';
  };
  refreshHist();
  const unsubHist = history?.subscribe(refreshHist);
  if (unsubHist) disposers.push(unsubHist);
  randomBtn.addEventListener('click', () => {
    if (opts.onRandomize) { opts.onRandomize(); return; }
    if (ctrl) { ctrl.randomizeWeights(Date.now() & 0xffffffff); refresh(); }
  });

  // ── Presets, then the params ──
  const presetsBody = document.createElement('div');
  presetsBody.className = 'fb-presets';
  const body = document.createElement('div');
  body.className = 'fb-body';
  const scroll = document.createElement('div');
  scroll.className = 'fb-scroll';
  scroll.append(presetsBody, body);
  container.appendChild(scroll);
  if (opts.buildPresets) {
    opts.buildPresets(presetsBody);
  } else if (opts.presets && opts.presets.length > 0) {
    const pillRow = el('div', 'display:flex;flex-wrap:wrap;gap:4px;margin:0 0 0.4rem;');
    for (const preset of opts.presets) {
      const pill = el('button', pillStyle(preset.id === opts.activePresetId), preset.name);
      pill.addEventListener('click', () => opts.onPresetLoad?.(preset));
      pillRow.appendChild(pill);
    }
    presetsBody.appendChild(pillRow);
  }

  const commit = (label: string) => { history?.push(label); refresh(); };

  // Shared gesture helpers for custom blocks (the layer stack).
  const api: CustomRowApi = {
    get, set, commit,
    attachRowDrag: (row, spec: NumSpec) => {
      const drag = attachMeterDrag(row, {
        label: spec.label, min: spec.min, max: spec.max, step: spec.step, scale: spec.scale, int: spec.int, stepDrag: spec.stepDrag,
        get: () => get(spec.key), set: (v) => set(spec.key, v), history, refresh,
      });
      row.addEventListener('click', (e) => { if (drag.suppressClick()) e.stopImmediatePropagation(); }, { capture: true });
    },
    attachLongPress: (elm, key) => {
      // Desktop: alt-click locks (same as meter rows); a long-press works too.
      elm.addEventListener('click', (e) => { if (e.altKey && locks) { e.preventDefault(); e.stopPropagation(); locks.toggle(key); refresh(); } });
      let timer = 0;
      elm.addEventListener('pointerdown', () => { clearTimeout(timer); timer = window.setTimeout(() => { locks?.toggle(key); refresh(); }, 600); });
      const cancel = () => clearTimeout(timer);
      elm.addEventListener('pointermove', cancel); elm.addEventListener('pointerup', cancel); elm.addEventListener('pointercancel', cancel);
      elm.addEventListener('contextmenu', (e) => e.preventDefault());
    },
    isLocked: (key) => locks?.isLocked(key) ?? false,
    setLocked: (key, on) => locks?.set(key, on),
    refresh: () => refresh(),
  };

  // ── Groups ──
  for (const g of groups) {
    const h = document.createElement('h6');
    h.className = 'fb-group';
    h.textContent = g.name;
    body.appendChild(h);
    if (g.note) {
      const n = el('small', 'display:block;font-size:0.6rem;color:var(--text-muted);margin:-2px 0 4px 2px;');
      body.appendChild(n);
      refreshers.push(() => { n.textContent = g.note!(); });
    }
    if (g.render) {
      const c = document.createElement('div');
      body.appendChild(c);
      const block = g.render(c, api, 'meter-row');
      refreshers.push(() => block.refresh());
    }
    for (const spec of g.items) {
      if (spec.kind === 'num') {
        const row: MeterRowHandle = createMeterRow(body, {
          label: spec.label, min: spec.min, max: spec.max, step: spec.step, scale: spec.scale, int: spec.int, stepDrag: spec.stepDrag,
          history, lock: locks ? { key: spec.key, locks } : undefined,
          get: () => get(spec.key), set: (v) => set(spec.key, v),
          onChange: () => { for (const r of refreshers) if (r !== rowRefresh) r(); },
        });
        const rowRefresh = () => { row.el.hidden = spec.showIf ? !spec.showIf(params) : false; row.refresh(); };
        refreshers.push(rowRefresh);
        disposers.push(() => row.dispose());
      } else {
        refreshers.push(enumRow(body, spec, get, set, commit, params, locks));
      }
    }
  }

  function refresh(): void { for (const r of refreshers) r(); }
  refresh();
  const unsubLocks = locks?.subscribe(refresh);
  if (unsubLocks) disposers.push(unsubLocks);

  return { refresh, dispose() { for (const d of disposers) d(); } };
}

/** One enum control: segmented bar (also for `cycle` specs, which have
 *  room for all names on desktop) or a native select. Returns its refresher. */
function enumRow(
  parent: HTMLElement, spec: EnumSpec<string>,
  get: (k: string) => number, set: (k: string, v: number) => void, commit: (label: string) => void,
  params: unknown, locks?: ParamLocks,
): () => void {
  const row = el('div', '');
  // Two names fit beside the label; longer lists stack label over a full-width bar.
  row.className = 'cppn-enum-row' + (spec.ui !== 'select' && spec.names.length > 2 ? ' stack' : '');
  const lab = el('span', '', spec.label);
  lab.className = 'n';
  row.appendChild(lab);
  const pick = (i: number) => { set(spec.key, i); commit(spec.label); };
  let update: () => void;
  if (spec.ui === 'select') {
    const sel = document.createElement('select');
    sel.className = 'look-select';
    spec.names.forEach((n, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = n; sel.appendChild(o); });
    sel.addEventListener('change', () => pick(+sel.value));
    row.appendChild(sel);
    update = () => { sel.value = String(Math.round(get(spec.key))); };
  } else {
    const bar = el('div', '');
    bar.className = spec.ui === 'swatches' ? 'look-swatches' : 'look-segmented';
    const btns = spec.names.map((n, i) => {
      const b = document.createElement('button');
      if (spec.ui === 'swatches') { b.className = 'sw'; b.title = n; b.style.background = spec.colors?.[i] ?? 'currentColor'; }
      else b.textContent = n;
      b.addEventListener('click', () => { if (spec.custom) set(spec.custom, -1); pick(i); });
      bar.appendChild(b);
      return b;
    });
    const ck = spec.ui === 'swatches' ? spec.custom : undefined;
    const custom = ck ? makeCustomSwatch(() => get(ck), (v) => { set(spec.key, 0); set(ck, v); }, () => update(), () => commit(spec.label)) : null;
    if (custom) bar.appendChild(custom.el);
    row.appendChild(bar);
    update = () => {
      const v = Math.round(get(spec.key));
      const customOn = ck ? get(ck) >= 0 : false;
      btns.forEach((b, i) => b.classList.toggle('on', !customOn && i === v));
      custom?.refresh();
    };
  }
  if (locks) lab.addEventListener('click', (e) => { if (e.altKey) { locks.toggle(spec.key); } });
  parent.appendChild(row);
  return () => {
    row.hidden = spec.showIf ? !spec.showIf(params) : false;
    row.classList.toggle('locked', locks?.isLocked(spec.key) ?? false);
    update();
  };
}
