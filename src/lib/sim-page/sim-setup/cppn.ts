// src/lib/sim-page/sim-setup/cppn.ts
import type { CPPNController } from '../../../components/simulations/cppn/cppn-controller';
import { buildCPPNPanel } from '../../../components/simulations/cppn/cppn-panel';
import { CPPN_PRESETS } from '../../../data/cppn-presets';

export async function setupCPPN(
  ctrl: CPPNController,
  panelContent: HTMLElement,
  panel: HTMLElement,
): Promise<void> {
  const defaultPreset = CPPN_PRESETS.find(p => p.isDefault) ?? CPPN_PRESETS[0];
  if (defaultPreset) await ctrl.loadPreset(defaultPreset);

  let activeId = defaultPreset?.id;

  function buildPanel(id?: string): void {
    panelContent.innerHTML = '';
    buildCPPNPanel(panelContent, ctrl, {
      presets: CPPN_PRESETS,
      activePresetId: id,
      onClose: () => { panel.style.display = 'none'; },
      onPresetLoad: async (preset) => {
        await ctrl.loadPreset(preset);
        activeId = preset.id;
        buildPanel(preset.id);
      },
    });
  }
  buildPanel(activeId);
}
