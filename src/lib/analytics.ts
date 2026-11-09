// Umami custom events. The script in <Analytics /> only counts the production
// hostname, so on localhost `window.umami` is undefined and track() is a no-op.
//
// Every event carries `layout` (phone / desktop: the two UIs are different
// products) and, on a sim page, `sim`. Events are discrete gestures, never
// per-frame or per-pointermove.
type Props = Record<string, string | number | boolean>;
interface Umami { track(name: string, data?: Props): void }

let currentSim: string | null = null;
/** WebGPU adapter summary (vendor / architecture), filled by initWebGPU. */
export let gpuInfo: string | null = null;
export function setGpuInfo(info: { vendor?: string; architecture?: string; description?: string } | null): void {
  if (!info) { gpuInfo = null; return; }
  gpuInfo = [info.vendor, info.architecture].filter(Boolean).join('/') || info.description || null;
}

const layout = (): 'phone' | 'desktop' => (typeof matchMedia === 'function' && matchMedia('(max-width: 768px)').matches ? 'phone' : 'desktop');

export function track(name: string, data?: Props): void {
  try {
    const u = (window as unknown as { umami?: Umami }).umami;
    if (!u) return;
    const props: Props = { layout: layout(), ...(currentSim ? { sim: currentSim } : {}), ...data };
    u.track(name, props);
  } catch { /* blocked */ }
}

/** Shader / pipeline failures: `sim`, the first error line. The bug signal. */
export function trackShaderError(message: string): void {
  track('shader-error', { message: message.split('\n')[0].slice(0, 200) });
}

/** Clarity custom tags: filter recordings by sim / layout / webgpu in the Clarity dashboard. */
function clarityTag(key: string, value: string): void {
  try { (window as unknown as { clarity?: (cmd: string, ...a: string[]) => void }).clarity?.('set', key, value); } catch { /* blocked */ }
}

/**
 * Per-sim engagement. `sim-open` on load (WebGPU availability, GPU vendor),
 * `sim-leave` on leaving with seconds, median fps, the render size and how
 * many times the visitor interacted (presets, dice, edits), so a 2 s bounce
 * reads differently from a 10 min session and a slow device shows as a cluster.
 * Also tags the Clarity recording with sim / layout / webgpu.
 */
export function trackSimSession(sim: string, webgpu: boolean, perf?: { tickCount(): number; canvas: HTMLCanvasElement }): { interact(kind: string): void } {
  currentSim = sim;
  clarityTag('sim', sim); clarityTag('layout', layout()); clarityTag('webgpu', String(webgpu));
  const t0 = performance.now();
  let interactions = 0;
  track('sim-open', { webgpu, ...(gpuInfo ? { gpu: gpuInfo } : {}) });

  // fps: sample the controller's frame counter every 2 s, report the median
  const samples: number[] = [];
  let lastTicks = perf?.tickCount() ?? 0, lastT = t0;
  const timer = perf ? window.setInterval(() => {
    if (document.hidden) return;
    const now = performance.now(), ticks = perf.tickCount();
    const fps = ((ticks - lastTicks) * 1000) / (now - lastT);
    lastTicks = ticks; lastT = now;
    if (Number.isFinite(fps) && fps > 0) samples.push(fps);
  }, 2000) : 0;

  const leave = () => {
    clearInterval(timer);
    const seconds = Math.round((performance.now() - t0) / 1000);
    const sorted = samples.sort((a, b) => a - b);
    const fps = sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : undefined;
    track('sim-leave', {
      seconds, interactions,
      bucket: seconds < 10 ? '<10s' : seconds < 60 ? '<1m' : seconds < 300 ? '<5m' : '5m+',
      ...(fps !== undefined ? { fps } : {}),
      ...(perf ? { resolution: Math.max(perf.canvas.width, perf.canvas.height) } : {}),
    });
  };
  window.addEventListener('pagehide', leave, { once: true });
  return { interact: (kind) => { interactions++; track(kind); } };
}
