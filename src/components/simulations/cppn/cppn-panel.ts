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
