// src/components/simulations/cppn/cppn-spec.ts
// A flat, numeric view of the CPPN config for the shared preset manager and
// the phone scrub list. The nested config (layers, distribution object,
// motion ladder) is what the controller runs on; `toFlat` / `configFromFlat`
// convert. Architecture is flat too: `layers` is the count and
// `layerNWidth` / `layerNAct` describe each layer (rows past the count are
// hidden by showIf).

import type { NumSpec, EnumSpec, ParamGroup } from '../../../lib/sim-page/param-spec';
import { normalizeConfig, type Activation, type CPPNConfig, type CPPNPreset, type DistributionType, type LayerConfig, type WeightDistribution } from './cppn-types';
import type { PresetBody } from '../../../lib/presets/preset-schema';

export const DIST_TYPES: readonly DistributionType[] = ['normal', 'uniform', 'glorot', 'sparse'];
export const DIST_NAMES = ['Normal', 'Uniform', 'Glorot', 'Sparse'] as const;
export const ACTIVATIONS: readonly Activation[] = ['tanh', 'sin', 'cos', 'abs', 'sigmoid'];
export const ACT_NAMES = ['tanh', 'sin', 'cos', 'abs', 'sigmoid'] as const;
export const MAX_LAYERS = 8;
export const MIN_WIDTH = 2;
export const MAX_WIDTH = 256;
export const Z_INPUTS = 3 + 16;   // x, y, r + z

export interface CPPNFlatParams extends Record<string, unknown> {
  // Network
  layers: number;                 // 1..MAX_LAYERS
  layer0Width: number; layer0Act: number;
  layer1Width: number; layer1Act: number;
  layer2Width: number; layer2Act: number;
  layer3Width: number; layer3Act: number;
  layer4Width: number; layer4Act: number;
  layer5Width: number; layer5Act: number;
  layer6Width: number; layer6Act: number;
  layer7Width: number; layer7Act: number;
  // Weights
  distType: number;       // index into DIST_TYPES
  sigma: number;          // normal
  a: number;              // uniform
  glorotScale: number;    // glorot
  sparsity: number;       // sparse
  magnitude: number;      // sparse
  seed: number;
  // Motion ladder
  animate: number;        // 0 | 1
  speed: number;
  spread: number;
  depth: number;
  falloff: number;
  bands: number;          // 1..4
  // Space
  scale: number;
}

export type FlatKey = keyof CPPNFlatParams & string;

export const ARCH_KEYS: FlatKey[] = ['layers', ...Array.from({ length: MAX_LAYERS }, (_, i) => [`layer${i}Width`, `layer${i}Act`] as FlatKey[]).flat()];
export const WEIGHT_KEYS: FlatKey[] = ['distType', 'sigma', 'a', 'glorotScale', 'sparsity', 'magnitude', 'seed'];
export const isArchKey = (k: string): boolean => (ARCH_KEYS as string[]).includes(k);
export const isWeightKey = (k: string): boolean => (WEIGHT_KEYS as string[]).includes(k);

/** Body stored in presets / undo snapshots: flat params plus the exact
 *  weights, so a saved image is reproduced exactly even if the generator changes. */
export type CPPNBody = PresetBody<CPPNFlatParams> & { weights?: number[] };

export const DEFAULT_FLAT: CPPNFlatParams = {
  layers: 3,
  layer0Width: 32, layer0Act: 0, layer1Width: 32, layer1Act: 1, layer2Width: 32, layer2Act: 0,
  layer3Width: 16, layer3Act: 0, layer4Width: 16, layer4Act: 0, layer5Width: 16, layer5Act: 0,
  layer6Width: 16, layer6Act: 0, layer7Width: 16, layer7Act: 0,
  distType: 0, sigma: 1, a: 1, glorotScale: 1, sparsity: 0.8, magnitude: 2, seed: 1,
  animate: 1, speed: 0.05, spread: 1.3, depth: 0.2, falloff: 0.8, bands: 4,
  scale: 1,
};

/** Weight count of an architecture: the per-pixel cost. Mirrors computeWeightLayout. */
export function paramCount(layers: LayerConfig[]): number {
  if (layers.length === 0) return 0;
  let n = Z_INPUTS * layers[0].width;
  for (let i = 0; i < layers.length - 1; i++) n += layers[i].width * layers[i + 1].width + layers[i + 1].width;
  return n + 3 * layers[layers.length - 1].width;
}

