// src/components/simulations/cppn/cppn-types.ts

export type Activation = 'tanh' | 'sin' | 'cos' | 'abs' | 'sigmoid';
export type DistributionType = 'normal' | 'uniform' | 'glorot' | 'sparse';

export interface LayerConfig {
  width: number;
  activation: Activation;
}

export interface WeightDistribution {
  type: DistributionType;
  sigma?: number;     // normal: std dev (default 1.0)
  a?: number;         // uniform: range [-a, a] (default 1.0)
  scale?: number;     // glorot: multiplier (default 1.0)
  sparsity?: number;  // sparse: zero fraction (default 0.8)
  magnitude?: number; // sparse: non-zero scale (default 2.0)
}

/**
 * Latent motion as a geometric ladder of oscillation bands, like octaves in
 * fractal noise. Band b (0-based) has frequency speed·spread^b and amplitude
 * depth·falloff^b; the 16 z dims are split evenly across `bands` bands and
 * each dim gets a random phase offset so a band's dims don't move in lockstep.
 */
export interface MotionLadder {
  speed: number;    // band 0 frequency, cycles/second
  spread: number;   // frequency ratio between consecutive bands (≥1)
  depth: number;    // band 0 amplitude
  falloff: number;  // amplitude ratio between consecutive bands (0..1]
  bands: number;    // 1..4
}

export const DEFAULT_MOTION: MotionLadder = { speed: 0.2, spread: 2.0, depth: 1.0, falloff: 0.7, bands: 4 };

export interface CPPNConfig {
  zDim: number;            // always 16 — not user-configurable in this iteration
  layers: LayerConfig[];   // hidden layers only; input/output are fixed
  distribution: WeightDistribution;
  scale: number;           // coordinate space scale
  motion: MotionLadder;
}

/** Pre-ladder presets stored explicit bands; `normalizeConfig` fits a ladder. */
export interface ZBand {
  freq: number;
  amplitude: number;
  phase: number;
}
export interface LegacyCPPNConfig {
  zDim: number;
  layers: LayerConfig[];
  distribution: WeightDistribution;
  scale: number;
  numBands?: number;
  zBands?: ZBand[];
  motion?: MotionLadder;
}

/** Accept either shape; a legacy band list is fitted to the ladder by its
 *  first band and the mean consecutive ratios. */
export function normalizeConfig(raw: CPPNConfig | LegacyCPPNConfig): CPPNConfig {
  const c = raw as LegacyCPPNConfig;
  let motion: MotionLadder;
  if (c.motion) {
    motion = { ...DEFAULT_MOTION, ...c.motion };
  } else if (c.zBands && c.zBands.length > 0) {
    const bands = c.zBands.slice(0, Math.min(4, c.numBands ?? c.zBands.length));
    // Least-squares fit of log(value) = log(base) + b·log(ratio) over band
    // index b, with the ratio clamped to the ladder's range. When the clamp
    // binds (e.g. amplitudes that rise across bands) the base falls back to
    // the geometric mean, so the overall motion level is preserved.
    const fit = (vals: number[], lo: number, hi: number): [number, number] => {
      const n = vals.length;
      const ys = vals.map(v => Math.log(Math.max(v, 1e-4)));
      if (n === 1) return [vals[0], 1];
      const xm = (n - 1) / 2, ym = ys.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0;
      for (let i = 0; i < n; i++) { sxy += (i - xm) * (ys[i] - ym); sxx += (i - xm) ** 2; }
      const slope = Math.min(Math.log(hi), Math.max(Math.log(lo), sxy / sxx));
      return [Math.exp(ym - slope * xm), Math.exp(slope)];
    };
    const [speed, spread] = fit(bands.map(b => b.freq), 1, 4);
    const [depth, falloff] = fit(bands.map(b => b.amplitude), 0.1, 1);
    motion = { speed, spread, depth, falloff, bands: bands.length };
  } else {
    motion = { ...DEFAULT_MOTION };
  }
  return {
    zDim: c.zDim ?? 16,
    layers: c.layers.map(l => ({ ...l })),
    distribution: { ...c.distribution },
    scale: c.scale,
    motion,
  };
}

export interface CPPNPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  config: CPPNConfig | LegacyCPPNConfig;
  weights: number[];  // serialized Float32Array — exact reproduction
  seed: number;       // seed that generated these weights
}
