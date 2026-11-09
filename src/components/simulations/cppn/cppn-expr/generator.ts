// Grammar-based expression generator. Every subtree carries an interval over
// the canvas (interval.ts); a function is applied only where its domain holds,
// otherwise the child is shifted (`posify`) or scaled (`tame`) first, so
// log/sqrt/pow/÷ are in-domain by construction. `a` and `t` are only ever
// emitted as integer harmonics (seamless around the circle / across the 60 s
// wrap). Which items appear is decided by the weights alone; complexity only
// sets the size of the tree.
import { OPS, BINARY, VARS, type ExprGroup, type VarName, type BinOp } from './optable';
import { astToString, parse, type Ast } from './parser';
import { intervalOf, type Interval } from './interval';
import { compile } from './compile';
import { evalProgram, makeVars } from './eval-js';

export const GEN_ITEMS = [
  'x', 'y', 'r', 'const',
  't', 'px', 'py',
  'a', 'sin', 'cos', 'tanh', 'gauss', 'abs', 'sqrt', 'exp', 'log', '+', '-', '*', '/', 'length', 'min', 'max', 'pow', 'mix', 'smoothstep',
  'mod', 'sign', 'atan2', 'fract', 'floor', 'step',
] as const;
export type GenItem = typeof GEN_ITEMS[number];
export type GenGroup = Exclude<ExprGroup, 'typed'>;

export const GEN_GROUP: Record<GenItem, GenGroup> = Object.fromEntries(GEN_ITEMS.map(k => {
  if (k === 'x' || k === 'y' || k === 'r' || k === 'const') return [k, 'spatial'];
  if (k === 't' || k === 'px' || k === 'py') return [k, 'dynamic'];
  if (k === 'a' || (BINARY as readonly string[]).includes(k)) return [k, 'smooth'];
  const op = OPS.find(o => o.name === k);
  return [k, (op?.group ?? 'smooth') as GenGroup];
})) as Record<GenItem, GenGroup>;

export type Weights = Record<GenItem, number>;

const fill = (f: (k: GenItem) => number): Weights => Object.fromEntries(GEN_ITEMS.map(k => [k, f(k)])) as Weights;
const defaultW = (k: GenItem) => (GEN_GROUP[k] === 'discrete' ? 0.15 : k === 't' ? 0.3 : k === 'px' || k === 'py' ? 0.15 : 1);

export const GEN_PRESETS: Record<'default' | 'uniform' | 'smooth' | 'static', () => Weights> = {
  default: () => fill(defaultW),
  uniform: () => fill(() => 1),
  smooth:  () => fill(k => (GEN_GROUP[k] === 'discrete' ? 0 : defaultW(k))),
  static:  () => fill(k => (GEN_GROUP[k] === 'dynamic' ? 0 : defaultW(k))),
};

export interface GenSettings { weights: Weights; complexity: number; normalize: boolean }

export const canonical = (src: string): string => src.replace(/\s+/g, '');

export function nodeCount(ast: Ast): number {
  switch (ast.k) {
    case 'num': case 'var': return 1;
    case 'neg': return 1 + nodeCount(ast.a);
    case 'bin': return 1 + nodeCount(ast.a) + nodeCount(ast.b);
    case 'call': return 1 + ast.args.reduce((s, a) => s + nodeCount(a), 0);
  }
}

// ── helpers ─────────────────────────────────────────────────────
class Reject extends Error {}
const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: number): Ast => ({ k: 'num', v: r2(v) });
const vr = (name: VarName): Ast => ({ k: 'var', name });
const call = (fn: string, args: Ast[]): Ast => ({ k: 'call', fn, args });
const bin = (op: BinOp, a: Ast, b: Ast): Ast => ({ k: 'bin', op, a, b });
/** a + k with a negative constant written as a subtraction (`x - 1.1`, never `x + -1.1`). */
const plus = (a: Ast, b: Ast): Ast => (b.k === 'num' && b.v < 0 ? bin('-', a, num(-b.v)) : bin('+', a, b));
const isConst = (n: Ast): boolean => n.k === 'num' || (n.k === 'neg' && isConst(n.a)) || (n.k === 'bin' && isConst(n.a) && isConst(n.b)) || (n.k === 'call' && n.args.every(isConst));
const span = ([lo, hi]: Interval) => hi - lo;

