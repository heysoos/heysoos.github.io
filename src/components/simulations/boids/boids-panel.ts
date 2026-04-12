// src/components/simulations/boids/boids-panel.ts
import type { BoidsController } from './boids-controller';
import type { BoidsPreset } from '../../../data/boids-presets';
import { buildImagePanelSection } from '../../../lib/webgpu/image-editor/image-panel-section';
import { openImageEditorOverlay  } from '../../../lib/webgpu/image-editor/image-editor-overlay';
import {
  type AudioReactor,
  type BandKey,
  type AudioMapping,
  BAND_COLORS,
  PARAM_META,
  MAPPABLE_PARAMS,
  defaultMapping,
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
): { teardown: () => void } {
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
      'padding:5px 10px',
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
    audioVizControls = buildAudioTab(audioBody, opts.reactor, switchTab);
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
  addSlider(paramsBody, 'Time Step', 0.001, 0.1,  0.001, () => controller.params.dt,           v => { controller.params.dt = v; });
  addSlider(paramsBody, 'Particles', 10,    10000, 10,    () => controller.params.numParticles,  v => { controller.params.numParticles = v; }, 'log');

  // ── Forces ────────────────────────────────────────────────────────
  addSection(paramsBody, 'Forces');
  addSlider(paramsBody, 'Attraction Radius', 0.02, 0.6,  0.01,  () => controller.params.attractionRadius, v => { controller.params.attractionRadius = v; });
  addSlider(paramsBody, 'Repulsion Radius',  0.01, 0.3,  0.005, () => controller.params.repulsionRadius,  v => { controller.params.repulsionRadius = v; });
  addSlider(paramsBody, 'Attraction',        0,    2.0,  0.01,  () => controller.params.attraction,       v => { controller.params.attraction = v; });
  addSlider(paramsBody, 'Repulsion',         0,    5.0,  0.05,  () => controller.params.repulsion,        v => { controller.params.repulsion = v; });
  addSlider(paramsBody, 'Alignment',         0,    1.0,  0.01,  () => controller.params.alignment,        v => { controller.params.alignment = v; });
  addSlider(paramsBody, 'Friction',          0,    10.0, 0.1,   () => controller.params.friction,              v => { controller.params.friction = v; });
  addSlider(paramsBody, 'Max Speed',         0.01, 1.0,  0.01,  () => controller.params.maxSpeed,              v => { controller.params.maxSpeed = v; });
  addSlider(paramsBody, 'Noise',             0,    0.5,  0.005, () => controller.params.noise ?? 0,            v => { controller.params.noise = v; });

  // ── Perception ────────────────────────────────────────────────────
  addSection(paramsBody, 'Perception');
  addSlider(paramsBody, 'Vision Cone',  -1.0, 0.99, 0.05, () => controller.params.coneAngle,   v => { controller.params.coneAngle = v; });
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
    imageForce: controller.imageForce,
  });

  return {
    teardown: () => {
      audioVizControls?.stop();
    },
  };
}

// ── Audio tab builder ─────────────────────────────────────────────────────────

