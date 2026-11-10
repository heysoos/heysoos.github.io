// src/lib/sim-page/fps-counter.ts

interface FpsTarget {
  maxFps: number;
  tickCount: number;
  /** Backing-size multiplier when the sim lowers resolution to keep up (CPPN). */
  renderScale?: number;
}

export function createFpsCounter(
  fpsValueEl:     HTMLElement,
  fpsUnlimited:   HTMLInputElement,
  fpsSlider:      HTMLInputElement,
  fpsSliderLabel: HTMLElement,
  fpsSliderRow:   HTMLElement,
  ctrl:           FpsTarget,
): { dispose: () => void } {
  let lastTick = ctrl.tickCount;
  let lastMs   = performance.now();

  const intervalId = setInterval(() => {
    const now   = performance.now();
    const ticks = ctrl.tickCount - lastTick;
    const rs = ctrl.renderScale ?? 1;
    fpsValueEl.textContent = `${Math.round(ticks * 1000 / (now - lastMs))} fps${rs < 0.995 ? ` · ${Math.round(rs * 100)}% res` : ''}`;
    lastTick = ctrl.tickCount;
    lastMs   = now;
  }, 500);

  function applyMaxFps(): void {
    if (fpsUnlimited.checked) {
      ctrl.maxFps = Infinity;
      fpsSliderRow.style.opacity = '0.35';
      fpsSliderRow.style.pointerEvents = 'none';
    } else {
      ctrl.maxFps = parseInt(fpsSlider.value, 10);
      fpsSliderRow.style.opacity = '';
      fpsSliderRow.style.pointerEvents = '';
    }
  }

  fpsUnlimited.addEventListener('change', applyMaxFps);
  fpsSlider.addEventListener('input', () => {
    fpsSliderLabel.textContent = fpsSlider.value;
    applyMaxFps();
  });
  applyMaxFps();

  return {
    dispose() { clearInterval(intervalId); },
  };
}
