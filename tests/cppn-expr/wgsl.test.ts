import { test, expect } from 'vitest';
import { OPS, OPCODE } from '../../src/components/simulations/cppn/cppn-expr/optable';
import { emitEvalProgram, wgslPostProcess } from '../../src/components/simulations/cppn/cppn-expr/wgsl';

test('one case per opcode, in table order', () => {
  const src = emitEvalProgram();
  for (const op of OPS) expect(src).toContain(`case ${OPCODE.FN0 + OPS.indexOf(op)}u`);
  expect(src).toContain('case 11u'); // DIV
  expect(src).toContain('array<f32, 16>');
  expect(src).toContain('@binding(2)');
  expect(src).toContain('fn evalProgram(slot: u32, x: f32, y: f32, r: f32, a: f32, t: f32, px: f32, py: f32) -> f32');
});

test('no bare division or log in emitted bodies', () => {
  const src = emitEvalProgram();
  expect(src).not.toMatch(/[^f]\/ b\b/);   // every divide goes through safeDiv
  expect(src).toMatch(/log\(abs\(/);
});

test('post-process clamps and drops non-finite values', () => {
  const src = wgslPostProcess();
  expect(src).toContain('fn finiteClamp(v: f32) -> f32');
  expect(src).toContain('clamp(');
  expect(src).toContain('-10000.0, 10000.0');
});
