// src/components/simulations/boids/panel/boids-panel.ts
import type { BoidsController } from '../boids-controller';
import type { BoidsPreset } from '../../../../data/boids-presets';
import { buildImagePanelSection } from '../../../../lib/webgpu/image-editor/image-panel-section';
import { openImageEditorOverlay  } from '../../../../lib/webgpu/image-editor/image-editor-overlay';
import {
  type AudioReactor,
  type BandSnapshot,
  type AudioMapping,
  BAND_COLORS,
  PARAM_META,
} from '../boids-audio';
import { buildXYPad, type XYPadDef } from './xy-pad';
import { buildAudioTab, type AudioUpdaterMaps } from './audio-tab';
import { createRangeSlider } from './range-slider';
import { pillStyle } from './panel-styles';

// ── Main panel builder ────────────────────────────────────────────────────────

export interface BoidsPanelOpts {
  onShaderEdit?: () => void;
  onClose?: () => void;
  presets?: BoidsPreset[];
  activePresetId?: string;
  onPresetLoad?: (preset: BoidsPreset) => void;
  reactor?: AudioReactor;
}

export function buildBoidsPanel(
  container: HTMLElement,
  controller: BoidsController,
  opts: BoidsPanelOpts = {},
): { teardown: () => void; updateAudioViz: (baseParams?: Record<string, number>) => void } {

  // ── ResizeObserver disconnect registry ───────────────────────────────────────
  const disconnects: Array<() => void> = [];
  const registerDisconnect = (fn: () => void) => disconnects.push(fn);

  // ── Audio visualisation state ─────────────────────────────────────────────
  const updMaps: AudioUpdaterMaps = {
    paramIndicators:     new Map(),
    cellUpdaters:        new Map(),
    totalUpdaters:       new Map(),
    traceUpdaters:       new Map(),
    matrixTraceUpdaters: new Map(),
  };

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const tabBar = document.createElement('div');
  tabBar.style.cssText = [
    'display:flex',
    'border-bottom:1px solid var(--bg-surface-border)',
    'position:relative',
  ].join(';');

  // Close + shader buttons in top-right corner of the bar
  const tabRight = document.createElement('div');
  tabRight.style.cssText = 'display:flex;align-items:center;gap:0.35rem;padding:0 0.35rem;margin-left:auto;';
  if (opts.onShaderEdit) {
    const shaderBtn = document.createElement('button');
    shaderBtn.className = 'panel-close';
    shaderBtn.title = 'Edit Shader';
    shaderBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    shaderBtn.addEventListener('click', opts.onShaderEdit);
    tabRight.appendChild(shaderBtn);
  }
  if (opts.onClose) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', opts.onClose);
    tabRight.appendChild(closeBtn);
  }

  const tabNames = ['Params', 'Audio', 'Image'] as const;
  const tabBodies: Record<string, HTMLDivElement> = {};
  const tabBtns:  Record<string, HTMLButtonElement> = {};

  let activeTab = 'Params';

  function buildTabStyle(active: boolean): string {
    return [
      'padding:5px 8px',
      'font-size:0.62rem',
      'text-transform:uppercase',
      'letter-spacing:0.07em',
      'background:none',
      'border:none',
      'border-bottom:2px solid ' + (active ? 'var(--accent)' : 'transparent'),
      'color:' + (active ? 'var(--accent)' : 'var(--text-muted)'),
      'cursor:pointer',
      'transition:color 0.15s,border-color 0.15s',
    ].join(';');
  }

  let audioVizControls: { start: () => void; stop: () => void } | null = null;

  function switchTab(name: string): void {
    if (name === activeTab) return;
    if (activeTab === 'Audio') audioVizControls?.stop();
    activeTab = name;
    for (const t of tabNames) {
      const isActive = t === name;
      tabBtns[t].style.cssText = buildTabStyle(isActive);
      tabBodies[t].style.display = isActive ? 'block' : 'none';
    }
    if (name === 'Audio') audioVizControls?.start();
  }

  for (const name of tabNames) {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.style.cssText = buildTabStyle(name === 'Params');
    btn.addEventListener('click', () => switchTab(name));
    tabBar.appendChild(btn);
    tabBtns[name] = btn;

    const body = document.createElement('div');
    body.style.display = name === 'Params' ? 'block' : 'none';
    body.style.overflowX = 'hidden';
    tabBodies[name] = body;
  }

  tabBar.appendChild(tabRight);
  container.appendChild(tabBar);

  for (const name of tabNames) container.appendChild(tabBodies[name]);

  const paramsBody = tabBodies['Params'];
  const audioBody  = tabBodies['Audio'];
  const imageBody  = tabBodies['Image'];

  if (opts.reactor) {
    audioVizControls = buildAudioTab(audioBody, opts.reactor, updMaps, registerDisconnect);
    // Start immediately stopped — Params tab is shown first
    audioVizControls.stop();
  } else {
    audioBody.style.cssText = 'padding:8px;color:var(--text-muted);font-size:0.7rem;';
    audioBody.textContent = 'No audio reactor provided.';
  }

  // ── Preset switcher ───────────────────────────────────────────────────────
  if (opts.presets && opts.presets.length > 0) {
    const pillRow = document.createElement('div');
    pillRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:0.3rem 0 0.1rem;';
    for (const preset of opts.presets) {
      const isActive = preset.id === opts.activePresetId;
      const pill = document.createElement('button');
      pill.style.cssText = pillStyle(isActive);
      pill.textContent = preset.name;
      pill.addEventListener('click', () => opts.onPresetLoad?.(preset));
      pillRow.appendChild(pill);
    }
    paramsBody.appendChild(pillRow);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function addSection(parent: HTMLElement, label: string): void {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    parent.appendChild(divider);
    const heading = document.createElement('p');
    heading.className = 'section-heading';
    heading.textContent = label;
    parent.appendChild(heading);
  }

  // ── Appearance ────────────────────────────────────────────────────────────
  addSection(paramsBody, 'Appearance');
  createRangeSlider(paramsBody, {
    label: 'Size', min: 0.001, max: 0.08, step: 0.001,
    get: () => controller.params.size,
    set: v => { controller.params.size = v; },
    scale: 'log',
  });
  createRangeSlider(paramsBody, {
    label: 'Opacity', min: 0.01, max: 1.0, step: 0.01,
    get: () => controller.params.opacity,
    set: v => { controller.params.opacity = v; },
  });
  buildOpacityModeRow(paramsBody, controller);
  buildShapeRow(paramsBody, controller);
  buildColorRow(paramsBody, controller);
  buildTrailsRow(paramsBody, controller);

  // ── Simulation ────────────────────────────────────────────────────────────
  addSection(paramsBody, 'Simulation');
  createRangeSlider(paramsBody, {
    label: 'Time Step', min: 0.001, max: 0.1, step: 0.001,
    get: () => controller.params.dt,
    set: v => { controller.params.dt = v; },
    onIndicatorCreate: (w, f) => updMaps.paramIndicators.set('dt', { wrap: w, fill: f }),
  });
  createRangeSlider(paramsBody, {
    label: 'Particles', min: 10, max: 10000, step: 10,
    get: () => controller.params.numParticles,
    set: v => { controller.params.numParticles = v; },
    scale: 'log',
  });

  // ── Forces ────────────────────────────────────────────────────────────────
  addSection(paramsBody, 'Forces');
  const padTraceUpdaters = buildForcesPads(paramsBody, controller);

  // ── Perception ────────────────────────────────────────────────────────────
  addSection(paramsBody, 'Perception');
  createRangeSlider(paramsBody, {
    label: 'Vision Cone', min: -1.0, max: 0.99, step: 0.05,
    get: () => controller.params.coneAngle,
    set: v => { controller.params.coneAngle = v; },
    onIndicatorCreate: (w, f) => updMaps.paramIndicators.set('coneAngle', { wrap: w, fill: f }),
  });
  createRangeSlider(paramsBody, {
    label: 'Mouse Radius', min: 0.05, max: 0.5, step: 0.01,
    get: () => controller.params.mouseRadius,
    set: v => { controller.params.mouseRadius = v; },
  });

  // ── Image Force Field ─────────────────────────────────────────────────────
  buildImagePanelSection(imageBody, controller.imageProcessor, {
    onOpenEditor: () => {
      const viewport = document.getElementById('sim-viewport') ?? document.body;
      openImageEditorOverlay(controller.imageProcessor, {
        onClose:        () => { /* overlay closed */ },
        onRebindGroups: () => controller.rebuildBoidsBindGroups(),
        onSetForceMode: (m) => controller.imageForce.setForceMode(m),
      }, viewport);
    },
    onRebindGroups: () => controller.rebuildBoidsBindGroups(),
    webcam:         controller.webcam,
    imageForce:     controller.imageForce,
  });

  // Called from the mapping loop in slug.astro every rAF.
  // Reads controller.params (already audio-modulated) to update indicator bars
  // in the Params tab and amplitude bars + traces in the Audio tab.
  let audioWasActive = false;
  function updateAudioViz(baseParams?: Record<string, number>): void {
    const reactor = opts.reactor;
    if (!reactor) return;

    // Reset all param indicators to hidden
    for (const [, ind] of updMaps.paramIndicators) ind.wrap.style.display = 'none';

    if (!reactor.isActive()) {
      if (audioWasActive) {
        for (const [, u] of updMaps.cellUpdaters) u(0);
        for (const fn of padTraceUpdaters) fn(null, [], undefined);
        audioWasActive = false;
      }
      return;
    }
    audioWasActive = true;

    const snapshot = reactor.analyze();

    // Cell amplitude bars + traces
    for (const m of reactor.mappings) {
      if (!m.enabled) continue;
      const key = `${String(m.param)}::${m.band}`;
      const effectiveSignal = Math.min(1, snapshot[m.band] * (m.gain ?? 1));
      updMaps.cellUpdaters.get(key)?.(effectiveSignal);
      updMaps.traceUpdaters.get(key)?.(effectiveSignal);
    }

    // Total-tab live updates
    for (const [param, u] of updMaps.totalUpdaters) {
      const baseVal      = baseParams?.[param] ?? (controller.params as Record<string, number>)[param] ?? 0;
      const modulatedVal = (controller.params as Record<string, number>)[param] ?? 0;
      u(snapshot, baseVal, modulatedVal);
    }

    // Matrix row sparklines (one per param, shows combined modulated value)
    for (const [param, u] of updMaps.matrixTraceUpdaters) {
      const meta = PARAM_META[param];
      if (!meta) continue;
      const modulatedVal = (controller.params as Record<string, number>)[param] ?? 0;
      const range = meta.max - meta.min;
      const normalized = range > 0 ? Math.max(0, Math.min(1, (modulatedVal - meta.min) / range)) : 0;
      u(normalized);
    }

    // XY pad audio traces
    for (const fn of padTraceUpdaters) {
      fn(snapshot, reactor.mappings, baseParams);
    }

    // Param indicators in the Params tab
    for (const m of reactor.mappings) {
      if (!m.enabled) continue;
      const meta = PARAM_META[m.param as string];
      if (!meta) continue;
      const currentVal = (controller.params as Record<string, number>)[m.param as string] ?? 0;
      const range = meta.max - meta.min;
      const fraction = range > 0 ? Math.max(0, Math.min(1, (currentVal - meta.min) / range)) : 0;
      const ind = updMaps.paramIndicators.get(m.param as string);
      if (ind) {
        ind.wrap.style.display = 'block';
        ind.fill.style.width   = `${fraction * 100}%`;
        ind.fill.style.background = BAND_COLORS[m.band];
      }
    }
  }

  return {
    teardown: () => { audioVizControls?.stop(); for (const fn of disconnects) fn(); },
    updateAudioViz,
  };
}

