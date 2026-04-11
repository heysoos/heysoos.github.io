// src/components/simulations/nca/nca-panel.ts
import type { NCAController } from './nca-controller';
import type { NCAPreset, NCAActivation, NCAGridSize, NCASeedMode } from './nca-types';

export interface NCAPanelOpts {
  presets?: NCAPreset[];
  activePresetId?: string;
  onPresetLoad?: (preset: NCAPreset) => void;
  onClose?: () => void;
}

// ── DOM helpers ───────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, css: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(parent: HTMLElement, text: string, onClick: () => void, css = ''): HTMLButtonElement {
  const b = el('button',
    'padding:0.2rem 0.5rem;border:1px solid var(--bg-surface-border);border-radius:3px;' +
    'background:transparent;color:var(--text-muted);font-size:0.68rem;cursor:pointer;white-space:nowrap;' + css,
    text) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

function slider(
  parent: HTMLElement, label: string,
  min: number, max: number, step: number, value: number,
  onChange: (v: number) => void,
): void {
  const wrap  = el('div', 'display:flex;flex-direction:column;gap:0.1rem;margin-bottom:0.35rem;');
  const top   = el('div', 'display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-body);');
  const valEl = el('span', 'color:var(--accent);font-variant-numeric:tabular-nums;', String(value));
  top.appendChild(el('span', '', label));
  top.appendChild(valEl);
  const inp = el('input', 'width:100%;accent-color:var(--accent);cursor:pointer;') as HTMLInputElement;
  inp.type = 'range'; inp.min = String(min); inp.max = String(max);
  inp.step = String(step); inp.value = String(value);
  inp.addEventListener('input', () => {
    const v = parseFloat(inp.value);
    const dec = String(step).includes('.') ? String(step).split('.')[1].length : 0;
    valEl.textContent = v.toFixed(dec);
    onChange(v);
  });
  wrap.appendChild(top); wrap.appendChild(inp);
  parent.appendChild(wrap);
}

function row(parent: HTMLElement, css = ''): HTMLElement {
  const r = el('div', 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:0.3rem;' + css);
  parent.appendChild(r);
  return r;
}

function toggle(parent: HTMLElement, label: string, checked: boolean, onChange: (v: boolean) => void): void {
  const wrap = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;');
  wrap.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);', label));
  const inp = el('input', 'cursor:pointer;accent-color:var(--accent);') as HTMLInputElement;
  inp.type = 'checkbox'; inp.checked = checked;
  inp.addEventListener('change', () => onChange(inp.checked));
  wrap.appendChild(inp);
  parent.appendChild(wrap);
}

function segmented(parent: HTMLElement, options: string[], value: string, onChange: (v: string) => void): void {
  const wrap = el('div', 'display:flex;gap:4px;margin-bottom:0.3rem;flex-wrap:wrap;');
  for (const opt of options) {
    btn(wrap, opt, () => {
      onChange(opt);
      wrap.querySelectorAll('button').forEach(b2 =>
        (b2 as HTMLButtonElement).style.borderColor = b2.textContent === opt ? 'var(--accent)' : 'var(--bg-surface-border)');
    }, opt === value ? 'border-color:var(--accent);color:var(--accent);' : '');
  }
  parent.appendChild(wrap);
}

// ── Accordion section ─────────────────────────────────────────────

function section(parent: HTMLElement, title: string, open = true): HTMLElement {
  const wrap = el('div', 'border-bottom:1px solid var(--bg-surface-border);');
  const header = el('div',
    'display:flex;justify-content:space-between;align-items:center;' +
    'padding:0.4rem 0;cursor:pointer;user-select:none;');
  const titleEl = el('span', 'font-size:0.68rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);', title);
  const arrow = el('span', 'font-size:0.6rem;color:var(--text-muted);transition:transform 0.15s;', open ? '▼' : '▶');
  header.appendChild(titleEl);
  header.appendChild(arrow);

  const body = el('div', 'padding:0.4rem 0;' + (open ? '' : 'display:none;'));
  header.addEventListener('click', () => {
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    arrow.textContent = isOpen ? '▶' : '▼';
  });
  wrap.appendChild(header);
  wrap.appendChild(body);
  parent.appendChild(wrap);
  return body;
}

// ── Build panel ───────────────────────────────────────────────────

