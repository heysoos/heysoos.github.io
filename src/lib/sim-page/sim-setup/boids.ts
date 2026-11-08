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
import { wireHandleHistory } from '../handle-actions';
import { isPhoneLayout } from '../bottom-sheet';
import { createScrubPanel, type ScrubPanelHandle } from '../scrub-panel';
import { AUDIO_BANDS, BOIDS_COLORS, BOIDS_GROUPS, colorIndex, randomizeBoidsParams } from '../../../components/simulations/boids/boids-spec';
import { MAPPABLE_PARAMS, PARAM_META, type BandKey } from '../../../components/simulations/boids/boids-audio';
import type { ImageForceMode } from '../../../components/simulations/boids/boids-image-force';

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
  // Audio: one mapping per band on the phone (the first enabled one wins
  // when the desktop tab made several).
  let audioNote = '';
  const bandTarget = (band: BandKey): number => {
    const m = reactor.mappings.find(m => m.band === band && m.enabled);
    const i = m ? MAPPABLE_PARAMS.indexOf(m.param) : -1;
    return i + 1;
  };
  const setBandTarget = (band: BandKey, v: number): void => {
    reactor.mappings = reactor.mappings.filter(m => m.band !== band);
    const param = MAPPABLE_PARAMS[Math.round(v) - 1];
    if (param) {
      const meta = PARAM_META[param as string];
      reactor.mappings.push({ param, band, mode: 'add', depth: 0.5, gain: 1, min: meta.min, max: meta.max, enabled: true });
    }
    reactor.saveMappings();
  };
  const setMic = (on: boolean): void => {
    if (!on) { reactor.stop(); audioNote = ''; scrub?.refresh(); return; }
    reactor.start('microphone')
      .then(() => { audioNote = ''; })
      .catch(() => { audioNote = reactor.lastError || 'microphone unavailable'; })
      .then(() => scrub?.refresh());
  };
  // Camera: the webcam feeds the image processor; the force reads it.
  let cameraNote = '';
  const setCamera = (on: boolean): void => {
    if (!on) {
      ctrl.webcam.stop();
      ctrl.imageProcessor.clearImage();
      ctrl.rebuildBoidsBindGroups();
      cameraNote = '';
      scrub?.refresh();
      return;
    }
    ctrl.imageForce.setEnabled(true);
    ctrl.webcam.start()
      .then(() => { ctrl.rebuildBoidsBindGroups(); cameraNote = ctrl.webcam.status === 'error' ? (ctrl.webcam.lastError || 'camera unavailable') : ''; })
      .catch(() => { cameraNote = ctrl.webcam.lastError || 'camera unavailable'; })
      .then(() => scrub?.refresh());
  };
  const getKey = (k: string): number => {
    if (k === 'color') return colorIndex(ctrl.params);
    if (k === 'trails') return ctrl.trailsEnabled ? 1 : 0;
    if (k === 'trailDecay') return ctrl.trailDecay;
    if (k === 'audioSource') return reactor.isActive() ? 1 : 0;
    if (k === 'audioStrength') return reactor.globalStrength;
    if (k.startsWith('audio:')) return bandTarget(k.slice(6) as BandKey);
    if (k === 'camera') return ctrl.webcam.status === 'active' ? 1 : 0;
    if (k === 'cameraMirror') return ctrl.webcam.mirrored ? 1 : 0;
    if (k === 'imageMode') return ctrl.imageForce.getForceMode();
    if (k === 'imageStrength') return ctrl.imageForce.getStrength();
    if (k === 'imageInvert') return ctrl.imageForce.getInvert() ? 1 : 0;
    return pr[k] ?? 0;
  };
  const setKey = (k: string, v: number): void => {
    if (k === 'color') {
      const c = BOIDS_COLORS[Math.round(v)];
      if (c) { ctrl.params.colorR = c.r; ctrl.params.colorG = c.g; ctrl.params.colorB = c.b; }
    } else if (k === 'trails') ctrl.trailsEnabled = v === 1;
    else if (k === 'trailDecay') ctrl.trailDecay = v;
    else if (k === 'audioSource') setMic(v === 1);
    else if (k === 'audioStrength') { reactor.globalStrength = v; reactor.saveGlobal(); }
    else if (k.startsWith('audio:')) setBandTarget(k.slice(6) as BandKey, v);
    else if (k === 'camera') setCamera(v === 1);
    else if (k === 'cameraMirror') ctrl.webcam.mirrored = v === 1;
    else if (k === 'imageMode') ctrl.imageForce.setForceMode(Math.round(v) as ImageForceMode);
    else if (k === 'imageStrength') ctrl.imageForce.setStrength(v);
    else if (k === 'imageInvert') ctrl.imageForce.setInvert(v === 1);
    else pr[k] = v;
  };
  const noteFor = (k: string): string => (k === 'audioSource' ? audioNote : k === 'camera' ? cameraNote : '');
  // showIf predicates read through this so virtual keys resolve too.
  const paramView = new Proxy({}, { get: (_t, k) => getKey(String(k)) });
  const randomize = (): void => {
    mgr.history.endGesture();
    const kept = mgr.locks.keys().map(k => [k, pr[k]] as const);
    randomizeBoidsParams(ctrl.params);
    for (const [k, v] of kept) pr[k] = v;
    mgr.history.push('Randomize');
    mgr.rebuild();
  };

  const scrubKey = 'boids-scrub-open';
  const settingsBtn = document.querySelector<HTMLElement>('[data-action="settings"]');
  const settingsIcon = settingsBtn?.querySelector<HTMLElement>('.ctrl-icon') ?? null;
  function setScrubOpen(open: boolean): void {
    scrub?.setVisible(open);
    sessionStorage.setItem(scrubKey, open ? 'true' : 'false');
    viewport.classList.toggle('scrub-open', open);
    if (settingsIcon) settingsIcon.textContent = open ? '×' : '⚙';
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
        note: noteFor,
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
      if (settingsIcon) settingsIcon.textContent = '⚙';
    }
  }
  // On phones the ⚙ button toggles the scrub list, not the sheet.
  settingsBtn?.addEventListener('click', (e) => {
    if (!scrub) return;
    e.stopImmediatePropagation();
    setScrubOpen(!scrub.isVisible());
  }, { capture: true });

  function buildPanel(): void {
    const scrollTop = panelContent.scrollTop;
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
    panelContent.scrollTop = scrollTop;
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

  const detachKeys = attachUndoKeys(mgr.history);
  const unwireHandle = wireHandleHistory(panel, mgr.history);
  document.addEventListener('pagehide', unwireHandle, { once: true });
  document.addEventListener('pagehide', () => { detachKeys(); mgr.dispose(); }, { once: true });
}
