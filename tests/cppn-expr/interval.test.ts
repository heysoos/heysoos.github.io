import { test, expect } from 'vitest';
import { parse } from '../../src/components/simulations/cppn/cppn-expr/parser';
import { intervalOf, VAR_RANGES } from '../../src/components/simulations/cppn/cppn-expr/interval';

const I = (s: string) => intervalOf(parse(s));

test('leaves and trig', () => {
  expect(I('x')).toEqual([-1, 1]);
  expect(I('r')[1]).toBeCloseTo(Math.SQRT2);
  expect(I('sin(7*x)')).toEqual([-1, 1]);
  expect(I('sin(0.5*x)')[1]).toBeCloseTo(Math.sin(0.5));
  expect(I('sin(0.5*x)')[0]).toBeCloseTo(-Math.sin(0.5));
  expect(I('cos(0.5*x)')[1]).toBeCloseTo(1);          // critical point 0 inside
  expect(I('cos(0.5*x)')[0]).toBeCloseTo(Math.cos(0.5));
  expect(VAR_RANGES.t).toEqual([0, 2 * Math.PI]);
  expect(VAR_RANGES.a[0]).toBeCloseTo(-Math.PI);
});

test('domain-shifted children stay finite', () => {
  const [lo, hi] = I('log(r + 1.37)');
  expect(lo).toBeCloseTo(Math.log(1.37));
  expect(Number.isFinite(hi)).toBe(true);
  expect(I('sqrt(r + 0.5)')[0]).toBeCloseTo(Math.sqrt(0.5));
  expect(I('exp(2*x)')[1]).toBeCloseTo(Math.exp(2));
});

test('products and quotients', () => {
  expect(I('x * y')).toEqual([-1, 1]);
  expect(I('gauss(2*r)')).toEqual([expect.closeTo(Math.exp(-8), 5), 1]);
  expect(I('x / (y + 2)')).toEqual([-1, 1]);
  const q = I('1 / x');                                 // divisor crosses 0 → safe-divide bound
  expect(q[0]).toBe(-1e6); expect(q[1]).toBe(1e6);
});

test('n-ary and discrete rules', () => {
  expect(I('min(x, r)')[1]).toBeCloseTo(1); expect(I('max(x, r)')[0]).toBe(0);
  expect(I('length(x, y)')[1]).toBeCloseTo(Math.SQRT2);
  expect(I('mix(x, 3, r)')).toEqual([-1, expect.closeTo(1 + 4 * Math.SQRT2, 5)]);   // x + (3 − x)·r, r up to √2
  expect(I('smoothstep(0, 1, x)')).toEqual([0, 1]);
  expect(I('step(0, x)')).toEqual([0, 1]);
  expect(I('fract(3*x)')).toEqual([0, 1]);
  expect(I('floor(3*x)')).toEqual([-3, 3]);
  expect(I('sign(x)')).toEqual([-1, 1]);
  expect(I('atan2(y, x)')).toEqual([-Math.PI, Math.PI]);
  expect(I('mod(x, 2)')).toEqual([0, 2]);
  expect(I('pow(r, 2)')[0]).toBe(0); expect(I('pow(r, 2)')[1]).toBeCloseTo(2);
  expect(I('tanh(3*x)')[1]).toBeCloseTo(Math.tanh(3));
  expect(I('abs(x - 0.5)')).toEqual([0, 1.5]);
  expect(I('-x')).toEqual([-1, 1]);
  expect(I('x^2')).toEqual([-1, 1]);                    // signed pow
});

test('never NaN', () => {
  for (const s of ['log(x)', 'sqrt(x)', 'tan(x)', 'x^0.5', 'exp(100*x)', 'mod(x, 0)']) {
    const [lo, hi] = I(s);
    expect(Number.isNaN(lo) || Number.isNaN(hi), s).toBe(false);
    expect(lo <= hi, s).toBe(true);
  }
});

test('mix and clamp rules are sound against sampled values', async () => {
  const { compile } = await import('../../src/components/simulations/cppn/cppn-expr/compile');
  const { evalProgram, makeVars } = await import('../../src/components/simulations/cppn/cppn-expr/eval-js');
  for (const s of ['mix(x, y, r)', 'mix(x, 3, r)', 'clamp(x + 5, 0, y*10)', 'mix(x, y, 2*r) / (mix(y, x, r) + 2.5)']) {
    const ast = parse(s); const [lo, hi] = intervalOf(ast); const p = compile(ast);
    for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) {
      const v = evalProgram(p, makeVars(-1 + i / 10, -1 + j / 10));
      expect(v, `${s} at ${i},${j}`).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(v, `${s} at ${i},${j}`).toBeLessThanOrEqual(hi + 1e-9);
    }
  }
  expect(I('mix(x, y, r)')[0]).toBeLessThan(-1.5);          // k up to √2 overshoots the hull
});