// ── Params tab section builders ───────────────────────────────────────────────
// Each handles one Appearance sub-section. Extracted from buildBoidsPanel to
// keep that function navigable. Add new Appearance controls here, not inline.

function buildOpacityModeRow(parent: HTMLElement, controller: BoidsController): void {
  const modeRow = document.createElement('div');
  modeRow.className = 'param-row';
  const modeLabel = document.createElement('div');
  modeLabel.className = 'param-label';
  modeLabel.innerHTML = '<span>Opacity Mode</span>';
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:4px;';
  const modes = ['velocity', 'uniform'];
  const modeBtns: HTMLButtonElement[] = [];
  for (let mi = 0; mi < modes.length; mi++) {
    const btn = document.createElement('button');
    btn.style.cssText = pillStyle(controller.params.opacityMode === mi);
    btn.textContent = modes[mi];
    btn.addEventListener('click', () => {
      controller.params.opacityMode = mi;
      modeBtns.forEach((b, j) => { b.style.cssText = pillStyle(j === mi); });
    });
    modeBtns.push(btn);
    btnRow.appendChild(btn);
  }
  modeRow.appendChild(modeLabel);
  modeRow.appendChild(btnRow);
  parent.appendChild(modeRow);
}

function buildShapeRow(parent: HTMLElement, controller: BoidsController): void {
  const labelEl = document.createElement('div');
  labelEl.className = 'param-label';
  labelEl.innerHTML = '<span>Shape</span>';
  parent.appendChild(labelEl);
  const shapeRow = document.createElement('div');
  shapeRow.className = 'shape-row';
  const shapes = [
    { id: 0, glyph: '▲' },
    { id: 1, glyph: '●' },
    { id: 2, glyph: '◆' },
    { id: 3, glyph: '✦' },
  ];
  const shapeBtns: HTMLButtonElement[] = [];
  for (const s of shapes) {
    const btn = document.createElement('button');
    btn.className = 'shape-btn' + (controller.params.shapeId === s.id ? ' active' : '');
    btn.textContent = s.glyph;
    btn.title = ['Triangle', 'Circle', 'Diamond', 'Blob'][s.id];
    btn.addEventListener('click', () => {
      controller.params.shapeId = s.id;
      shapeBtns.forEach((b, i) => b.classList.toggle('active', i === s.id));
    });
    shapeBtns.push(btn);
    shapeRow.appendChild(btn);
  }
  parent.appendChild(shapeRow);
}

