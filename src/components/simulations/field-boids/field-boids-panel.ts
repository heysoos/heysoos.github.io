// src/components/simulations/field-boids/field-boids-panel.ts
import type { FieldBoidsController } from './field-boids-controller';
import type { FieldBoidsPreset } from './field-boids-types';
import { createRangeSlider } from '../boids/panel/range-slider';
import { pillStyle } from '../boids/panel/panel-styles';
import type { UndoHistory } from '../../../lib/presets/undo-history';
import type { TiltSensor } from '../../../lib/sim-page/tilt-sensor';
import { randomizeFieldBoidsParams } from './field-boids-randomize';
import type { ParamLocks, ParamLockBinding } from '../../../lib/presets/param-locks';
import { LOOK_GROUP } from './field-boids-spec';

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

function divider(parent: HTMLElement): void {
  const d = document.createElement('div');
  d.className = 'section-divider';
  parent.appendChild(d);
}

function heading(parent: HTMLElement, text: string): void {
  const h = document.createElement('p');
  h.className = 'section-heading';
  h.textContent = text;
  parent.appendChild(h);
}

/** A labelled row of exclusive pills for an enum param. */
function pillRow(parent: HTMLElement, label: string, names: readonly string[], get: () => number, set: (i: number) => void, history?: UndoHistory): void {
  const row = el('div', 'display:flex;align-items:center;gap:4px;margin-bottom:0.3rem;flex-wrap:wrap;');
  row.appendChild(el('span', 'font-size:0.66rem;color:var(--text-muted);min-width:3.6rem;', label));
  const btns: HTMLButtonElement[] = [];
  names.forEach((name, i) => {
    const b = el('button', pillStyle(get() === i), name);
    b.addEventListener('click', () => {
      set(i);
      btns.forEach((x, k) => { x.style.cssText = pillStyle(k === i); });
      history?.push(label);
    });
    btns.push(b);
    row.appendChild(b);
  });
  parent.appendChild(row);
}
const RANDOM_BTN = 'padding:2px 8px;border-radius:4px;border:1px solid var(--bg-surface-border);background:transparent;color:var(--text-body);font-size:0.66rem;cursor:pointer;white-space:nowrap;line-height:1.3;';

const GRAVITY_KEY = 'field-boids:gravity';

/** "Tilt gravity" switch plus the gravity strength. Device settings, not
 *  preset params: the sensor keeps its own state, the strength is kept in
 *  localStorage, and neither is saved with or randomized by presets. */
