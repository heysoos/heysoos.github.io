// Benchmark harness for the boids simulation.
//
// Trigger via URL: ?bench=8000&frames=600&warmup=60
// Records per-frame timestamps via controller.onFrameComplete, then logs
// avg/p50/p95/p99 frame time + derived FPS to the console.
//
// Also exposes window.runBench(opts) for ad-hoc use.

export interface BenchOpts {
  particles: number;
  frames:    number;
  warmup:    number;
  label?:    string;
}

interface BenchTarget {
  params:    { numParticles: number };
  maxFps:    number;
  tickCount: number;
  onFrameComplete: ((timestampMs: number) => void) | null;
  reset(): void;
}

export function parseBenchOpts(): BenchOpts | null {
  const p = new URLSearchParams(window.location.search);
  const raw = p.get('bench');
  if (raw == null) return null;
  const particles = parseInt(raw, 10);
  if (!Number.isFinite(particles) || particles <= 0) return null;
  return {
    particles,
    frames: clampInt(p.get('frames'), 600, 10, 100000),
    warmup: clampInt(p.get('warmup'),  60,  0, 10000),
    label:  p.get('label') ?? undefined,
  };
}

function clampInt(v: string | null, dflt: number, lo: number, hi: number): number {
  const n = parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

export function runBench(controller: BenchTarget, opts: BenchOpts): Promise<BenchResult> {
  return new Promise((resolve) => {
    controller.params.numParticles = opts.particles;
    // The controller's tick uses requestAnimationFrame when maxFps is Infinity
    // (vsync-locked, ~60Hz on most displays) and setTimeout(0) when finite.
    // We need the unthrottled setTimeout path, so set a very high finite cap —
    // the per-frame check `now - lastFrameTime < 1000/maxFps - 1` is always
    // false at this rate, so it never actually throttles.
    controller.maxFps = 99999;
    controller.reset();

    const total = opts.warmup + opts.frames;
    const stamps: number[] = [];
    let count = 0;

    const prev = controller.onFrameComplete;
    controller.onFrameComplete = (ts: number) => {
      stamps.push(ts);
      count++;
      if (count >= total) {
        controller.onFrameComplete = prev;
        const result = computeStats(stamps, opts);
        logResult(result);
        resolve(result);
      }
    };

    // eslint-disable-next-line no-console
    console.log(`[bench] start — particles=${opts.particles} warmup=${opts.warmup} frames=${opts.frames}${opts.label ? ` label=${opts.label}` : ''}`);
  });
}

export interface BenchResult {
  label?:    string;
  particles: number;
  frames:    number;
  avgMs:     number;
  fps:       number;
  p50Ms:     number;
  p95Ms:     number;
  p99Ms:     number;
  minMs:     number;
  maxMs:     number;
}

function computeStats(stamps: number[], opts: BenchOpts): BenchResult {
  // Skip warmup; compute deltas between consecutive stamps in the measured window.
  const sliced = stamps.slice(opts.warmup);
  const deltas: number[] = [];
  for (let i = 1; i < sliced.length; i++) {
    deltas.push(sliced[i] - sliced[i - 1]);
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  const sum = deltas.reduce((a, b) => a + b, 0);
  const avg = sum / deltas.length;
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return {
    label:     opts.label,
    particles: opts.particles,
    frames:    deltas.length,
    avgMs:     avg,
    fps:       1000 / avg,
    p50Ms:     pick(0.50),
    p95Ms:     pick(0.95),
    p99Ms:     pick(0.99),
    minMs:     sorted[0],
    maxMs:     sorted[sorted.length - 1],
  };
}

function logResult(r: BenchResult): void {
  const tag = r.label ? `[${r.label}] ` : '';
  // eslint-disable-next-line no-console
  console.log(
    `[bench] ${tag}done — particles=${r.particles} | avg=${r.avgMs.toFixed(2)}ms (${r.fps.toFixed(1)} fps) | p50=${r.p50Ms.toFixed(2)} p95=${r.p95Ms.toFixed(2)} p99=${r.p99Ms.toFixed(2)} | min=${r.minMs.toFixed(2)} max=${r.maxMs.toFixed(2)} | n=${r.frames}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[bench-csv] label,particles,avg_ms,fps,p50,p95,p99,min,max,n\n[bench-csv] ${r.label ?? ''},${r.particles},${r.avgMs.toFixed(3)},${r.fps.toFixed(2)},${r.p50Ms.toFixed(3)},${r.p95Ms.toFixed(3)},${r.p99Ms.toFixed(3)},${r.minMs.toFixed(3)},${r.maxMs.toFixed(3)},${r.frames}`,
  );
}

export function attachBench(controller: BenchTarget): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).runBench = (opts: BenchOpts) => runBench(controller, opts);
  const auto = parseBenchOpts();
  if (auto) {
    // Defer one frame so the canvas/panel has a chance to lay out
    requestAnimationFrame(() => { void runBench(controller, auto); });
  }
}
