// src/lib/sim-page/sim-setup/cppn.ts
// CPPN page wiring. Same shape as field-boids: a shared preset manager
// (built-ins + localStorage customs, undo history, locks), the phone scrub
// card over the canvas (⚙ toggles it; params, presets and Randomize live
// there), and the full tabbed panel on desktop.
import type { CPPNController } from '../../../components/simulations/cppn/cppn-controller';
import { buildCPPNPanel } from '../../../components/simulations/cppn/cppn-panel';
import {
  CPPN_GROUPS, DEFAULT_FLAT, configFromFlat, presetToBody, toFlat,
  type CPPNBody, type CPPNFlatParams, type FlatKey,
} from '../../../components/simulations/cppn/cppn-spec';
import { CPPN_PRESETS } from '../../../data/cppn-presets';
import { createPresetManager } from '../../presets/preset-manager';
import { buildPresetSection, type PresetSectionHandle } from '../../presets/preset-ui';
import { attachUndoKeys } from '../../presets/undo-history';
import { isPhoneLayout } from '../bottom-sheet';
import { wireHandleHistory } from '../handle-actions';
import { createScrubPanel, type ScrubPanelHandle } from '../scrub-panel';
import type { ParamGroup } from '../param-spec';

const RES_KEY = 'cppn:maxResolution';

export async function setupCPPN(
  ctrl: CPPNController,
  panelContent: HTMLElement,
  panel: HTMLElement,
): Promise<void> {
  const builtIn = CPPN_PRESETS.map(presetToBody);

  const mgr = createPresetManager<CPPNFlatParams>({
    simId: 'cppn',
    defaults: { ...DEFAULT_FLAT },
    builtIn,
    capture: (): CPPNBody => ({
      params: toFlat(ctrl.config, ctrl.seed, ctrl.isAnimating),
      layers: ctrl.config.layers.map(l => ({ ...l })),
      weights: Array.from(ctrl.weights),
    }),
    apply: async (body) => {
      const b = body as CPPNBody;
      const config = configFromFlat(ctrl.config, b.params, b.layers);
      ctrl.setAnimate(b.params.animate !== 0);
      await ctrl.setState(config, b.params.seed, b.weights);
    },
  });

  const defaultPreset = builtIn.find(p => p.isDefault) ?? builtIn[0];
  if (defaultPreset) {
    await mgr.load(defaultPreset);
    mgr.history.clear();
  }

  // Device setting (not a preset param): the render cap. Persisted like
  // field-boids' gravity strength.
  try {
    const raw = localStorage.getItem(RES_KEY);
    if (raw !== null && Number.isFinite(+raw)) ctrl.maxResolution = +raw;
  } catch { /* storage blocked */ }
  const deviceGroup: ParamGroup<string> = { name: 'Device', items: [
    { kind: 'num', key: 'maxResolution', label: 'Max resolution', min: 256, max: 1920, step: 64, int: true },
  ] };

  // Phone param edits go through the flat view: read the current flat
  // params, change one key, push the result back through the controller.
  const flat = (): CPPNFlatParams => toFlat(ctrl.config, ctrl.seed, ctrl.isAnimating);
  const getParam = (k: string): number => {
    if (k === 'maxResolution') return ctrl.maxResolution;
    return flat()[k as FlatKey] as number;
  };
  const setParam = (k: string, v: number): void => {
    if (k === 'maxResolution') {
      ctrl.maxResolution = v;
      try { localStorage.setItem(RES_KEY, String(v)); } catch { /* session-only */ }
      return;
    }
    const f = { ...flat(), [k]: v } as CPPNFlatParams;
    if (k === 'animate') { ctrl.setAnimate(v !== 0); return; }
    const config = configFromFlat(ctrl.config, f);
    if (k === 'seed' || k.startsWith('dist') || ['sigma', 'a', 'glorotScale', 'sparsity', 'magnitude'].includes(k)) {
      // Weight-affecting: regenerate from the (possibly new) seed.
      ctrl.config = config;
      ctrl.randomizeWeights(f.seed);
    } else {
      ctrl.config = config;    // scale / bands: uniform-only, no weight change
    }
  };
  const randomize = (): void => {
    mgr.history.endGesture();
    ctrl.randomizeWeights(Date.now() & 0xffffffff);
    mgr.history.push('Randomize');
  };

  let section: PresetSectionHandle | null = null;
  let scrub: ScrubPanelHandle | null = null;
  const viewport = panel.parentElement as HTMLElement;   // .sim-viewport, positioned
  const scrubKey = 'cppn-scrub-open';
  // showIf predicates read the flat params; hand the scrub list a live proxy.
  const flatProxy = new Proxy({}, { get: (_t, k) => flat()[k as FlatKey] }) as CPPNFlatParams;

  function ensureScrub(): void {
    const want = isPhoneLayout();
    if (want && !scrub) {
      scrub = createScrubPanel({
        host: viewport,
        groups: [...CPPN_GROUPS, deviceGroup],
        params: flatProxy,
        get: getParam,
        set: setParam,
        history: mgr.history,
        locks: mgr.locks,
        buildPresets: (c) => buildPresetSection(c, mgr, { showTitle: false }).dispose,
        onRandomize: () => { randomize(); mgr.rebuild(); },
        onClose: () => setScrubOpen(false),
      });
      // The page script must not reopen the sheet from its own saved state.
      panel.style.display = 'none';
      sessionStorage.setItem('cppn-panel-open', 'false');
      setScrubOpen(sessionStorage.getItem(scrubKey) !== 'false');
    } else if (!want && scrub) {
      scrub.dispose();
      scrub = null;
      viewport.classList.remove('scrub-open');
      if (settingsIcon) settingsIcon.textContent = '⚙';
    }
  }
  // ⚙ opens the list and turns into × while it is open (sim-page.css phone rules).
  const settingsBtn = document.querySelector<HTMLElement>('[data-action="settings"]');
  const settingsIcon = settingsBtn?.querySelector<HTMLElement>('.ctrl-icon') ?? null;
  function setScrubOpen(open: boolean): void {
    scrub?.setVisible(open);
    sessionStorage.setItem(scrubKey, open ? 'true' : 'false');
    viewport.classList.toggle('scrub-open', open);
    if (settingsIcon) settingsIcon.textContent = open ? '×' : '⚙';
  }
  settingsBtn?.addEventListener('click', (e) => {
    if (!scrub) return;
    e.stopImmediatePropagation();
    setScrubOpen(!scrub.isVisible());
  }, { capture: true });

  function buildPanel(): void {
    const scrollTop = panelContent.scrollTop;
    section?.dispose();
    panelContent.innerHTML = '';
    ensureScrub();
    if (scrub) {
      scrub.refresh();
      scrub.rebuildPresets();
    } else {
      buildCPPNPanel(panelContent, ctrl, {
        onClose: () => { panel.style.display = 'none'; },
        buildPresets: (c) => { section = buildPresetSection(c, mgr, { showTitle: false }); },
        onChange: (label) => { mgr.history.push(label); section?.refresh(); },
      });
    }
    panelContent.scrollTop = scrollTop;
  }
  mgr.onRebuild(buildPanel);
  buildPanel();
  window.matchMedia('(max-width: 768px)').addEventListener('change', buildPanel);

  const detachKeys = attachUndoKeys(mgr.history);
  const unwireHandle = wireHandleHistory(panel, mgr.history);
  document.addEventListener('pagehide', () => { detachKeys(); unwireHandle(); mgr.dispose(); }, { once: true });
}
