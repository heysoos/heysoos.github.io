// Interval arithmetic over the canvas: a conservative [lo, hi] for any AST,
// given the variable ranges on the unit square. The generator uses it to
// build in-domain expressions (log/sqrt children positive, divisors away from
// 0) and the normalizer clamps its sampled range inside it.
import { OPS, VARS, type VarName } from './optable';
import type { Ast } from './parser';

export type Interval = [lo: number, hi: number];

export const VAR_RANGES: Record<VarName, Interval> = {
  x: [-1, 1], y: [-1, 1], r: [0, Math.SQRT2], a: [-Math.PI, Math.PI],
  t: [0, 2 * Math.PI], px: [-1, 1], py: [-1, 1],
};

const BIG = 1e6;
const hull = (...vs: number[]): Interval => [Math.min(...vs), Math.max(...vs)];
const clampI = ([lo, hi]: Interval, a: number, b: number): Interval => [Math.min(b, Math.max(a, lo)), Math.min(b, Math.max(a, hi))];
const absI = ([lo, hi]: Interval): Interval => (lo >= 0 ? [lo, hi] : hi <= 0 ? [-hi, -lo] : [0, Math.max(-lo, hi)]);
const monotone = (f: (v: number) => number) => ([lo, hi]: Interval): Interval => hull(f(lo), f(hi));
const mul = (a: Interval, b: Interval): Interval => hull(a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]);
const add = (a: Interval, b: Interval): Interval => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Interval, b: Interval): Interval => [a[0] - b[1], a[1] - b[0]];
const excludesZero = ([lo, hi]: Interval) => lo > 0 || hi < 0;
const finite = ([lo, hi]: Interval): Interval => [
  Number.isNaN(lo) ? -BIG : Math.max(-BIG, lo),
  Number.isNaN(hi) ? BIG : Math.min(BIG, hi),
];

function div(a: Interval, b: Interval): Interval {
  if (!excludesZero(b)) return [-BIG, BIG];
  return mul(a, [1 / b[1], 1 / b[0]]);
}

/** sign(a)·|a|^b over both intervals. */
function spow(a: Interval, b: Interval): Interval {
  const m = absI(a);
  const p = finite(hull(Math.pow(m[0], b[0]), Math.pow(m[0], b[1]), Math.pow(m[1], b[0]), Math.pow(m[1], b[1])));
  if (a[0] >= 0) return p;
  if (a[1] <= 0) return [-p[1], -p[0]];
  return [-p[1], p[1]];
}

/** sin/cos: endpoints plus the critical points k·π/2 inside the interval. */
function trig(f: (v: number) => number, [lo, hi]: Interval): Interval {
  if (hi - lo >= 2 * Math.PI) return [-1, 1];
  const vals = [f(lo), f(hi)];
  const k0 = Math.ceil(lo / (Math.PI / 2)), k1 = Math.floor(hi / (Math.PI / 2));
  for (let k = k0; k <= k1; k++) vals.push(f(k * Math.PI / 2));
  const r = hull(...vals);
  return [Math.max(-1, r[0]), Math.min(1, r[1])];
}

type Rule = (args: Interval[]) => Interval;

/** Per-op range rules, keyed by op name; the test asserts every OP has one. */
export const OP_RANGE: Record<string, Rule> = {
  sin:   ([a]) => trig(Math.sin, a),
  cos:   ([a]) => trig(Math.cos, a),
  tanh:  ([a]) => monotone(Math.tanh)(clampI(a, -15, 15)),
  gauss: ([a]) => { const m = absI(a); return [Math.exp(-m[1] * m[1]), Math.exp(-m[0] * m[0])]; },
  abs:   ([a]) => absI(a),
  sqrt:  ([a]) => monotone(Math.sqrt)(absI(a)),
  exp:   ([a]) => monotone(Math.exp)(clampI(a, -20, 20)),
  log:   ([a]) => monotone(v => Math.log(v + 1e-6))(absI(a)),
  length: ([a, b]) => { const m = absI(a), n = absI(b); return [Math.hypot(m[0], n[0]), Math.hypot(m[1], n[1])]; },
  min:   ([a, b]) => [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
  max:   ([a, b]) => [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  pow:   ([a, b]) => spow(a, b),
  mix:   ([a, b, k]) => add(a, mul(sub(b, a), k)),   // a + (b − a)·k; k may leave [0, 1] (the generator blends with r)
  smoothstep: () => [0, 1],
  mod:   ([, b]) => (b[0] > 0 ? [0, b[1]] : b[1] < 0 ? [b[0], 0] : [-BIG, BIG]),
  sign:  ([a]) => [Math.sign(a[0]), Math.sign(a[1])],
  atan2: () => [-Math.PI, Math.PI],
  fract: () => [0, 1],
  floor: ([a]) => [Math.floor(a[0]), Math.floor(a[1])],
  step:  () => [0, 1],
  tan:   () => [-20, 20],
  atan:  ([a]) => monotone(Math.atan)(a),
  clamp: ([x, lo, hi]) => { const L: Interval = [Math.min(lo[0], hi[0]), Math.min(lo[1], hi[1])], H: Interval = [Math.max(lo[0], hi[0]), Math.max(lo[1], hi[1])]; return [Math.min(Math.max(x[0], L[0]), H[0]), Math.min(Math.max(x[1], L[1]), H[1])]; },   // monotone in each argument
};

for (const op of OPS) if (!OP_RANGE[op.name]) throw new Error(`interval: no range rule for ${op.name}`);

export function intervalOf(ast: Ast, vars: Record<VarName, Interval> = VAR_RANGES): Interval {
  const go = (n: Ast): Interval => {
    switch (n.k) {
      case 'num': return [n.v, n.v];
      case 'var': return vars[n.name] ?? VAR_RANGES[n.name];
      case 'neg': { const a = go(n.a); return [-a[1], -a[0]]; }
      case 'bin': {
        const a = go(n.a), b = go(n.b);
        switch (n.op) {
          case '+': return add(a, b);
          case '-': return sub(a, b);
          case '*': return mul(a, b);
          case '/': return div(a, b);
          case '^': return spow(a, b);
        }
      }
      // falls through only for an impossible op
      case 'call': {
        const rule = OP_RANGE[n.fn];
        return rule ? rule(n.args.map(go)) : [-BIG, BIG];
      }
    }
  };
  return finite(go(ast));
}

/** Variables an AST reads. */
export function usesVars(ast: Ast): Set<VarName> {
  const out = new Set<VarName>();
  const walk = (n: Ast): void => {
    if (n.k === 'var') out.add(n.name);
    else if (n.k === 'neg') walk(n.a);
    else if (n.k === 'bin') { walk(n.a); walk(n.b); }
    else if (n.k === 'call') n.args.forEach(walk);
  };
  walk(ast);
  return out;
}

export { VARS };
