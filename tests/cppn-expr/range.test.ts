import { test, expect } from 'vitest';
import { parse } from '../../src/components/simulations/cppn/cppn-expr/parser';
import { compile } from '../../src/components/simulations/cppn/cppn-expr/compile';
import { measureRange } from '../../src/components/simulations/cppn/cppn-expr/range';
import { usesVars } from '../../src/components/simulations/cppn/cppn-expr/interval';

const M = (s: string) => { const a = parse(s); return measureRange(compile(a), a); };

test('x is unchanged by normalization', () => {
  const r = M('x');
  expect(r.mid).toBeCloseTo(0, 5); expect(r.half).toBeCloseTo(1, 2);
});
test('time-invariant for t', () => {
  const r = M('sin(2*t) + x');
  expect(r.lo).toBeCloseTo(-2, 1); expect(r.hi).toBeCloseTo(2, 1);
});
test('pointer-invariant for px', () => {
  const r = M('px + x');
  expect(r.lo).toBeCloseTo(-2, 1); expect(r.hi).toBeCloseTo(2, 1);
});
test('r maps 0..√2', () => {
  const r = M('r');
  expect(r.lo).toBeLessThan(0.07); expect(r.hi).toBeCloseTo(Math.SQRT2, 1);
});
test('half has a floor and the range is clamped inside the interval', () => {
  expect(M('0*x + 1').half).toBe(1e-6);
  const r = M('sin(0.5*x)');
  expect(r.hi).toBeLessThanOrEqual(Math.sin(0.5) + 1e-9);
});
test('usesVars', () => { expect([...usesVars(parse('sin(t) + px*x'))].sort()).toEqual(['px', 't', 'x']); });
test('the grid never lands on a singularity: normalized 1/x and log(r) keep contrast', () => {
  const a = parse('1/x'); const r = measureRange(compile(a), a);
  expect(r.half).toBeLessThan(100); expect(Math.abs(r.mid)).toBeLessThan(1);
  const b = parse('log(r)'); const rb = measureRange(compile(b), b);
  expect(rb.lo).toBeGreaterThan(-5);
});
