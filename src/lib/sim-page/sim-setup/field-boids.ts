// src/lib/sim-page/sim-setup/field-boids.ts
import type { FieldBoidsController } from '../../../components/simulations/field-boids/field-boids-controller';
import { buildFieldBoidsPanel } from '../../../components/simulations/field-boids/field-boids-panel';
import { FIELD_BOIDS_PRESETS } from '../../../data/field-boids-presets';

export async function setupFieldBoids(
  ctrl: FieldBoidsController,
  panelContent: HTMLElement,
  panel: HTMLElement,
): Promise<void> {
  const defaultPreset = FIELD_BOIDS_PRESETS.find(p => p.isDefault) ?? FIELD_BOIDS_PRESETS[0];
  if (defaultPreset) ctrl.loadPreset(defaultPreset);

  function buildPanel(id?: string): void {
    panelContent.innerHTML = '';
    buildFieldBoidsPanel(panelContent, ctrl, {
      presets: FIELD_BOIDS_PRESETS,
      activePresetId: id,
      onClose: () => { panel.style.display = 'none'; },
      onPresetLoad: (preset) => {
        ctrl.loadPreset(preset);
        buildPanel(preset.id);
      },
    });
  }
  buildPanel(defaultPreset?.id);
}