function buildAudioTab(
  container: HTMLElement,
  reactor: AudioReactor,
  switchTab: (name: string) => void,
): { start: () => void; stop: () => void } {

  container.style.cssText = 'display:flex;flex-direction:column;gap:0;';

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

  sourceSection.appendChild(sourceLabel);
  sourceSection.appendChild(sourceBtnRow);
  sourceSection.appendChild(errorMsg);
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
  mappingsSection.style.cssText = 'padding:0 0 4px;border-bottom:1px solid var(--bg-surface-border);';

  const mappingsLabel = document.createElement('div');
  mappingsLabel.style.cssText = 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);padding:6px 8px 3px;';
  mappingsLabel.textContent = 'Mappings';
  mappingsSection.appendChild(mappingsLabel);

  const mappingsList = document.createElement('div');
  mappingsSection.appendChild(mappingsList);

  function buildBandBtnStyle(band: BandKey, activeBand: BandKey): string {
    const isActive = band === activeBand;
    return [
      'width:18px;height:18px;border-radius:3px;font-size:0.6rem;cursor:pointer;',
      'border:1px solid ' + (isActive ? BAND_COLORS[band] : 'var(--bg-surface-border)') + ';',
      'background:' + (isActive ? BAND_COLORS[band] + '33' : 'transparent') + ';',
      'color:' + (isActive ? BAND_COLORS[band] : 'var(--text-muted)') + ';',
    ].join('');
  }

  function buildMappingRow(mapping: AudioMapping): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'padding:5px 8px;border-top:1px solid var(--bg-surface-border);display:flex;flex-direction:column;gap:4px;';

    // Row 1: param dropdown + remove button
    const row1 = document.createElement('div');
    row1.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const paramSel = document.createElement('select');
    paramSel.style.cssText = [
      'flex:1;background:var(--bg-surface);color:var(--text-body);',
      'border:1px solid var(--bg-surface-border);border-radius:3px;',
      'font-size:0.65rem;padding:2px 4px;cursor:pointer;',
    ].join('');
    for (const p of MAPPABLE_PARAMS) {
      const opt = document.createElement('option');
      opt.value = String(p);
      opt.textContent = PARAM_META[String(p)].label;
      opt.selected = p === mapping.param;
      paramSel.appendChild(opt);
    }
    paramSel.addEventListener('change', () => {
      mapping.param = paramSel.value as typeof mapping.param;
      const meta = PARAM_META[paramSel.value];
      minInput.value = String(meta.min);
      maxInput.value = String(meta.max);
      mapping.min = meta.min;
      mapping.max = meta.max;
      reactor.saveMappings();
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.style.cssText = [
      'background:none;border:none;color:var(--text-muted);',
      'cursor:pointer;font-size:0.9rem;padding:0 2px;line-height:1;',
    ].join('');
    removeBtn.addEventListener('click', () => {
      const idx = reactor.mappings.indexOf(mapping);
      if (idx !== -1) reactor.mappings.splice(idx, 1);
      reactor.saveMappings();
      rebuildMappingsList();
    });

    row1.appendChild(paramSel);
    row1.appendChild(removeBtn);
    row.appendChild(row1);

    // Row 2: band selector + mode toggle
    const row2 = document.createElement('div');
    row2.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const BAND_ABBR: Record<BandKey, string> = {
      bass: 'B', mid: 'M', presence: 'P', hi: 'H', volume: 'V',
    };

    const bandBtns: HTMLButtonElement[] = [];
    for (const band of ['bass', 'mid', 'presence', 'hi', 'volume'] as BandKey[]) {
      const b = document.createElement('button');
      b.textContent = BAND_ABBR[band];
      b.title = band;
      b.style.cssText = buildBandBtnStyle(band, mapping.band);
      b.addEventListener('click', () => {
        mapping.band = band;
        for (const bb of bandBtns) {
          bb.style.cssText = buildBandBtnStyle(
            (bb as HTMLButtonElement & { _band: BandKey })._band,
            mapping.band,
          );
        }
        reactor.saveMappings();
      });
      (b as HTMLButtonElement & { _band: BandKey })._band = band;
      bandBtns.push(b);
      row2.appendChild(b);
    }

    // Mode toggle
    const modeBtn = document.createElement('button');
    modeBtn.style.cssText = [
      'margin-left:auto;padding:1px 6px;border-radius:3px;font-size:0.65rem;cursor:pointer;',
      'border:1px solid var(--bg-surface-border);background:transparent;color:var(--text-muted);',
    ].join('');
    modeBtn.textContent = mapping.mode === 'add' ? '+ add' : '× mul';
    modeBtn.addEventListener('click', () => {
      mapping.mode = mapping.mode === 'add' ? 'multiply' : 'add';
      modeBtn.textContent = mapping.mode === 'add' ? '+ add' : '× mul';
      reactor.saveMappings();
    });
    row2.appendChild(modeBtn);
    row.appendChild(row2);

    // Row 3: depth slider
    const row3 = document.createElement('div');
    row3.style.cssText = 'display:flex;align-items:center;gap:6px;';

    const depthLabel = document.createElement('span');
    depthLabel.style.cssText = 'font-size:0.6rem;color:var(--text-muted);min-width:30px;';
    depthLabel.textContent = 'Depth';

    const depthSlider = document.createElement('input');
    depthSlider.type = 'range';
    depthSlider.min  = '0';
    depthSlider.max  = '1';
    depthSlider.step = '0.01';
    depthSlider.value = String(mapping.depth);
    depthSlider.style.cssText = 'flex:1;accent-color:var(--accent);';

    const depthVal = document.createElement('span');
    depthVal.style.cssText = 'font-size:0.6rem;color:var(--accent);min-width:28px;text-align:right;font-variant-numeric:tabular-nums;';
    depthVal.textContent = mapping.depth.toFixed(2);

    depthSlider.addEventListener('input', () => {
      mapping.depth = parseFloat(depthSlider.value);
      depthVal.textContent = mapping.depth.toFixed(2);
      reactor.saveMappings();
    });

    row3.appendChild(depthLabel);
    row3.appendChild(depthSlider);
    row3.appendChild(depthVal);
    row.appendChild(row3);

    // Row 4: min / max clamp inputs
    const row4 = document.createElement('div');
    row4.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const inputStyle = [
      'width:48px;background:var(--bg-surface);color:var(--text-body);',
      'border:1px solid var(--bg-surface-border);border-radius:3px;',
      'font-size:0.62rem;padding:1px 3px;text-align:right;',
    ].join('');

    const minLabel = document.createElement('span');
    minLabel.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
    minLabel.textContent = 'Min';

    const minInput = document.createElement('input');
    minInput.type  = 'text';
    minInput.value = String(mapping.min);
    minInput.style.cssText = inputStyle;
    minInput.addEventListener('blur', () => {
      const v = parseFloat(minInput.value);
      if (!isNaN(v) && v < mapping.max) { mapping.min = v; reactor.saveMappings(); }
      else minInput.value = String(mapping.min);
    });

    const maxLabel = document.createElement('span');
    maxLabel.style.cssText = 'font-size:0.6rem;color:var(--text-muted);margin-left:4px;';
    maxLabel.textContent = 'Max';

    const maxInput = document.createElement('input');
    maxInput.type  = 'text';
    maxInput.value = String(mapping.max);
    maxInput.style.cssText = inputStyle;
    maxInput.addEventListener('blur', () => {
      const v = parseFloat(maxInput.value);
      if (!isNaN(v) && v > mapping.min) { mapping.max = v; reactor.saveMappings(); }
      else maxInput.value = String(mapping.max);
    });

    row4.appendChild(minLabel);
    row4.appendChild(minInput);
    row4.appendChild(maxLabel);
    row4.appendChild(maxInput);
    row.appendChild(row4);

    return row;
  }

  function rebuildMappingsList(): void {
    mappingsList.innerHTML = '';
    reactor.mappings.forEach((m) => {
      mappingsList.appendChild(buildMappingRow(m));
    });
  }

  rebuildMappingsList();

  // "+ Add Mapping" button
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add Mapping';
  addBtn.style.cssText = [
    'display:block;width:calc(100% - 16px);margin:6px 8px 4px;',
    'padding:4px 0;border-radius:4px;font-size:0.68rem;cursor:pointer;',
    'border:1px solid var(--bg-surface-border);background:transparent;',
    'color:var(--text-muted);transition:border-color 0.15s,color 0.15s;',
  ].join('');
  addBtn.addEventListener('mouseenter', () => { addBtn.style.borderColor = 'var(--accent)'; addBtn.style.color = 'var(--accent)'; });
  addBtn.addEventListener('mouseleave', () => { addBtn.style.borderColor = 'var(--bg-surface-border)'; addBtn.style.color = 'var(--text-muted)'; });
  addBtn.addEventListener('click', () => {
    const used = reactor.mappings.map(m => m.param);
    reactor.mappings.push(defaultMapping(used));
    reactor.saveMappings();
    rebuildMappingsList();
  });
  mappingsSection.appendChild(addBtn);
  container.appendChild(mappingsSection);

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
