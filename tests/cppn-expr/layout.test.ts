import { test, expect } from 'vitest';
import { computeWeightLayout, packedSlotCount, migrateWeightsFromXYR, Z_DIM } from '../../src/components/simulations/cppn/cppn-codegen';
import { MAX_INPUTS } from '../../src/components/simulations/cppn/cppn-expr/compile';
import { PARAMS_FLOATS } from '../../src/components/simulations/cppn/cppn-controller';
import type { CPPNConfig, LayerConfig } from '../../src/components/simulations/cppn/cppn-types';

const cfgWith = (widths: number[]): CPPNConfig => ({
  zDim: 16, layers: widths.map(w => ({ width: w, activation: 'tanh' as const })),
  distribution: { type: 'normal', sigma: 1 }, scale: 1, zScale: 1,
  motion: { speed: 0.05, spread: 1.3, depth: 0.2, falloff: 0.8, bands: 4 },
  inputs: ['x', 'y', 'r'], normalizeInputs: false,
});

/** The pre-change layout: 3 input columns, then z, hidden, out. */
function oldLayout(layers: LayerConfig[]) {
  const w0 = layers[0].width;
  let offset = 3 * w0 + Z_DIM * w0;
  const hiddenWeightOffsets: number[] = [], hiddenBiasOffsets: number[] = [];
  for (let i = 0; i < layers.length - 1; i++) {
    hiddenWeightOffsets.push(offset); offset += layers[i].width * layers[i + 1].width;
    hiddenBiasOffsets.push(offset); offset += layers[i + 1].width;
  }
  const outWeightOffset = offset; offset += layers[layers.length - 1].width * 3;
  return { hiddenWeightOffsets, hiddenBiasOffsets, outWeightOffset, totalCount: offset };
}

const cfg = cfgWith([32, 32, 32]);
const L = computeWeightLayout(cfg);
const oldL = oldLayout(cfg.layers);

test('layout has 8 input columns and total grows by 5*w0', () => {
  expect(MAX_INPUTS).toBe(8);
  expect(L.wInOffset).toBe(0);
  expect(L.wzOffset).toBe(8 * 32);
  expect(L.totalCount).toBe(oldL.totalCount + 5 * 32);
});

test('packed slot count: 2 input groups + 4 z groups per neuron', () => {
  const hiddenSlots = 2 * (32 * (1 + 8));   // per output neuron: bias slot + 8 dot4 slots
  const outSlots = 3 * 8;
  expect(packedSlotCount(cfg, L)).toBe(32 * 6 + hiddenSlots + outSlots);
});

test('migrateWeightsFromXYR preserves values and zeroes new columns', () => {
  const old = new Float32Array(oldL.totalCount);
  for (let i = 0; i < old.length; i++) old[i] = Math.sin(i * 0.37);
  const nw = migrateWeightsFromXYR(old, cfg);
  expect(nw.length).toBe(L.totalCount);
  expect(nw[L.wInOffset + 0 * 32 + 5]).toBe(old[5]);
  expect(nw[L.wInOffset + 2 * 32 + 5]).toBe(old[2 * 32 + 5]);
  expect(nw[L.wInOffset + 3 * 32 + 5]).toBe(0);
  expect(nw[L.wInOffset + 7 * 32 + 31]).toBe(0);
  expect(nw[L.wzOffset + 9]).toBe(old[3 * 32 + 9]);
  expect(nw[L.hiddenWeightOffsets[0] + 7]).toBe(old[oldL.hiddenWeightOffsets[0] + 7]);
  expect(nw[L.hiddenBiasOffsets[1] + 3]).toBe(old[oldL.hiddenBiasOffsets[1] + 3]);
  expect(nw[L.outWeightOffset + 11]).toBe(old[oldL.outWeightOffset + 11]);
});

test('params uniform size', () => { expect(PARAMS_FLOATS).toBe(56); });
