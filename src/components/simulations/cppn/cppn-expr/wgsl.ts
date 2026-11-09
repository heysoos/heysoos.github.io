// Emits the WGSL stack-machine interpreter from the op table, so the shader
// and the JS evaluator share one source of truth for opcodes and semantics.
import { OPS, OPCODE, BINARY, BINARY_WGSL, WGSL_HELPERS } from './optable';
import { MAX_OPS, STACK_DEPTH, CHANNEL_LIMIT } from './compile';

const ARG = ['a', 'b', 'c'];

/** `finiteClamp`: non-finite → 0, then clamp to ±CHANNEL_LIMIT. The bound is
 *  only there to keep values finite: raw coordinates (|x| ≈ 9 at scale 5, far
 *  more zoomed out) must pass through unchanged so old presets stay identical. */
export function wgslPostProcess(): string {
  return `
fn finiteClamp(v: f32) -> f32 {
  let f = select(0.0, v, v == v && abs(v) < 1e30);
  return clamp(f, -${CHANNEL_LIMIT.toFixed(1)}, ${CHANNEL_LIMIT.toFixed(1)});
}
`;
}

/**
 * `fn evalProgram(slot, x, y, r, a, t, px, py) -> f32` reading
 * `prog[slot * MAX_OPS + i]` from binding 2. Uniform control flow: the program
 * is the same for every pixel, so the switch takes one path per op.
 */
export function emitEvalProgram(): string {
  const binOps = [OPCODE.ADD, OPCODE.SUB, OPCODE.MUL, OPCODE.DIV, OPCODE.POW];
  let cases = '';
  cases += `      case ${OPCODE.PUSH_CONST}u: { st[sp] = op.y; sp++; }\n`;
  cases += `      case ${OPCODE.PUSH_VAR}u: {\n        var v = 0.0;\n        switch u32(op.y) {\n`;
  const vars = ['x', 'y', 'r', 'a', 't', 'px', 'py'];
  vars.forEach((v, i) => { cases += `          case ${i}u: { v = ${v}; }\n`; });
  cases += `          default: { v = 0.0; }\n        }\n        st[sp] = v; sp++;\n      }\n`;
  cases += `      case ${OPCODE.NEG}u: { st[sp - 1u] = -st[sp - 1u]; }\n`;
  BINARY.forEach((op, i) => {
    cases += `      case ${binOps[i]}u: { let b = st[sp - 1u]; let a = st[sp - 2u]; sp--; st[sp - 1u] = ${BINARY_WGSL[op]}; }\n`;
  });
  OPS.forEach((def, i) => {
    const code = OPCODE.FN0 + i;
    const n = def.arity;
    let body = '';
    for (let k = n - 1; k >= 0; k--) body += `let ${ARG[k]} = st[sp - ${n - k}u]; `;
    if (n > 1) body += `sp -= ${n - 1}u; `;
    body += `st[sp - 1u] = ${def.wgsl};`;
    cases += `      case ${code}u: { ${body} }\n`;
  });

  return `
@group(0) @binding(2) var<storage, read> prog : array<vec4f>;
${WGSL_HELPERS}
fn evalProgram(slot: u32, x: f32, y: f32, r: f32, a: f32, t: f32, px: f32, py: f32) -> f32 {
  var st: array<f32, ${STACK_DEPTH}>;
  var sp = 0u;
  let base = slot * ${MAX_OPS}u;
  for (var i = 0u; i < ${MAX_OPS}u; i++) {
    let op = prog[base + i];
    let code = u32(op.x);
    if (code == ${OPCODE.END}u) { break; }
    switch code {
${cases}      default: { }
    }
    sp = min(sp, ${STACK_DEPTH - 1}u);
  }
  return select(0.0, st[max(sp, 1u) - 1u], sp > 0u);
}
`;
}
