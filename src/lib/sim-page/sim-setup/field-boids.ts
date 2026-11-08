// src/lib/sim-page/sim-setup/field-boids.ts
import type { FieldBoidsController } from '../../../components/simulations/field-boids/field-boids-controller';
import { buildFieldBoidsPanel, GRAVITY_KEY, randomizeKeepingLocks, restoreDeviceGravity } from '../../../components/simulations/field-boids/field-boids-panel';
import { DEFAULT_FIELD_BOIDS_PARAMS, type FieldBoidsParams } from '../../../components/simulations/field-boids/field-boids-types';
import { FIELD_BOIDS_PRESETS } from '../../../data/field-boids-presets';
import { createPresetManager } from '../../presets/preset-manager';
import { buildPresetSection, type PresetSectionHandle } from '../../presets/preset-ui';
import { attachUndoKeys } from '../../presets/undo-history';
import { wireControlBar, setSettingsOpen, KEY_ROWS, PARAM_ROWS_MOUSE, PARAM_ROWS_TOUCH } from '../control-bar';
import type { HelpSection } from '../help-popover';
import { isPhoneLayout } from '../bottom-sheet';
import { createTiltSensor, tiltMaybeAvailable, type TiltSensor } from '../tilt-sensor';
import { wireHandleHistory } from '../handle-actions';
import { createScrubPanel, type ScrubPanelHandle } from '../scrub-panel';
import { FIELD_BOIDS_GROUPS, type ParamGroup, type ParamKey } from '../../../components/simulations/field-boids/field-boids-spec';

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

  // Touch feedback: a ring under each finger showing the force radius, for
  // touch and pen only (the mouse already has a cursor).
  const rings = document.createElement('div');
  rings.className = 'touch-rings';
  (panel.parentElement as HTMLElement).appendChild(rings);
  const ringEls = new Map<number, HTMLElement>();
  ctrl.onPointers = (pts) => {
    const host = rings.getBoundingClientRect();
    const seen = new Set<number>();
    for (const p of pts) {
      if (p.type === 'mouse') continue;
      seen.add(p.id);
      let el = ringEls.get(p.id);
      if (!el) { el = document.createElement('div'); el.className = 'touch-ring'; rings.appendChild(el); ringEls.set(p.id, el); }
      const d = Math.max(28, 2 * ctrl.pointerRadiusPx());
      el.style.cssText = `left:${p.clientX - host.left}px;top:${p.clientY - host.top}px;width:${d}px;height:${d}px;`;
    }
    for (const [id, el] of ringEls) if (!seen.has(id)) { el.remove(); ringEls.delete(id); }
  };

  let section: PresetSectionHandle | null = null;
  let scrub: ScrubPanelHandle | null = null;
  const viewport = panel.parentElement as HTMLElement;   // .sim-viewport, positioned

  // Phone: everything lives in the scrub card over the canvas (params,
  // presets, Randomize, tilt); the bottom sheet is never shown. Desktop: the
  // full slider panel.
  const scrubKey = 'field-boids-scrub-open';
  // Device settings (not preset params, never randomized) as a last group of
  // the phone list: the tilt toggle and the gravity strength. Their keys
  // are routed to the controller / sensor instead of ctrl.params.
  const deviceGroup: ParamGroup | null = tilt ? { name: 'Device', items: [
    { kind: 'enum', key: 'tiltGravity' as ParamKey, label: 'Tilt steers gravity', names: ['Off', 'On'], ui: 'segmented' },
    { kind: 'num', key: 'gravity' as ParamKey, label: 'Gravity', min: 0, max: 1, step: 0.005 },
  ] } : null;
  let tiltNote = '';
  const getDevice = (k: string): number | undefined => {
    if (k === 'gravity') return ctrl.gravity;
    if (k === 'tiltGravity') return tilt?.isEnabled() ? 1 : 0;
    return undefined;
  };
  const setDevice = (k: string, v: number): boolean => {
    if (k === 'gravity') {
      ctrl.gravity = v;
      try { localStorage.setItem(GRAVITY_KEY, String(v)); } catch { /* session-only */ }
      return true;
    }
    if (k === 'tiltGravity') {
      if (!tilt) return true;
      if (v === 0) { tilt.disable(); tiltNote = ''; return true; }
      tilt.enable().then((r) => {
        tiltNote = r === 'enabled' ? '' : r === 'denied' ? 'permission denied' : r === 'no-sensor' ? 'no tilt sensor' : 'unsupported';
        scrub?.refresh();
      });
      return true;
    }
    return false;
  };

  function ensureScrub(): void {
    const want = isPhoneLayout();
    if (want && !scrub) {
      scrub = createScrubPanel({
        host: viewport,
        groups: deviceGroup ? [...FIELD_BOIDS_GROUPS, deviceGroup] : FIELD_BOIDS_GROUPS,
        params: ctrl.params,
        get: (k) => getDevice(k) ?? (ctrl.params as unknown as Record<string, number>)[k],
        set: (k, v) => { if (!setDevice(k, v)) (ctrl.params as unknown as Record<string, number>)[k] = v; },
        note: (k) => (k === 'tiltGravity' ? tiltNote : ''),
        history: mgr.history,
        locks: mgr.locks,
        buildPresets: (c) => buildPresetSection(c, mgr, { showTitle: false }).dispose,
        onRandomize: () => { randomizeKeepingLocks(ctrl, mgr.locks, mgr.history); mgr.rebuild(); },
        onClose: () => setScrubOpen(false),
      });
      // The page script must not reopen the sheet from its own saved state.
      panel.style.display = 'none';
      sessionStorage.setItem('field-boids-panel-open', 'false');
      setScrubOpen(sessionStorage.getItem(scrubKey) !== 'false');
    } else if (!want && scrub) {
      scrub.dispose();
      scrub = null;
      viewport.classList.remove('scrub-open');
      setSettingsOpen(false);
    }
  }
  // ⚙ opens the list and turns into × while it is open; pause/reset and the
  // fps readout only show alongside the list (see sim-page.css phone rules).
  const settingsBtn = document.querySelector<HTMLElement>('[data-action="settings"]');
  function setScrubOpen(open: boolean): void {
    scrub?.setVisible(open);
    sessionStorage.setItem(scrubKey, open ? 'true' : 'false');
    viewport.classList.toggle('scrub-open', open);
    setSettingsOpen(open);
  }
  // On phones the ⚙ button toggles the scrub list, not the sheet.
  settingsBtn?.addEventListener('click', (e) => {
    if (!scrub) return;
    e.stopImmediatePropagation();
    setScrubOpen(!scrub.isVisible());
  }, { capture: true });

  function buildPanel(): void {
    const scroller = () => panelContent.querySelector<HTMLElement>('.fb-scroll') ?? panelContent;
    const scrollTop = scroller().scrollTop;
    section?.dispose();
    panelContent.innerHTML = '';
    ensureScrub();
    if (scrub) {
      scrub.refresh();
      scrub.rebuildPresets();
    } else {
      buildFieldBoidsPanel(panelContent, ctrl, {
        onClose: () => { panel.style.display = 'none'; },
        buildPresets: (c) => { section = buildPresetSection(c, mgr, { showTitle: false }); },
        history: mgr.history,
        locks: mgr.locks,
        tilt,
        rebuild: () => mgr.rebuild(),
      });
    }
    scroller().scrollTop = scrollTop;
  }
  mgr.onRebuild(buildPanel);
  buildPanel();
  window.matchMedia('(max-width: 768px)').addEventListener('change', buildPanel);

  const bar = wireControlBar(viewport, {
    randomize: () => { randomizeKeepingLocks(ctrl, mgr.locks, mgr.history); mgr.rebuild(); },
    help: fieldBoidsHelp,
  });
  const detachKeys = attachUndoKeys(mgr.history);
  const unwireHandle = wireHandleHistory(panel, mgr.history);
  document.addEventListener('pagehide', () => { detachKeys(); unwireHandle(); mgr.dispose(); tilt?.dispose(); bar.dispose(); }, { once: true });
}

function fieldBoidsHelp(touch: boolean): HelpSection[] {
  const canvas: HelpSection = touch
    ? { title: 'Canvas', rows: [
        { glyph: 'hp-point', label: '1 finger', effect: 'attract · drag carries' },
        { glyph: 'hp-pinch', label: '2 fingers', effect: 'pinch zoom · pan' },
        { glyph: 'hp-tilt', label: 'tilt', effect: 'gravity (Device row)' },
        { glyph: 'hp-touch', label: 'tap', effect: 'close list' },
      ] }
    : { title: 'Canvas', rows: [
        { glyph: 'hp-point', label: 'drag', effect: 'attract · carry' },
        { glyph: 'hp-wheel', label: 'wheel', effect: 'zoom at cursor' },
        { glyph: 'hp-move', label: 'alt · mid · space', effect: '+ drag pans' },
      ] };
  const params: HelpSection = { title: 'Parameters', rows: touch ? PARAM_ROWS_TOUCH : PARAM_ROWS_MOUSE };
  return touch ? [canvas, params] : [canvas, params, { title: 'Keys', rows: KEY_ROWS }];
}
