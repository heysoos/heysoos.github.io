import { test, expect } from 'vitest';
import { CPPNController } from '../../src/components/simulations/cppn/cppn-controller';
import { computeWeightLayout, removeInputColumn } from '../../src/components/simulations/cppn/cppn-codegen';
import type { CPPNConfig } from '../../src/components/simulations/cppn/cppn-types';

test('a slot that fails to compile keeps its last good source in config (and reports the error)', () => {
  const c = new CPPNController();                       // no GPU: compile + bookkeeping only
  expect(c.config.inputs).toEqual(['x', 'y', 'r']);
  const res = c.setInputs(['sin(3*x +', 'y', 'r']);
  expect(res[0].ok).toBe(false);
  expect(c.config.inputs).toEqual(['x', 'y', 'r']);     // broken draft never lands in config / presets / undo
  expect(c.setInputs(['sin(3*x)', 'y', 'r'])[0].ok).toBe(true);
  expect(c.config.inputs[0]).toBe('sin(3*x)');
  // a brand-new slot that never compiled falls back to x
  const r2 = c.setInputs(['sin(3*x)', 'y', 'r', 'nope(']);
  expect(r2[3].ok).toBe(false);
  expect(c.config.inputs[3]).toBe('x');
});

test('removeInput drops the slot and shifts the later ones down', () => {
  const c = new CPPNController();
  c.setInputs(['x', 'y', 'r', 'sin(2*x)']);
  c.removeInput(1);
  expect(c.config.inputs).toEqual(['x', 'r', 'sin(2*x)']);
  expect(c.inputStatus.length).toBe(3);
});

test('removeInputColumn shifts weight columns k+1..7 down and zeroes column 7', () => {
  const cfg: CPPNConfig = { zDim: 16, layers: [{ width: 4, activation: 'tanh' }], distribution: { type: 'normal' }, scale: 1, motion: { speed: 0, spread: 1, depth: 0, falloff: 1, bands: 1 }, inputs: ['x', 'y', 'r'], normalizeInputs: false };
  const L = computeWeightLayout(cfg);
  const w = new Float32Array(L.totalCount);
  for (let k = 0; k < 8; k++) for (let i = 0; i < 4; i++) w[L.wInOffset + k * 4 + i] = (k + 1) * 10 + i;
  w[L.wzOffset] = 99;
  removeInputColumn(w, L, 4, 1);
  expect(w[L.wInOffset + 0 * 4 + 2]).toBe(12);          // column 0 untouched
  expect(w[L.wInOffset + 1 * 4 + 2]).toBe(32);          // old column 2 moved to 1
  expect(w[L.wInOffset + 6 * 4 + 3]).toBe(83);          // old column 7 moved to 6
  expect(w[L.wInOffset + 7 * 4 + 1]).toBe(0);           // column 7 cleared
  expect(w[L.wzOffset]).toBe(99);                       // z block untouched
});