const UNARY  = ['sin', 'cos', 'tanh', 'gauss', 'abs', 'sqrt', 'exp', 'log', 'sign', 'fract', 'floor'] as const;
const NARY   = ['length', 'min', 'max', 'pow', 'mix', 'smoothstep', 'mod', 'atan2', 'step'] as const;
const LEAVES = ['x', 'y', 'r', 'const', 't', 'px', 'py', 'a'] as const;
const WRAPS  = ['sin', 'cos', 'tanh', 'gauss'] as const;
const GEN_BINARY = ['+', '-', '*', '/'] as const;   // `^` is typed-only; pow is the n-ary form

interface Ctx { rng: () => number; w: Weights; c: number; spatial: boolean; dynamic: boolean }

function wpick<T extends GenItem>(ctx: Ctx, items: readonly T[]): T | null {
  let s = 0;
  for (const it of items) s += Math.max(0, ctx.w[it] ?? 0);
  if (s <= 0) return null;
  let u = ctx.rng() * s;
  for (const it of items) { u -= Math.max(0, ctx.w[it] ?? 0); if (u <= 0) return it; }
  return items[items.length - 1];
}
function pickBy<T>(ctx: Ctx, items: readonly [T, number][]): T | null {
  let s = 0; for (const [, w] of items) s += w;
  if (s <= 0) return null;
  let u = ctx.rng() * s;
  for (const [it, w] of items) { u -= w; if (u <= 0) return it; }
  return items[items.length - 1][0];
}

function konst(ctx: Ctx): Ast {
  const u = ctx.rng();
  return num(u < 0.5 ? 1 + ctx.rng() * 7 : u < 0.8 ? 0.1 + ctx.rng() * 6.18 : 0.1 + ctx.rng() * 1.9);
}

function harmonic(ctx: Ctx, v: 'a' | 't', kmax: number): Ast {
  const f = wpick(ctx, ['sin', 'cos'] as const) ?? 'sin';
  const k = 1 + Math.floor(ctx.rng() * kmax);
  let inner: Ast = k === 1 ? vr(v) : bin('*', num(k), vr(v));
  if (ctx.rng() < 0.4) inner = plus(inner, num(0.1 + ctx.rng() * 6.1));
  return call(f, [inner]);
}

function leaf(ctx: Ctx): Ast {
  // a and t are only ever emitted as sin/cos harmonics, so they need one of those.
  const leaves = ctx.w.sin > 0 || ctx.w.cos > 0 ? LEAVES : LEAVES.filter(l => l !== 'a' && l !== 't');
  const l = wpick(ctx, leaves) ?? 'x';
  if (l === 'const') return konst(ctx);
  if (l === 'a') { ctx.spatial = true; return harmonic(ctx, 'a', 7); }
  if (l === 't') { ctx.dynamic = true; return harmonic(ctx, 't', 12); }
  if (l === 'px' || l === 'py') ctx.dynamic = true; else ctx.spatial = true;
  return vr(l);
}
function varLeaf(ctx: Ctx): Ast {
  for (let i = 0; i < 6; i++) { const l = leaf(ctx); if (!isConst(l)) return l; }
  ctx.spatial = true;
  return vr('x');
}

/** Shift so the interval's low end is ≥ min. */
function posify(c: Ast, min: number, ctx: Ctx): Ast {
  const iv = intervalOf(c);
  if (iv[0] >= min) return c;
  if (span(iv) > 50) throw new Reject();
  const k = Math.ceil((min - iv[0] + ctx.rng() * 1.2) * 100) / 100;
  return plus(c, num(k));
}
/** Scale so the interval's high end is ≤ max. */
function tame(c: Ast, max: number): Ast {
  const iv = intervalOf(c);
  if (iv[1] <= max) return c;
  if (span(iv) > 1e4) throw new Reject();
  const k = Math.floor((max / iv[1]) * 100) / 100 || 0.01;
  return bin('*', num(k), c);
}