export function toFlat(config: CPPNConfig, seed: number, animate: boolean): CPPNFlatParams {
  const d = config.distribution;
  const m = config.motion;
  const out: CPPNFlatParams = {
    ...DEFAULT_FLAT,
    layers: Math.min(MAX_LAYERS, config.layers.length),
    distType: Math.max(0, DIST_TYPES.indexOf(d.type)),
    sigma: d.sigma ?? DEFAULT_FLAT.sigma,
    a: d.a ?? DEFAULT_FLAT.a,
    glorotScale: d.scale ?? DEFAULT_FLAT.glorotScale,
    sparsity: d.sparsity ?? DEFAULT_FLAT.sparsity,
    magnitude: d.magnitude ?? DEFAULT_FLAT.magnitude,
    seed,
    animate: animate ? 1 : 0,
    speed: m.speed, spread: m.spread, depth: m.depth, falloff: m.falloff, bands: m.bands,
    scale: config.scale,
  };
  config.layers.slice(0, MAX_LAYERS).forEach((l, i) => {
    out[`layer${i}Width`] = l.width;
    out[`layer${i}Act`] = Math.max(0, ACTIVATIONS.indexOf(l.activation));
  });
  return out;
}

export function layersFromFlat(f: CPPNFlatParams): LayerConfig[] {
  const n = Math.min(MAX_LAYERS, Math.max(1, Math.round(f.layers)));
  return Array.from({ length: n }, (_, i) => ({
    width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(f[`layer${i}Width`] as number))),
    activation: ACTIVATIONS[Math.round(f[`layer${i}Act`] as number)] ?? 'tanh',
  }));
}

export function distributionFromFlat(f: CPPNFlatParams): WeightDistribution {
  const type = DIST_TYPES[Math.round(f.distType)] ?? 'normal';
  switch (type) {
    case 'normal':  return { type, sigma: f.sigma };
    case 'uniform': return { type, a: f.a };
    case 'glorot':  return { type, scale: f.glorotScale };
    case 'sparse':  return { type, sparsity: f.sparsity, magnitude: f.magnitude };
  }
}

/** Build a config from the flat view (zDim comes from `base`). */
export function configFromFlat(base: CPPNConfig, f: CPPNFlatParams): CPPNConfig {
  return {
    zDim: base.zDim,
    layers: layersFromFlat(f),
    distribution: distributionFromFlat(f),
    scale: f.scale,
    motion: {
      speed: f.speed, spread: f.spread, depth: f.depth, falloff: f.falloff,
      bands: Math.min(4, Math.max(1, Math.round(f.bands))),
    },
  };
}

/** Convert a built-in CPPNPreset (nested, possibly legacy config) into the shared body shape. */
export function presetToBody(p: CPPNPreset): CPPNBody & { id: string; name: string; isDefault?: boolean } {
  const config = normalizeConfig(p.config);
  return {
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    params: toFlat(config, p.seed, true),
    weights: p.weights,
  };
}

// ── Groups for the phone list ─────────────────────────────────────

const num = (key: FlatKey, label: string, min: number, max: number, step: number, extra: Partial<NumSpec<FlatKey>> = {}): NumSpec<FlatKey> =>
  ({ kind: 'num', key, label, min, max, step, ...extra });
const en = (key: FlatKey, label: string, names: readonly string[], ui: EnumSpec['ui'], extra: Partial<EnumSpec<FlatKey>> = {}): EnumSpec<FlatKey> =>
  ({ kind: 'enum', key, label, names, ui, ...extra });

const isDist = (i: number) => (p: CPPNFlatParams) => Math.round(p.distType) === i;
/** Width spec for layer i: the layer stack's rows scrub these. */
export const layerWidthSpec = (i: number): NumSpec<FlatKey> =>
  num(`layer${i}Width` as FlatKey, `Layer ${i + 1} width`, MIN_WIDTH, MAX_WIDTH, 1, { scale: 'log', int: true });

export const CPPN_GROUPS: ParamGroup<FlatKey>[] = [
  // The Network group is a custom block (cppn-network-rows.ts): one row per
  // layer. The sim setup attaches it so it can carry the budget note.
  { name: 'Network', items: [] },
  { name: 'Weights', items: [
    en('distType', 'Distribution', DIST_NAMES, 'cycle', { rebuilds: true }),
    num('sigma', 'σ (std dev)', 0.1, 5, 0.05, { showIf: isDist(0) }),
    num('a', 'Range ±a', 0.1, 5, 0.05, { showIf: isDist(1) }),
    num('glorotScale', 'Glorot scale', 0.1, 5, 0.05, { showIf: isDist(2) }),
    num('sparsity', 'Sparsity', 0, 0.99, 0.01, { showIf: isDist(3) }),
    num('magnitude', 'Magnitude', 0.1, 10, 0.1, { showIf: isDist(3) }),
    num('seed', 'Seed', 0, 4_294_967_295, 1, { int: true, stepDrag: 24 }),
  ] },
  { name: 'Motion', items: [
    en('animate', 'Animate', ['Off', 'On'], 'segmented'),
    num('speed', 'Speed', 0.005, 0.3, 0.005, { scale: 'log' }),
    num('spread', 'Spread', 1, 2.5, 0.05),
    num('depth', 'Depth', 0.02, 0.6, 0.01, { scale: 'log' }),
    num('falloff', 'Falloff', 0.3, 1, 0.05),
    num('bands', 'Bands', 1, 4, 1, { int: true }),
  ] },
  { name: 'View', items: [
    num('scale', 'Coordinate scale', 0.1, 5, 0.05),
  ] },
];
