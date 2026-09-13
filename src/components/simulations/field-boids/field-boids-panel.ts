// src/components/simulations/field-boids/field-boids-panel.ts
import type { FieldBoidsController } from './field-boids-controller';
import type { FieldBoidsPreset } from './field-boids-types';
import { createRangeSlider } from '../boids/panel/range-slider';
import { pillStyle } from '../boids/panel/panel-styles';

export interface FieldBoidsPanelOpts {
  presets?: FieldBoidsPreset[];
  activePresetId?: string;
  onPresetLoad?: (preset: FieldBoidsPreset) => void;
  onClose?: () => void;
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

export function buildFieldBoidsPanel(
  container: HTMLElement,
  ctrl: FieldBoidsController,
  opts: FieldBoidsPanelOpts = {},
): void {
  container.innerHTML = '';
  const p = ctrl.params;

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

  // Preset pills
  if (opts.presets && opts.presets.length > 0) {
    const pillRow = el('div', 'display:flex;flex-wrap:wrap;gap:4px;margin:0 0 0.4rem;');
    for (const preset of opts.presets) {
      const pill = el('button', pillStyle(preset.id === opts.activePresetId), preset.name);
      pill.addEventListener('click', () => opts.onPresetLoad?.(preset));
      pillRow.appendChild(pill);
    }
    container.appendChild(pillRow);
  }

  // Simulation
  heading(container, 'Simulation');
  createRangeSlider(container, { label: 'Particles', min: 1000, max: 2000000, step: 1000, scale: 'log',
    get: () => p.numParticles, set: v => { p.numParticles = Math.round(v); } });
  createRangeSlider(container, { label: 'Attraction radius', min: 0.01, max: 0.5, step: 0.005,
    get: () => p.attractionRadius, set: v => { p.attractionRadius = v; } });
  createRangeSlider(container, { label: 'Repulsion radius', min: 0.005, max: 0.2, step: 0.005,
    get: () => p.repulsionRadius, set: v => { p.repulsionRadius = v; } });
  createRangeSlider(container, { label: 'Attraction', min: 0, max: 5, step: 0.01,
    get: () => p.attraction, set: v => { p.attraction = v; } });
  createRangeSlider(container, { label: 'Repulsion', min: 0, max: 10, step: 0.01,
    get: () => p.repulsion, set: v => { p.repulsion = v; } });
  createRangeSlider(container, { label: 'Alignment', min: 0, max: 10, step: 0.01,
    get: () => p.alignment, set: v => { p.alignment = v; } });
  createRangeSlider(container, { label: 'Cone angle', min: -1, max: 1, step: 0.01,
    get: () => p.coneAngle, set: v => { p.coneAngle = v; } });
  createRangeSlider(container, { label: 'Friction', min: 0, max: 10, step: 0.1,
    get: () => p.friction, set: v => { p.friction = v; } });
  createRangeSlider(container, { label: 'Max speed', min: 0.01, max: 1, step: 0.01,
    get: () => p.maxSpeed, set: v => { p.maxSpeed = v; } });
  createRangeSlider(container, { label: 'Noise', min: 0, max: 0.1, step: 0.001,
    get: () => p.noise, set: v => { p.noise = v; } });

  // Field
  divider(container);
  heading(container, 'Field');
  createRangeSlider(container, { label: 'Memory', min: 0, max: 0.99, step: 0.01,
    get: () => p.memory, set: v => { p.memory = v; } });
  createRangeSlider(container, { label: 'Splat size', min: 0.5, max: 6, step: 0.1,
    get: () => p.splatSize, set: v => { p.splatSize = v; } });

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
    });
    modeBtns.push(b);
    modeRow.appendChild(b);
  });
  container.appendChild(modeRow);
  createRangeSlider(container, { label: 'Exposure', min: 0.1, max: 20, step: 0.1, scale: 'log',
    get: () => p.exposure, set: v => { p.exposure = v; } });
  createRangeSlider(container, { label: 'Point alpha', min: 0.01, max: 1, step: 0.01,
    get: () => p.pointAlpha, set: v => { p.pointAlpha = v; } });
}
