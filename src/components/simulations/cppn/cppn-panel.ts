// src/components/simulations/cppn/cppn-panel.ts
import type { CPPNController, LayerConfig } from './cppn-controller';
import type { CPPNPreset, Activation, ZBand, WeightDistribution } from './cppn-types';

export interface CPPNPanelOpts {
  presets?: CPPNPreset[];
  activePresetId?: string;
  onPresetLoad?: (preset: CPPNPreset) => void;
  onClose?: () => void;
}

const ACTIVATIONS: Activation[] = ['tanh', 'sin', 'cos', 'abs', 'sigmoid'];

// ── DOM helpers ───────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, css: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (css)             e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

function divider(parent: HTMLElement): void {
  parent.appendChild(el('div', 'height:1px;background:var(--bg-surface-border);margin:0.4rem 0 0.3rem;'));
}

function heading(parent: HTMLElement, text: string): void {
  parent.appendChild(el('p',
    'font-size:0.6rem;letter-spacing:1.5px;color:var(--text-muted);text-transform:uppercase;margin:0 0 0.25rem;',
    text));
}

function row(parent: HTMLElement, css = ''): HTMLElement {
  const r = el('div', 'display:flex;align-items:center;gap:4px;margin-bottom:0.3rem;' + css);
  parent.appendChild(r);
  return r;
}

function slider(
  parent: HTMLElement, label: string,
  min: number, max: number, step: number, value: number,
  onChange: (v: number) => void,
): void {
  const wrap   = el('div', 'display:flex;flex-direction:column;gap:0.1rem;margin-bottom:0.3rem;');
  const top    = el('div', 'display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-body);');
  const valEl  = el('span', 'color:var(--accent);font-variant-numeric:tabular-nums;', String(value));
  top.appendChild(el('span', '', label));
  top.appendChild(valEl);
  const inp = el('input', 'width:100%;accent-color:var(--accent);cursor:pointer;');
  inp.type = 'range';
  inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(value);
  inp.addEventListener('input', () => {
    const v = parseFloat(inp.value);
    valEl.textContent = v.toFixed(String(step).includes('.') ? String(step).split('.')[1].length : 0);
    onChange(v);
  });
  wrap.appendChild(top);
  wrap.appendChild(inp);
  parent.appendChild(wrap);
}

function selectEl(
  parent: HTMLElement, options: string[], value: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const s = el('select',
    'flex:1;background:var(--bg-primary);border:1px solid var(--bg-surface-border);border-radius:3px;padding:2px 4px;color:var(--text-body);font-size:0.72rem;') as HTMLSelectElement;
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt;
    if (opt === value) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  parent.appendChild(s);
  return s;
}

