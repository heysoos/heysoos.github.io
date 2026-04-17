// src/lib/sim-page/sim-setup/nca.ts
import type { NCAController } from '../../../components/simulations/nca/nca-controller';
import { buildNCAPanel } from '../../../components/simulations/nca/nca-panel';
import { NCA_PRESETS } from '../../../data/nca-presets';

export function setupNCA(
  ctrl: NCAController,
  panelContent: HTMLElement,
  panel: HTMLElement,
): void {
  const defaultPreset = NCA_PRESETS.find(p => p.isDefault) ?? NCA_PRESETS[0];
  if (defaultPreset) ctrl.loadPreset(defaultPreset);

  let activeId = defaultPreset?.id;

  function buildPanel(id?: string): void {
    panelContent.innerHTML = '';
    buildNCAPanel(panelContent, ctrl, {
      presets: NCA_PRESETS,
      activePresetId: id,
      onClose: () => { panel.style.display = 'none'; },
      onPresetLoad: (preset) => {
        activeId = preset.id;
        buildPanel(preset.id);
      },
    });
  }
  buildPanel(activeId);
}
