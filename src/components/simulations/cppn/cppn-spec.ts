// src/components/simulations/cppn/cppn-spec.ts
// A flat, numeric view of the CPPN config for the shared preset manager and
// the phone scrub list. The nested config (distribution object, z-band
// array) is what the controller runs on; `toFlat` / `applyFlat` convert.
// Architecture (layer widths/activations) is not flat-scrubbable — it lives
// in the preset body as `layers` and is edited on the desktop Arch tab.

import type { NumSpec, EnumSpec, ParamGroup } from '../../../lib/sim-page/param-spec';
import type { CPPNConfig, CPPNPreset, DistributionType, LayerConfig, WeightDistribution } from './cppn-types';
import type { PresetBody } from '../../../lib/presets/preset-schema';

export const DIST_TYPES: readonly DistributionType[] = ['normal', 'uniform', 'glorot', 'sparse'];
export const DIST_NAMES = ['Normal', 'Uniform', 'Glorot', 'Sparse'] as const;
export const MAX_BANDS = 4;

export interface CPPNFlatParams extends Record<string, unknown> {
  scale: number;
  distType: number;       // index into DIST_TYPES
  sigma: number;          // normal
  a: number;              // uniform
  glorotScale: number;    // glorot
  sparsity: number;       // sparse
  magnitude: number;      // sparse
  seed: number;
  animate: number;        // 0 | 1
  numBands: number;       // 2..4
  band0Freq: number; band0Amp: number; band0Phase: number;
  band1Freq: number; band1Amp: number; band1Phase: number;
  band2Freq: number; band2Amp: number; band2Phase: number;
  band3Freq: number; band3Amp: number; band3Phase: number;
}

export type FlatKey = keyof CPPNFlatParams & string;

/** Body stored in presets / undo snapshots: flat params plus architecture
 *  and the exact weights (so a saved image is reproduced exactly even if the
 *  generator changes). */
export type CPPNBody = PresetBody<CPPNFlatParams> & {
  layers: LayerConfig[];
  weights?: number[];
};

export const DEFAULT_FLAT: CPPNFlatParams = {
  scale: 1, distType: 0, sigma: 1, a: 1, glorotScale: 1, sparsity: 0.8, magnitude: 2,
  seed: 1, animate: 1, numBands: 4,
  band0Freq: 0.2, band0Amp: 1.0, band0Phase: 0.0,
  band1Freq: 0.5, band1Amp: 0.8, band1Phase: 1.0,
  band2Freq: 0.9, band2Amp: 0.6, band2Phase: 2.1,
  band3Freq: 1.5, band3Amp: 0.4, band3Phase: 3.7,
};

export function toFlat(config: CPPNConfig, seed: number, animate: boolean): CPPNFlatParams {
  const d = config.distribution;
  const out: CPPNFlatParams = {
    ...DEFAULT_FLAT,
    scale: config.scale,
    distType: Math.max(0, DIST_TYPES.indexOf(d.type)),
    sigma: d.sigma ?? DEFAULT_FLAT.sigma,
    a: d.a ?? DEFAULT_FLAT.a,
    glorotScale: d.scale ?? DEFAULT_FLAT.glorotScale,
    sparsity: d.sparsity ?? DEFAULT_FLAT.sparsity,
    magnitude: d.magnitude ?? DEFAULT_FLAT.magnitude,
    seed,
    animate: animate ? 1 : 0,
    numBands: config.numBands,
  };
  config.zBands.forEach((b, i) => {
    if (i >= MAX_BANDS) return;
    out[`band${i}Freq`] = b.freq;
    out[`band${i}Amp`] = b.amplitude;
    out[`band${i}Phase`] = b.phase;
  });
  return out;
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

/** Merge a flat view back into a config (keeps layers and zDim). */
export function configFromFlat(base: CPPNConfig, f: CPPNFlatParams, layers?: LayerConfig[]): CPPNConfig {
  const numBands = Math.min(MAX_BANDS, Math.max(2, Math.round(f.numBands)));
  const zBands = Array.from({ length: numBands }, (_, i) => ({
    freq: f[`band${i}Freq`] as number,
    amplitude: f[`band${i}Amp`] as number,
    phase: f[`band${i}Phase`] as number,
  }));
  return {
    ...base,
    layers: layers ?? base.layers,
    scale: f.scale,
    distribution: distributionFromFlat(f),
    numBands,
    zBands,
  };
}

/** Convert a built-in CPPNPreset (nested config) into the shared body shape. */
export function presetToBody(p: CPPNPreset): CPPNBody & { id: string; name: string; isDefault?: boolean } {
  return {
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    params: toFlat(p.config, p.seed, true),
    layers: p.config.layers.map(l => ({ ...l })),
    weights: p.weights,
  };
}

// ── Groups for the phone list ─────────────────────────────────────

const num = (key: FlatKey, label: string, min: number, max: number, step: number, extra: Partial<NumSpec<FlatKey>> = {}): NumSpec<FlatKey> =>
  ({ kind: 'num', key, label, min, max, step, ...extra });
const en = (key: FlatKey, label: string, names: readonly string[], ui: EnumSpec['ui'], extra: Partial<EnumSpec<FlatKey>> = {}): EnumSpec<FlatKey> =>
  ({ kind: 'enum', key, label, names, ui, ...extra });

const isDist = (i: number) => (p: CPPNFlatParams) => Math.round(p.distType) === i;
const hasBand = (i: number) => (p: CPPNFlatParams) => Math.round(p.numBands) > i;

const bandItems = (i: number) => [
  num(`band${i}Freq` as FlatKey, `Band ${i} freq`, 0.05, 4, 0.05, { showIf: hasBand(i) }),
  num(`band${i}Amp` as FlatKey, `Band ${i} amp`, 0, 2, 0.05, { showIf: hasBand(i) }),
  num(`band${i}Phase` as FlatKey, `Band ${i} phase`, 0, 6.28, 0.05, { showIf: hasBand(i) }),
];

export const CPPN_GROUPS: ParamGroup<FlatKey>[] = [
  { name: 'Weights', items: [
    num('seed', 'Seed', 0, 99_999, 1, { int: true }),
    en('distType', 'Distribution', DIST_NAMES, 'segmented', { rebuilds: true }),
    num('sigma', 'σ (std dev)', 0.1, 5, 0.05, { showIf: isDist(0) }),
    num('a', 'Range ±a', 0.1, 5, 0.05, { showIf: isDist(1) }),
    num('glorotScale', 'Scale', 0.1, 5, 0.05, { showIf: isDist(2) }),
    num('sparsity', 'Sparsity', 0, 0.99, 0.01, { showIf: isDist(3) }),
    num('magnitude', 'Magnitude', 0.1, 10, 0.1, { showIf: isDist(3) }),
  ] },
  { name: 'Space', items: [
    num('scale', 'Coordinate scale', 0.1, 5, 0.05),
  ] },
  { name: 'Motion', items: [
    en('animate', 'Animate', ['Off', 'On'], 'segmented'),
    num('numBands', 'Bands', 2, MAX_BANDS, 1, { int: true }),
    ...bandItems(0), ...bandItems(1), ...bandItems(2), ...bandItems(3),
  ] },
];
