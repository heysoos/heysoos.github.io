// Umami custom events. The script in BaseLayout only loads on the production
// hostname, so on localhost `window.umami` is undefined and track() is a no-op.
// Event names are short verbs; properties are small strings/numbers.
type Props = Record<string, string | number | boolean>;
interface Umami { track(name: string, data?: Props): void }

export function track(name: string, data?: Props): void {
  try { (window as unknown as { umami?: Umami }).umami?.track(name, data); } catch { /* blocked */ }
}

/**
 * Per-sim engagement: `sim-open` on load (with WebGPU availability), and on
 * leaving the page `sim-leave` with the seconds spent and how many times the
 * visitor interacted (presets, dice, edits) so a 2 s bounce reads differently
 * from a 10 min session.
 */
export function trackSimSession(sim: string, webgpu: boolean): { interact(kind: string): void } {
  const t0 = performance.now();
  let interactions = 0;
  track('sim-open', { sim, webgpu });
  const leave = () => {
    const seconds = Math.round((performance.now() - t0) / 1000);
    track('sim-leave', { sim, seconds, interactions, bucket: seconds < 10 ? '<10s' : seconds < 60 ? '<1m' : seconds < 300 ? '<5m' : '5m+' });
  };
  window.addEventListener('pagehide', leave, { once: true });
  return { interact: (kind) => { interactions++; track(kind, { sim }); } };
}
