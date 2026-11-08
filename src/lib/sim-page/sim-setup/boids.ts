// src/lib/sim-page/sim-setup/boids.ts
import type { BoidsController } from '../../../components/simulations/boids/boids-controller';
import { buildBoidsPanel } from '../../../components/simulations/boids/panel';
import { BOIDS_PRESETS } from '../../../data/boids-presets';
import { bindBoidsAudio } from '../boids-audio-binding';
import { createShaderEditor, type ShaderEditorHandle } from '../shader-editor';
import { applyBoidsPreset, captureBoidsPreset, type BoidsPresetBody } from '../boids-preset-apply';
import { createPresetManager } from '../../presets/preset-manager';
import { buildPresetSection, type PresetSectionHandle } from '../../presets/preset-ui';
import { attachUndoKeys } from '../../presets/undo-history';
import { wireControlBar, setSettingsOpen, KEY_ROWS, PARAM_ROWS_MOUSE, PARAM_ROWS_TOUCH } from '../control-bar';
import type { HelpSection } from '../help-popover';
import { wireHandleHistory } from '../handle-actions';
import { isPhoneLayout } from '../bottom-sheet';
import { createScrubPanel, type ScrubPanelHandle } from '../scrub-panel';
import { BOIDS_COLORS, BOIDS_GROUPS, colorIndex, randomizeBoidsParams } from '../../../components/simulations/boids/boids-spec';
import { boidsPhoneTabs } from '../boids-phone-tabs';
import { packRGB, unpackRGB } from '../custom-swatch';
import { randomColor } from '../palette';

type Params = BoidsPresetBody['params'];

