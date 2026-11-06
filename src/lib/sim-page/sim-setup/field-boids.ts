// src/lib/sim-page/sim-setup/field-boids.ts
import type { FieldBoidsController } from '../../../components/simulations/field-boids/field-boids-controller';
import { buildFieldBoidsPanel } from '../../../components/simulations/field-boids/field-boids-panel';
import { DEFAULT_FIELD_BOIDS_PARAMS, type FieldBoidsParams } from '../../../components/simulations/field-boids/field-boids-types';
import { FIELD_BOIDS_PRESETS } from '../../../data/field-boids-presets';
import { createPresetManager } from '../../presets/preset-manager';
import { buildPresetSection, type PresetSectionHandle } from '../../presets/preset-ui';
import { attachUndoKeys } from '../../presets/undo-history';
import { isPhoneLayout } from '../bottom-sheet';

/** Phones run ~70–80k particles comfortably; presets keep their desktop
 *  count, the clamp is applied at load time only. The slider can go higher. */
export const PHONE_PARTICLE_CAP = 80_000;

type Params = FieldBoidsParams & Record<string, unknown>;

export async function setupFieldBoids(
  ctrl: FieldBoidsController,
  panelContent: HTMLElement,
  panel: HTMLElement,
): Promise<void> {
  const mgr = createPresetManager<Params>({
    simId: 'field-boids',
    defaults: { ...DEFAULT_FIELD_BOIDS_PARAMS },
    builtIn: FIELD_BOIDS_PRESETS as unknown as Array<{ id: string; name: string; params: Params }>,
    capture: () => ({ params: { ...ctrl.params } }),
    apply: (body) => {
      Object.assign(ctrl.params, body.params);
      if (isPhoneLayout()) {
        ctrl.params.numParticles = Math.min(ctrl.params.numParticles, PHONE_PARTICLE_CAP);
      }
    },
  });

  const defaultPreset = FIELD_BOIDS_PRESETS.find(p => p.isDefault) ?? FIELD_BOIDS_PRESETS[0];
  if (defaultPreset) {
    Object.assign(ctrl.params, defaultPreset.params);
    if (isPhoneLayout()) ctrl.params.numParticles = Math.min(ctrl.params.numParticles, PHONE_PARTICLE_CAP);
    mgr.setActiveId(defaultPreset.id);
    mgr.history.resetBaseline();
  }

  let section: PresetSectionHandle | null = null;

  function buildPanel(): void {
    const scrollTop = panelContent.scrollTop;
    section?.dispose();
    panelContent.innerHTML = '';
    buildFieldBoidsPanel(panelContent, ctrl, {
      onClose: () => { panel.style.display = 'none'; },
      buildPresets: (c) => { section = buildPresetSection(c, mgr); },
      history: mgr.history,
    });
    panelContent.scrollTop = scrollTop;
  }
  mgr.onRebuild(buildPanel);
  buildPanel();

  const detachKeys = attachUndoKeys(mgr.history);
  document.addEventListener('pagehide', () => { detachKeys(); mgr.dispose(); }, { once: true });
}
