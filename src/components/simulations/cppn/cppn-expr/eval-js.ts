// JS interpreter for compiled programs — the oracle the shader is checked
// against, and what paints thumbnails and samples normalization ranges.
import { OPCODE, OPS, BINARY_JS, VARS, type VarName } from './optable';
import { STACK_DEPTH, type Program } from './compile';

export type Vars = Record<VarName, number>;

/** Canvas-space variables: r and a derived from x, y; t, px, py default 0. */
export function makeVars(x: number, y: number, t = 0, px = 0, py = 0): Vars {
  return { x, y, r: Math.hypot(x, y), a: Math.atan2(y, x), t, px, py };
}

const BIN_FNS = [BINARY_JS['+'], BINARY_JS['-'], BINARY_JS['*'], BINARY_JS['/'], BINARY_JS['^']];

/** Always finite, clamped to [-8, 8] (the shader's finiteClamp). */
export function evalProgram(p: Program, v: Vars): number {
  const st = new Float64Array(STACK_DEPTH);
  let sp = 0;
  const ops = p.ops;
  for (let i = 0; i < p.length; i++) {
    const code = ops[i * 4], imm = ops[i * 4 + 1];
    if (code === OPCODE.END) break;
    if (code === OPCODE.PUSH_CONST) { st[sp++] = imm; continue; }
    if (code === OPCODE.PUSH_VAR) { st[sp++] = v[VARS[imm | 0]]; continue; }
    if (code === OPCODE.NEG) { st[sp - 1] = -st[sp - 1]; continue; }
    if (code >= OPCODE.ADD && code <= OPCODE.POW) {
      const b = st[--sp], a = st[sp - 1];
      st[sp - 1] = BIN_FNS[code - OPCODE.ADD](a, b);
      continue;
    }
    const def = OPS[code - OPCODE.FN0];
    if (!def) break;
    if (def.arity === 1) st[sp - 1] = def.js(st[sp - 1]);
    else if (def.arity === 2) { const b = st[--sp]; st[sp - 1] = def.js(st[sp - 1], b); }
    else { const c = st[--sp], b = st[--sp]; st[sp - 1] = def.js(st[sp - 1], b, c); }
  }
  const out = sp > 0 ? st[sp - 1] : 0;
  if (!Number.isFinite(out)) return 0;
  return out < -8 ? -8 : out > 8 ? 8 : out;
}
