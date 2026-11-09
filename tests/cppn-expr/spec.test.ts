import { test, expect } from 'vitest';
import { toFlat, configFromFlat, presetToBody, paramCount, DEFAULT_FLAT, prepareCPPNBody, type CPPNBody } from '../../src/components/simulations/cppn/cppn-spec';
import { flatParamCount, randomizeFlat } from '../../src/components/simulations/cppn/cppn-randomize';
import { migrateWeightsFromXYR } from '../../src/components/simulations/cppn/cppn-codegen';
import type { CPPNConfig, CPPNPreset } from '../../src/components/simulations/cppn/cppn-types';
import { migrateWeights } from '../../scripts/migrate-cppn-weights.mjs';

const cfg: CPPNConfig = {
  zDim: 16, layers: [{ width: 32, activation: 'tanh' }, { width: 8, activation: 'sin' }],
  distribution: { type: 'normal', sigma: 1 }, scale: 1,
  motion: { speed: 0.05, spread: 1.3, depth: 0.2, falloff: 0.8, bands: 4 },
  inputs: ['x', 'y', 'r'], normalizeInputs: false,
};

test('toFlat/configFromFlat carry normalizeInputs', () => {
  const f = toFlat({ ...cfg, normalizeInputs: true }, 1, true);
  expect(f.normalizeInputs).toBe(1);
  expect(configFromFlat(cfg, { ...f, normalizeInputs: 0 }).normalizeInputs).toBe(false);
  expect(configFromFlat(cfg, f).inputs).toEqual(['x', 'y', 'r']);
  expect(DEFAULT_FLAT.normalizeInputs).toBe(1);
});

test('presetToBody carries inputs and legacy defaults', () => {
  const legacy = { id: 'p', name: 'P', config: { zDim: 16, layers: cfg.layers, distribution: cfg.distribution, scale: 1 }, weights: [], seed: 3 } as unknown as CPPNPreset;
  const b = presetToBody(legacy);
  expect(b.inputs).toEqual(['x', 'y', 'r']);
  expect(b.params.normalizeInputs).toBe(0);
  const modern = { ...legacy, config: { ...cfg, inputs: ['sin(2*x)', 'y'], normalizeInputs: true } } as CPPNPreset;
  expect(presetToBody(modern).inputs).toEqual(['sin(2*x)', 'y']);
  expect(presetToBody(modern).params.normalizeInputs).toBe(1);
});

test('paramCount counts active inputs only', () => {
  expect(paramCount([{ width: 32, activation: 'tanh' }], 3)).toBe(19 * 32 + 3 * 32);
  expect(paramCount([{ width: 32, activation: 'tanh' }], 8)).toBe(24 * 32 + 3 * 32);
  expect(paramCount([{ width: 32, activation: 'tanh' }])).toBe(19 * 32 + 3 * 32);
  expect(flatParamCount(DEFAULT_FLAT, 5)).toBe(paramCount([{ width: 32, activation: 'tanh' }, { width: 32, activation: 'sin' }, { width: 32, activation: 'tanh' }], 5));
});

test('prepareCPPNBody: legacy body gets inputs and normalize off; locked slots are pinned', () => {
  // DEFAULT_FLAT is 32,32,32: the old layout had 19*32 + 2*(32*32+32) + 3*32 weights
  const oldLen = 19 * 32 + 2 * (32 * 32 + 32) + 3 * 32;
  const legacyBody = { params: { ...DEFAULT_FLAT }, weights: Array.from({ length: oldLen }, (_, i) => i + 1) } as CPPNBody;
  const out = prepareCPPNBody(legacyBody, ['a', 'b', 'c'], []);
  expect(out.inputs).toEqual(['x', 'y', 'r']);
  expect(out.params.normalizeInputs).toBe(0);
  expect(out.weights!.length).toBe(oldLen + 5 * 32);
  expect(out.weights![3 * 32 - 1]).toBe(3 * 32);          // last r weight kept in place
  expect(out.weights![3 * 32]).toBe(0);                    // first new column is zero
  expect(out.weights![8 * 32]).toBe(3 * 32 + 1);           // first z weight shifted up
  const modern = { params: { ...DEFAULT_FLAT, normalizeInputs: 1 }, inputs: ['x', 'y', 'r', 'sin(t)'] } as CPPNBody;
  const pinned = prepareCPPNBody(modern, ['cos(a)', 'y', 'gauss(r)'], ['input0', 'input2', 'input5']);
  expect(pinned.inputs).toEqual(['cos(a)', 'y', 'gauss(r)', 'sin(t)']);
  expect(pinned.params.normalizeInputs).toBe(1);
});

test('randomizeFlat budget uses the active input count', () => {
  const f = randomizeFlat(DEFAULT_FLAT, [], 2000, 8);
  expect(flatParamCount(f, 8)).toBeLessThanOrEqual(2000 * 1.05);
});

test('migration script matches migrateWeightsFromXYR', () => {
  const w0 = 36;
  const old = Array.from({ length: 3 * w0 + 16 * w0 + 36 * 5 + 5 + 5 * 3 }, (_, i) => Math.cos(i));
  const viaScript = migrateWeights(old, w0);
  const viaLib = migrateWeightsFromXYR(old, { ...cfg, layers: [{ width: 36, activation: 'tanh' }, { width: 5, activation: 'tanh' }] });
  expect(viaScript.length).toBe(viaLib.length);
  expect(Array.from(viaLib).every((v, i) => v === Math.fround(viaScript[i]))).toBe(true);
});

test('a pre-feature exported bundle loads as x, y, r with normalize off and migrated weights', async () => {
  const { parseBundle } = await import('../../src/lib/presets/preset-file');
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../fixtures/cppn-legacy-preset.json', import.meta.url), 'utf-8');
  const parsed = parseBundle(text, DEFAULT_FLAT);
  expect(parsed.warnings).toEqual([]);
  const body = prepareCPPNBody(parsed.presets[0] as unknown as CPPNBody, ['x', 'y', 'r'], []);
  expect(body.inputs).toEqual(['x', 'y', 'r']);
  expect(body.params.normalizeInputs).toBe(0);
  expect(body.weights!.length).toBe(317 + 5 * 4);
});
