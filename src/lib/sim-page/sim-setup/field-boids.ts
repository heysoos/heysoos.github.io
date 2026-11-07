// src/lib/sim-page/sim-setup/field-boids.ts
import type { FieldBoidsController } from '../../../components/simulations/field-boids/field-boids-controller';
import { buildFieldBoidsPanel, restoreDeviceGravity } from '../../../components/simulations/field-boids/field-boids-panel';
import { DEFAULT_FIELD_BOIDS_PARAMS, type FieldBoidsParams } from '../../../components/simulations/field-boids/field-boids-types';
import { FIELD_BOIDS_PRESETS } from '../../../data/field-boids-presets';
import { createPresetManager } from '../../presets/preset-manager';
import { buildPresetSection, type PresetSectionHandle } from '../../presets/preset-ui';
import { attachUndoKeys } from '../../presets/undo-history';
import { isPhoneLayout } from '../bottom-sheet';
import { createTiltSensor, tiltMaybeAvailable, type TiltSensor } from '../tilt-sensor';
import { wireHandleHistory } from '../handle-actions';
import { createScrubPanel, type ScrubPanelHandle } from '../scrub-panel';
import { FIELD_BOIDS_GROUPS } from '../../../components/simulations/field-boids/field-boids-spec';

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
    apply: (body) => { Object.assign(ctrl.params, body.params); },
    prepare: (body) => {
      if (isPhoneLayout()) {
        body.params.numParticles = Math.min(body.params.numParticles, PHONE_PARTICLE_CAP);
      }
      return body;
    },
  });

  const defaultPreset = FIELD_BOIDS_PRESETS.find(p => p.isDefault) ?? FIELD_BOIDS_PRESETS[0];
  if (defaultPreset) {
    await mgr.load(defaultPreset as unknown as { id: string; name: string; params: Params });
    mgr.history.clear();
  }

  // Tilt sensor: only offered where a sensor is plausible (coarse pointer +
  // DeviceOrientationEvent). Desktops get no toggle and gravity stays
  // straight down, so a preset with gravity behaves the same everywhere.
  let tilt: TiltSensor | undefined;
  if (tiltMaybeAvailable()) {
    restoreDeviceGravity(ctrl);
    tilt = createTiltSensor({
      onDirection: (x, y) => ctrl.setGravityDirection(x, y),
      onDisabled: () => ctrl.resetGravityDirection(),
    });
  }

  let section: PresetSectionHandle | null = null;
  let scrub: ScrubPanelHandle | null = null;
  const viewport = panel.parentElement as HTMLElement;   // .sim-viewport, positioned

  // Phone: params live in the scrub list over the canvas; the sheet keeps
  // presets, Randomize and tilt. Desktop: the full slider panel.
  function ensureScrub(): void {
    const want = isPhoneLayout();
    if (want && !scrub) {
      scrub = createScrubPanel({
        host: viewport,
        groups: FIELD_BOIDS_GROUPS,
        get: (k) => (ctrl.params as unknown as Record<string, number>)[k],
        set: (k, v) => { (ctrl.params as unknown as Record<string, number>)[k] = v; },
        history: mgr.history,
        locks: mgr.locks,
      });
    } else if (!want && scrub) {
      scrub.dispose();
      scrub = null;
    }
    scrub?.setVisible(panel.style.display !== 'none');
  }

  function buildPanel(): void {
    const scrollTop = panelContent.scrollTop;
    section?.dispose();
    panelContent.innerHTML = '';
    ensureScrub();
    buildFieldBoidsPanel(panelContent, ctrl, {
      onClose: () => { panel.style.display = 'none'; },
      buildPresets: (c) => { section = buildPresetSection(c, mgr); },
      history: mgr.history,
      locks: mgr.locks,
      tilt,
      rebuild: () => mgr.rebuild(),
      paramsHidden: !!scrub,
    });
    scrub?.refresh();
    panelContent.scrollTop = scrollTop;
  }
  mgr.onRebuild(buildPanel);
  buildPanel();
  window.matchMedia('(max-width: 768px)').addEventListener('change', buildPanel);
  // The scrub list follows the sheet's open/closed state.
  new MutationObserver(() => scrub?.setVisible(panel.style.display !== 'none'))
    .observe(panel, { attributes: true, attributeFilter: ['style'] });

  const detachKeys = attachUndoKeys(mgr.history);
  const unwireHandle = wireHandleHistory(panel, mgr.history);
  document.addEventListener('pagehide', () => { detachKeys(); unwireHandle(); mgr.dispose(); tilt?.dispose(); }, { once: true });
}
