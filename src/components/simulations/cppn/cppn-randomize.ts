// src/components/simulations/cppn/cppn-randomize.ts
// Randomize explores architectures, not just weights: a random number of
// layers with log-uniform widths, scaled down until the weight count fits a
// budget, random activations, a random weight distribution, a new seed and
// a rolled motion ladder. Locked keys keep their current value; locking any
// network row keeps the whole architecture (widths can't be rescaled around
// a pinned layer sensibly).

import {
  ACTIVATIONS, DIST_TYPES, MAX_LAYERS, MAX_WIDTH, MIN_WIDTH, layersFromFlat, paramCount,
  type CPPNFlatParams, type FlatKey,
} from './cppn-spec';
import type { LayerConfig } from './cppn-types';

/** Weight budgets: Soft Colors is ~4k and runs 60 fps on an Intel iGPU at the
 *  320 cap; Roses is ~8k and fine on a discrete GPU. */
export const BUDGET_DESKTOP = 8000;
export const BUDGET_PHONE = 4000;

const rnd = Math.random;
const gauss = () => { const u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const logUniform = (lo: number, hi: number) => Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo)));
const pick = <T,>(xs: readonly T[], weights?: number[]): T => {
  if (!weights) return xs[Math.floor(rnd() * xs.length)];
  let r = rnd() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < xs.length; i++) { r -= weights[i]; if (r <= 0) return xs[i]; }
  return xs[xs.length - 1];
};

/** Layer count 1..MAX_LAYERS, biased toward 2–4. */
function rollLayerCount(): number {
  const weights = [1, 3, 4, 3, 1.5, 0.8, 0.4, 0.2].slice(0, MAX_LAYERS);
  return pick(Array.from({ length: weights.length }, (_, i) => i + 1), weights);
}

// tanh and sin dominate; abs and sigmoid everywhere look muddy.
const ACT_WEIGHTS = [4, 4, 1.5, 1, 1];
const randomLayer = (): LayerConfig => ({
  width: Math.round(logUniform(MIN_WIDTH, MAX_WIDTH)),
  activation: pick(ACTIVATIONS, ACT_WEIGHTS),
});

/**
 * A random architecture that keeps each layer in `fixed` exactly (width,
 * activation *and* position), fills the other slots with random layers and
 * scales only the free layers' widths until the weight count fits. The
 * stack is at least deep enough to hold the deepest fixed layer. `count`,
 * when given, pins the layer count (the Layers row is locked).
 */
export function randomArchitecture(budget: number, fixed: Map<number, LayerConfig> = new Map(), count?: number): LayerConfig[] {
  const deepest = Math.max(-1, ...fixed.keys()) + 1;
  const n = Math.min(MAX_LAYERS, Math.max(deepest, count ?? rollLayerCount()));
  const slots: Array<LayerConfig | null> = Array.from({ length: n }, () => null);
  const free: number[] = [];
  for (const [i, l] of fixed) if (i < n) slots[i] = { ...l };
  for (let i = 0; i < n; i++) if (!slots[i]) { slots[i] = randomLayer(); free.push(i); }
  let layers = slots as LayerConfig[];
  // Fit the budget by scaling the free widths together (weights are
  // ~quadratic in width, so sqrt of the overshoot per step).
  let guard = 0;
  while (free.length > 0 && paramCount(layers) > budget && guard++ < 40) {
    const k = 0.97 / Math.sqrt(paramCount(layers) / budget);
    layers = layers.map((l, i) => free.includes(i) ? { ...l, width: Math.max(MIN_WIDTH, Math.floor(l.width * k)) } : l);
    if (free.every(i => layers[i].width === MIN_WIDTH)) break;
  }
  return layers;
}

export function randomizeFlat(current: CPPNFlatParams, lockedKeys: string[], budget: number): CPPNFlatParams {
  const locked = new Set(lockedKeys);
  const f: CPPNFlatParams = { ...current };
  const set = (k: FlatKey, v: number) => { if (!locked.has(k)) f[k] = v; };

  // Network: a locked layer (its width or activation row) stays exactly
  // where it is; the stack around it is rolled, at least deep enough to
  // reach it.
  const cur = layersFromFlat(current);
  const fixed = new Map<number, LayerConfig>();
  cur.forEach((l, i) => { if (locked.has(`layer${i}Width`) || locked.has(`layer${i}Act`)) fixed.set(i, l); });
  const layers = randomArchitecture(budget, fixed, locked.has('layers') ? cur.length : undefined);
  f.layers = layers.length;
  layers.forEach((l, i) => {
    f[`layer${i}Width`] = l.width;
    f[`layer${i}Act`] = Math.max(0, ACTIVATIONS.indexOf(l.activation));
  });

  // Weights. What makes an image read is the *gain* into each activation,
  // std(w)·√fanIn, not the raw std: the presets use σ 0.9 into fan-in 128
  // (gain ≈ 10, hard tanh edges) and ≈ 3–4 into their narrow layers. A
  // narrow random net at σ 1 has gain ≈ 2 and comes out grey. So draw a
  // gain, log-normal around 4, and derive each distribution's parameter
  // from the network's typical fan-in.
  const fanIns = [19, ...layers.slice(0, -1).map(l => l.width)];   // `layers` = the architecture just rolled above
  const fanIn = Math.exp(fanIns.reduce((s, x) => s + Math.log(x), 0) / fanIns.length);   // geometric mean
  const gain = Math.exp(Math.log(4) + gauss() * 0.45);                                   // ~[2.2, 7.3] at ±1σ
  const std = gain / Math.sqrt(fanIn);
  set('distType', Math.floor(rnd() * DIST_TYPES.length));
  set('sigma', +std.toFixed(2));                                   // normal: std directly
  set('a', +(std * Math.sqrt(3)).toFixed(2));                      // uniform[-a,a]: std = a/√3
  set('glorotScale', +(gain / Math.sqrt(2)).toFixed(2));           // glorot: std ≈ scale·√2/√fanIn
  const sparsity = +(0.5 + rnd() * 0.4).toFixed(2);
  set('sparsity', sparsity);
  set('magnitude', +Math.min(10, std / Math.sqrt(1 - sparsity)).toFixed(2));   // ±m with prob (1-s): std = m·√(1-s)
  set('seed', Math.floor(rnd() * 4_294_967_296));

  // Motion ladder.
  // Around the presets (0.05 Hz, depth 0.13–0.24): slow drift to a gentle
  // breath, never flicker.
  set('speed', +logUniform(0.02, 0.12).toFixed(3));
  set('spread', +(1 + rnd() * 1).toFixed(2));
  set('depth', +logUniform(0.08, 0.35).toFixed(2));
  set('falloff', +(0.5 + rnd() * 0.5).toFixed(2));
  set('bands', 1 + Math.floor(rnd() * 4));

  return f;
}

/** For a budget readout: the count the current flat architecture implies. */
export function flatParamCount(f: CPPNFlatParams): number {
  return paramCount(layersFromFlat(f));
}
