// src/components/simulations/boids/boids-panel.ts
import type { BoidsController } from './boids-controller';
import type { BoidsPreset } from '../../../data/boids-presets';
import { buildImagePanelSection } from '../../../lib/webgpu/image-editor/image-panel-section';
import { openImageEditorOverlay  } from '../../../lib/webgpu/image-editor/image-editor-overlay';
import {
  type AudioReactor,
  type BandKey,
  type AudioMapping,
  type BandSnapshot,
  BAND_COLORS,
  PARAM_META,
  MAPPABLE_PARAMS,
  drawAudioViz,
} from './boids-audio';

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
  // ── Audio visualisation state — declared first so buildAudioTab can capture them ──
  const paramIndicators = new Map<string, { wrap: HTMLElement; fill: HTMLElement }>();
  const cellUpdaters        = new Map<string, (amplitude: number) => void>();
  const totalUpdaters       = new Map<string, (snapshot: BandSnapshot, baseVal: number, modulatedVal: number) => void>();
  const traceUpdaters       = new Map<string, (amplitude: number) => void>();
  const matrixTraceUpdaters = new Map<string, (normalizedVal: number) => void>();

  // ── Tab bar (replaces old plain header) ──────────────────────────
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

  // Append all three bodies to container
  for (const name of tabNames) container.appendChild(tabBodies[name]);

  // Shorthand references used in the sections below
  const paramsBody = tabBodies['Params'];
  const audioBody  = tabBodies['Audio'];
  const imageBody  = tabBodies['Image'];

  // Audio tab placeholder — replaced in Tasks 7–9
  if (opts.reactor) {
    audioVizControls = buildAudioTab(audioBody, opts.reactor, switchTab, cellUpdaters, totalUpdaters, traceUpdaters, matrixTraceUpdaters);
    // Start immediately stopped since Params tab is shown first
    audioVizControls.stop();
  } else {
    audioBody.style.cssText = 'padding:8px;color:var(--text-muted);font-size:0.7rem;';
    audioBody.textContent = 'No audio reactor provided.';
  }

  // ── Preset switcher ───────────────────────────────────────────────
  if (opts.presets && opts.presets.length > 0) {
    const pillRow = document.createElement('div');
    pillRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:0.3rem 0 0.1rem;';
    for (const preset of opts.presets) {
      const isActive = preset.id === opts.activePresetId;
      const pill = document.createElement('button');
      pill.style.cssText = [
        'padding:2px 8px',
        'border-radius:12px',
        'font-size:0.68rem',
        'cursor:pointer',
        'transition:background 0.15s,color 0.15s',
        isActive
          ? 'background:var(--accent);color:var(--bg-primary);border:1px solid transparent;'
          : 'background:transparent;color:var(--text-muted);border:1px solid var(--bg-surface-border);',
      ].join(';');
      pill.textContent = preset.name;
      pill.addEventListener('click', () => opts.onPresetLoad?.(preset));
      pillRow.appendChild(pill);
    }
    paramsBody.appendChild(pillRow);
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function addSection(parent: HTMLElement, label: string): void {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    parent.appendChild(divider);
    const heading = document.createElement('p');
    heading.className = 'section-heading';
    heading.textContent = label;
    parent.appendChild(heading);
  }

  function addSlider(
    parent: HTMLElement,
    label: string,
    min: number, max: number, step: number,
    get: () => number,
    set: (v: number) => void,
    scale: 'linear' | 'log' = 'linear',
    paramKey?: string,
  ): void {
    const row = document.createElement('div');
    row.className = 'param-row';
    const labelEl = document.createElement('div');
    labelEl.className = 'param-label';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = label;
    const valueSpan = document.createElement('span');
    valueSpan.className = 'param-value';
    valueSpan.style.cursor = 'text';
    valueSpan.title = 'Click to edit';
    labelEl.appendChild(nameSpan);
    labelEl.appendChild(valueSpan);
    const input = document.createElement('input');
    input.type = 'range';

    const isLog = scale === 'log';
    const sliderMin = isLog ? Math.log(min) : min;
    const sliderMax = isLog ? Math.log(max) : max;
    const sliderStep = isLog ? (sliderMax - sliderMin) / 1000 : step;
    const decimals = step >= 1 ? 0 : (String(step).split('.')[1]?.length ?? 2);

    function sliderToValue(s: number): number {
      if (!isLog) return s;
      const v = Math.exp(s);
      return decimals === 0 ? Math.round(v) : parseFloat(v.toFixed(decimals));
    }
    function valueToSlider(v: number): number {
      return isLog ? Math.log(Math.max(v, min)) : v;
    }

    input.min = String(sliderMin);
    input.max = String(sliderMax);
    input.step = String(sliderStep);
    input.value = String(valueToSlider(get()));
    valueSpan.textContent = get().toFixed(decimals);

    input.addEventListener('input', () => {
      const val = sliderToValue(parseFloat(input.value));
      set(val);
      valueSpan.textContent = val.toFixed(decimals);
    });

    valueSpan.addEventListener('click', () => {
      const lastVal = get();
      const editInput = document.createElement('input');
      editInput.type = 'text';
      editInput.value = lastVal.toFixed(decimals);
      editInput.className = 'param-value-edit';
      valueSpan.replaceWith(editInput);
      editInput.select();

      function commit(): void {
        const raw = decimals === 0 ? parseInt(editInput.value, 10) : parseFloat(editInput.value);
        const isValid = !isNaN(raw) && raw >= min && raw <= max;
        const finalVal = isValid ? raw : lastVal;
        if (isValid) {
          set(finalVal);
          input.value = String(valueToSlider(finalVal));
        }
        valueSpan.textContent = finalVal.toFixed(decimals);
        editInput.replaceWith(valueSpan);
      }

      editInput.addEventListener('blur', commit);
      editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { editInput.blur(); }
        if (e.key === 'Escape') { editInput.value = lastVal.toFixed(decimals); editInput.blur(); }
      });
      editInput.focus();
    });

    row.appendChild(labelEl);
    row.appendChild(input);
    // Audio modulation indicator — thin colored bar below the slider track,
    // shown only when an active mapping targets this param.
    if (paramKey) {
      const indWrap = document.createElement('div');
      indWrap.style.cssText = 'height:2px;background:var(--bg-surface-border);border-radius:1px;overflow:hidden;margin-top:2px;display:none;';
      const indFill = document.createElement('div');
      indFill.style.cssText = 'height:100%;width:0%;border-radius:1px;';
      indWrap.appendChild(indFill);
      row.appendChild(indWrap);
      paramIndicators.set(paramKey, { wrap: indWrap, fill: indFill });
    }
    parent.appendChild(row);
  }

  // ── Appearance ────────────────────────────────────────────────────
  addSection(paramsBody, 'Appearance');
  addSlider(paramsBody, 'Size', 0.001, 0.08, 0.001, () => controller.params.size, v => { controller.params.size = v; }, 'log');
  addSlider(paramsBody, 'Opacity', 0.01, 1.0, 0.01, () => controller.params.opacity, v => { controller.params.opacity = v; });

  // Opacity mode toggle
  {
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
      btn.style.cssText = [
        'padding:2px 8px',
        'border-radius:12px',
        'font-size:0.68rem',
        'cursor:pointer',
        'transition:background 0.15s,color 0.15s',
        controller.params.opacityMode === mi
          ? 'background:var(--accent);color:var(--bg-primary);border:1px solid transparent;'
          : 'background:transparent;color:var(--text-muted);border:1px solid var(--bg-surface-border);',
      ].join(';');
      btn.textContent = modes[mi];
      btn.addEventListener('click', () => {
        controller.params.opacityMode = mi;
        modeBtns.forEach((b, j) => {
          b.style.cssText = [
            'padding:2px 8px',
            'border-radius:12px',
            'font-size:0.68rem',
            'cursor:pointer',
            'transition:background 0.15s,color 0.15s',
            j === mi
              ? 'background:var(--accent);color:var(--bg-primary);border:1px solid transparent;'
              : 'background:transparent;color:var(--text-muted);border:1px solid var(--bg-surface-border);',
          ].join(';');
        });
      });
      modeBtns.push(btn);
      btnRow.appendChild(btn);
    }
    modeRow.appendChild(modeLabel);
    modeRow.appendChild(btnRow);
    paramsBody.appendChild(modeRow);
  }

  // Shape selector
  {
    const labelEl = document.createElement('div');
    labelEl.className = 'param-label';
    labelEl.innerHTML = '<span>Shape</span>';
    paramsBody.appendChild(labelEl);
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
    paramsBody.appendChild(shapeRow);
  }

  // Color
  {
    const labelEl = document.createElement('div');
    labelEl.className = 'param-label';
    labelEl.innerHTML = '<span>Color</span>';
    paramsBody.appendChild(labelEl);
    const colorRow = document.createElement('div');
    colorRow.className = 'color-row';
    const colorPresets = [
      { hex: '#e0a040', r: 0.88, g: 0.63, b: 0.25, label: 'Amber' },
      { hex: '#4090e0', r: 0.25, g: 0.56, b: 0.88, label: 'Blue' },
      { hex: '#50c878', r: 0.31, g: 0.78, b: 0.47, label: 'Green' },
      { hex: '#e05080', r: 0.88, g: 0.31, b: 0.50, label: 'Rose' },
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
    paramsBody.appendChild(colorRow);
  }

  // Trails
  {
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
    paramsBody.appendChild(trailRow);
    const decayWrapper = document.createElement('div');
    decayWrapper.style.display = controller.trailsEnabled ? 'block' : 'none';
    addSlider(decayWrapper, 'Trail Decay', 0.80, 0.99, 0.01,
      () => controller.trailDecay,
      v => { controller.trailDecay = v; },
    );
    paramsBody.appendChild(decayWrapper);
    toggleInput.addEventListener('change', () => {
      controller.trailsEnabled = toggleInput.checked;
      decayWrapper.style.display = toggleInput.checked ? 'block' : 'none';
    });
  }

  // ── Simulation ────────────────────────────────────────────────────
  addSection(paramsBody, 'Simulation');
  addSlider(paramsBody, 'Time Step', 0.001, 0.1,  0.001, () => controller.params.dt,           v => { controller.params.dt = v; }, 'linear', 'dt');
  addSlider(paramsBody, 'Particles', 10,    10000, 10,    () => controller.params.numParticles,  v => { controller.params.numParticles = v; }, 'log');

  // ── Forces ────────────────────────────────────────────────────────
  addSection(paramsBody, 'Forces');
  addSlider(paramsBody, 'Attraction Radius', 0.02, 0.6,  0.01,  () => controller.params.attractionRadius, v => { controller.params.attractionRadius = v; }, 'linear', 'attractionRadius');
  addSlider(paramsBody, 'Repulsion Radius',  0.01, 0.3,  0.005, () => controller.params.repulsionRadius,  v => { controller.params.repulsionRadius = v; }, 'linear', 'repulsionRadius');
  addSlider(paramsBody, 'Attraction',        0,    2.0,  0.01,  () => controller.params.attraction,       v => { controller.params.attraction = v; }, 'linear', 'attraction');
  addSlider(paramsBody, 'Repulsion',         0,    5.0,  0.05,  () => controller.params.repulsion,        v => { controller.params.repulsion = v; }, 'linear', 'repulsion');
  addSlider(paramsBody, 'Alignment',         0,    1.0,  0.01,  () => controller.params.alignment,        v => { controller.params.alignment = v; }, 'linear', 'alignment');
  addSlider(paramsBody, 'Friction',          0,    10.0, 0.1,   () => controller.params.friction,         v => { controller.params.friction = v; }, 'linear', 'friction');
  addSlider(paramsBody, 'Max Speed',         0.01, 1.0,  0.01,  () => controller.params.maxSpeed,         v => { controller.params.maxSpeed = v; }, 'linear', 'maxSpeed');
  addSlider(paramsBody, 'Noise',             0,    0.5,  0.005, () => controller.params.noise ?? 0,            v => { controller.params.noise = v; });

  // ── Perception ────────────────────────────────────────────────────
  addSection(paramsBody, 'Perception');
  addSlider(paramsBody, 'Vision Cone',  -1.0, 0.99, 0.05, () => controller.params.coneAngle,   v => { controller.params.coneAngle = v; }, 'linear', 'coneAngle');
  addSlider(paramsBody, 'Mouse Radius', 0.05, 0.5,  0.01, () => controller.params.mouseRadius, v => { controller.params.mouseRadius = v; });

  // ── Image Force Field ─────────────────────────────────────────────
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
  // Reads controller.params (already audio-modulated at this point) to update
  // the indicator bars in the Params tab and amplitude bars + traces in the Audio tab.
  function updateAudioViz(baseParams?: Record<string, number>): void {
    const reactor = opts.reactor;
    if (!reactor) return;

    // Reset all param indicators to hidden first
    for (const [, ind] of paramIndicators) ind.wrap.style.display = 'none';

    if (!reactor.isActive()) {
      for (const [, u] of cellUpdaters) u(0);
      return;
    }

    const snapshot = reactor.analyze();

    // Cell amplitude bars + traces
    for (const m of reactor.mappings) {
      if (!m.enabled) continue;
      const key = `${String(m.param)}::${m.band}`;
      const effectiveSignal = Math.min(1, snapshot[m.band] * (m.gain ?? 1));
      cellUpdaters.get(key)?.(effectiveSignal);
      traceUpdaters.get(key)?.(effectiveSignal);
    }

    // Total-tab live updates
    for (const [param, u] of totalUpdaters) {
      const baseVal      = baseParams?.[param] ?? (controller.params as Record<string, number>)[param] ?? 0;
      const modulatedVal = (controller.params as Record<string, number>)[param] ?? 0;
      u(snapshot, baseVal, modulatedVal);
    }

    // Matrix row sparklines (one per param, shows combined modulated value)
    for (const [param, u] of matrixTraceUpdaters) {
      const meta = PARAM_META[param];
      if (!meta) continue;
      const modulatedVal = (controller.params as Record<string, number>)[param] ?? 0;
      const range = meta.max - meta.min;
      const normalized = range > 0 ? Math.max(0, Math.min(1, (modulatedVal - meta.min) / range)) : 0;
      u(normalized);
    }

    // Param indicators in the Params tab
    for (const m of reactor.mappings) {
      if (!m.enabled) continue;
      const meta = PARAM_META[m.param as string];
      if (!meta) continue;
      const currentVal = (controller.params as Record<string, number>)[m.param as string] ?? 0;
      const range = meta.max - meta.min;
      const fraction = range > 0 ? Math.max(0, Math.min(1, (currentVal - meta.min) / range)) : 0;
      const ind = paramIndicators.get(m.param as string);
      if (ind) {
        ind.wrap.style.display = 'block';
        ind.fill.style.width   = `${fraction * 100}%`;
        ind.fill.style.background = BAND_COLORS[m.band];
      }
    }
  }

  return {
    teardown: () => {
      audioVizControls?.stop();
    },
    updateAudioViz,
  };
}

