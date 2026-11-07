// src/components/simulations/field-boids/field-boids-panel.ts
import type { FieldBoidsController } from './field-boids-controller';
import type { FieldBoidsPreset } from './field-boids-types';
import { createRangeSlider } from '../boids/panel/range-slider';
import { pillStyle } from '../boids/panel/panel-styles';
import type { UndoHistory } from '../../../lib/presets/undo-history';
import type { TiltSensor } from '../../../lib/sim-page/tilt-sensor';
import { randomizeFieldBoidsParams } from './field-boids-randomize';

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

const VIEW_MODES = ['Density', 'Flow', 'Points'] as const;
const RANDOM_BTN = 'padding:2px 8px;border-radius:4px;border:1px solid var(--bg-surface-border);background:transparent;color:var(--text-body);font-size:0.66rem;cursor:pointer;white-space:nowrap;line-height:1.3;';

/** "Tilt gravity" switch. Not a preset param: it is a device setting, and
 *  the sensor keeps its own state so the row survives panel rebuilds. */
function buildTiltRow(parent: HTMLElement, tilt: TiltSensor): void {
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
}

export function buildFieldBoidsPanel(
  container: HTMLElement,
  ctrl: FieldBoidsController,
  opts: FieldBoidsPanelOpts = {},
): void {
  container.innerHTML = '';
  const p = ctrl.params;
  const history = opts.history;

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
  heading(simHead, 'Simulation');
  const randomBtn = el('button', RANDOM_BTN, '⚄ Randomize');
  randomBtn.title = 'Random dynamics (particle count and view unchanged)';
  randomBtn.addEventListener('click', () => {
    history?.endGesture();
    randomizeFieldBoidsParams(p);
    history?.push('Randomize');
    (opts.rebuild ?? (() => buildFieldBoidsPanel(container, ctrl, opts)))();
  });
  simHead.appendChild(randomBtn);
  container.appendChild(simHead);
  createRangeSlider(container, { label: 'Particles', min: 1000, max: 2000000, step: 1000, scale: 'log',
    get: () => p.numParticles, set: v => { p.numParticles = Math.round(v); }, history });
  createRangeSlider(container, { label: 'Steps per frame', min: 1, max: 30, step: 1,
    get: () => p.stepsPerFrame, set: v => { p.stepsPerFrame = Math.round(v); }, history });
  createRangeSlider(container, { label: 'Attraction radius', min: 0.01, max: 0.5, step: 0.005,
    get: () => p.attractionRadius, set: v => { p.attractionRadius = v; }, history });
  createRangeSlider(container, { label: 'Repulsion radius', min: 0.005, max: 0.2, step: 0.005,
    get: () => p.repulsionRadius, set: v => { p.repulsionRadius = v; }, history });
  createRangeSlider(container, { label: 'Attraction', min: 0, max: 5, step: 0.01,
    get: () => p.attraction, set: v => { p.attraction = v; }, history });
  createRangeSlider(container, { label: 'Repulsion', min: 0, max: 10, step: 0.01,
    get: () => p.repulsion, set: v => { p.repulsion = v; }, history });
  createRangeSlider(container, { label: 'Alignment', min: 0, max: 10, step: 0.01,
    get: () => p.alignment, set: v => { p.alignment = v; }, history });
  createRangeSlider(container, { label: 'Cone angle', min: -1, max: 1, step: 0.01,
    get: () => p.coneAngle, set: v => { p.coneAngle = v; }, history });
  createRangeSlider(container, { label: 'Friction', min: 0, max: 10, step: 0.1,
    get: () => p.friction, set: v => { p.friction = v; }, history });
  createRangeSlider(container, { label: 'Max speed', min: 0.01, max: 1, step: 0.01,
    get: () => p.maxSpeed, set: v => { p.maxSpeed = v; }, history });
  createRangeSlider(container, { label: 'Noise', min: 0, max: 0.1, step: 0.001,
    get: () => p.noise, set: v => { p.noise = v; }, history });
  createRangeSlider(container, { label: 'Gravity', min: 0, max: 1, step: 0.005,
    get: () => p.gravity, set: v => { p.gravity = v; }, history });
  if (opts.tilt) buildTiltRow(container, opts.tilt);

  // Field
  divider(container);
  heading(container, 'Field');
  createRangeSlider(container, { label: 'Memory', min: 0, max: 0.99, step: 0.01,
    get: () => p.memory, set: v => { p.memory = v; }, history });
  createRangeSlider(container, { label: 'Splat size', min: 0.5, max: 3, step: 0.1,
    get: () => p.splatSize, set: v => { p.splatSize = v; }, history });

  // View
  divider(container);
  heading(container, 'View');
  const modeRow = el('div', 'display:flex;gap:4px;margin-bottom:0.4rem;');
  const modeBtns: HTMLButtonElement[] = [];
  VIEW_MODES.forEach((name, i) => {
    const b = el('button', pillStyle(p.viewMode === i), name);
    b.addEventListener('click', () => {
      p.viewMode = i;
      modeBtns.forEach((mb, k) => { mb.style.cssText = pillStyle(k === i); });
      history?.push('View mode');
    });
    modeBtns.push(b);
    modeRow.appendChild(b);
  });
  container.appendChild(modeRow);
  createRangeSlider(container, { label: 'Exposure', min: 0.1, max: 20, step: 0.1, scale: 'log',
    get: () => p.exposure, set: v => { p.exposure = v; }, history });
  createRangeSlider(container, { label: 'Point alpha', min: 0.01, max: 1, step: 0.01,
    get: () => p.pointAlpha, set: v => { p.pointAlpha = v; }, history });
}
