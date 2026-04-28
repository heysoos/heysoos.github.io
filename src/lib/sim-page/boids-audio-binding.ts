// src/lib/sim-page/boids-audio-binding.ts
// Shared audio-reactor wiring used by both the gallery sim page and the
// admin/boids editor. Sets up an AudioReactor, a Proxy that snapshots the
// "base" (un-modulated) params, and a rAF loop that applies audio mappings
// to ctrl.params each frame. Pass `getBaseParams` into the panel's
// updateAudioViz callback so indicator bars show modulation deltas correctly.

import type { BoidsController } from '../../components/simulations/boids/boids-controller';
import { AudioReactor } from '../../components/simulations/boids/boids-audio';

export interface BoidsAudioBinding {
  reactor: AudioReactor;
  getBaseParams: () => Record<string, number>;
  dispose: () => void;
}

export function bindBoidsAudio(ctrl: BoidsController): BoidsAudioBinding {
  const reactor = new AudioReactor();

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

  let rafId = 0;
  let stopped = false;
  (function loop() {
    if (stopped) return;
    if (reactor.isActive()) {
      isApplyingAudio = true;
      Object.assign(ctrl.params, baseParams);
      const snapshot = reactor.analyze();
      reactor.applyMappings(ctrl.params, snapshot);
      isApplyingAudio = false;
    }
    rafId = requestAnimationFrame(loop);
  })();

  const onPageHide = () => dispose();
  document.addEventListener('pagehide', onPageHide, { once: true });

  function dispose(): void {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(rafId);
    reactor.stop();
    document.removeEventListener('pagehide', onPageHide);
  }

  return {
    reactor,
    getBaseParams: () => baseParams,
    dispose,
  };
}