function buildColorRow(parent: HTMLElement, controller: BoidsController): void {
  const labelEl = document.createElement('div');
  labelEl.className = 'param-label';
  labelEl.innerHTML = '<span>Color</span>';
  parent.appendChild(labelEl);
  const colorRow = document.createElement('div');
  colorRow.className = 'color-row';
  const colorPresets = [
    { hex: '#e0a040', r: 0.88, g: 0.63, b: 0.25, label: 'Amber' },
    { hex: '#4090e0', r: 0.25, g: 0.56, b: 0.88, label: 'Blue'  },
    { hex: '#50c878', r: 0.31, g: 0.78, b: 0.47, label: 'Green' },
    { hex: '#e05080', r: 0.88, g: 0.31, b: 0.50, label: 'Rose'  },
    { hex: '#ffffff', r: 1.00, g: 1.00, b: 1.00, label: 'White' },
  ];
  const swatches: HTMLButtonElement[] = [];
  function applyColor(r: number, g: number, b: number): void {
    controller.params.colorR = r;
    controller.params.colorG = g;
    controller.params.colorB = b;
  }
  function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  for (let i = 0; i < colorPresets.length; i++) {
    const p = colorPresets[i];
    const btn = document.createElement('button');
    btn.className = 'color-swatch' + (i === 0 ? ' active' : '');
    btn.style.background = p.hex;
    btn.title = p.label;
    btn.addEventListener('click', () => {
      applyColor(p.r, p.g, p.b);
      swatches.forEach((s, j) => s.classList.toggle('active', j === i));
      colorPicker.value = p.hex;
    });
    swatches.push(btn);
    colorRow.appendChild(btn);
  }
  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.className = 'color-picker';
  colorPicker.value = colorPresets[0].hex;
  colorPicker.title = 'Custom color';
  colorPicker.addEventListener('input', () => {
    const [r, g, b] = hexToRgb(colorPicker.value);
    applyColor(r, g, b);
    swatches.forEach(s => s.classList.remove('active'));
  });
  colorRow.appendChild(colorPicker);
  parent.appendChild(colorRow);
}

