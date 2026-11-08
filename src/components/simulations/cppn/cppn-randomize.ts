// src/components/simulations/cppn/cppn-randomize.ts
// Randomize explores architectures, not just weights: a random number of
// layers with log-uniform widths, scaled down until the weight count fits a
// budget, random activations, a random weight distribution, a new seed and
// a rolled motion ladder. Locked keys keep their current value; locking any
// network row keeps the whole architecture (widths can't be rescaled around
// a pinned layer sensibly).

import {
  ACTIVATIONS, DIST_TYPES, MAX_LAYERS, MAX_WIDTH, MIN_WIDTH, isArchKey, layersFromFlat, paramCount,
  type CPPNFlatParams, type FlatKey,
} from './cppn-spec';
import type { LayerConfig } from './cppn-types';

/** Weight budgets: Soft Colors is ~4k and runs 60 fps on an Intel iGPU at the
 *  320 cap; Roses is ~8k and fine on a discrete GPU. */
export const BUDGET_DESKTOP = 8000;
export const BUDGET_PHONE = 4000;

const rnd = Math.random;
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

export function randomArchitecture(budget: number): LayerConfig[] {
  const n = rollLayerCount();
  // tanh and sin dominate; abs and sigmoid everywhere look muddy.
  const acts = ACTIVATIONS;
  const actWeights = [4, 4, 1.5, 1, 1];
  let layers: LayerConfig[] = Array.from({ length: n }, () => ({
    width: Math.round(logUniform(MIN_WIDTH, MAX_WIDTH)),
    activation: pick(acts, actWeights),
  }));
  // Fit the budget by scaling all widths together (the first layer is the
  // cheapest per neuron to scale since its fan-in is fixed at 19).
  let guard = 0;
  while (paramCount(layers) > budget && guard++ < 40) {
    const over = paramCount(layers) / budget;
    const k = 1 / Math.sqrt(over) * 0.97;        // weights are ~quadratic in width
    layers = layers.map(l => ({ ...l, width: Math.max(MIN_WIDTH, Math.floor(l.width * k)) }));
    if (layers.every(l => l.width === MIN_WIDTH)) break;
  }
  return layers;
}

export function randomizeFlat(current: CPPNFlatParams, lockedKeys: string[], budget: number): CPPNFlatParams {
  const locked = new Set(lockedKeys);
  const f: CPPNFlatParams = { ...current };
  const set = (k: FlatKey, v: number) => { if (!locked.has(k)) f[k] = v; };

  // Network: all-or-nothing around locks.
  if (!lockedKeys.some(isArchKey)) {
    const layers = randomArchitecture(budget);
    f.layers = layers.length;
    layers.forEach((l, i) => {
      f[`layer${i}Width`] = l.width;
      f[`layer${i}Act`] = Math.max(0, ACTIVATIONS.indexOf(l.activation));
    });
  }

  // Weights: a distribution with its parameter in a sensible band, new seed.
  set('distType', Math.floor(rnd() * DIST_TYPES.length));
  set('sigma', +logUniform(0.5, 2.5).toFixed(2));
  set('a', +logUniform(0.5, 3).toFixed(2));
  set('glorotScale', +logUniform(0.5, 4).toFixed(2));
  set('sparsity', +(0.5 + rnd() * 0.4).toFixed(2));
  set('magnitude', +logUniform(1, 5).toFixed(1));
  set('seed', Math.floor(rnd() * 4_294_967_296));

  // Motion ladder.
  set('speed', +logUniform(0.03, 0.6).toFixed(2));
  set('spread', +(1.2 + rnd() * 2.3).toFixed(2));
  set('depth', +(0.4 + rnd() * 1.2).toFixed(2));
  set('falloff', +(0.4 + rnd() * 0.6).toFixed(2));
  set('bands', 1 + Math.floor(rnd() * 4));

  return f;
}

/** For a budget readout: the count the current flat architecture implies. */
export function flatParamCount(f: CPPNFlatParams): number {
  return paramCount(layersFromFlat(f));
}
