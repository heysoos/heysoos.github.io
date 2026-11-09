// AST → stack-machine bytecode. One op per vec4f slot: (opcode, immediate, 0, 0),
// END-terminated. The same program runs on the GPU (wgsl.ts) and in JS (eval-js.ts).
import { OPCODE, OPS, VARS, type BinOp } from './optable';
import { ExprError, type Ast } from './parser';

export const MAX_INPUTS = 8;
export const MAX_OPS = 64;
export const STACK_DEPTH = 16;
/** Channel values are clamped to ±CHANNEL_LIMIT after evaluation (finite-safety only). */
export const CHANNEL_LIMIT = 1e4;

export interface Program {
  /** MAX_OPS × 4 floats; op i at [i*4] = opcode, [i*4+1] = immediate. */
  ops: Float32Array;
  /** Ops emitted, including the END. */
  length: number;
}

const BIN_OPCODE: Record<BinOp, number> = {
  '+': OPCODE.ADD, '-': OPCODE.SUB, '*': OPCODE.MUL, '/': OPCODE.DIV, '^': OPCODE.POW,
};
const FN_OPCODE = new Map(OPS.map((o, i) => [o.name, OPCODE.FN0 + i]));

export function compile(ast: Ast): Program {
  const ops = new Float32Array(MAX_OPS * 4);
  let n = 0;
  let sp = 0;
  const fail = (msg: string): never => { throw new ExprError(msg, 0); };
  const emit = (code: number, imm = 0, push = 1, pop = 0) => {
    if (n >= MAX_OPS - 1) fail('expression too long');          // leave room for END
    ops[n * 4] = code; ops[n * 4 + 1] = imm; n++;
    sp += push - pop;
    if (sp > STACK_DEPTH) fail('expression too deep');
  };
  const walk = (node: Ast): void => {
    switch (node.k) {
      case 'num': emit(OPCODE.PUSH_CONST, node.v); break;
      case 'var': emit(OPCODE.PUSH_VAR, VARS.indexOf(node.name)); break;
      case 'neg': walk(node.a); emit(OPCODE.NEG, 0, 1, 1); break;
      case 'bin': walk(node.a); walk(node.b); emit(BIN_OPCODE[node.op], 0, 1, 2); break;
      case 'call': {
        for (const a of node.args) walk(a);
        const code = FN_OPCODE.get(node.fn);
        if (code === undefined) fail(`unknown function “${node.fn}”`);
        emit(code as number, 0, 1, node.args.length);
        break;
      }
    }
  };
  walk(ast);
  ops[n * 4] = OPCODE.END; n++;
  return { ops, length: n };
}