function gen(budget: number, ctx: Ctx): Ast {
  if (budget <= 1 || ctx.rng() < (1 - ctx.c) * 0.35) return leaf(ctx);
  const c = ctx.c;
  const kinds: [string, number][] = [];
  if (wpick(ctx, UNARY)) kinds.push(['unary', 1.5 + 4 * c]);
  if (wpick(ctx, GEN_BINARY)) kinds.push(['binary', 2 + 3.5 * c]);
  if (wpick(ctx, NARY)) kinds.push(['nary', 0.3 + 3 * c]);
  kinds.push(['scaled', 5 - 3 * c]);
  const kind = pickBy(ctx, kinds) ?? 'scaled';

  if (kind === 'unary') {
    let child = gen(budget - 1, ctx);
    if (isConst(child)) child = varLeaf(ctx);
    const f = wpick(ctx, UNARY)!;
    if (f === 'sqrt') child = posify(child, 0, ctx);
    else if (f === 'log') child = posify(child, 0.1, ctx);
    else if (f === 'exp') child = tame(child, 4);
    return call(f, [child]);
  }

  if (kind === 'scaled') {
    const l = varLeaf(ctx);
    if (l.k === 'call') return l;                       // already a harmonic
    const k = Math.max(0.5, Math.abs((konst(ctx) as { v: number }).v));
    let inner: Ast = bin('*', num(k), l);
    if (ctx.rng() < 0.4) inner = plus(inner, gen(Math.max(1, budget - 2), ctx));
    const f = wpick(ctx, WRAPS);
    return f ? call(f, [inner]) : inner;
  }

  if (kind === 'binary') {
    const op = wpick(ctx, GEN_BINARY)!;
    const na = 1 + Math.floor(ctx.rng() * (budget - 1)), nb = Math.max(1, budget - 1 - na);
    const a = gen(na, ctx);
    let b = gen(nb, ctx);
    if (isConst(a) && isConst(b)) b = varLeaf(ctx);
    if (op === '/') b = posify(b, 0.5, ctx);
    if (op === '+') return plus(a, b);
    return bin(op, a, b);
  }

  // n-ary
  const f = wpick(ctx, NARY)!;
  const per = Math.max(1, Math.floor((budget - 1) / 2));
  const arg = (): Ast => gen(per, ctx);
  switch (f) {
    case 'mod': { let a = arg(); if (isConst(a)) a = varLeaf(ctx); return call('mod', [a, num(0.5 + ctx.rng() * 2)]); }
    case 'pow': { let a = arg(); if (isConst(a)) a = varLeaf(ctx); return call('pow', [posify(a, 0, ctx), num(0.5 + ctx.rng() * 2.5)]); }
    case 'step': {
      let a = arg(); if (isConst(a)) a = varLeaf(ctx);
      const iv = intervalOf(a); if (span(iv) > 50) throw new Reject();
      return call('step', [num(iv[0] + ctx.rng() * span(iv)), a]);
    }
    case 'smoothstep': {
      let a = arg(); if (isConst(a)) a = varLeaf(ctx);
      const iv = intervalOf(a); if (span(iv) > 50) throw new Reject();
      const e0 = iv[0] + ctx.rng() * span(iv) * 0.6;
      const e1 = e0 + Math.max(0.1, (iv[1] - e0) * ctx.rng());
      return call('smoothstep', [num(e0), num(e1), a]);
    }
    case 'mix': {
      let a = arg(), b = arg();
      if (isConst(a) && isConst(b)) b = varLeaf(ctx);
      ctx.spatial = true;
      return call('mix', [a, b, vr('r')]);
    }
    default: {
      let a = arg(), b = arg();
      if (isConst(a) && isConst(b)) b = varLeaf(ctx);
      return call(f, [a, b]);
    }
  }
}

function flatOnCanvas(ast: Ast): boolean {
  const p = compile(ast);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const v = evalProgram(p, makeVars(-1 + (i + 0.5) / 4, -1 + (j + 0.5) / 4));
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  return hi - lo < 0.05;
}

/**
 * One fresh expression. Never throws; falls back to `sin(3*x)`.
 * `taken` holds canonical forms already on screen (dedupe).
 */
export function generateExpression(settings: GenSettings, taken: ReadonlySet<string>, rng: () => number = Math.random): string {
  const c = Math.min(1, Math.max(0, settings.complexity));
  for (let tries = 0; tries < 60; tries++) {
    const ctx: Ctx = { rng, w: settings.weights, c, spatial: false, dynamic: false };
    try {
      const budget = Math.max(1, Math.round(1 + 9 * c + (rng() - 0.5) * (2 + 4 * c)));
      let n = gen(budget, ctx);
      if (!ctx.spatial || isConst(n)) continue;
      const iv = intervalOf(n);
      if (!Number.isFinite(iv[0]) || !Number.isFinite(iv[1]) || Math.abs(iv[0]) >= 1e6 || Math.abs(iv[1]) >= 1e6 || span(iv) < 0.05) continue;
      if (!ctx.dynamic && flatOnCanvas(n)) continue;
      if (span(iv) > 6 && !settings.normalize) n = tame(n, 3);
      const src = astToString(n);
      if (taken.has(canonical(src)) && rng() >= 0.08 * Math.pow(0.5, tries)) continue;
      parse(src);                                   // belt and braces: must round-trip
      return src;
    } catch (e) {
      if (e instanceof Reject) continue;
      continue;
    }
  }
  return 'sin(3*x)';
}

export { VARS };
