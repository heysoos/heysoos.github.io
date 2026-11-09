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
  CPPN_GROUPS, DEFAULT_FLAT, GROUP_LOCK_PREFIX, configFromFlat, expandGroupLocks, isArchKey, isWeightKey, presetToBody, prepareCPPNBody, toFlat,
  type CPPNBody, type CPPNFlatParams, type FlatKey,
} from '../../../components/simulations/cppn/cppn-spec';
import { BUDGET_DESKTOP, BUDGET_PHONE, flatParamCount, randomizeFlat, randomizeInputs } from '../../../components/simulations/cppn/cppn-randomize';
import { loadGenSettings, saveGenSettings } from '../../../components/simulations/cppn/cppn-expr/settings';
import type { GenSettings } from '../../../components/simulations/cppn/cppn-expr/generator';
import { renderNetworkRows } from '../../../components/simulations/cppn/cppn-network-rows';
import { buildInputsPage, type InputsApi } from '../../../components/simulations/cppn/cppn-inputs-panel';
import { makeThumb } from '../../../components/simulations/cppn/cppn-expr/thumb';
import { generateExpression, canonical } from '../../../components/simulations/cppn/cppn-expr/generator';
import type { PanelMode } from '../../../components/simulations/cppn/cppn-panel';
import { CPPN_PRESETS } from '../../../data/cppn-presets';
import { createPresetManager } from '../../presets/preset-manager';
import { createParamLocks } from '../../presets/param-locks';
import { buildPresetSection, type PresetSectionHandle } from '../../presets/preset-ui';
import { attachUndoKeys } from '../../presets/undo-history';
import { isPhoneLayout } from '../bottom-sheet';
import { wireHandleHistory } from '../handle-actions';
import { createScrubPanel, type ScrubPanelHandle } from '../scrub-panel';
import type { ParamGroup } from '../param-spec';
import { attachCPPNGestures } from '../cppn-gestures';
import { wireControlBar, setSettingsOpen, KEY_ROWS, PARAM_ROWS_MOUSE, PARAM_ROWS_TOUCH } from '../control-bar';
import type { HelpSection } from '../help-popover';

const RES_KEY = 'cppn:maxResolution';
const ARCH_DEBOUNCE_MS = 180;

