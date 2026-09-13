// src/lib/sim-page/sim-setup/field-boids.ts
import type { FieldBoidsController } from '../../../components/simulations/field-boids/field-boids-controller';
import { FIELD_BOIDS_PRESETS } from '../../../data/field-boids-presets';

export async function setupFieldBoids(
  ctrl: FieldBoidsController,
  _panelContent: HTMLElement,
  _panel: HTMLElement,
): Promise<void> {
  const defaultPreset = FIELD_BOIDS_PRESETS.find(p => p.isDefault) ?? FIELD_BOIDS_PRESETS[0];
  if (defaultPreset) ctrl.loadPreset(defaultPreset);
  // Panel is built in Task 5.
}
