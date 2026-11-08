// src/lib/sim-page/sim-setup/cppn.ts
// CPPN page wiring. Same shape as field-boids: a shared preset manager
// (built-ins + localStorage customs, undo history, locks), the phone scrub
// card over the canvas (⚙ toggles it; network, weights, motion, presets and
// Randomize live there), and the tabbed panel on desktop.
//
// Edits flow through the flat view in cppn-spec.ts. Network rows change the
// architecture, which recompiles the shader: those are debounced so a width
// scrub compiles once when the finger settles, and the viewport carries
// .sim-busy while a compile is in flight (spinner on ⚄, "compiling" by the
// fps readout).
import type { CPPNController } from '../../../components/simulations/cppn/cppn-controller';
import { buildCPPNPanel } from '../../../components/simulations/cppn/cppn-panel';
import {
  CPPN_GROUPS, DEFAULT_FLAT, configFromFlat, isArchKey, isWeightKey, presetToBody, toFlat,
  type CPPNBody, type CPPNFlatParams, type FlatKey,
} from '../../../components/simulations/cppn/cppn-spec';
import { BUDGET_DESKTOP, BUDGET_PHONE, flatParamCount, randomizeFlat } from '../../../components/simulations/cppn/cppn-randomize';
import { CPPN_PRESETS } from '../../../data/cppn-presets';
import { createPresetManager } from '../../presets/preset-manager';
import { buildPresetSection, type PresetSectionHandle } from '../../presets/preset-ui';
import { attachUndoKeys } from '../../presets/undo-history';
import { isPhoneLayout } from '../bottom-sheet';
import { wireHandleHistory } from '../handle-actions';
import { createScrubPanel, type ScrubPanelHandle } from '../scrub-panel';
import type { ParamGroup } from '../param-spec';

const RES_KEY = 'cppn:maxResolution';
const ARCH_DEBOUNCE_MS = 180;

export async function setupCPPN(
  ctrl: CPPNController,
  panelContent: HTMLElement,
  panel: HTMLElement,
): Promise<void> {
  const builtIn = CPPN_PRESETS.map(presetToBody);
  const budget = () => (isPhoneLayout() ? BUDGET_PHONE : BUDGET_DESKTOP);

  const mgr = createPresetManager<CPPNFlatParams>({
    simId: 'cppn',
    defaults: { ...DEFAULT_FLAT },
    builtIn,
    capture: (): CPPNBody => ({
      params: toFlat(ctrl.config, ctrl.seed, ctrl.isAnimating),
      weights: Array.from(ctrl.weights),
    }),
    apply: async (body) => {
      const b = body as CPPNBody;
      ctrl.setAnimate(b.params.animate !== 0);
      await ctrl.setState(configFromFlat(ctrl.config, b.params), b.params.seed, b.weights);
    },
  });

  const defaultPreset = builtIn.find(p => p.isDefault) ?? builtIn[0];
  if (defaultPreset) {
    await mgr.load(defaultPreset);
    mgr.history.clear();
  }

  // Compile spinner.
  const viewport = panel.parentElement as HTMLElement;   // .sim-viewport, positioned
  ctrl.onBusy = (busy) => viewport.classList.toggle('sim-busy', busy);

  // Device setting (not a preset param): the render cap, persisted.
  try {
    const raw = localStorage.getItem(RES_KEY);
    if (raw !== null && Number.isFinite(+raw)) ctrl.maxResolution = +raw;
  } catch { /* storage blocked */ }
  const deviceGroup: ParamGroup<string> = { name: 'Device', items: [
    { kind: 'num', key: 'maxResolution', label: 'Max resolution', min: 256, max: 1920, step: 64, int: true },
  ] };

  // ── Flat-view edits ──
  // Architecture edits are staged in `pendingFlat` and applied after a short
  // quiet period, so a scrub recompiles once. Everything else applies at once.
  const flat = (): CPPNFlatParams => pendingFlat ?? toFlat(ctrl.config, ctrl.seed, ctrl.isAnimating);
  let pendingFlat: CPPNFlatParams | null = null;
  let archTimer = 0;
  const flushArch = () => {
    archTimer = 0;
    if (!pendingFlat) return;
    const f = pendingFlat;
    pendingFlat = null;
    ctrl.config = configFromFlat(ctrl.config, f);
    void ctrl.setLayers(ctrl.config.layers).then(() => { scrub?.refresh(); section?.refresh(); });
  };
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
    if (isArchKey(k)) {
      pendingFlat = f;
      if (archTimer) clearTimeout(archTimer);
      archTimer = window.setTimeout(flushArch, ARCH_DEBOUNCE_MS);
      return;
    }
    if (k === 'animate') { ctrl.setAnimate(v !== 0); return; }
    ctrl.config = configFromFlat(ctrl.config, f);
    if (isWeightKey(k)) ctrl.randomizeWeights(f.seed);   // regenerate from the (possibly new) seed
  };
  const randomize = (): void => {
    mgr.history.endGesture();
    const f = randomizeFlat(toFlat(ctrl.config, ctrl.seed, ctrl.isAnimating), mgr.locks.keys(), budget());
    ctrl.setAnimate(f.animate !== 0);
    void ctrl.setState(configFromFlat(ctrl.config, f), f.seed).then(() => {
      mgr.history.push('Randomize');
      mgr.rebuild();
    });
  };

  let section: PresetSectionHandle | null = null;
  let scrub: ScrubPanelHandle | null = null;
  const scrubKey = 'cppn-scrub-open';
  // showIf predicates and the budget line read the flat params; hand the
  // scrub list a live proxy so they always see the staged state.
  const flatProxy = new Proxy({}, { get: (_t, k) => flat()[k as FlatKey] }) as CPPNFlatParams;
  const groups: ParamGroup<string>[] = CPPN_GROUPS.map(g => g.name === 'Network'
    ? { ...g, note: () => `${flatParamCount(flat()).toLocaleString()} weights · budget ${budget().toLocaleString()}` }
    : g);

  function ensureScrub(): void {
    const want = isPhoneLayout();
    if (want && !scrub) {
      scrub = createScrubPanel({
        host: viewport,
        groups: [...groups, deviceGroup],
        params: flatProxy,
        get: getParam,
        set: setParam,
        history: mgr.history,
        locks: mgr.locks,
        buildPresets: (c) => buildPresetSection(c, mgr, { showTitle: false }).dispose,
        onRandomize: randomize,
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
        onRandomize: randomize,
        budget: budget(),
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