function buildTiltRow(parent: HTMLElement, ctrl: FieldBoidsController, tilt: TiltSensor): void {
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
  const p = ctrl.params;
  const history = opts.history;
  const lockFor = (key: keyof typeof p): ParamLockBinding | undefined =>
    opts.locks ? { key: key as string, locks: opts.locks } : undefined;

  // Header
  const header = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;');
  header.appendChild(el('p',
    'font-size:0.65rem;letter-spacing:1.5px;color:var(--text-muted);text-transform:uppercase;margin:0;',
    'Field Boids'));
  if (opts.onClose) {
    const closeBtn = el('button',
      'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1rem;line-height:1;padding:0;', '×');
    closeBtn.addEventListener('click', opts.onClose);
    header.appendChild(closeBtn);
  }
  container.appendChild(header);

  // Presets: shared section when provided, plain pill row otherwise (admin)
  if (opts.buildPresets) {
    opts.buildPresets(container);
  } else if (opts.presets && opts.presets.length > 0) {
    const pillRow = el('div', 'display:flex;flex-wrap:wrap;gap:4px;margin:0 0 0.4rem;');
    for (const preset of opts.presets) {
      const pill = el('button', pillStyle(preset.id === opts.activePresetId), preset.name);
      pill.addEventListener('click', () => opts.onPresetLoad?.(preset));
      pillRow.appendChild(pill);
    }
    container.appendChild(pillRow);
  }

  // Simulation
  const simHead = el('div', 'display:flex;justify-content:space-between;align-items:baseline;');
  if (!opts.paramsHidden) heading(simHead, 'Simulation');
  const randomBtn = el('button', RANDOM_BTN, '⚄ Randomize');
  randomBtn.title = 'Random dynamics (particle count and view unchanged)';
  randomBtn.addEventListener('click', () => {
    history?.endGesture();
    // Locked params survive Randomize like they survive a preset load.
    const pr = p as unknown as Record<string, number>;
    const kept = (opts.locks?.keys() ?? []).map(k => [k, pr[k]] as const);
    randomizeFieldBoidsParams(p);
    for (const [k, v] of kept) pr[k] = v;
    history?.push('Randomize');
    (opts.rebuild ?? (() => buildFieldBoidsPanel(container, ctrl, opts)))();
  });
  simHead.appendChild(randomBtn);
  container.appendChild(simHead);
  if (opts.paramsHidden) {
    if (opts.tilt) buildTiltRow(container, ctrl, opts.tilt);
    return;
  }
  createRangeSlider(container, { label: 'Particles', min: 1000, max: 2000000, step: 1000, scale: 'log',
    get: () => p.numParticles, set: v => { p.numParticles = Math.round(v); }, history, lock: lockFor('numParticles') });
  createRangeSlider(container, { label: 'Steps per frame', min: 1, max: 30, step: 1,
    get: () => p.stepsPerFrame, set: v => { p.stepsPerFrame = Math.round(v); }, history, lock: lockFor('stepsPerFrame') });
  createRangeSlider(container, { label: 'Attraction radius', min: 0.01, max: 0.5, step: 0.005,
    get: () => p.attractionRadius, set: v => { p.attractionRadius = v; }, history, lock: lockFor('attractionRadius') });
  createRangeSlider(container, { label: 'Repulsion radius', min: 0.005, max: 0.2, step: 0.005,
    get: () => p.repulsionRadius, set: v => { p.repulsionRadius = v; }, history, lock: lockFor('repulsionRadius') });
  createRangeSlider(container, { label: 'Attraction', min: 0, max: 5, step: 0.01,
    get: () => p.attraction, set: v => { p.attraction = v; }, history, lock: lockFor('attraction') });
  createRangeSlider(container, { label: 'Repulsion', min: 0, max: 10, step: 0.01,
    get: () => p.repulsion, set: v => { p.repulsion = v; }, history, lock: lockFor('repulsion') });
  createRangeSlider(container, { label: 'Alignment', min: 0, max: 10, step: 0.01,
    get: () => p.alignment, set: v => { p.alignment = v; }, history, lock: lockFor('alignment') });
  createRangeSlider(container, { label: 'Cone angle', min: -1, max: 1, step: 0.01,
    get: () => p.coneAngle, set: v => { p.coneAngle = v; }, history, lock: lockFor('coneAngle') });
  createRangeSlider(container, { label: 'Friction', min: 0, max: 10, step: 0.1,
    get: () => p.friction, set: v => { p.friction = v; }, history, lock: lockFor('friction') });
  createRangeSlider(container, { label: 'Max speed', min: 0.01, max: 1, step: 0.01,
    get: () => p.maxSpeed, set: v => { p.maxSpeed = v; }, history, lock: lockFor('maxSpeed') });
  createRangeSlider(container, { label: 'Noise', min: 0, max: 0.1, step: 0.001,
    get: () => p.noise, set: v => { p.noise = v; }, history, lock: lockFor('noise') });
  if (opts.tilt) buildTiltRow(container, ctrl, opts.tilt);

  // Field
  divider(container);
  heading(container, 'Field');
  createRangeSlider(container, { label: 'Memory', min: 0, max: 0.99, step: 0.01,
    get: () => p.memory, set: v => { p.memory = v; }, history, lock: lockFor('memory') });
  createRangeSlider(container, { label: 'Splat size', min: 0.5, max: 3, step: 0.1,
    get: () => p.splatSize, set: v => { p.splatSize = v; }, history, lock: lockFor('splatSize') });

  // Look: enums as pill rows, numbers as sliders, all from the shared spec.
  divider(container);
  heading(container, 'Look');
  const pr = p as unknown as Record<string, number>;
  for (const item of LOOK_GROUP.items) {
    if (item.kind === 'enum') {
      pillRow(container, item.label, item.names, () => pr[item.key], i => { pr[item.key] = i; }, history);
    } else {
      createRangeSlider(container, { label: item.label, min: item.min, max: item.max, step: item.step, scale: item.scale,
        get: () => pr[item.key], set: v => { pr[item.key] = item.int ? Math.round(v) : v; }, history, lock: lockFor(item.key) });
    }
  }
}