function buildTrailsRow(parent: HTMLElement, controller: BoidsController): void {
  const trailRow = document.createElement('div');
  trailRow.className = 'trail-row';
  const trailLabel = document.createElement('span');
  trailLabel.textContent = 'Trails';
  const toggleWrap = document.createElement('label');
  toggleWrap.className = 'toggle-switch';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.checked = controller.trailsEnabled;
  const toggleSlider = document.createElement('span');
  toggleSlider.className = 'toggle-slider';
  toggleWrap.appendChild(toggleInput);
  toggleWrap.appendChild(toggleSlider);
  trailRow.appendChild(trailLabel);
  trailRow.appendChild(toggleWrap);
  parent.appendChild(trailRow);
  const decayWrapper = document.createElement('div');
  decayWrapper.style.display = controller.trailsEnabled ? 'block' : 'none';
  createRangeSlider(decayWrapper, {
    label: 'Trail Decay',
    min: 0.80, max: 0.99, step: 0.01,
    get: () => controller.trailDecay,
    set: v => { controller.trailDecay = v; },
  });
  parent.appendChild(decayWrapper);
  toggleInput.addEventListener('change', () => {
    controller.trailsEnabled = toggleInput.checked;
    decayWrapper.style.display = toggleInput.checked ? 'block' : 'none';
  });
}

