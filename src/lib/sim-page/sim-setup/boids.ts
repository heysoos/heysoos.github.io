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

  function buildPanel(): void {
    const scrollTop = panelContent.scrollTop;
    section?.dispose();
    panelControls?.teardown();
    panelContent.innerHTML = '';
    panelControls = buildBoidsPanel(panelContent, ctrl, {
      reactor,
      history: mgr.history,
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
  document.addEventListener('pagehide', () => { detachKeys(); mgr.dispose(); }, { once: true });
}