export async function setupCPPN(
  ctrl: CPPNController,
  panelContent: HTMLElement,
  panel: HTMLElement,
): Promise<void> {
  if (import.meta.env.DEV) (window as unknown as { __cppn?: CPPNController }).__cppn = ctrl;   // dev hook: pixel checks
  const builtIn = CPPN_PRESETS.map(presetToBody);
  const budget = () => (isPhoneLayout() ? BUDGET_PHONE : BUDGET_DESKTOP);
  const locks = createParamLocks('cppn');
  // Locks with `group:*` entries expanded to their members (Randomize and prepare use this; the UI shows raw keys).
  const effectiveLockedKeys = (): string[] => expandGroupLocks(locks.keys());
  const lockedInputSlots = (): Set<number> => {
    const out = new Set<number>();
    for (const k of effectiveLockedKeys()) { const m = /^input(\d)$/.exec(k); if (m) out.add(+m[1]); }
    return out;
  };
  // Generator taste (device setting) + the preset's normalize flag.
  let genStored = loadGenSettings();
  const genSettings = (): GenSettings => ({ ...genStored, normalize: ctrl.config.normalizeInputs });
  const setGenSettings = (s: GenSettings): void => { genStored = { weights: { ...s.weights }, complexity: s.complexity, normalize: true }; saveGenSettings(genStored); };

  const mgr = createPresetManager<CPPNFlatParams>({
    simId: 'cppn',
    defaults: { ...DEFAULT_FLAT },
    builtIn,
    capture: (): CPPNBody => ({
      params: toFlat(ctrl.config, ctrl.seed, ctrl.isAnimating),
      weights: Array.from(ctrl.weights),
      inputs: [...ctrl.config.inputs],
    }),
    apply: async (body) => {
      const b = body as CPPNBody;
      ctrl.setAnimate(b.params.animate !== 0);
      const config = configFromFlat(ctrl.config, b.params);
      if (b.inputs && b.inputs.length > 0) config.inputs = [...b.inputs];
      await ctrl.setState(config, b.params.seed, b.weights);
    },
    // Pre-expression bodies get x, y, r + normalize off; locked input slots
    // (and every member of a locked group) keep their current value.
    prepare: (body) => {
      const b = prepareCPPNBody(body as CPPNBody, ctrl.config.inputs, effectiveLockedKeys());
      const current = toFlat(ctrl.config, ctrl.seed, ctrl.isAnimating);
      for (const k of effectiveLockedKeys()) if (k in current) (b.params as Record<string, unknown>)[k] = current[k as FlatKey];
      return b;
    },
    locks,
  });

  if (import.meta.env.DEV) (window as unknown as { __cppnMgr?: unknown }).__cppnMgr = mgr;
  const defaultPreset = builtIn.find(p => p.isDefault) ?? builtIn[0];
  if (defaultPreset) {
    await mgr.load(defaultPreset);
    mgr.history.clear();
  }

  // Compile spinner.
  const viewport = panel.parentElement as HTMLElement;   // .sim-viewport, positioned
  ctrl.onBusy = (busy) => viewport.classList.toggle('sim-busy', busy);

  // Canvas gestures: pinch/wheel zoom of the coordinate window, pan, one-
  // finger latent scrub, minimap (see cppn-gestures.ts).
  const canvas = viewport.querySelector<HTMLCanvasElement>('canvas')!;
  const gestures = attachCPPNGestures(canvas, viewport, ctrl);

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
    // Mid-scrub: wait for the finger to lift rather than compiling every
    // width it rests on for 180ms.
    if (mgr.history.isGestureOpen()) { archTimer = window.setTimeout(flushArch, ARCH_DEBOUNCE_MS); return; }
    const f = pendingFlat;
    pendingFlat = null;
    ctrl.config = configFromFlat(ctrl.config, f);
    void ctrl.setLayers(ctrl.config.layers).then(() => { scrub?.refresh(); desktop?.refresh(); section?.refresh(); });
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
    if (k.endsWith('Act')) {                      // activations are uniforms: live, no recompile
      if (pendingFlat) pendingFlat[k] = v;
      ctrl.config = configFromFlat(ctrl.config, f);
      return;
    }
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
  // Shift+R / both dice: everything unlocked — architecture, weights, motion
  // and the input expressions. R / ↺ stay "new seed" (weights only).
  const randomize = (): void => {
    mgr.history.endGesture();
    const lockedKeys = effectiveLockedKeys();
    const f = randomizeFlat(toFlat(ctrl.config, ctrl.seed, ctrl.isAnimating), lockedKeys, budget(), ctrl.config.inputs.length);
    const config = configFromFlat(ctrl.config, f);
    const inputsLocked = lockedKeys.includes(`${GROUP_LOCK_PREFIX}Network`) || lockedKeys.includes(`${GROUP_LOCK_PREFIX}Inputs`);
    if (!inputsLocked) config.inputs = randomizeInputs(ctrl.config.inputs, lockedInputSlots(), genSettings());
    ctrl.setAnimate(f.animate !== 0);
    void ctrl.setState(config, f.seed).then(() => {
      mgr.history.push('Randomize');
      mgr.rebuild();
    });
  };
  /** The inputs page's ⚄: fresh expressions for the unlocked slots only (a buffer write). */
  const randomizeInputsOnly = (): void => {
    mgr.history.endGesture();
    ctrl.setInputs(randomizeInputs(ctrl.config.inputs, lockedInputSlots(), genSettings()));
    mgr.history.push('Randomize inputs');
    mgr.rebuild();
  };

  // ── Inputs page API (desktop page and phone band share it) ──
  const commitInputs = (label: string): void => { mgr.history.push(label); desktop?.refresh(); section?.refresh(); scrub?.refresh(); };
  const inputsApi: InputsApi = {
    inputs: () => ctrl.config.inputs,
    setInput: (i, src) => { const list = [...ctrl.config.inputs]; list[i] = src; return ctrl.setInputs(list)[i]; },
    addInput: () => {
      if (ctrl.config.inputs.length >= 8) return;
      const taken = new Set(ctrl.config.inputs.map(canonical));
      ctrl.setInputs([...ctrl.config.inputs, generateExpression(genSettings(), taken)]);
    },
    removeInput: (i) => { if (ctrl.config.inputs.length <= 1) return; ctrl.setInputs(ctrl.config.inputs.filter((_, j) => j !== i)); },
    results: () => ctrl.inputStatus,
    normalize: () => ctrl.config.normalizeInputs,
    setNormalize: (on) => ctrl.setNormalize(on),
    isLocked: (i) => locks.isLocked(`input${i}`),
    setLocked: (i, on) => locks.set(`input${i}`, on),
    genSettings,
    setGenSettings,
    randomizeInputs: randomizeInputsOnly,
    commit: commitInputs,
    back: () => { desktop?.setMode('main'); panelMode = 'main'; },
    dynamicVars: () => ({ t: 2 * Math.PI * ((ctrl.exprClock % 60) / 60), px: ctrl.pointer[0], py: ctrl.pointer[1] }),
  };
  let panelMode: PanelMode = 'main';
  const inputThumbs = (): HTMLCanvasElement[] => {
    const d = inputsApi.dynamicVars!();
    return ctrl.config.inputs.slice(0, 6).map(src => makeThumb(src, 16, { normalize: ctrl.config.normalizeInputs, ...d }));
  };
  // px / py read the pointer over the canvas (world space, holds its last value).
  ctrl.bindPointer(canvas);

  let section: PresetSectionHandle | null = null;
  let scrub: ScrubPanelHandle | null = null;
  let desktop: { refresh(): void; dispose(): void; setMode(m: PanelMode): void } | null = null;
  const scrubKey = 'cppn-scrub-open';
  // showIf predicates and the budget line read the flat params; hand the
  // scrub list a live proxy so they always see the staged state.
  const flatProxy = new Proxy({}, { get: (_t, k) => flat()[k as FlatKey] }) as CPPNFlatParams;
  const groups: ParamGroup<string>[] = CPPN_GROUPS.map(g => g.name === 'Network'
    ? { ...g,
        note: () => `${Math.round(flat().layers)} layers · ${flatParamCount(flat(), ctrl.config.inputs.length).toLocaleString()} / ${budget().toLocaleString()} weights`,
        render: (c, api, rowClass) => renderNetworkRows(c, api, rowClass, { inputsRow: {
          count: () => ctrl.config.inputs.length,
          thumbs: inputThumbs,
          onOpen: () => { if (desktop) { desktop.setMode('inputs'); panelMode = 'inputs'; } },
        } }) }
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
      setSettingsOpen(false);
    }
  }
  // ⚙ opens the list and turns into × while it is open (sim-page.css phone rules).
  const settingsBtn = document.querySelector<HTMLElement>('[data-action="settings"]');
  function setScrubOpen(open: boolean): void {
    scrub?.setVisible(open);
    sessionStorage.setItem(scrubKey, open ? 'true' : 'false');
    viewport.classList.toggle('scrub-open', open);
    setSettingsOpen(open);
  }
  settingsBtn?.addEventListener('click', (e) => {
    if (!scrub) return;
    e.stopImmediatePropagation();
    setScrubOpen(!scrub.isVisible());
  }, { capture: true });

  function buildPanel(): void {
    const scroller = () => panelContent.querySelector<HTMLElement>('.fb-scroll') ?? panelContent;
    const scrollTop = scroller().scrollTop;
    section?.dispose();
    desktop?.dispose(); desktop = null;
    panelContent.innerHTML = '';
    ensureScrub();
    if (scrub) {
      scrub.refresh();
      scrub.rebuildPresets();
    } else {
      desktop = buildCPPNPanel(panelContent, {
        groups: [...groups, deviceGroup],
        params: flatProxy,
        get: getParam,
        set: setParam,
        history: mgr.history,
        locks: mgr.locks,
        buildPresets: (c) => { section = buildPresetSection(c, mgr, { showTitle: false }); },
        onRandomize: randomize,
        onClose: () => { panel.style.display = 'none'; },
        groupLocks: true,
        inputsPage: (c) => buildInputsPage(c, inputsApi),
        mode: panelMode,
      });
    }
    scroller().scrollTop = scrollTop;
  }
  mgr.onRebuild(buildPanel);
  buildPanel();
  window.matchMedia('(max-width: 768px)').addEventListener('change', buildPanel);

  const bar = wireControlBar(viewport, { randomize, help: helpSections });
  // ↺ (and R) = new seed, same architecture. Routed through setParam so the
  // Seed row shows it and it is one undo step.
  const resetBtn = document.querySelector<HTMLElement>('[data-action="reset"]');
  if (resetBtn) { resetBtn.dataset.label = 'new seed'; resetBtn.setAttribute('aria-label', 'New seed'); }
  resetBtn?.addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    mgr.history.endGesture();
    setParam('seed', Math.floor(Math.random() * 4294967296));
    mgr.history.push('New seed');
    mgr.rebuild();
  }, { capture: true });

  const detachKeys = attachUndoKeys(mgr.history);
  const unwireHandle = wireHandleHistory(panel, mgr.history);
  document.addEventListener('pagehide', () => { detachKeys(); unwireHandle(); mgr.dispose(); gestures.dispose(); bar.dispose(); }, { once: true });
}

