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

export interface ZBand {
  freq: number;       // cycles/second
  amplitude: number;
  phase: number;      // radians
}

export interface CPPNConfig {
  zDim: number;            // always 16 — not user-configurable in this iteration
  layers: LayerConfig[];   // hidden layers only; input/output are fixed
  distribution: WeightDistribution;
  numBands: number;        // 2 | 3 | 4
  zBands: ZBand[];         // length === numBands
  scale: number;           // coordinate space scale
}

export interface CPPNPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  config: CPPNConfig;
  weights: number[];  // serialized Float32Array — exact reproduction
  seed: number;       // seed that generated these weights
}
