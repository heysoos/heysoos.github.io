// Recursive-descent parser for input expressions.
//   expr  → term (('+'|'-') term)*
//   term  → unary (('*'|'/') unary)*
//   unary → '-' unary | power
//   power → atom ('^' unary)?
//   atom  → num | '(' expr ')' | ident ['(' args ')']
// No implicit multiplication. Errors carry a character position.
import { VARS, CONSTS, opByName, type VarName, type BinOp } from './optable';

export type Ast =
  | { k: 'num'; v: number }
  | { k: 'var'; name: VarName }
  | { k: 'neg'; a: Ast }
  | { k: 'bin'; op: BinOp; a: Ast; b: Ast }
  | { k: 'call'; fn: string; args: Ast[] };

export interface ParseError { msg: string; pos: number }

/** Thrown by parse/compile: an Error (so test matchers and stack traces work)
 *  whose enumerable fields are exactly a ParseError. */
export class ExprError extends Error implements ParseError {
  msg: string;
  pos: number;
  constructor(msg: string, pos: number) { super(msg); this.msg = msg; this.pos = pos; }
}

type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'end'; v: ''; pos: number };

function fail(msg: string, pos: number): never { throw new ExprError(msg, pos); }

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      const m = /^\d*\.?\d*(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: parseFloat(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if ('+-*/^(),'.includes(c)) { out.push({ t: 'op', v: c, pos: i }); i++; continue; }
    fail(`unexpected “${c}”`, i);
  }
  out.push({ t: 'end', v: '', pos: src.length });
  return out;
}

export function parse(src: string): Ast {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = toks[p]; return t.t === 'op' && t.v === v; };
  const next = () => toks[p++];
  const unexpected = (): never => {
    const u = peek();
    if (u.t === 'end') fail('expression ends early', u.pos);
    fail(`unexpected “${u.v}”`, u.pos);
  };

  function expr(): Ast {
    let a = term();
    while (isOp('+') || isOp('-')) { const op = next().v as BinOp; a = { k: 'bin', op, a, b: term() }; }
    return a;
  }
  function term(): Ast {
    let a = unary();
    while (isOp('*') || isOp('/')) { const op = next().v as BinOp; a = { k: 'bin', op, a, b: unary() }; }
    return a;
  }
  function unary(): Ast {
    if (isOp('-')) { next(); return { k: 'neg', a: unary() }; }
    return power();
  }
  function power(): Ast {
    const a = atom();
    if (isOp('^')) { next(); return { k: 'bin', op: '^', a, b: unary() }; }
    return a;
  }
  function atom(): Ast {
    const t = peek();
    if (t.t === 'end') fail('expression ends early', t.pos);
    if (t.t === 'num') { next(); return { k: 'num', v: t.v }; }
    if (t.t === 'op') {
      if (t.v !== '(') unexpected();
      next();
      const e = expr();
      if (!isOp(')')) unexpected();
      next();
      return e;
    }
    next();
    const name = t.v;
    if (isOp('(')) {
      next();
      const def = opByName(name);
      if (!def) fail(`unknown function “${name}”`, t.pos);
      const args: Ast[] = [];
      if (!isOp(')')) {
        args.push(expr());
        while (isOp(',')) { next(); args.push(expr()); }
      }
      if (!isOp(')')) unexpected();
      next();
      if (args.length !== def.arity) fail(`${name} takes ${def.arity} argument${def.arity === 1 ? '' : 's'}, got ${args.length}`, t.pos);
      return { k: 'call', fn: name, args };
    }
    if (name in CONSTS) return { k: 'num', v: CONSTS[name as 'pi' | 'e'] };
    if ((VARS as readonly string[]).includes(name)) return { k: 'var', name: name as VarName };
    if (opByName(name)) fail(`${name} needs arguments`, t.pos);
    fail(`unknown variable “${name}”`, t.pos);
  }

  const ast = expr();
  if (peek().t !== 'end') unexpected();
  return ast;
}

export function tryParse(src: string): { ast: Ast } | { error: ParseError } {
  try { return { ast: parse(src) }; }
  catch (e) {
    if (e instanceof ExprError) return { error: { msg: e.msg, pos: e.pos } };
    throw e;
  }
}

const PREC: Record<BinOp, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };
const NEG_PREC = 3;

function prec(n: Ast): number {
  if (n.k === 'bin') return PREC[n.op];
  if (n.k === 'neg') return NEG_PREC;
  return 9;
}

export function fmtNum(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** Canonical text: `+`/`-` spaced, `*`/`/`/`^` tight, args joined by `, `. */
export function astToString(n: Ast): string {
  switch (n.k) {
    case 'num': return fmtNum(n.v);
    case 'var': return n.name;
    case 'neg': {
      const a = astToString(n.a);
      return '-' + (prec(n.a) < NEG_PREC ? `(${a})` : a);
    }
    case 'bin': {
      const p = PREC[n.op];
      const lp = prec(n.a), rp = prec(n.b);
      const needL = n.op === '^' ? lp <= p : lp < p;
      const needR = n.op === '^' ? rp < NEG_PREC : (rp < p || (rp === p && (n.op === '-' || n.op === '/')));
      const left = needL ? `(${astToString(n.a)})` : astToString(n.a);
      const right = needR ? `(${astToString(n.b)})` : astToString(n.b);
      if (n.op === '+' || n.op === '-') return `${left} ${n.op} ${right}`;
      return `${left}${n.op}${right}`;
    }
    case 'call': return `${n.fn}(${n.args.map(astToString).join(', ')})`;
  }
}
