// src/lib/sim-page/sim-setup/boids.ts
import type { BoidsController } from '../../../components/simulations/boids/boids-controller';
import { buildBoidsPanel } from '../../../components/simulations/boids/panel';
import { BOIDS_PRESETS } from '../../../data/boids-presets';
import { bindBoidsAudio } from '../boids-audio-binding';
import { createShaderEditor, type ShaderEditorHandle } from '../shader-editor';

export async function setupBoids(
  ctrl: BoidsController,
  panelContent: HTMLElement,
  panel: HTMLElement,
  shaderPanelEl: HTMLElement,
): Promise<void> {
  const { reactor, getBaseParams } = bindBoidsAudio(ctrl);

  let panelControls: { teardown: () => void; updateAudioViz: (baseParams?: Record<string, number>) => void } | null = null;

  // Drive panel viz from the same rAF that bindBoidsAudio runs internally.
  // bindBoidsAudio already updates ctrl.params each frame; we just need to
  // pump the panel updaters with the latest base snapshot.
  let vizRafId = 0;
  (function vizLoop() {
    panelControls?.updateAudioViz(getBaseParams());
    vizRafId = requestAnimationFrame(vizLoop);
  })();
  document.addEventListener('pagehide', () => cancelAnimationFrame(vizRafId), { once: true });

  const defaultPreset = BOIDS_PRESETS.find(p => p.isDefault) ?? BOIDS_PRESETS[0];
  if (defaultPreset) {
    Object.assign(ctrl.params, defaultPreset.params);
    ctrl.trailsEnabled = defaultPreset.trailsEnabled;
    ctrl.trailDecay = defaultPreset.trailDecay;
    if (defaultPreset.shader !== undefined) await ctrl.reloadShader(defaultPreset.shader);
  }

  let shaderEditorHandle: ShaderEditorHandle | null = null;
  let shaderEditorOpen = false;

  function buildPanel(activeId?: string): void {
    panelControls?.teardown();
    panelContent.innerHTML = '';
    panelControls = buildBoidsPanel(panelContent, ctrl, {
      presets: BOIDS_PRESETS,
      activePresetId: activeId,
      reactor,
      onClose: () => {
        panelControls?.teardown();
        panel.style.display = 'none';
      },
      onShaderEdit: () => {
        shaderEditorOpen = !shaderEditorOpen;
        shaderPanelEl.style.display = shaderEditorOpen ? 'flex' : 'none';
      },
      onPresetLoad: async (preset) => {
        Object.assign(ctrl.params, preset.params);
        ctrl.trailsEnabled = preset.trailsEnabled;
        ctrl.trailDecay = preset.trailDecay;
        const nextShader = preset.shader ?? ctrl.defaultShaderSource;
        await ctrl.reloadShader(nextShader);
        shaderEditorHandle?.setDoc(nextShader);
        buildPanel(preset.id);
      },
    });
  }
  buildPanel(defaultPreset?.id);

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
      onApply: (code) => ctrl.reloadShader(code),
      onReset: () => ctrl.shaderSource,
      onClose: () => { shaderEditorOpen = false; },
    },
  );
}
