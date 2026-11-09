// Normalization range of a channel over the canonical unit square, sampled
// with the JS evaluator and clamped inside the interval bound. Channels that
// read t / px / py are sampled over 8 time phases and 5 pointer positions and
// the union taken, so the range never moves as time runs or the pointer moves.
import type { Ast } from './parser';
import type { Program } from './compile';
import { evalProgram, makeVars } from './eval-js';
import { intervalOf, usesVars } from './interval';

export interface Range { lo: number; hi: number; mid: number; half: number }

// 24 points per axis including both edges (x spans the full [-1, 1]) but,
// with an even count, never the exact centre: 1/x, log(r) and friends are
// sampled next to their singularity (|x| ≥ 1/23), not on it, so a
// normalized channel keeps its contrast instead of collapsing onto the spike.
const GRID = 24;
const T_PHASES = Array.from({ length: 8 }, (_, i) => (2 * Math.PI * i) / 8);
const POINTERS: [number, number][] = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

export function measureRange(p: Program, ast: Ast): Range {
  const used = usesVars(ast);
  const ts = used.has('t') ? T_PHASES : [0];
  const ps = used.has('px') || used.has('py') ? POINTERS : [[0, 0] as [number, number]];
  let lo = Infinity, hi = -Infinity;
  for (const t of ts) for (const [px, py] of ps) {
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const x = -1 + (2 * i) / (GRID - 1), y = -1 + (2 * j) / (GRID - 1);
      const v = evalProgram(p, makeVars(x, y, t, px, py));
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const [ilo, ihi] = intervalOf(ast);
  lo = Math.max(lo, ilo); hi = Math.min(hi, ihi);
  if (!(lo <= hi)) { lo = Math.min(lo, hi); hi = lo; }
  return { lo, hi, mid: (lo + hi) / 2, half: Math.max((hi - lo) / 2, 1e-6) };
}

export { usesVars };