export async function setupBoids(
  ctrl: BoidsController,
  panelContent: HTMLElement,
  panel: HTMLElement,
  shaderPanelEl: HTMLElement,
): Promise<void> {
  const { reactor, getBaseParams } = bindBoidsAudio(ctrl);

  let panelControls: { teardown: () => void; updateAudioViz: (baseParams?: Record<string, number>) => void } | null = null;
  let shaderEditorHandle: ShaderEditorHandle | null = null;
  let shaderEditorOpen = false;

  // Drive panel viz from a dedicated rAF. bindBoidsAudio handles the
  // audio→params mapping in its own loop; here we only pump the panel
  // updaters with the latest base snapshot. Skip the work when the panel
  // is hidden (perf opt from 26768e8).
  let vizRafId = 0;
  (function vizLoop() {
    if (panel.style.display !== 'none') {
      panelControls?.updateAudioViz(getBaseParams());
    }
    vizRafId = requestAnimationFrame(vizLoop);
  })();
  document.addEventListener('pagehide', () => cancelAnimationFrame(vizRafId), { once: true });

  const mgr = createPresetManager<Params>({
    simId: 'boids',
    defaults: { ...(ctrl.params as unknown as Params) },
    builtIn: BOIDS_PRESETS as unknown as Array<{ id: string; name: string; params: Params }>,
    // Base (un-modulated) params so audio reactivity never reads as an edit.
    capture: () => captureBoidsPreset(ctrl, reactor.isActive() ? getBaseParams() : undefined),
    apply: (body) => applyBoidsPreset(ctrl, body as BoidsPresetBody, (code) => shaderEditorHandle?.setDoc(code)),
  });

  const defaultPreset = BOIDS_PRESETS.find(p => p.isDefault) ?? BOIDS_PRESETS[0];
  if (defaultPreset) {
    await mgr.load(defaultPreset as unknown as { id: string; name: string; params: Params });
    mgr.history.clear();
  }

  let section: PresetSectionHandle | null = null;
  let scrub: ScrubPanelHandle | null = null;
  const viewport = panel.parentElement as HTMLElement;   // .sim-viewport, positioned

  // Touch feedback: a ring under each finger showing the force radius, for
  // touch and pen only (the mouse already has a cursor).
  const rings = document.createElement('div');
  rings.className = 'touch-rings';
  viewport.appendChild(rings);
  const ringEls = new Map<number, HTMLElement>();
  ctrl.onPointers = (pts) => {
    const host = rings.getBoundingClientRect();
    const seen = new Set<number>();
    for (const pt of pts) {
      if (pt.type === 'mouse') continue;
      seen.add(pt.id);
      let el = ringEls.get(pt.id);
      if (!el) { el = document.createElement('div'); el.className = 'touch-ring'; rings.appendChild(el); ringEls.set(pt.id, el); }
      const d = Math.max(28, 2 * ctrl.pointerRadiusPx());
      el.style.cssText = `left:${pt.clientX - host.left}px;top:${pt.clientY - host.top}px;width:${d}px;height:${d}px;`;
    }
    for (const [id, el] of ringEls) if (!seen.has(id)) { el.remove(); ringEls.delete(id); }
  };

  // Phone: the same scrub card as field-boids over the canvas (params,
  // presets, Randomize); the bottom sheet with the desktop panel is never
  // shown. `color` and `trails` are virtual keys of the spec, routed here.
  const pr = ctrl.params as unknown as Record<string, number>;
  const getKey = (k: string): number => {
    if (k === 'color') return colorIndex(ctrl.params);
    if (k === 'colorHex') return colorIndex(ctrl.params) >= 0 ? -1 : packRGB(ctrl.params.colorR, ctrl.params.colorG, ctrl.params.colorB);
    if (k === 'trails') return ctrl.trailsEnabled ? 1 : 0;
    if (k === 'trailDecay') return ctrl.trailDecay;
    return pr[k] ?? 0;
  };
  const setKey = (k: string, v: number): void => {
    if (k === 'color') {
      const c = BOIDS_COLORS[Math.round(v)];
      if (c) { ctrl.params.colorR = c.r; ctrl.params.colorG = c.g; ctrl.params.colorB = c.b; }
    } else if (k === 'colorHex') {
      if (v >= 0) [ctrl.params.colorR, ctrl.params.colorG, ctrl.params.colorB] = unpackRGB(v);
    } else if (k === 'trails') ctrl.trailsEnabled = v === 1;
    else if (k === 'trailDecay') ctrl.trailDecay = v;
    else pr[k] = v;
  };
  // showIf predicates read through this so virtual keys resolve too.
  const paramView = new Proxy({}, { get: (_t, k) => getKey(String(k)) });
  const randomize = (): void => {
    mgr.history.endGesture();
    const kept = mgr.locks.keys().map(k => [k, pr[k]] as const);
    randomizeBoidsParams(ctrl.params);
    if (!mgr.locks.keys().includes('color')) {           // a colour from the curated list
      [ctrl.params.colorR, ctrl.params.colorG, ctrl.params.colorB] = unpackRGB(randomColor());
    }
    for (const [k, v] of kept) pr[k] = v;
    mgr.history.push('Randomize');
    mgr.rebuild();
  };

  const scrubKey = 'boids-scrub-open';
  const settingsBtn = document.querySelector<HTMLElement>('[data-action="settings"]');
  function setScrubOpen(open: boolean): void {
    scrub?.setVisible(open);
    sessionStorage.setItem(scrubKey, open ? 'true' : 'false');
    viewport.classList.toggle('scrub-open', open);
    setSettingsOpen(open);
  }
  function ensureScrub(): void {
    const want = isPhoneLayout();
    if (want && !scrub) {
      scrub = createScrubPanel({
        host: viewport,
        groups: BOIDS_GROUPS,
        params: paramView,
        get: getKey,
        set: setKey,
        history: mgr.history,
        locks: mgr.locks,
        // Audio and Image: the desktop tabs at full size, a live monitor strip when shrunk.
        tabs: boidsPhoneTabs(ctrl, reactor, getBaseParams, viewport),
        storageKey: 'boids-scrub',
        buildPresets: (c) => buildPresetSection(c, mgr, { showTitle: false }).dispose,
        onRandomize: randomize,
        onClose: () => setScrubOpen(false),
      });
      // The page script must not reopen the sheet from its own saved state.
      panelControls?.teardown();
      panelControls = null;
      panel.style.display = 'none';
      sessionStorage.setItem('boids-panel-open', 'false');
      setScrubOpen(sessionStorage.getItem(scrubKey) !== 'false');
    } else if (!want && scrub) {
      scrub.dispose();
      scrub = null;
      viewport.classList.remove('scrub-open');
      setSettingsOpen(false);
    }
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
    panelControls?.teardown();
    panelContent.innerHTML = '';
    ensureScrub();
    if (scrub) {
      scrub.refresh();
      scrub.rebuildPresets();
      return;
    }
    panelControls = buildBoidsPanel(panelContent, ctrl, {
      reactor,
      history: mgr.history,
      locks: mgr.locks,
      spec: { groups: BOIDS_GROUPS, params: paramView, get: getKey, set: setKey, onRandomize: randomize },
      buildPresets: (c) => { section = buildPresetSection(c, mgr, { showTitle: false }); },
      onClose: () => {
        panelControls?.teardown();
        panel.style.display = 'none';
      },
      onShaderEdit: () => {
        shaderEditorOpen = !shaderEditorOpen;
        shaderPanelEl.style.display = shaderEditorOpen ? 'flex' : 'none';
      },
    });
    scroller().scrollTop = scrollTop;
  }
  mgr.onRebuild(buildPanel);
  buildPanel();
  window.matchMedia('(max-width: 768px)').addEventListener('change', buildPanel);

  const editorWrap   = shaderPanelEl.querySelector('#shader-editor-wrap') as HTMLElement;
  const shaderErrors = shaderPanelEl.querySelector('#shader-errors') as HTMLElement;
  const applyBtn     = shaderPanelEl.querySelector('#shader-apply') as HTMLButtonElement;
  const resetBtn     = shaderPanelEl.querySelector('#shader-reset') as HTMLButtonElement;
  const closeBtn     = shaderPanelEl.querySelector('#shader-panel-close') as HTMLButtonElement;

  shaderEditorHandle = createShaderEditor(
    editorWrap,
    shaderErrors,
    applyBtn,
    resetBtn,
    closeBtn,
    shaderPanelEl,
    {
      initialCode: ctrl.shaderSource,
      // Applying a shader is one undo entry; CodeMirror keeps its own text history.
      onApply: async (code) => { const r = await ctrl.reloadShader(code); mgr.history.push('Shader'); section?.refresh(); return r; },
      onReset: () => ctrl.shaderSource,
      onClose: () => { shaderEditorOpen = false; },
    },
  );

  const bar = wireControlBar(viewport, { randomize, help: boidsHelp });
  const detachKeys = attachUndoKeys(mgr.history);
  const unwireHandle = wireHandleHistory(panel, mgr.history);
  document.addEventListener('pagehide', unwireHandle, { once: true });
  document.addEventListener('pagehide', () => { detachKeys(); mgr.dispose(); bar.dispose(); }, { once: true });
}

function boidsHelp(touch: boolean): HelpSection[] {
  const canvas: HelpSection = touch
    ? { title: 'Canvas', rows: [
        { glyph: 'hp-point', label: '1 finger', effect: 'attract · drag carries' },
        { glyph: 'hp-pinch', label: '2 fingers', effect: 'pinch zoom · pan' },
        { glyph: 'hp-touch', label: 'tap', effect: 'close list' },
      ] }
    : { title: 'Canvas', rows: [
        { glyph: 'hp-hover', label: 'hover', effect: 'attract' },
        { glyph: 'hp-point', label: 'drag', effect: 'attract · carry' },
        { glyph: 'hp-wheel', label: 'wheel', effect: 'zoom at cursor' },
        { glyph: 'hp-move', label: 'alt · mid · space', effect: '+ drag pans' },
      ] };
  const params: HelpSection = { title: 'Parameters', rows: touch ? PARAM_ROWS_TOUCH : PARAM_ROWS_MOUSE };
  return touch ? [canvas, params] : [canvas, params, { title: 'Keys', rows: KEY_ROWS }];
}