// ── Forces XY pads ────────────────────────────────────────────────────────────

function buildForcesPads(
  parent: HTMLElement,
  controller: BoidsController,
): Array<(snapshot: BandSnapshot | null, mappings: AudioMapping[], baseParams?: Record<string, number>) => void> {
  const grid = document.createElement('div');
  grid.className = 'pads-grid';
  parent.appendChild(grid);

  const pads: Array<{ xDef: XYPadDef; yDef: XYPadDef }> = [
    // TL: Attraction (Y) × Repulsion (X)
    {
      yDef: { paramKey: 'attraction',   label: 'Attraction', iconId: 'ic-attract', min: 0,    max: 2.0, scale: 'linear' },
      xDef: { paramKey: 'repulsion',    label: 'Repulsion',  iconId: 'ic-repulse', min: 0,    max: 5.0, scale: 'linear' },
    },
    // TR: Attr Radius (Y) × Rep Radius (X)
    {
      yDef: { paramKey: 'attractionRadius', label: 'Attr Radius', iconId: 'ic-radius', min: 0.02, max: 0.6,  scale: 'log' },
      xDef: { paramKey: 'repulsionRadius',  label: 'Rep Radius',  iconId: 'ic-radius', min: 0.01, max: 0.3,  scale: 'log' },
    },
    // BL: Alignment (Y) × Noise (X)
    {
      yDef: { paramKey: 'alignment', label: 'Alignment', iconId: 'ic-align', min: 0, max: 1.0, scale: 'linear' },
      xDef: { paramKey: 'noise',     label: 'Noise',     iconId: 'ic-noise', min: 0, max: 0.5, scale: 'linear' },
    },
    // BR: Max Speed (Y) × Friction (X)
    {
      yDef: { paramKey: 'maxSpeed', label: 'Max Speed', iconId: 'ic-speed',    min: 0.01, max: 1.0,  scale: 'linear' },
      xDef: { paramKey: 'friction', label: 'Friction',  iconId: 'ic-friction', min: 0,    max: 10.0, scale: 'linear' },
    },
  ];

  const updaters: Array<(snapshot: BandSnapshot | null, mappings: AudioMapping[], baseParams?: Record<string, number>) => void> = [];

  for (const { xDef, yDef } of pads) {
    const { updateTrace } = buildXYPad(grid, xDef, yDef, controller);
    updaters.push(updateTrace);
  }

  return updaters;
}

// ── Reset button helper ───────────────────────────────────────────────────────
// Returns a small ↺ button wired to a range slider. Invisible when at default,
// muted when changed, accent on hover. Dispatches 'input' so the slider's own
// listener handles value propagation.

export function makeResetBtn(slider: HTMLInputElement, defaultValue: number): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = '↺';
  btn.title = `Reset to ${defaultValue}`;
  btn.style.cssText = [
    'background:none;border:none;cursor:pointer;padding:0 1px;',
    'font-size:0.7rem;line-height:1;border-radius:2px;flex-shrink:0;',
    'color:var(--bg-surface-border);transition:color 0.1s;',
  ].join('');

  function sync(): void {
    const atDefault = Math.abs(parseFloat(slider.value) - defaultValue) < 0.001;
    btn.style.color = atDefault ? 'var(--bg-surface-border)' : 'var(--text-muted)';
  }

  slider.addEventListener('input', sync);
  sync();

  btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--accent)'; });
  btn.addEventListener('mouseleave', sync);
  btn.addEventListener('click', () => {
    slider.value = String(defaultValue);
    slider.dispatchEvent(new Event('input'));
  });

  return btn;
}