// ── Reset button helper ───────────────────────────────────────────────────────
// Returns a small ↺ button wired to a range slider. Invisible when at default,
// muted when changed, accent on hover. Dispatches 'input' so the slider's own
// listener handles value propagation.

function makeResetBtn(slider: HTMLInputElement, defaultValue: number): HTMLButtonElement {
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
  sync(); // set initial state

  btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--accent)'; });
  btn.addEventListener('mouseleave', sync);
  btn.addEventListener('click', () => {
    slider.value = String(defaultValue);
    slider.dispatchEvent(new Event('input'));
  });

  return btn;
}

// ── Audio tab builder ─────────────────────────────────────────────────────────

function buildAudioTab(
  container: HTMLElement,
  reactor: AudioReactor,
  switchTab: (name: string) => void,
  cellUpdaters: Map<string, (amplitude: number) => void>,
  totalUpdaters: Map<string, (snapshot: BandSnapshot, baseVal: number, modulatedVal: number) => void>,
  traceUpdaters: Map<string, (amplitude: number) => void>,
  matrixTraceUpdaters: Map<string, (normalizedVal: number) => void>,
): { start: () => void; stop: () => void } {

  // Do NOT touch display here — it's managed by switchTab (setting display:flex
  // would overwrite the display:none set during tab body creation, causing Audio
  // content to bleed into the Params tab on initial render).
  container.style.overflowX = 'hidden';

  // ── Source row ────────────────────────────────────────────────────
  const sourceSection = document.createElement('div');
  sourceSection.style.cssText = 'padding:8px 8px 6px;border-bottom:1px solid var(--bg-surface-border);';

  const sourceLabel = document.createElement('div');
  sourceLabel.style.cssText = 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:5px;';
  sourceLabel.textContent = 'Audio Source';

  const sourceBtnRow = document.createElement('div');
  sourceBtnRow.style.cssText = 'display:flex;align-items:center;gap:5px;';

  function pillStyle(active: boolean): string {
    return [
      'padding:2px 8px',
      'border-radius:12px',
      'font-size:0.68rem',
      'cursor:pointer',
      'transition:background 0.15s,color 0.15s',
      active
        ? 'background:var(--accent);color:var(--bg-primary);border:1px solid transparent;'
        : 'background:transparent;color:var(--text-muted);border:1px solid var(--bg-surface-border);',
    ].join(';');
  }

  const micBtn = document.createElement('button');
  micBtn.textContent = 'Microphone';
  micBtn.style.cssText = pillStyle(false);

  const sysBtn = document.createElement('button');
  sysBtn.textContent = 'System Audio';
  sysBtn.style.cssText = pillStyle(false);

  // Status dot
  const statusDot = document.createElement('span');
  statusDot.style.cssText = [
    'width:7px;height:7px;border-radius:50%;',
    'display:inline-block;margin-left:auto;',
    'background:var(--text-muted);transition:background 0.2s;',
  ].join('');

  const errorMsg = document.createElement('div');
  errorMsg.style.cssText = 'font-size:0.62rem;color:#e05060;margin-top:4px;display:none;word-break:break-word;';

  function updateStatus(): void {
    if (reactor.status === 'active') {
      statusDot.style.background = 'var(--accent)';
      statusDot.style.boxShadow  = '0 0 4px var(--accent)';
      micBtn.style.cssText = pillStyle(reactor.activeSourceKind === 'microphone');
      sysBtn.style.cssText = pillStyle(reactor.activeSourceKind === 'system');
      errorMsg.style.display = 'none';
    } else if (reactor.status === 'error') {
      statusDot.style.background = '#e05060';
      statusDot.style.boxShadow  = 'none';
      errorMsg.textContent = reactor.lastError;
      errorMsg.style.display = 'block';
      micBtn.style.cssText = pillStyle(false);
      sysBtn.style.cssText = pillStyle(false);
    } else {
      statusDot.style.background = 'var(--text-muted)';
      statusDot.style.boxShadow  = 'none';
      micBtn.style.cssText = pillStyle(false);
      sysBtn.style.cssText = pillStyle(false);
      errorMsg.style.display = 'none';
    }
  }

  async function startSource(kind: 'microphone' | 'system'): Promise<void> {
    if (reactor.isActive()) {
      if (reactor.activeSourceKind === kind) {
        // Clicking the already-active source toggles it off
        reactor.stop();
        updateStatus();
        return;
      }
      // Clicking a different source: stop current and switch
      reactor.stop();
    }
    try {
      await reactor.start(kind);
    } catch { /* error already stored in reactor.lastError */ }
    updateStatus();
  }

  micBtn.addEventListener('click', () => void startSource('microphone'));
  sysBtn.addEventListener('click', () => void startSource('system'));

  sourceBtnRow.appendChild(micBtn);
  sourceBtnRow.appendChild(sysBtn);
  sourceBtnRow.appendChild(statusDot);

  // Global strength slider
  const globalStrRow = document.createElement('div');
  globalStrRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;';
  const globalStrLbl = document.createElement('span');
  globalStrLbl.style.cssText = 'font-size:0.55rem;color:var(--text-muted);min-width:44px;';
  globalStrLbl.textContent = 'Strength';
  const globalStrSlider = document.createElement('input');
  globalStrSlider.type = 'range';
  globalStrSlider.min  = '0';
  globalStrSlider.max  = '2';
  globalStrSlider.step = '0.01';
  globalStrSlider.value = String(reactor.globalStrength);
  globalStrSlider.style.cssText = 'flex:1;accent-color:var(--accent);';
  const globalStrVal = document.createElement('span');
  globalStrVal.style.cssText = 'font-size:0.6rem;color:var(--accent);min-width:26px;text-align:right;font-variant-numeric:tabular-nums;';
  globalStrVal.textContent = reactor.globalStrength.toFixed(2);
  globalStrSlider.addEventListener('input', () => {
    reactor.globalStrength = parseFloat(globalStrSlider.value);
    globalStrVal.textContent = reactor.globalStrength.toFixed(2);
    reactor.saveGlobal();
  });
  globalStrRow.appendChild(globalStrLbl);
  globalStrRow.appendChild(globalStrSlider);
  globalStrRow.appendChild(globalStrVal);
  globalStrRow.appendChild(makeResetBtn(globalStrSlider, 1.0));

  sourceSection.appendChild(sourceLabel);
  sourceSection.appendChild(sourceBtnRow);
  sourceSection.appendChild(errorMsg);
  sourceSection.appendChild(globalStrRow);
  container.appendChild(sourceSection);

  // Sync UI to current reactor state (reactor may already be active from a prior panel build)
  updateStatus();

  // ── Spectrum canvas ───────────────────────────────────────────────
  const canvasSection = document.createElement('div');
  canvasSection.style.cssText = 'padding:6px 8px 4px;border-bottom:1px solid var(--bg-surface-border);';

  const vizCanvas = document.createElement('canvas');
  vizCanvas.width  = 184;
  vizCanvas.height = 40;
  vizCanvas.style.cssText = 'width:100%;height:40px;display:block;border-radius:2px;background:#06050a;';
  canvasSection.appendChild(vizCanvas);

  // Band meters
  const metersRow = document.createElement('div');
  metersRow.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:3px;margin-top:5px;';

  const BAND_KEYS: BandKey[] = ['bass', 'mid', 'presence', 'hi', 'volume'];
  const BAND_LABELS: Record<BandKey, string> = {
    bass: 'bass', mid: 'mid', presence: 'pres', hi: 'hi', volume: 'vol',
  };

  const meterBars: Partial<Record<BandKey, HTMLDivElement>> = {};

  for (const band of BAND_KEYS) {
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';

    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'width:100%;height:16px;background:var(--bg-surface-border);border-radius:1px;overflow:hidden;display:flex;align-items:flex-end;';

    const bar = document.createElement('div');
    bar.style.cssText = `width:100%;height:0%;background:${BAND_COLORS[band]};`;
    barWrap.appendChild(bar);
    meterBars[band] = bar;

    const label = document.createElement('div');
    label.style.cssText = `font-size:0.55rem;color:${BAND_COLORS[band]};letter-spacing:0.04em;`;
    label.textContent = BAND_LABELS[band];

    col.appendChild(barWrap);
    col.appendChild(label);
    metersRow.appendChild(col);
  }

  canvasSection.appendChild(metersRow);
  container.appendChild(canvasSection);

  // ── Mappings section ──────────────────────────────────────────────
  const mappingsSection = document.createElement('div');
  mappingsSection.style.cssText = 'padding:0;';

  const mappingsHeader = document.createElement('div');
  mappingsHeader.style.cssText = 'display:flex;align-items:center;padding:5px 8px 3px;';
  const mappingsLabel = document.createElement('div');
  mappingsLabel.style.cssText = 'font-size:0.55rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);flex:1;';
  mappingsLabel.textContent = 'Mappings';
  mappingsHeader.appendChild(mappingsLabel);
  mappingsSection.appendChild(mappingsHeader);

  // Matrix table — fixed layout so we can control column widths precisely
  // Layout: 85px label | 12px trace | 5 × ~29px bands (table is 250px wide)
  const matrixTable = document.createElement('table');
  matrixTable.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed;';

  // thead — band column headers
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const paramTh = document.createElement('th');
  paramTh.style.cssText = 'width:85px;text-align:left;padding-left:8px;font-size:0.5rem;color:transparent;user-select:none;';
  paramTh.textContent = '-';
  headerRow.appendChild(paramTh);
  // Trace column header (no label — just reserves the space)
  const traceTh = document.createElement('th');
  traceTh.style.cssText = 'width:12px;padding:0;';
  headerRow.appendChild(traceTh);
  const BAND_KEYS_ORDER: BandKey[] = ['bass', 'mid', 'presence', 'hi', 'volume'];
  const BAND_ABBR: Record<BandKey, string> = { bass: 'B', mid: 'M', presence: 'P', hi: 'H', volume: 'V' };
  for (const band of BAND_KEYS_ORDER) {
    const th = document.createElement('th');
    th.style.cssText = `font-size:0.5rem;text-transform:uppercase;letter-spacing:0.06em;padding:2px 0;text-align:center;color:${BAND_COLORS[band]};`;
    th.textContent = BAND_ABBR[band];
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  matrixTable.appendChild(thead);

  const tbody = document.createElement('tbody');
  matrixTable.appendChild(tbody);
  mappingsSection.appendChild(matrixTable);
  container.appendChild(mappingsSection);

  // Track which param row's drawer is currently open (null = none)
  let openParam: string | null = null;
  let drawerRow: HTMLTableRowElement | null = null;

  // Persistent sparkline objects — survive rebuildMatrix() so ring buffers are not wiped
  const matTraceCache = new Map<string, { canvas: HTMLCanvasElement; push: (v: number) => void }>();

  // Mini sparkline for matrix trace column
  const MAT_TRACE_LEN = 60;
  const MAT_TRACE_W   = 10;
  const MAT_TRACE_H   = 14;
  const matDpr        = window.devicePixelRatio || 1;

  function makeMatrixTrace(): { canvas: HTMLCanvasElement; push: (v: number) => void } {
    const buf = new Float32Array(MAT_TRACE_LEN);
    let ptr = 0;
    const canvas = document.createElement('canvas');
    canvas.width  = MAT_TRACE_W * matDpr;
    canvas.height = MAT_TRACE_H * matDpr;
    canvas.style.cssText = `width:${MAT_TRACE_W}px;height:${MAT_TRACE_H}px;display:block;border-radius:1px;`;
    function push(v: number): void {
      buf[ptr] = v;
      ptr = (ptr + 1) % MAT_TRACE_LEN;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth   = matDpr;
      ctx.beginPath();
      const H = canvas.height, W = canvas.width;
      for (let i = 0; i < MAT_TRACE_LEN; i++) {
        const idx = (ptr + i) % MAT_TRACE_LEN;
        const x = (i / (MAT_TRACE_LEN - 1)) * W;
        const y = H - buf[idx] * (H - 2) - 1;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return { canvas, push };
  }

  function rebuildMatrix(): void {
    cellUpdaters.clear();
    totalUpdaters.clear();
    traceUpdaters.clear();
    matrixTraceUpdaters.clear();
    tbody.innerHTML = '';
    openParam = null;
    drawerRow = null;

    for (const paramKey of MAPPABLE_PARAMS) {
      const param = String(paramKey);
      const meta  = PARAM_META[param];
      if (!meta) continue;

      const activeMappings = reactor.mappings.filter(m => String(m.param) === param);
      const hasAny = activeMappings.length > 0;

      const tr = document.createElement('tr');
      tr.style.cssText = 'cursor:pointer;transition:background 0.1s;';
      tr.addEventListener('mouseenter', () => { if (openParam !== param) tr.style.background = 'rgba(255,255,255,0.03)'; });
      tr.addEventListener('mouseleave', () => { if (openParam !== param) tr.style.background = ''; });

      // Param label cell — truncates with ellipsis; click opens/closes the drawer
      const nameTd = document.createElement('td');
      nameTd.title = meta.label;
      nameTd.style.cssText = [
        `font-size:0.57rem;padding:3px 4px 3px 8px;`,
        `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
        `color:${hasAny ? 'var(--text-body)' : 'var(--text-muted)'};`,
        `opacity:${hasAny ? '1' : '0.5'};`,
        `cursor:${hasAny ? 'pointer' : 'default'};`,
      ].join('');
      nameTd.textContent = meta.label;
      nameTd.addEventListener('click', () => {
        if (!hasAny) return;
        if (openParam === param) {
          closeDrawer();
        } else {
          const firstBand = [...activeMappings].sort(
            (a, b) => BAND_KEYS_ORDER.indexOf(a.band) - BAND_KEYS_ORDER.indexOf(b.band)
          )[0].band;
          openDrawer(param, firstBand);
        }
      });
      tr.appendChild(nameTd);

      // Trace column — sparkline of combined modulation for this param
      const traceTd = document.createElement('td');
      traceTd.style.cssText = 'padding:1px 1px;vertical-align:middle;';
      if (hasAny) {
        // Reuse cached trace so the ring buffer survives rebuildMatrix() calls
        if (!matTraceCache.has(param)) {
          matTraceCache.set(param, makeMatrixTrace());
        }
        const { canvas: traceCanvas, push } = matTraceCache.get(param)!;
        traceTd.appendChild(traceCanvas);
        matrixTraceUpdaters.set(param, push);
      } else {
        matTraceCache.delete(param);
      }
      tr.appendChild(traceTd);

      // Band cells
      for (const band of BAND_KEYS_ORDER) {
        const td = document.createElement('td');
        td.style.cssText = 'text-align:center;padding:3px 0;cursor:pointer;transition:background 0.1s;';
        td.addEventListener('mouseenter', () => { td.style.background = 'rgba(255,255,255,0.06)'; });
        td.addEventListener('mouseleave', () => { td.style.background = ''; });

        const mapping = activeMappings.find(m => m.band === band) ?? null;
        td.addEventListener('click', () => {
          // Remember which drawer was open so we can restore it after rebuild
          const wasOpenParam = openParam;

          if (mapping) {
            // Filled dot → toggle OFF (remove mapping)
            const idx = reactor.mappings.findIndex(m => String(m.param) === param && m.band === band);
            if (idx !== -1) reactor.mappings.splice(idx, 1);
            reactor.saveMappings();
          } else {
            // Empty dot → toggle ON (add mapping)
            const meta = PARAM_META[param];
            reactor.mappings.push({
              param: paramKey,
              band,
              mode: 'add',
              depth: 0.5,
              gain: 1.0,
              min: meta.min,
              max: meta.max,
              enabled: true,
            });
            reactor.saveMappings();
          }

          rebuildMatrix();

          // Restore drawer — band cell clicks must never change drawer open/close state.
          // If the drawer was open before the toggle, reopen it (unless all mappings were removed).
          if (wasOpenParam !== null) {
            const remaining = reactor.mappings.filter(m => String(m.param) === wasOpenParam);
            if (remaining.length > 0) {
              const bandToOpen = [...remaining].sort(
                (a, b) => BAND_KEYS_ORDER.indexOf(a.band) - BAND_KEYS_ORDER.indexOf(b.band)
              )[0].band;
              openDrawer(wasOpenParam, bandToOpen);
            }
          }
        });

        const cellDiv = document.createElement('div');
        cellDiv.style.cssText = 'display:inline-flex;flex-direction:column;align-items:center;gap:1px;padding:2px;border-radius:3px;';

        const dot = document.createElement('div');
        dot.style.cssText = 'width:9px;height:9px;border-radius:50%;display:block;';
        if (mapping) {
          dot.style.background  = BAND_COLORS[band];
          dot.style.border      = `1px solid ${BAND_COLORS[band]}`;
          dot.style.boxShadow   = `0 0 4px ${BAND_COLORS[band]}aa`;
        } else {
          dot.style.background = `${BAND_COLORS[band]}28`;
          dot.style.border     = `1px solid ${BAND_COLORS[band]}70`;
        }
        cellDiv.appendChild(dot);

        // Live amplitude bar beneath dot (only for mapped cells)
        const liveBar = document.createElement('div');
        liveBar.style.cssText = `width:${mapping ? '12px' : '0'};height:2px;background:var(--bg-surface-border);border-radius:1px;overflow:hidden;`;
        const liveFill = document.createElement('div');
        liveFill.style.cssText = `height:100%;width:0%;background:${BAND_COLORS[band]};border-radius:1px;`;
        liveBar.appendChild(liveFill);
        cellDiv.appendChild(liveBar);

        if (mapping) {
          const key = `${param}::${band}`;
          cellUpdaters.set(key, (amplitude: number) => {
            liveFill.style.width = `${Math.round(amplitude * 100)}%`;
          });
        }

        td.appendChild(cellDiv);
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }
  }

  rebuildMatrix();

  // ── Drawer helpers ────────────────────────────────────────────────

  const TRACE_LEN = 200;
  const TRACE_W = 184;
  const TRACE_H = 32;
  const dpr = window.devicePixelRatio || 1;

  function makeTraceCanvas(bandColor: string): {
    canvas: HTMLCanvasElement;
    push: (v: number) => void;
    draw: () => void;
  } {
    const data = new Float32Array(TRACE_LEN);
    let ptr = 0;
    const canvas = document.createElement('canvas');
    canvas.width  = TRACE_W * dpr;
    canvas.height = TRACE_H * dpr;
    canvas.style.cssText = `width:100%;height:${TRACE_H}px;display:block;border-radius:2px;background:#06050a;margin-top:2px;`;

    function draw(): void {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const W = TRACE_W, H = TRACE_H;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      let trMin = Infinity, trMax = -Infinity;
      for (let i = 0; i < TRACE_LEN; i++) {
        if (data[i] < trMin) trMin = data[i];
        if (data[i] > trMax) trMax = data[i];
      }
      if (!isFinite(trMin)) trMin = 0;
      if (!isFinite(trMax)) trMax = 0;
      const currentVal = data[(ptr - 1 + TRACE_LEN) % TRACE_LEN];

      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, 1);     ctx.lineTo(W, 1);
      ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1);
      ctx.stroke();

      const innerH = H - 2;
      ctx.strokeStyle = bandColor;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let i = 0; i < TRACE_LEN; i++) {
        const idx = (ptr + i) % TRACE_LEN;
        const x = (i / (TRACE_LEN - 1)) * W;
        const y = H - data[idx] * innerH - 1;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Labels: min (bottom-left), max (top-left), current (right, tracks tip)
      const FONT = '9px monospace';
      ctx.font = FONT;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(trMax.toFixed(2), 2, 10);
      ctx.fillText(trMin.toFixed(2), 2, H - 2);
      const tipY = H - currentVal * innerH - 1;
      const labelY = Math.max(9, Math.min(H - 3, tipY - 5));
      ctx.fillStyle = bandColor;
      ctx.fillText(currentVal.toFixed(2), W - 26, labelY);
    }

    function push(v: number): void {
      data[ptr] = v;
      ptr = (ptr + 1) % TRACE_LEN;
      draw();
    }

    return { canvas, push, draw };
  }

  function buildBandTab(mapping: AudioMapping): HTMLDivElement {
    const body = document.createElement('div');
    body.style.cssText = 'padding:6px 8px;';
    const color = BAND_COLORS[mapping.band];

    function row(label: string, content: HTMLElement): void {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:0.55rem;color:var(--text-muted);min-width:30px;';
      lbl.textContent = label;
      r.appendChild(lbl);
      r.appendChild(content);
      body.appendChild(r);
    }

    function makeSlider(min: number, max: number, step: number, value: number): { el: HTMLInputElement; valEl: HTMLSpanElement } {
      const el = document.createElement('input');
      el.type  = 'range';
      el.min   = String(min);
      el.max   = String(max);
      el.step  = String(step);
      el.value = String(value);
      el.style.cssText = `flex:1;accent-color:${color};`;
      const valEl = document.createElement('span');
      valEl.style.cssText = `font-size:0.6rem;color:${color};min-width:28px;text-align:right;font-variant-numeric:tabular-nums;`;
      valEl.textContent = value.toFixed(2);
      return { el, valEl };
    }

    // Depth
    const { el: depthSlider, valEl: depthVal } = makeSlider(0, 1, 0.01, mapping.depth);
    depthSlider.addEventListener('input', () => {
      mapping.depth = parseFloat(depthSlider.value);
      depthVal.textContent = mapping.depth.toFixed(2);
      reactor.saveMappings();
    });
    const depthWrap = document.createElement('div');
    depthWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;';
    depthWrap.appendChild(depthSlider);
    depthWrap.appendChild(depthVal);
    depthWrap.appendChild(makeResetBtn(depthSlider, 0.5));
    row('Depth', depthWrap);

    // Gain
    const { el: gainSlider, valEl: gainVal } = makeSlider(0, 4, 0.05, mapping.gain ?? 1.0);
    gainSlider.addEventListener('input', () => {
      mapping.gain = parseFloat(gainSlider.value);
      gainVal.textContent = mapping.gain.toFixed(2);
      reactor.saveMappings();
    });
    const gainWrap = document.createElement('div');
    gainWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;';
    gainWrap.appendChild(gainSlider);
    gainWrap.appendChild(gainVal);
    gainWrap.appendChild(makeResetBtn(gainSlider, 1.0));
    row('Gain', gainWrap);

    // Mode
    const modeBtn = document.createElement('button');
    modeBtn.style.cssText = [
      'padding:1px 6px;border-radius:3px;font-size:0.65rem;cursor:pointer;',
      'border:1px solid var(--bg-surface-border);background:transparent;color:var(--text-muted);',
    ].join('');
    function modeBtnLabel(mode: typeof mapping.mode): string {
      return mode === 'add' ? '+ add' : mode === 'subtract' ? '− sub' : '× mul';
    }
    modeBtn.textContent = modeBtnLabel(mapping.mode);
    modeBtn.addEventListener('click', () => {
      mapping.mode = mapping.mode === 'add' ? 'subtract' : mapping.mode === 'subtract' ? 'multiply' : 'add';
      modeBtn.textContent = modeBtnLabel(mapping.mode);
      reactor.saveMappings();
    });
    row('Mode', modeBtn);

    // Min / Max
    const minMaxRow = document.createElement('div');
    minMaxRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;';
    const inputStyle = [
      'width:48px;background:var(--bg-surface);color:var(--text-body);',
      'border:1px solid var(--bg-surface-border);border-radius:3px;',
      'font-size:0.62rem;padding:1px 3px;text-align:right;',
    ].join('');
    const meta = PARAM_META[String(mapping.param)];

    const minLabel = document.createElement('span');
    minLabel.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
    minLabel.textContent = 'Min';
    const minInput = document.createElement('input');
    minInput.type = 'text'; minInput.value = String(mapping.min); minInput.style.cssText = inputStyle;
    minInput.addEventListener('blur', () => {
      const v = parseFloat(minInput.value);
      if (!isNaN(v) && v < mapping.max) { mapping.min = v; reactor.saveMappings(); }
      else minInput.value = String(mapping.min);
    });
    minInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') minInput.blur(); });

    const maxLabel = document.createElement('span');
    maxLabel.style.cssText = 'font-size:0.6rem;color:var(--text-muted);margin-left:4px;';
    maxLabel.textContent = 'Max';
    const maxInput = document.createElement('input');
    maxInput.type = 'text'; maxInput.value = String(mapping.max); maxInput.style.cssText = inputStyle;
    maxInput.addEventListener('blur', () => {
      const v = parseFloat(maxInput.value);
      if (!isNaN(v) && v > mapping.min) { mapping.max = v; reactor.saveMappings(); }
      else maxInput.value = String(mapping.max);
    });
    maxInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') maxInput.blur(); });

    minMaxRow.appendChild(minLabel); minMaxRow.appendChild(minInput);
    minMaxRow.appendChild(maxLabel); minMaxRow.appendChild(maxInput);
    body.appendChild(minMaxRow);

    // Trace
    const { canvas: traceCanvas, push: pushTrace } = makeTraceCanvas(color);
    body.appendChild(traceCanvas);

    // Register trace updater — bar updater lives in cellUpdaters (registered by rebuildMatrix)
    const key = `${String(mapping.param)}::${mapping.band}`;
    traceUpdaters.set(key, pushTrace);

    // meta is already declared above (used for minInput/maxInput), suppress unused warning
    void meta;

    return body;
  }

  function buildTotalTab(param: string): {
    body: HTMLDivElement;
    registerUpdater: () => void;
  } {
    const resolvedTextBody = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-body').trim() || 'rgba(232,224,208,0.9)';
    const meta     = PARAM_META[param];
    const mappings = reactor.mappings
      .filter(m => String(m.param) === param)
      .sort((a, b) => BAND_KEYS_ORDER.indexOf(a.band) - BAND_KEYS_ORDER.indexOf(b.band));

    const body = document.createElement('div');
    body.style.cssText = 'padding:6px 8px;';

    // ── Live value header ─────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:baseline;gap:6px;margin-bottom:4px;';
    const liveVal  = document.createElement('span');
    liveVal.style.cssText = 'font-size:0.75rem;font-variant-numeric:tabular-nums;color:var(--text-body);font-weight:600;min-width:32px;';
    liveVal.textContent = '—';
    const baseValEl = document.createElement('span');
    baseValEl.style.cssText = 'font-size:0.58rem;color:var(--text-muted);';
    baseValEl.textContent = 'base —';
    const deltaEl = document.createElement('span');
    deltaEl.style.cssText = 'font-size:0.58rem;margin-left:auto;font-variant-numeric:tabular-nums;';
    deltaEl.textContent = '';
    header.appendChild(liveVal);
    header.appendChild(baseValEl);
    header.appendChild(deltaEl);
    body.appendChild(header);

    // ── Range bar ──────────────────────────────────────────────────────
    const rangeRow = document.createElement('div');
    rangeRow.style.cssText = 'display:flex;align-items:center;gap:5px;margin-bottom:4px;';
    const rangeLbl = document.createElement('span');
    rangeLbl.style.cssText = 'font-size:0.52rem;color:var(--text-muted);min-width:28px;';
    rangeLbl.textContent = 'range';
    const rangeWrap = document.createElement('div');
    rangeWrap.style.cssText = 'flex:1;position:relative;';
    const rangeTrack = document.createElement('div');
    rangeTrack.style.cssText = 'height:5px;background:var(--bg-surface-border);border-radius:3px;overflow:hidden;';
    const rangeFill = document.createElement('div');
    rangeFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,var(--accent),var(--text-body));opacity:0.5;border-radius:3px;';
    rangeTrack.appendChild(rangeFill);
    const rangeCursor = document.createElement('div');
    rangeCursor.style.cssText = 'position:absolute;top:-1px;width:2px;height:7px;background:var(--text-body);border-radius:1px;box-shadow:0 0 3px var(--text-body);transform:translateX(-1px);left:0%;';
    const rangeMinMax = document.createElement('div');
    rangeMinMax.style.cssText = 'display:flex;justify-content:space-between;font-size:0.5rem;color:var(--text-muted);margin-top:1px;font-variant-numeric:tabular-nums;';
    rangeMinMax.innerHTML = `<span>${meta.min}</span><span class="range-cur-lbl" style="color:var(--text-body);">—</span><span>${meta.max}</span>`;
    const rangeCurLbl = rangeMinMax.querySelector<HTMLSpanElement>('.range-cur-lbl')!;
    rangeWrap.appendChild(rangeTrack);
    rangeWrap.appendChild(rangeCursor);
    rangeWrap.appendChild(rangeMinMax);
    rangeRow.appendChild(rangeLbl);
    rangeRow.appendChild(rangeWrap);
    body.appendChild(rangeRow);

    // ── Stacked trace canvas ──────────────────────────────────────────
    const STACKED_H = 40;
    const stackCanvas = document.createElement('canvas');
    stackCanvas.width  = TRACE_W * dpr;
    stackCanvas.height = STACKED_H * dpr;
    stackCanvas.style.cssText = `width:100%;height:${STACKED_H}px;display:block;border-radius:2px;background:#06050a;margin-bottom:3px;`;
    body.appendChild(stackCanvas);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;font-size:0.5rem;margin-bottom:5px;';
    for (const m of mappings) {
      const s = document.createElement('span');
      s.style.color = BAND_COLORS[m.band];
      s.textContent = `— ${m.band}`;
      legend.appendChild(s);
    }
    const combSpan = document.createElement('span');
    combSpan.style.cssText = 'color:var(--text-body);font-weight:600;';
    combSpan.textContent = '— combined';
    legend.appendChild(combSpan);
    body.appendChild(legend);

    // ── Contributions breakdown ───────────────────────────────────────
    const contribSection = document.createElement('div');
    contribSection.style.cssText = 'border-top:1px solid var(--bg-surface-border);padding-top:5px;';
    const contribLbl = document.createElement('div');
    contribLbl.style.cssText = 'font-size:0.5rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:3px;';
    contribLbl.textContent = 'contributions';
    contribSection.appendChild(contribLbl);
    function contribModeLabel(mode: AudioMapping['mode']): string {
      return mode === 'add' ? '+add' : mode === 'subtract' ? '−sub' : '×mul';
    }
    const contribRows: { fill: HTMLElement; valEl: HTMLElement; modeEl: HTMLElement }[] = [];
    for (const m of mappings) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:3px;';
      const swatch = document.createElement('div');
      swatch.style.cssText = `width:6px;height:6px;border-radius:50%;background:${BAND_COLORS[m.band]};flex-shrink:0;`;
      const name = document.createElement('span');
      name.style.cssText = `font-size:0.52rem;color:${BAND_COLORS[m.band]};min-width:30px;`;
      name.textContent = m.band;
      const modeEl = document.createElement('span');
      modeEl.style.cssText = 'font-size:0.5rem;color:var(--text-muted);min-width:22px;cursor:pointer;user-select:none;';
      modeEl.title = 'Click to cycle mode';
      modeEl.textContent = contribModeLabel(m.mode);
      modeEl.addEventListener('mouseenter', () => { modeEl.style.color = 'var(--text-body)'; });
      modeEl.addEventListener('mouseleave', () => { modeEl.style.color = 'var(--text-muted)'; });
      modeEl.addEventListener('click', () => {
        m.mode = m.mode === 'add' ? 'subtract' : m.mode === 'subtract' ? 'multiply' : 'add';
        modeEl.textContent = contribModeLabel(m.mode);
        reactor.saveMappings();
      });
      const barWrap = document.createElement('div');
      barWrap.style.cssText = 'flex:1;height:3px;background:var(--bg-surface-border);border-radius:2px;';
      const barFill = document.createElement('div');
      barFill.style.cssText = `height:100%;width:0%;background:${BAND_COLORS[m.band]};border-radius:2px;`;
      barWrap.appendChild(barFill);
      const valEl = document.createElement('span');
      valEl.style.cssText = `font-size:0.5rem;color:${BAND_COLORS[m.band]};min-width:32px;text-align:right;font-variant-numeric:tabular-nums;`;
      valEl.textContent = '—';
      row.appendChild(swatch); row.appendChild(name); row.appendChild(modeEl);
      row.appendChild(barWrap); row.appendChild(valEl);
      contribSection.appendChild(row);
      contribRows.push({ fill: barFill, valEl, modeEl });
    }
    body.appendChild(contribSection);

    // Per-band ring buffers for stacked trace
    const bandBuffers = mappings.map(() => new Float32Array(TRACE_LEN));
    const combinedBuffer = new Float32Array(TRACE_LEN);
    let tracePtr = 0;

    function drawStackedTrace(): void {
      const ctx = stackCanvas.getContext('2d');
      if (!ctx) return;
      const W = TRACE_W, H = STACKED_H;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const innerH = H - 2;
      // Individual band traces (faint)
      mappings.forEach((m, i) => {
        ctx.strokeStyle = BAND_COLORS[m.band];
        ctx.lineWidth   = 1;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        for (let j = 0; j < TRACE_LEN; j++) {
          const idx = (tracePtr + j) % TRACE_LEN;
          const x = (j / (TRACE_LEN - 1)) * W;
          const y = H - bandBuffers[i][idx] * innerH - 1;
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      // Combined trace (bright)
      ctx.strokeStyle = resolvedTextBody;
      ctx.lineWidth   = 2;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let j = 0; j < TRACE_LEN; j++) {
        const idx = (tracePtr + j) % TRACE_LEN;
        const x = (j / (TRACE_LEN - 1)) * W;
        const y = H - Math.min(1, Math.max(0, combinedBuffer[idx])) * innerH - 1;
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function registerUpdater(): void {
      totalUpdaters.set(param, (snapshot: BandSnapshot, baseVal: number, modulatedVal: number) => {
        // Update live value header
        const delta = modulatedVal - baseVal;
        liveVal.textContent    = modulatedVal.toFixed(3);
        baseValEl.textContent  = `base ${baseVal.toFixed(3)}`;
        deltaEl.textContent    = (delta >= 0 ? '+' : '') + delta.toFixed(3);
        deltaEl.style.color    = delta >= 0 ? '#80d060' : '#e05060';

        // Range bar
        const rangeSpan = meta.max - meta.min;
        const fraction  = rangeSpan > 0 ? Math.max(0, Math.min(1, (modulatedVal - meta.min) / rangeSpan)) : 0;
        rangeFill.style.width         = `${fraction * 100}%`;
        rangeCursor.style.left        = `${fraction * 100}%`;
        rangeCurLbl.textContent       = modulatedVal.toFixed(3);

        // Per-band contributions
        mappings.forEach((m, i) => {
          const signal = Math.min(1, snapshot[m.band] * (m.gain ?? 1));
          const mappingMeta = PARAM_META[String(m.param)];
          let contribution: number;
          let barFraction: number;
          // Keep modeEl in sync — mode may have changed via the band tab's mode button
          contribRows[i].modeEl.textContent = contribModeLabel(m.mode);
          if (m.mode === 'add' || m.mode === 'subtract') {
            const sign = m.mode === 'subtract' ? -1 : 1;
            contribution = sign * signal * m.depth * (m.max - m.min);
            barFraction  = Math.min(1, Math.abs(contribution) / Math.max(0.001, mappingMeta.max - mappingMeta.min));
            contribRows[i].valEl.textContent = (contribution >= 0 ? '+' : '') + contribution.toFixed(3);
          } else {
            contribution = 1 + signal * m.depth;
            barFraction  = Math.min(1, (contribution - 1) / 2);
            contribRows[i].valEl.textContent = `×${contribution.toFixed(3)}`;
          }
          (contribRows[i].fill as HTMLElement).style.width = `${barFraction * 100}%`;

          // Push to per-band ring buffer (normalised amplitude)
          bandBuffers[i][tracePtr] = signal;
        });

        // Combined: normalise modulated value to 0–1 within param range
        const normModulated = rangeSpan > 0 ? Math.max(0, Math.min(1, (modulatedVal - meta.min) / rangeSpan)) : 0;
        combinedBuffer[tracePtr] = normModulated;
        tracePtr = (tracePtr + 1) % TRACE_LEN;

        drawStackedTrace();
      });
    }

    return { body, registerUpdater };
  }

  function openDrawer(param: string, activeBand: BandKey): void {
    // Close any existing drawer first (handles cleanup of updaters + row highlight)
    closeDrawer();

    const activeMappings = reactor.mappings.filter(m => String(m.param) === param);
    const multiMapping   = activeMappings.length >= 2;

    // Find the param <tr> in tbody (exclude drawer rows to prevent index desync)
    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr:not(.audio-drawer-row)'));
    const paramIdx = MAPPABLE_PARAMS.findIndex(p => String(p) === param);
    const paramTr  = rows[paramIdx];
    if (!paramTr) return;

    openParam = param;
    paramTr.style.background = 'var(--bg-surface)';

    // Build the drawer <tr>
    const tr = document.createElement('tr');
    tr.className = 'audio-drawer-row';
    const td = document.createElement('td');
    td.colSpan = 7; // param + trace + 5 bands
    td.style.cssText = 'padding:0;border-top:1px solid var(--bg-surface-border);border-bottom:1px solid var(--bg-surface-border);';

    // Tab strip
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;border-bottom:1px solid var(--bg-surface-border);background:var(--bg-primary);';

    const tabBodies: Record<string, HTMLDivElement> = {};
    // Default to ∑ tab when multiple mappings exist; otherwise show the requested band
    let activeTabKey: string = multiMapping ? '∑' : activeBand;

    function switchDrawerTab(key: string): void {
      activeTabKey = key;
      for (const [k, t] of Object.entries(tabBodies)) {
        t.style.display = k === key ? 'block' : 'none';
      }
      // Update tab underline styles
      tabs.querySelectorAll<HTMLButtonElement>('[data-tabkey]').forEach(btn => {
        const isActive = btn.dataset['tabkey'] === key;
        const bColor   = btn.dataset['bandcolor'] ?? 'var(--text-body)';
        btn.style.borderBottomColor = isActive ? bColor : 'transparent';
        btn.style.color = isActive ? bColor : 'var(--text-muted)';
        btn.classList.toggle('active-tab', isActive);
      });
    }

    function makeTabBtn(label: string, key: string, color: string, removable = false): HTMLButtonElement {
      const btn = document.createElement('button');
      btn.dataset['tabkey']    = key;
      btn.dataset['bandcolor'] = color;
      btn.style.cssText = [
        'flex:1;padding:4px 4px 4px 6px;font-size:0.52rem;',
        'cursor:pointer;border:none;background:transparent;',
        'border-bottom:2px solid transparent;transition:color 0.1s;',
        `color:var(--text-muted);`,
        removable ? 'display:flex;align-items:center;gap:3px;' : 'text-align:center;',
      ].join('');

      if (removable) {
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        labelSpan.style.cssText = 'flex:1;text-align:center;';
        const xSpan = document.createElement('span');
        xSpan.textContent = '×';
        xSpan.title = 'Remove mapping';
        xSpan.style.cssText = 'font-size:0.8rem;line-height:1;opacity:0.4;padding:0 2px;border-radius:2px;flex-shrink:0;';
        xSpan.addEventListener('mouseenter', () => { xSpan.style.opacity = '1'; xSpan.style.color = '#e05060'; });
        xSpan.addEventListener('mouseleave', () => { xSpan.style.opacity = '0.4'; xSpan.style.color = ''; });
        xSpan.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = reactor.mappings.findIndex(m => String(m.param) === param && m.band === (key as BandKey));
          if (idx !== -1) reactor.mappings.splice(idx, 1);
          reactor.saveMappings();
          closeDrawer();
          rebuildMatrix();
          const remaining = reactor.mappings.filter(m => String(m.param) === param);
          if (remaining.length > 0) openDrawer(param, remaining[0].band);
        });
        btn.appendChild(labelSpan);
        btn.appendChild(xSpan);
      } else {
        btn.textContent = label;
      }

      btn.addEventListener('click', () => switchDrawerTab(key));
      return btn;
    }

    // Band tabs — sorted by BAND_KEYS_ORDER so tabs always match matrix column order
    const sortedMappings = [...activeMappings].sort(
      (a, b) => BAND_KEYS_ORDER.indexOf(a.band) - BAND_KEYS_ORDER.indexOf(b.band)
    );
    for (const m of sortedMappings) {
      const label = `● ${m.band}`;
      const color = BAND_COLORS[m.band];
      const btn   = makeTabBtn(label, m.band, color, true);
      tabs.appendChild(btn);
      const body = buildBandTab(m);
      body.style.display = 'none';
      tabBodies[m.band] = body;
    }

    // ∑ total tab (only when 2+ mappings)
    if (multiMapping) {
      const totalBtn = makeTabBtn('∑ total', '∑', 'var(--text-body)', false);
      tabs.appendChild(totalBtn);
      const { body: totalBody, registerUpdater } = buildTotalTab(param);
      totalBody.style.display = 'none';
      tabBodies['∑'] = totalBody;
      registerUpdater();
    }

    // Per-param strength row — sits above the tab strip, always visible
    const paramStrRow = document.createElement('div');
    paramStrRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--bg-surface-border);background:var(--bg-primary);';
    const paramStrLbl = document.createElement('span');
    paramStrLbl.style.cssText = 'font-size:0.55rem;color:var(--text-muted);min-width:44px;';
    paramStrLbl.textContent = 'Strength';
    const paramStrSlider = document.createElement('input');
    paramStrSlider.type = 'range';
    paramStrSlider.min  = '0';
    paramStrSlider.max  = '2';
    paramStrSlider.step = '0.01';
    const curParamStr = reactor.paramStrengths[param] ?? 1.0;
    paramStrSlider.value = String(curParamStr);
    paramStrSlider.style.cssText = 'flex:1;accent-color:var(--accent);';
    const paramStrVal = document.createElement('span');
    paramStrVal.style.cssText = 'font-size:0.6rem;color:var(--accent);min-width:26px;text-align:right;font-variant-numeric:tabular-nums;';
    paramStrVal.textContent = curParamStr.toFixed(2);
    paramStrSlider.addEventListener('input', () => {
      reactor.paramStrengths[param] = parseFloat(paramStrSlider.value);
      paramStrVal.textContent = reactor.paramStrengths[param].toFixed(2);
      reactor.saveGlobal();
    });
    paramStrRow.appendChild(paramStrLbl);
    paramStrRow.appendChild(paramStrSlider);
    paramStrRow.appendChild(paramStrVal);
    paramStrRow.appendChild(makeResetBtn(paramStrSlider, 1.0));

    td.appendChild(paramStrRow);
    td.appendChild(tabs);
    for (const body of Object.values(tabBodies)) td.appendChild(body);

    tr.appendChild(td);
    // Insert after paramTr
    paramTr.insertAdjacentElement('afterend', tr);
    drawerRow = tr;

    switchDrawerTab(activeTabKey);
  }

  function closeDrawer(): void {
    if (drawerRow) {
      drawerRow.remove();
      drawerRow = null;
    }
    if (openParam) {
      totalUpdaters.delete(openParam);
      reactor.mappings
        .filter(m => String(m.param) === openParam)
        .forEach(m => traceUpdaters.delete(`${openParam}::${m.band}`));
      const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr:not(.audio-drawer-row)'));
      const paramIdx = MAPPABLE_PARAMS.findIndex(p => String(p) === openParam);
      const paramTr  = rows[paramIdx];
      if (paramTr) paramTr.style.background = '';
    }
    openParam = null;
  }

  // ── Visualiser rAF loop (runs only when Audio tab is visible) ─────
  let vizRafId = 0;

  function startViz(): void {
    cancelAnimationFrame(vizRafId);
    let wasActive = false;
    function loop(): void {
      if (reactor.isActive()) {
        wasActive = true;
        const snapshot = reactor.analyze();
        // analyze() must be called first — it populates freqData that drawAudioViz reads
        drawAudioViz(vizCanvas, reactor);
        for (const band of BAND_KEYS) {
          const bar = meterBars[band];
          if (bar) bar.style.height = `${Math.round(snapshot[band] * 100)}%`;
        }
      } else if (wasActive) {
        // Only clear once after going inactive — skip redundant work on subsequent idle frames
        wasActive = false;
        const ctx2d = vizCanvas.getContext('2d');
        if (ctx2d) ctx2d.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
        for (const bar of Object.values(meterBars)) {
          if (bar) bar.style.height = '0%';
        }
      }
      vizRafId = requestAnimationFrame(loop);
    }
    vizRafId = requestAnimationFrame(loop);
  }

  function stopViz(): void {
    cancelAnimationFrame(vizRafId);
  }

  return { start: startViz, stop: stopViz };
}
