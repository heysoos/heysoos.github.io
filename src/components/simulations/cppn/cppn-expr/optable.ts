// The single table of expression ops: name, arity, group, description, the
// JS implementation (thumbnails, range sampling, tests) and the WGSL body
// (shader interpreter). Both implement the same *total* semantics — no op
// can ever produce NaN or Inf from finite inputs — so a typo can never black
// out the canvas. Keep `js` and `wgsl` in lock-step; the WGSL emitter and the
// JS evaluator both read this table so they cannot drift structurally.

export type ExprGroup = 'spatial' | 'dynamic' | 'smooth' | 'discrete' | 'typed';

export const GROUP_COLORS: Record<Exclude<ExprGroup, 'typed'>, string> = {
  spatial:  '#8a8178',
  dynamic:  '#7cb87a',
  smooth:   '#e4833f',
  discrete: '#5aa0d8',
};

export interface OpDef {
  name: string;
  arity: 1 | 2 | 3;
  group: ExprGroup;
  desc: string;
  /** Signature shown as a hint, e.g. `smoothstep(e0, e1, x)`. */
  sig: string;
  js: (...a: number[]) => number;
  /** WGSL expression over `a`, `b`, `c` (f32). */
  wgsl: string;
}

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Safe divide: the divisor is nudged away from 0 on its own side (sign(0) = +1). */
export const safeDiv = (a: number, b: number) => a / (b + 1e-6 * (b < 0 ? -1 : 1));
const safePow = (a: number, b: number) => (a === 0 ? 0 : Math.sign(a)) * Math.pow(Math.abs(a), b);

/** WGSL helpers the op bodies rely on. */
export const WGSL_HELPERS = `
fn safeDiv(a: f32, b: f32) -> f32 { return a / (b + select(1e-6, -1e-6, b < 0.0)); }
fn safePow(a: f32, b: f32) -> f32 { return select(sign(a), 0.0, a == 0.0) * pow(abs(a), b); }
fn sstep(e0: f32, e1: f32, x: f32) -> f32 { let t = clamp(safeDiv(x - e0, e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
`;