const CHIP = '<span class="hg-chip">tanh ›</span>';
const IX = '<span class="hg-ix">3</span>';
function helpSections(touch: boolean): HelpSection[] {
  const canvas: HelpSection = touch
    ? { title: 'Canvas', rows: [
        { glyph: 'hp-point', label: '1 finger', effect: 'latent scrub · motion holds' },
        { glyph: 'hp-pinch', label: '2 fingers', effect: 'pinch zoom · pan' },
        { glyph: 'hp-touch', label: 'tap', effect: 'close list' },
        { glyph: 'hp-map', label: 'minimap', effect: 'reset view · ×2 reset latent' },
      ] }
    : { title: 'Canvas', rows: [
        { glyph: 'hp-point', label: 'drag', effect: 'latent scrub · motion holds' },
        { glyph: 'hp-wheel', label: 'wheel', effect: 'zoom at cursor' },
        { glyph: 'hp-move', label: 'alt / mid / space + drag', effect: 'pan' },
        { glyph: 'hp-map', label: 'minimap', effect: 'reset view · ×2 reset latent' },
      ] };
  const params: HelpSection = { title: 'Parameters', rows: [
    ...(touch ? PARAM_ROWS_TOUCH : PARAM_ROWS_MOUSE),
    { glyph: IX, label: 'drag', effect: 'reorder layer' },
    { glyph: CHIP, label: touch ? 'tap' : 'click', effect: 'next activation' },
    { glyph: CHIP, label: 'hold + slide', effect: 'scrub activations' },
  ] };
  const keys = KEY_ROWS.map(r => (r.label === 'P / R / H' ? { ...r, effect: 'pause / new seed / hide UI' } : r));
  return touch ? [canvas, params] : [canvas, params, { title: 'Keys', rows: keys }];
}
