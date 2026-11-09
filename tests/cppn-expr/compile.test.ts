import { test, expect } from 'vitest';
import { parse } from '../../src/components/simulations/cppn/cppn-expr/parser';
import { OPCODE } from '../../src/components/simulations/cppn/cppn-expr/optable';
import { compile, MAX_OPS, MAX_INPUTS, STACK_DEPTH, CHANNEL_LIMIT } from '../../src/components/simulations/cppn/cppn-expr/compile';
import { evalProgram, makeVars } from '../../src/components/simulations/cppn/cppn-expr/eval-js';

test('round trip', () => {
  const p = compile(parse('sin(3*x + t)'));
  expect(evalProgram(p, makeVars(0.5, 0, 0))).toBeCloseTo(Math.sin(1.5));
});

test('safe semantics are total', () => {
  const cases = [
    ['log(x)', makeVars(-1, 0)], ['sqrt(x)', makeVars(-4, 0)], ['1 / x', makeVars(0, 0)],
    ['exp(100*x)', makeVars(1, 0)], ['pow(x, 0.5)', makeVars(-1, 0)], ['mod(x, 0)', makeVars(1, 0)],
    ['tan(pi/2)', makeVars(0, 0)], ['x^0.5', makeVars(-1, 0)], ['smoothstep(1, 1, x)', makeVars(1, 0)],
  ] as const;
  for (const [src, v] of cases) {
    const out = evalProgram(compile(parse(src)), v);
    expect(Number.isFinite(out), src).toBe(true);
    expect(Math.abs(out), src).toBeLessThanOrEqual(CHANNEL_LIMIT);
  }
  expect(evalProgram(compile(parse('1 / x')), makeVars(-1e-9, 0))).toBeLessThan(0);   // sign kept
});

test('limits', () => {
  expect(() => compile(parse('x + '.repeat(40) + 'x'))).toThrow(/expression too long/);
  expect(() => compile(parse('x + ('.repeat(17) + 'x' + ')'.repeat(17)))).toThrow(/expression too deep/);
  expect(MAX_OPS).toBe(64); expect(MAX_INPUTS).toBe(8); expect(STACK_DEPTH).toBe(16);
});

test('program is END-terminated and fits MAX_OPS', () => {
  const p = compile(parse('x'));
  expect(p.length).toBe(2);
  expect(p.ops.length).toBe(MAX_OPS * 4);
  expect(p.ops[(p.length - 1) * 4]).toBe(OPCODE.END);
});

test('makeVars derives r and a', () => {
  const v = makeVars(1, 1);
  expect(v.r).toBeCloseTo(Math.SQRT2); expect(v.a).toBeCloseTo(Math.PI / 4); expect(v.t).toBe(0); expect(v.px).toBe(0);
});

test('a program that reaches the full stack depth evaluates correctly and the WGSL stack is not clamped below it', async () => {
  const src = 'x + ('.repeat(15) + 'x' + ')'.repeat(15);          // right-nested: height 16
  const p = compile(parse(src));
  expect(evalProgram(p, makeVars(0.5, 0))).toBeCloseTo(8);
  const { emitEvalProgram } = await import('../../src/components/simulations/cppn/cppn-expr/wgsl');
  expect(emitEvalProgram()).not.toMatch(/min\(sp/);
});