export function buildNCAPanel(
  container: HTMLElement,
  ctrl: NCAController,
  opts: NCAPanelOpts = {},
): void {
  container.innerHTML = '';

  const { presets = [], activePresetId, onPresetLoad, onClose } = opts;

  // ── Presets section ───────────────────────────────────────────
  const presetsBody = section(container, 'Presets', true);
  const presetRow = row(presetsBody);
  for (const preset of presets) {
    const b = btn(presetRow, preset.name, () => {
      ctrl.loadPreset(preset);
      onPresetLoad?.(preset);
      buildNCAPanel(container, ctrl, { ...opts, activePresetId: preset.id });
    });
    if (preset.id === activePresetId) {
      b.style.borderColor = 'var(--accent)';
      b.style.color = 'var(--accent)';
    }
  }
  const actionsRow = row(presetsBody, 'margin-top:0.3rem;');
  btn(actionsRow, 'Random Init', () => { ctrl.randomInit(); });

  // ── Architecture section ──────────────────────────────────────
  const archBody = section(container, 'Architecture', false);

  archBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin-bottom:0.2rem;', 'Channels'));
  segmented(archBody, ['8', '16', '32'], String(ctrl.config.channels), (v) => {
    ctrl.setParams({ channels: parseInt(v) as 8 | 16 | 32 });
  });

  archBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin-bottom:0.2rem;', 'Hidden'));
  segmented(archBody, ['32', '64', '128'], String(ctrl.config.hidden), (v) => {
    ctrl.setParams({ hidden: parseInt(v) as 32 | 64 | 128 });
  });

  archBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin-bottom:0.2rem;', 'Filters'));
  const filterRow = row(archBody);
  const filterDefs = [
    { key: 'identity'  as const, label: 'Id' },
    { key: 'sobelX'    as const, label: 'Sx' },
    { key: 'sobelY'    as const, label: 'Sy' },
    { key: 'laplacian' as const, label: 'Lap' },
  ];
  for (const { key, label } of filterDefs) {
    const b = btn(filterRow, label, () => {
      const f = { ...ctrl.config.filters, [key]: !ctrl.config.filters[key] };
      ctrl.setParams({ filters: f });
      b.style.borderColor = ctrl.config.filters[key] ? 'var(--accent)' : 'var(--bg-surface-border)';
      b.style.color = ctrl.config.filters[key] ? 'var(--accent)' : '';
    });
    if (ctrl.config.filters[key]) { b.style.borderColor = 'var(--accent)'; b.style.color = 'var(--accent)'; }
  }

  archBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin:0.3rem 0 0.2rem;', 'Activation'));
  segmented(archBody, ['relu', 'tanh', 'leakyrelu'], ctrl.config.activation, (v) => {
    ctrl.setParams({ activation: v as NCAActivation });
  });

  // ── Runtime section ───────────────────────────────────────────
  const runtimeBody = section(container, 'Runtime', true);
  slider(runtimeBody, 'Fire rate', 0.1, 1, 0.01, ctrl.config.fireRate, (v) => ctrl.setParams({ fireRate: v }));
  slider(runtimeBody, 'Steps/frame', 1, 16, 1, ctrl.config.stepsPerFrame, (v) => ctrl.setParams({ stepsPerFrame: Math.round(v) }));
  slider(runtimeBody, 'dt', 0.1, 2, 0.01, ctrl.config.dt, (v) => ctrl.setParams({ dt: v }));

  // ── Visualization section ─────────────────────────────────────
  const visBody = section(container, 'Visualization', false);
  const ch = ctrl.config.channels - 1;
  slider(visBody, 'R channel', 0, ch, 1, ctrl.config.channelR, (v) => ctrl.setParams({ channelR: Math.round(v) }));
  slider(visBody, 'G channel', 0, ch, 1, ctrl.config.channelG, (v) => ctrl.setParams({ channelG: Math.round(v) }));
  slider(visBody, 'B channel', 0, ch, 1, ctrl.config.channelB, (v) => ctrl.setParams({ channelB: Math.round(v) }));

  // ── Grid section ──────────────────────────────────────────────
  const gridBody = section(container, 'Grid', false);
  gridBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin-bottom:0.2rem;', 'Resolution'));
  segmented(gridBody, ['128', '256', '512'], String(ctrl.config.gridWidth), (v) => {
    const s = parseInt(v) as NCAGridSize;
    ctrl.setParams({ gridWidth: s, gridHeight: s });
  });
  gridBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin:0.3rem 0 0.2rem;', 'Seed mode'));
  segmented(gridBody, ['random', 'center', 'blank'], ctrl.config.seedMode, (v) => {
    ctrl.setParams({ seedMode: v as NCASeedMode });
  });
  const resetRow = row(gridBody, 'margin-top:0.4rem;');
  btn(resetRow, 'Reset', () => ctrl.reset());

  // ── Brush section ─────────────────────────────────────────────
  const brushBody = section(container, 'Brush', true);
  brushBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin-bottom:0.2rem;', 'Mode'));
  segmented(brushBody, ['damage', 'paint'], ctrl.brushOpts.mode, (v) => {
    ctrl.brushOpts = { ...ctrl.brushOpts, mode: v as 'damage' | 'paint' };
  });
  brushBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin-bottom:0.2rem;', 'Shape'));
  segmented(brushBody, ['circle', 'square'], ctrl.brushOpts.shape, (v) => {
    ctrl.brushOpts = { ...ctrl.brushOpts, shape: v as 'circle' | 'square' };
  });
  slider(brushBody, 'Size', 2, 80, 1, ctrl.brushOpts.size, (v) => {
    ctrl.brushOpts = { ...ctrl.brushOpts, size: Math.round(v) };
  });
  slider(brushBody, 'Strength', 0, 1, 0.01, ctrl.brushOpts.strength, (v) => {
    ctrl.brushOpts = { ...ctrl.brushOpts, strength: v };
  });
}
