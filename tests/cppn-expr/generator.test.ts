import { test, expect } from 'vitest';
import { parse, type Ast } from '../../src/components/simulations/cppn/cppn-expr/parser';
import { intervalOf } from '../../src/components/simulations/cppn/cppn-expr/interval';
import { GEN_ITEMS, GEN_GROUP, GEN_PRESETS, generateExpression, canonical, nodeCount, type GenSettings } from '../../src/components/simulations/cppn/cppn-expr/generator';

function makePRNG(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makePRNG(12345);
const S = (over: Partial<GenSettings> = {}): GenSettings => ({ weights: GEN_PRESETS.default(), complexity: 0.5, normalize: true, ...over });
const walk = (n: Ast, f: (n: Ast) => void): void => { f(n); if (n.k === 'neg') walk(n.a, f); else if (n.k === 'bin') { walk(n.a, f); walk(n.b, f); } else if (n.k === 'call') n.args.forEach(a => walk(a, f)); };
/** Every a/t variable sits directly inside sin/cos as `k*v`, `v`, or that plus a constant. */
function seamless(root: Ast): boolean {
  const core = (m: Ast) => (m.k === 'var' && (m.name === 'a' || m.name === 't')) || (m.k === 'bin' && m.op === '*' && m.a.k === 'num' && m.b.k === 'var' && (m.b.name === 'a' || m.b.name === 't'));
  const isHarmArg = (n: Ast): boolean => core(n) || (n.k === 'bin' && (n.op === '+' || n.op === '-') && core(n.a) && n.b.k === 'num');
  let ok = true;
  const go = (n: Ast): void => {
    if (n.k === 'var') { if (n.name === 'a' || n.name === 't') ok = false; return; }
    if (n.k === 'call' && (n.fn === 'sin' || n.fn === 'cos') && isHarmArg(n.args[0])) return;
    if (n.k === 'neg') go(n.a); else if (n.k === 'bin') { go(n.a); go(n.b); } else if (n.k === 'call') n.args.forEach(go);
  };
  go(root);
  return ok;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('500 rolls parse, are in-domain and spatial', () => {
  for (let i = 0; i < 500; i++) {
    const src = generateExpression(S(), new Set(), rng);
    const ast = parse(src);
    const [lo, hi] = intervalOf(ast);
    expect(Number.isFinite(lo) && Number.isFinite(hi), src).toBe(true);
    expect(/\b[xyr]\b|\ba\b/.test(src), src).toBe(true);
    walk(ast, n => {
      if (n.k === 'call' && n.fn === 'log') expect(intervalOf(n.args[0])[0], src).toBeGreaterThan(0.05);
      if (n.k === 'call' && n.fn === 'sqrt') expect(intervalOf(n.args[0])[0], src).toBeGreaterThanOrEqual(0);
      if (n.k === 'bin' && n.op === '/') { const [l, h] = intervalOf(n.b); expect(l > 0 || h < 0, src).toBe(true); }
    });
    expect(seamless(ast), src).toBe(true);                          // a/t only inside sin/cos(k*v [± φ])
    expect(src, src).not.toMatch(/\+ -/);
  }
});

test('zero weight means never', () => {
  const w = GEN_PRESETS.default(); w.sin = 0; w.cos = 0;
  for (let i = 0; i < 200; i++) expect(generateExpression(S({ weights: w }), new Set(), rng)).not.toMatch(/\b(sin|cos)\(/);
});

test('complexity moves node count', () => {
  const avg = (c: number) => mean(Array.from({ length: 300 }, () => nodeCount(parse(generateExpression(S({ complexity: c }), new Set(), rng)))));
  expect(avg(0)).toBeLessThan(3);
  expect(avg(1)).toBeGreaterThan(6);
});

test('dedupe', () => {
  const taken = new Set(['x', 'y', 'r']);
  let dup = 0;
  for (let i = 0; i < 400; i++) if (taken.has(canonical(generateExpression(S({ complexity: 0 }), taken, rng)))) dup++;
  expect(dup / 400).toBeLessThan(0.12);
});

test('generator survives an all-zero function vocabulary', () => {
  const w = GEN_PRESETS.uniform();
  for (const k of GEN_ITEMS) if (GEN_GROUP[k] === 'smooth' || GEN_GROUP[k] === 'discrete') w[k] = 0;
  for (let i = 0; i < 50; i++) expect(() => parse(generateExpression(S({ weights: w }), new Set(), rng))).not.toThrow();
});

test('presets', () => {
  const d = GEN_PRESETS.default();
  expect(d.mod).toBe(0.15); expect(d.t).toBe(0.3); expect(d.px).toBe(0.15); expect(d.sin).toBe(1); expect(d.const).toBe(1);
  expect(GEN_PRESETS.smooth().mod).toBe(0); expect(GEN_PRESETS.smooth().t).toBe(0.3);
  expect(GEN_PRESETS.static().t).toBe(0); expect(GEN_PRESETS.static().px).toBe(0); expect(GEN_PRESETS.static().mod).toBe(0.15);
  expect(GEN_PRESETS.uniform().mod).toBe(1);
  expect(GEN_GROUP.a).toBe('smooth');
  expect(GEN_ITEMS.slice(0, 4)).toEqual(['x', 'y', 'r', 'const']);
  expect(GEN_ITEMS.slice(4, 7)).toEqual(['t', 'px', 'py']);
  expect(GEN_ITEMS.length).toBe(32);
  expect(GEN_ITEMS).not.toContain('tan'); expect(GEN_ITEMS).not.toContain('clamp');
});

test('canonical strips whitespace', () => { expect(canonical('sin( 3 * x )')).toBe('sin(3*x)'); });
