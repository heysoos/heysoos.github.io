// src/components/simulations/field-boids/field-boids-panel.ts
import type { FieldBoidsController } from './field-boids-controller';
import type { FieldBoidsPreset } from './field-boids-types';
import { createRangeSlider } from '../boids/panel/range-slider';
import { createMeterRow } from '../../../lib/sim-page/meter-row';
import { pillStyle } from '../boids/panel/panel-styles';
import type { UndoHistory } from '../../../lib/presets/undo-history';
import type { TiltSensor } from '../../../lib/sim-page/tilt-sensor';
import { randomizeFieldBoidsParams } from './field-boids-randomize';
import type { ParamLocks, ParamLockBinding } from '../../../lib/presets/param-locks';
import { LOOK_GROUP, type EnumSpec } from './field-boids-spec';
import { DICE_SVG, UNDO_SVG, REDO_SVG } from '../../../lib/sim-page/icons';
import { makeCustomSwatch } from '../../../lib/sim-page/custom-swatch';

export interface FieldBoidsPanelOpts {
  presets?: FieldBoidsPreset[];
  activePresetId?: string;
  onPresetLoad?: (preset: FieldBoidsPreset) => void;
  onClose?: () => void;
  /** Gallery page: renders the shared preset section (replaces the pill row). */
  buildPresets?: (container: HTMLElement) => void;
  /** Gallery page: param changes record undo entries. */
  history?: UndoHistory;
  /** Phone: a tilt toggle steers the gravity direction. Omit on desktop. */
  tilt?: TiltSensor;
  /** Re-render the panel after a programmatic param change (Randomize).
   *  Defaults to rebuilding in place. */
  rebuild?: () => void;
  /** Gallery page: sliders can be locked across preset loads. */
  locks?: ParamLocks;
  /** Phone: params live in the scrub list, so the sheet shows only presets,
   *  Randomize and the tilt toggle. */
  paramsHidden?: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, css: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** One enum control, drawn as the spec says: segmented bar, swatches or select. */
function enumRow(parent: HTMLElement, spec: EnumSpec, getK: (k: string) => number, setK: (k: string, v: number) => void, history?: UndoHistory, after?: () => void): void {
  const row = el('div', 'display:flex;align-items:center;gap:6px;margin:0 0 0.35rem;');
  row.appendChild(el('span', 'font-size:0.6rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);min-width:4.2rem;', spec.label));
  const key = spec.key as string;
  const get = () => getK(key);
  const set = (i: number) => { if (spec.custom) setK(spec.custom, -1); setK(key, i); };
  const pick = (i: number) => { set(i); history?.push(spec.label); after?.(); };
  if (spec.ui === 'select') {
    const sel = document.createElement('select');
    sel.className = 'look-select';
    spec.names.forEach((n, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = n; sel.appendChild(o); });
    sel.value = String(get());
    sel.addEventListener('change', () => pick(+sel.value));
    row.appendChild(sel);
  } else {
    const bar = el('div', '');
    bar.className = spec.ui === 'swatches' ? 'look-swatches' : 'look-segmented';
    const ck = spec.ui === 'swatches' ? spec.custom : undefined;
    const customOn = () => (ck ? getK(ck) >= 0 : false);
    const btns = spec.names.map((n, i) => {
      const b = document.createElement('button');
      if (spec.ui === 'swatches') { b.className = 'sw'; b.title = n; b.style.background = spec.colors?.[i] ?? 'currentColor'; }
      else b.textContent = n;
      b.classList.toggle('on', !customOn() && get() === i);
      b.addEventListener('click', () => { pick(i); btns.forEach((x, k) => x.classList.toggle('on', k === i)); custom?.refresh(); });
      bar.appendChild(b);
      return b;
    });
    const custom = ck
      ? makeCustomSwatch(() => getK(ck), (v) => { setK(key, 0); setK(ck, v); },
          () => { btns.forEach(x => x.classList.remove('on')); },
          () => { history?.push(spec.label); after?.(); })
      : null;
    if (custom) bar.appendChild(custom.el);
    row.appendChild(bar);
  }
  parent.appendChild(row);
}


export const GRAVITY_KEY = 'field-boids:gravity';

/** "Tilt gravity" switch plus the gravity strength. Device settings, not
 *  preset params: the sensor keeps its own state, the strength is kept in
 *  localStorage, and neither is saved with or randomized by presets. */
export function buildTiltRow(parent: HTMLElement, ctrl: FieldBoidsController, tilt: TiltSensor): void {
  const row = document.createElement('div');
  row.className = 'trail-row';
  const label = el('span', '', 'Tilt steers gravity');
  const note = el('span', 'font-size:0.62rem;color:var(--text-muted);margin-left:0.4rem;');
  const wrap = document.createElement('label');
  wrap.className = 'toggle-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = tilt.isEnabled();
  const knob = document.createElement('span');
  knob.className = 'toggle-slider';
  wrap.append(input, knob);
  label.appendChild(note);
  row.append(label, wrap);
  parent.appendChild(row);

  input.addEventListener('change', async () => {
    if (!input.checked) { tilt.disable(); note.textContent = ''; return; }
    input.disabled = true;
    note.textContent = '…';
    const result = await tilt.enable();
    input.disabled = false;
    if (result === 'enabled') { note.textContent = ''; return; }
    input.checked = false;
    note.textContent = result === 'denied' ? 'permission denied'
                     : result === 'no-sensor' ? 'no tilt sensor'
                     : 'unsupported';
  });

  createRangeSlider(parent, { label: 'Gravity', min: 0, max: 1, step: 0.005,
    get: () => ctrl.gravity,
    set: v => { ctrl.gravity = v; try { localStorage.setItem(GRAVITY_KEY, String(v)); } catch { /* session-only */ } },
  });
}

/** Randomize the dynamics; locked params survive like they survive a
 *  preset load. Shared by the desktop button and the phone card header. */
export function randomizeKeepingLocks(ctrl: FieldBoidsController, locks?: ParamLocks, history?: UndoHistory): void {
  history?.endGesture();
  const pr = ctrl.params as unknown as Record<string, number>;
  const kept = (locks?.keys() ?? []).map(k => [k, pr[k]] as const);
  randomizeFieldBoidsParams(ctrl.params);
  for (const [k, v] of kept) pr[k] = v;
  history?.push('Randomize');
}

/** Restore the device gravity strength saved by the tilt row. */
export function restoreDeviceGravity(ctrl: FieldBoidsController): void {
  try {
    const raw = localStorage.getItem(GRAVITY_KEY);
    if (raw !== null && Number.isFinite(+raw)) ctrl.gravity = Math.min(1, Math.max(0, +raw));
  } catch { /* storage blocked */ }
}

export function buildFieldBoidsPanel(
  container: HTMLElement,
  ctrl: FieldBoidsController,
  opts: FieldBoidsPanelOpts = {},
): void {
  container.innerHTML = '';
  container.classList.add('fb-panel');   // column: fixed header, then the scrolling part
  const p = ctrl.params;
  const history = opts.history;
  const lockFor = (key: keyof typeof p): ParamLockBinding | undefined =>
    opts.locks ? { key: key as string, locks: opts.locks } : undefined;

  const host = container as HTMLElement & { __fbUnsub?: () => void };
  host.__fbUnsub?.();

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
  const randomBtn = mkBtn(`${DICE_SVG}<span>Randomize</span>`, 'h-random', 'Random dynamics (particle count and view unchanged)');
  head.appendChild(el('span', 'flex:1;'));
  if (opts.onClose) {
    const closeBtn = mkBtn('×', 'h-close', 'Close');
    closeBtn.addEventListener('click', opts.onClose);
  }
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
  host.__fbUnsub = history?.subscribe(refreshHist);
  randomBtn.addEventListener('click', () => {
    randomizeKeepingLocks(ctrl, opts.locks, history);
    (opts.rebuild ?? (() => buildFieldBoidsPanel(container, ctrl, opts)))();
  });

  // ── Presets at the top, then the params ──
  const scroll = document.createElement('div');
  scroll.className = 'fb-scroll';
  container.appendChild(scroll);
  const presetsBody = document.createElement('div');
  presetsBody.className = 'fb-presets';
  const body = document.createElement('div');
  body.className = 'fb-body';
  scroll.append(presetsBody, body);
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
  if (opts.paramsHidden) {
    if (opts.tilt) buildTiltRow(body, ctrl, opts.tilt);
    return;
  }

  // ── Params: group bands + one-line meter rows ──
  const group = (name: string) => { const h = document.createElement('h6'); h.className = 'fb-group'; h.textContent = name; body.appendChild(h); };
  const pr = p as unknown as Record<string, number>;
  const row = (key: keyof typeof p, label: string, min: number, max: number, step: number, extra: { scale?: 'linear' | 'log'; int?: boolean } = {}) =>
    createMeterRow(body, { label, min, max, step, ...extra, history, lock: lockFor(key),
      get: () => pr[key as string], set: v => { pr[key as string] = extra.int ? Math.round(v) : v; } });

  group('Simulation');
  row('numParticles', 'Particles', 1000, 2000000, 1000, { scale: 'log', int: true });
  row('stepsPerFrame', 'Steps per frame', 1, 30, 1, { int: true });
  row('attractionRadius', 'Attraction radius', 0.01, 0.5, 0.005);
  row('repulsionRadius', 'Repulsion radius', 0.005, 0.2, 0.005);
  row('attraction', 'Attraction', 0, 5, 0.01);
  row('repulsion', 'Repulsion', 0, 10, 0.01);
  row('alignment', 'Alignment', 0, 10, 0.01);
  row('coneAngle', 'Cone angle', -1, 1, 0.01);
  row('friction', 'Friction', 0, 10, 0.1);
  row('maxSpeed', 'Max speed', 0.01, 1, 0.01);
  row('noise', 'Noise', 0, 0.1, 0.001);
  if (opts.tilt) buildTiltRow(body, ctrl, opts.tilt);

  group('Field');
  row('memory', 'Memory', 0, 0.99, 0.01);
  row('splatSize', 'Splat size', 0.5, 3, 0.1);

  // Look: from the shared spec. Enums as segmented bars / swatches / selects,
  // numbers as meter rows; point rows only in the Points view.
  group('Look');
  const rebuild = opts.rebuild ?? (() => buildFieldBoidsPanel(container, ctrl, opts));
  for (const item of LOOK_GROUP.items) {
    if (item.showIf && !item.showIf(p)) continue;
    if (item.kind === 'enum') {
      enumRow(body, item, k => pr[k], (k, v) => { pr[k] = v; }, history, item.rebuilds ? rebuild : undefined);
    } else {
      row(item.key, item.label, item.min, item.max, item.step, { scale: item.scale, int: item.int });
    }
  }
}