function smallBtn(parent: HTMLElement, text: string, onClick: () => void, css = ''): HTMLButtonElement {
  const b = el('button',
    'padding:0.2rem 0.5rem;border:1px solid var(--bg-surface-border);border-radius:3px;background:transparent;color:var(--text-muted);font-size:0.68rem;cursor:pointer;white-space:nowrap;' + css,
    text) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

function numInput(
  parent: HTMLElement, value: number, min: number, max: number,
  onChange: (v: number) => void,
): HTMLInputElement {
  const inp = el('input',
    'width:48px;background:var(--bg-primary);border:1px solid var(--bg-surface-border);border-radius:3px;padding:2px 4px;color:var(--text-body);font-size:0.72rem;text-align:right;') as HTMLInputElement;
  inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.value = String(value);
  inp.addEventListener('change', () => {
    const v = Math.max(min, Math.min(max, parseInt(inp.value) || min));
    inp.value = String(v);
    onChange(v);
  });
  parent.appendChild(inp);
  return inp;
}

// ── Arch tab ─────────────────────────────────────────────────────

function buildArchTab(container: HTMLElement, ctrl: CPPNController): void {
  container.innerHTML = '';

  container.appendChild(el('div',
    'padding:4px 6px;border:1px solid var(--bg-surface-border);border-radius:4px;font-size:0.68rem;color:var(--text-muted);margin-bottom:4px;text-align:center;',
    'Input: x, y, r + z[16]'));

  for (let li = 0; li < ctrl.config.layers.length; li++) {
    const layer = ctrl.config.layers[li];
    const rowEl = row(container, 'background:var(--bg-surface);border-radius:4px;padding:3px 5px;');
    rowEl.appendChild(el('span', 'font-size:0.68rem;color:var(--text-muted);', `L${li}: `));

    numInput(rowEl, layer.width, 4, 512, async (v) => {
      const layers = ctrl.config.layers.map((l, i) => i === li ? { ...l, width: v } : l);
      await ctrl.setLayers(layers);
      buildArchTab(container, ctrl);
    });

    selectEl(rowEl, ACTIVATIONS, layer.activation, async (v) => {
      const layers = ctrl.config.layers.map((l, i) => i === li ? { ...l, activation: v as Activation } : l);
      await ctrl.setLayers(layers);
    });

    const delBtn = el('button', 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.9rem;padding:0 2px;', '×');
    delBtn.addEventListener('click', async () => {
      if (ctrl.config.layers.length <= 1) return;
      await ctrl.setLayers(ctrl.config.layers.filter((_, i) => i !== li));
      buildArchTab(container, ctrl);
    });
    rowEl.appendChild(delBtn);
  }

  const addBtn = el('button',
    'width:100%;margin-top:3px;padding:0.2rem;border:1px dashed var(--bg-surface-border);border-radius:4px;background:transparent;color:var(--text-muted);font-size:0.72rem;cursor:pointer;',
    '+ Add layer');
  addBtn.addEventListener('click', async () => {
    const prev = ctrl.config.layers[ctrl.config.layers.length - 1];
    await ctrl.setLayers([...ctrl.config.layers, { width: prev.width, activation: 'tanh' }]);
    buildArchTab(container, ctrl);
  });
  container.appendChild(addBtn);

  container.appendChild(el('div',
    'margin-top:4px;padding:4px 6px;border:1px solid var(--bg-surface-border);border-radius:4px;font-size:0.68rem;color:var(--text-muted);text-align:center;',
    'Output: RGB (sigmoid)'));

  divider(container);
  heading(container, 'Coordinate scale');
  slider(container, 'Scale', 0.1, 5.0, 0.05, ctrl.config.scale, (v) => ctrl.setScale(v));
}

// ── Weights tab ───────────────────────────────────────────────────

function buildWeightsTab(container: HTMLElement, ctrl: CPPNController): void {
  container.innerHTML = '';
  heading(container, 'Distribution');

  const paramBox = el('div', 'display:flex;flex-direction:column;gap:0;margin-top:0.2rem;');

  function renderParams(): void {
    paramBox.innerHTML = '';
    const dist = ctrl.config.distribution;
    switch (dist.type) {
      case 'normal':
        slider(paramBox, 'σ (std dev)', 0.1, 5.0, 0.05, dist.sigma ?? 1.0,
          (v) => ctrl.setDistribution({ ...dist, sigma: v }));
        break;
      case 'uniform':
        slider(paramBox, 'a (range ±a)', 0.1, 5.0, 0.05, dist.a ?? 1.0,
          (v) => ctrl.setDistribution({ ...dist, a: v }));
        break;
      case 'glorot':
        slider(paramBox, 'Scale', 0.1, 5.0, 0.05, dist.scale ?? 1.0,
          (v) => ctrl.setDistribution({ ...dist, scale: v }));
        break;
      case 'sparse':
        slider(paramBox, 'Sparsity', 0.0, 0.99, 0.01, dist.sparsity ?? 0.8,
          (v) => ctrl.setDistribution({ ...dist, sparsity: v }));
        slider(paramBox, 'Magnitude', 0.1, 10.0, 0.1, dist.magnitude ?? 2.0,
          (v) => ctrl.setDistribution({ ...dist, magnitude: v }));
        break;
    }
  }

  selectEl(container, ['normal', 'uniform', 'glorot', 'sparse'], ctrl.config.distribution.type,
    (v) => { ctrl.setDistribution({ type: v as any }); renderParams(); });

  container.appendChild(paramBox);
  renderParams();

  divider(container);
  heading(container, 'Seed');

  const seedRow = row(container);
  const seedInp = el('input',
    'flex:1;background:var(--bg-primary);border:1px solid var(--bg-surface-border);border-radius:3px;padding:2px 5px;color:var(--text-body);font-size:0.72rem;') as HTMLInputElement;
  seedInp.type = 'number';
  seedInp.value = String(ctrl.seed);
  seedInp.addEventListener('change', () => {
    ctrl.setSeed(parseInt(seedInp.value) || 0);
    seedInp.value = String(ctrl.seed);
  });
  seedRow.appendChild(seedInp);

  const randBtn = el('button',
    'margin-top:0.3rem;width:100%;padding:0.35rem;border:1px solid var(--accent);border-radius:4px;background:transparent;color:var(--accent);font-size:0.72rem;cursor:pointer;',
    '⟳ Randomize') as HTMLButtonElement;
  randBtn.addEventListener('click', () => {
    ctrl.randomizeWeights(Date.now() & 0xffffffff);
    seedInp.value = String(ctrl.seed);
  });
  container.appendChild(randBtn);
}

// ── Z tab ─────────────────────────────────────────────────────────

function buildZTab(container: HTMLElement, ctrl: CPPNController): void {
  container.innerHTML = '';

  const animRow = row(container);
  animRow.appendChild(el('span', 'flex:1;font-size:0.72rem;color:var(--text-body);', 'Animate'));
  const animCheck = el('input', '') as HTMLInputElement;
  animCheck.type = 'checkbox';
  animCheck.checked = true;
  animCheck.addEventListener('change', () => ctrl.setAnimate(animCheck.checked));
  animRow.appendChild(animCheck);

  divider(container);
  heading(container, 'Bands');
  const bandRow = row(container);
  bandRow.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);flex:1;', 'Num bands'));
  selectEl(bandRow, ['2', '3', '4'], String(ctrl.config.numBands), (v) => {
    ctrl.setNumBands(parseInt(v));
    buildZTab(container, ctrl);
  });

  for (let bi = 0; bi < ctrl.config.numBands; bi++) {
    const band = ctrl.config.zBands[bi];
    if (!band) continue;
    divider(container);
    heading(container, `Band ${bi}`);
    slider(container, 'Freq',  0.05, 4.0,  0.05, band.freq,      (v) => ctrl.setZBand(bi, { freq: v }));
    slider(container, 'Amp',   0.0,  2.0,  0.05, band.amplitude, (v) => ctrl.setZBand(bi, { amplitude: v }));
    slider(container, 'Phase', 0.0,  6.28, 0.05, band.phase,     (v) => ctrl.setZBand(bi, { phase: v }));
  }

  divider(container);
  smallBtn(container, 'Randomize dim offsets', () => ctrl.randomizeDimOffsets());
}

// ── Main export ───────────────────────────────────────────────────

export function buildCPPNPanel(
  container: HTMLElement,
  ctrl: CPPNController,
  opts: CPPNPanelOpts = {},
): void {
  container.innerHTML = '';

  // Header
  const header = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;');
  header.appendChild(el('p',
    'font-size:0.65rem;letter-spacing:1.5px;color:var(--text-muted);text-transform:uppercase;margin:0;',
    'CPPN'));
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
      const isActive = preset.id === opts.activePresetId;
      const pill = el('button',
        `padding:2px 8px;border-radius:12px;font-size:0.68rem;cursor:pointer;${isActive
          ? 'background:var(--accent);color:var(--bg-primary);border:1px solid transparent;'
          : 'background:transparent;color:var(--text-muted);border:1px solid var(--bg-surface-border);'}`,
        preset.name);
      pill.addEventListener('click', () => opts.onPresetLoad?.(preset));
      pillRow.appendChild(pill);
    }
    container.appendChild(pillRow);
  }

  // Tab bar + content
  const tabBar     = el('div', 'display:flex;border-bottom:1px solid var(--bg-surface-border);margin-bottom:0.4rem;');
  const tabContent = el('div', 'display:flex;flex-direction:column;');
  container.appendChild(tabBar);
  container.appendChild(tabContent);

  type Tab = 'Arch' | 'Weights' | 'Z';
  const TABS: Tab[] = ['Arch', 'Weights', 'Z'];
  const tabBtns: Partial<Record<Tab, HTMLButtonElement>> = {};

  function switchTab(tab: Tab): void {
    for (const t of TABS) {
      const active = t === tab;
      tabBtns[t]!.style.cssText =
        'flex:1;padding:0.3rem;background:transparent;border:none;border-bottom:2px solid ' +
        (active ? 'var(--accent);color:var(--accent);' : 'transparent;color:var(--text-muted);') +
        'cursor:pointer;font-size:0.68rem;letter-spacing:1px;text-transform:uppercase;';
    }
    if (tab === 'Arch')    buildArchTab(tabContent, ctrl);
    if (tab === 'Weights') buildWeightsTab(tabContent, ctrl);
    if (tab === 'Z')       buildZTab(tabContent, ctrl);
  }

  for (const tab of TABS) {
    const btn = el('button', '', tab) as HTMLButtonElement;
    tabBtns[tab] = btn;
    btn.addEventListener('click', () => switchTab(tab));
    tabBar.appendChild(btn);
  }

  switchTab('Arch');
}