export const OPS: readonly OpDef[] = [
  // smooth
  { name: 'sin',   arity: 1, group: 'smooth', desc: 'sine wave',               sig: 'sin(x)',          js: Math.sin,  wgsl: 'sin(a)' },
  { name: 'cos',   arity: 1, group: 'smooth', desc: 'cosine wave',             sig: 'cos(x)',          js: Math.cos,  wgsl: 'cos(a)' },
  { name: 'tanh',  arity: 1, group: 'smooth', desc: 'soft clip to ±1',         sig: 'tanh(x)',         js: v => Math.tanh(clampN(v, -15, 15)), wgsl: 'tanh(clamp(a, -15.0, 15.0))' },
  { name: 'gauss', arity: 1, group: 'smooth', desc: 'bump exp(−x²)',           sig: 'gauss(x)',        js: v => Math.exp(-v * v), wgsl: 'exp(-a * a)' },
  { name: 'abs',   arity: 1, group: 'smooth', desc: 'fold negatives up',       sig: 'abs(x)',          js: Math.abs,  wgsl: 'abs(a)' },
  { name: 'sqrt',  arity: 1, group: 'smooth', desc: 'root of |x|',             sig: 'sqrt(x)',         js: v => Math.sqrt(Math.abs(v)), wgsl: 'sqrt(abs(a))' },
  { name: 'exp',   arity: 1, group: 'smooth', desc: 'exponential growth',      sig: 'exp(x)',          js: v => Math.exp(clampN(v, -20, 20)), wgsl: 'exp(clamp(a, -20.0, 20.0))' },
  { name: 'log',   arity: 1, group: 'smooth', desc: 'log of |x|',              sig: 'log(x)',          js: v => Math.log(Math.abs(v) + 1e-6), wgsl: 'log(abs(a) + 1e-6)' },
  { name: 'length',     arity: 2, group: 'smooth', desc: 'distance √(a²+b²)',  sig: 'length(a, b)',    js: (a, b) => Math.hypot(a, b), wgsl: 'length(vec2f(a, b))' },
  { name: 'min',        arity: 2, group: 'smooth', desc: 'lower of two',       sig: 'min(a, b)',       js: (a, b) => Math.min(a, b), wgsl: 'min(a, b)' },
  { name: 'max',        arity: 2, group: 'smooth', desc: 'higher of two',      sig: 'max(a, b)',       js: (a, b) => Math.max(a, b), wgsl: 'max(a, b)' },
  { name: 'pow',        arity: 2, group: 'smooth', desc: 'sign(a)·|a|^b',      sig: 'pow(a, b)',       js: safePow, wgsl: 'safePow(a, b)' },
  { name: 'mix',        arity: 3, group: 'smooth', desc: 'blend a→b by k',     sig: 'mix(a, b, k)',    js: (a, b, k) => a + (b - a) * k, wgsl: 'mix(a, b, c)' },
  { name: 'smoothstep', arity: 3, group: 'smooth', desc: 'soft edge e0→e1',    sig: 'smoothstep(e0, e1, x)', js: (e0, e1, x) => { const t = clampN(safeDiv(x - e0, e1 - e0), 0, 1); return t * t * (3 - 2 * t); }, wgsl: 'sstep(a, b, c)' },
  // discrete
  { name: 'mod',   arity: 2, group: 'discrete', desc: 'wrap a into [0, b)',    sig: 'mod(a, b)',       js: (a, b) => a - b * Math.floor(safeDiv(a, b)), wgsl: 'a - b * floor(safeDiv(a, b))' },
  { name: 'sign',  arity: 1, group: 'discrete', desc: '−1, 0 or 1',            sig: 'sign(x)',         js: v => Math.sign(v), wgsl: 'sign(a)' },
  { name: 'atan2', arity: 2, group: 'discrete', desc: 'angle of (x, y)',       sig: 'atan2(y, x)',     js: (a, b) => Math.atan2(a, b), wgsl: 'atan2(a, b)' },
  { name: 'fract', arity: 1, group: 'discrete', desc: 'sawtooth x − ⌊x⌋',      sig: 'fract(x)',        js: v => v - Math.floor(v), wgsl: 'fract(a)' },
  { name: 'floor', arity: 1, group: 'discrete', desc: 'round down (stairs)',   sig: 'floor(x)',        js: v => Math.floor(v), wgsl: 'floor(a)' },
  { name: 'step',  arity: 2, group: 'discrete', desc: '0 below edge, 1 above', sig: 'step(edge, x)',   js: (e, x) => (x < e ? 0 : 1), wgsl: 'step(a, b)' },
  // typed-only (parser knows them, generator never emits them)
  { name: 'tan',   arity: 1, group: 'typed', desc: 'tangent (clamped ±20)',    sig: 'tan(x)',          js: v => clampN(Math.tan(v), -20, 20), wgsl: 'clamp(tan(a), -20.0, 20.0)' },
  { name: 'atan',  arity: 1, group: 'typed', desc: 'arctangent',               sig: 'atan(x)',         js: v => Math.atan(v), wgsl: 'atan(a)' },
  { name: 'clamp', arity: 3, group: 'typed', desc: 'limit x to [lo, hi]',      sig: 'clamp(x, lo, hi)', js: (x, lo, hi) => clampN(x, Math.min(lo, hi), Math.max(lo, hi)), wgsl: 'clamp(a, min(b, c), max(b, c))' },
];

export const BINARY = ['+', '-', '*', '/', '^'] as const;
export type BinOp = typeof BINARY[number];
export const BINARY_JS: Record<BinOp, (a: number, b: number) => number> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': safeDiv,
  '^': safePow,
};
export const BINARY_WGSL: Record<BinOp, string> = {
  '+': 'a + b', '-': 'a - b', '*': 'a * b', '/': 'safeDiv(a, b)', '^': 'safePow(a, b)',
};

export const VARS = ['x', 'y', 'r', 'a', 't', 'px', 'py'] as const;
export type VarName = typeof VARS[number];
export const VAR_DESC: Record<VarName, string> = {
  x: 'horizontal', y: 'vertical', r: 'radius', a: 'angle (seam at ±π)',
  t: 'time, wraps every 60 s', px: 'pointer x', py: 'pointer y',
};
export const CONSTS: Record<'pi' | 'e', number> = { pi: Math.PI, e: Math.E };

export const OPCODE = {
  END: 0, PUSH_CONST: 1, PUSH_VAR: 2, NEG: 3,
  ADD: 8, SUB: 9, MUL: 10, DIV: 11, POW: 12,
  FN0: 16,
} as const;

const byName = new Map(OPS.map(o => [o.name, o]));
export function opByName(name: string): OpDef | undefined { return byName.get(name); }
