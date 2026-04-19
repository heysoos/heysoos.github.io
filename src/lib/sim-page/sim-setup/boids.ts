// src/lib/sim-page/sim-setup/boids.ts
import type { BoidsController } from '../../../components/simulations/boids/boids-controller';
import { buildBoidsPanel } from '../../../components/simulations/boids/panel';
import { AudioReactor } from '../../../components/simulations/boids/boids-audio';
import { BOIDS_PRESETS } from '../../../data/boids-presets';
import { createShaderEditor, type ShaderEditorHandle } from '../shader-editor';

export async function setupBoids(
  ctrl: BoidsController,
  panelContent: HTMLElement,
  panel: HTMLElement,
  shaderPanelEl: HTMLElement,
): Promise<void> {
  const reactor = new AudioReactor();

  let panelControls: { teardown: () => void; updateAudioViz: (baseParams?: Record<string, number>) => void } | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseParams: Record<string, number> = { ...(ctrl.params as any) };
  let isApplyingAudio = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trackedParams = new Proxy(ctrl.params as any, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set(target: any, prop: string, value: any): boolean {
      target[prop] = value;
      if (!isApplyingAudio) baseParams[prop] = value;
      return true;
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctrl as any).params = trackedParams;

  let mappingRafId = 0;
  (function mappingLoop() {
    if (reactor.isActive()) {
      isApplyingAudio = true;
      Object.assign(ctrl.params, baseParams);
      const snapshot = reactor.analyze();
      reactor.applyMappings(ctrl.params, snapshot);
      isApplyingAudio = false;
    }
    if (panel.style.display !== 'none') {
      panelControls?.updateAudioViz(baseParams as Record<string, number>);
    }
    mappingRafId = requestAnimationFrame(mappingLoop);
  })();

  document.addEventListener('pagehide', () => {
    cancelAnimationFrame(mappingRafId);
    reactor.stop();
  }, { once: true });

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
