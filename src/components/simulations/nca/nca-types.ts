// src/components/simulations/nca/nca-types.ts

export type NCAActivation = 'relu' | 'tanh' | 'leakyrelu';

export interface NCAFilters {
  identity: boolean;
  sobelX: boolean;
  sobelY: boolean;
  laplacian: boolean;
}

export type NCAGridSize = 128 | 256 | 512;
export type NCASeedMode = 'random' | 'center' | 'blank';

export interface NCAConfig {
  channels: number;           // 8 | 16 | 32
  hidden: number;             // 32 | 64 | 128
  filters: NCAFilters;
  activation: NCAActivation;
  fireRate: number;           // 0–1
  stepsPerFrame: number;      // 1–16 (CPU loop, not a uniform)
  dt: number;                 // step size multiplier
  gridWidth: NCAGridSize;
  gridHeight: NCAGridSize;
  channelR: number;           // display channel index
  channelG: number;
  channelB: number;
  normalizeDisplay: boolean;
  seedMode: NCASeedMode;
}

export interface NCAWeightLayout {
  nFilters: number;           // count of active perception filters
  w1Offset: number;           // always 0
  w1BiasOffset: number;       // CHANNELS * N_FILTERS * HIDDEN
  w2Offset: number;           // w1BiasOffset + HIDDEN
  totalCount: number;         // w2Offset + HIDDEN * CHANNELS
}

export interface NCAPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  config: NCAConfig;
  weights: number[];          // flat Float32Array: [W1_weights | W1_biases | W2_weights]
}

export interface BrushOptions {
  mode: 'damage' | 'paint';
  shape: 'circle' | 'square';
  size: number;               // diameter in grid cells
  strength: number;           // 0–1, paint value scale
}

export const DEFAULT_NCA_CONFIG: NCAConfig = {
  channels: 16,
  hidden: 64,
  filters: { identity: true, sobelX: true, sobelY: true, laplacian: true },
  activation: 'relu',
  fireRate: 0.5,
  stepsPerFrame: 4,
  dt: 1.0,
  gridWidth: 256,
  gridHeight: 256,
  channelR: 0,
  channelG: 1,
  channelB: 2,
  normalizeDisplay: false,
  seedMode: 'random',
};
