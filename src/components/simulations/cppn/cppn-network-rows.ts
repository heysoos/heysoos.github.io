// src/components/simulations/cppn/cppn-network-rows.ts
// The phone card's layer stack: an "in" row, one row per hidden layer
// (index · width meter + number · activation chip), an "out" row, and
// − / + layer buttons. Dragging a layer row sideways scrubs its width,
// tapping the chip cycles the activation, long-pressing a row locks its
// width (which also pins the whole architecture for Randomize).

import type { CustomRowApi } from '../../../lib/sim-page/param-spec';
import { fmtParam, sliderFrac } from '../../../lib/sim-page/param-math';
import { ACT_NAMES, MAX_LAYERS, layerWidthSpec } from './cppn-spec';

export function renderNetworkRows(container: HTMLElement, api: CustomRowApi): { refresh(): void } {
  container.className += ' cppn-layers';
  const stack = document.createElement('div');
  const foot = document.createElement('div');
  foot.className = 'cppn-layer-pm';
  foot.innerHTML = `<button class="pm-minus">− layer</button><button class="pm-plus">+ layer</button>`;
  container.append(stack, foot);
  const minus = foot.querySelector<HTMLButtonElement>('.pm-minus')!;
  const plus = foot.querySelector<HTMLButtonElement>('.pm-plus')!;
  minus.addEventListener('click', () => {
    const n = Math.round(api.get('layers'));
    if (n <= 1) return;
    api.set('layers', n - 1);
    api.commit('Remove layer');
  });
  plus.addEventListener('click', () => {
    const n = Math.round(api.get('layers'));
    if (n >= MAX_LAYERS) return;
    api.set('layers', n + 1);
    api.commit('Add layer');
  });

  type LayerRow = { el: HTMLElement; val: HTMLElement; chip: HTMLElement };
  let rows: LayerRow[] = [];
  let built = -1;

  const ioRow = (label: string, text: string): HTMLElement => {
    const r = document.createElement('div');
    r.className = 'cppn-layer io';
    r.innerHTML = `<span class="ix">${label}</span><span class="w">${text}</span>`;
    return r;
  };

  function build(n: number): void {
    stack.innerHTML = '';
    rows = [];
    stack.appendChild(ioRow('in', 'x · y · r · z<sub>16</sub>'));
    for (let i = 0; i < n; i++) {
      const spec = layerWidthSpec(i);
      const r = document.createElement('div');
      r.className = 'cppn-layer scrub-row';
      r.innerHTML = `<span class="ix">${i + 1}</span><span class="w"><i class="lk"></i>width <b class="v"></b></span><button class="chip"></button>`;
      const chip = r.querySelector<HTMLButtonElement>('.chip')!;
      chip.addEventListener('pointerdown', (e) => e.stopPropagation());   // keep the row drag/long-press out of the chip
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const k = `layer${i}Act`;
        api.set(k, (Math.round(api.get(k)) + 1) % ACT_NAMES.length);
        api.commit('Activation');
      });
      api.attachRowDrag(r, spec);
      api.attachLongPress(r, spec.key);
      stack.appendChild(r);
      rows.push({ el: r, val: r.querySelector<HTMLElement>('.v')!, chip });
    }
    stack.appendChild(ioRow('out', 'rgb · sigmoid'));
    built = n;
  }

  function refresh(): void {
    const n = Math.max(1, Math.min(MAX_LAYERS, Math.round(api.get('layers'))));
    if (n !== built) build(n);
    rows.forEach((row, i) => {
      const spec = layerWidthSpec(i);
      const v = api.get(spec.key);
      row.val.textContent = fmtParam(spec, v);
      row.el.style.setProperty('--f', sliderFrac(spec, v).toFixed(4));
      row.el.classList.toggle('locked', api.isLocked(spec.key));
      row.chip.textContent = `${ACT_NAMES[Math.round(api.get(`layer${i}Act`))] ?? 'tanh'} ›`;
    });
    minus.disabled = n <= 1;
    plus.disabled = n >= MAX_LAYERS;
  }

  refresh();
  return { refresh };
}
