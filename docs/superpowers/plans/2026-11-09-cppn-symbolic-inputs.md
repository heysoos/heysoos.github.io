# CPPN Symbolic Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CPPN's fixed `x, y, r` inputs with up to 8 user-typed or generated expressions, evaluated by a WGSL bytecode interpreter so edits never recompile the shader, with greyscale thumbnails, an interval-typed generator steered by a probability histogram and complexity slider, group locks, a desktop inputs page and a phone bottom band.

**Architecture:** A new `cppn-expr/` package (op table → parser → bytecode → JS evaluator + WGSL emitter + interval analysis + generator) is pure TypeScript with unit tests. The controller gains a `prog` storage buffer, an expression clock, a pointer, and per-input normalization pairs; the weight layout grows to a fixed 8 input slots so adding inputs is a buffer write. UI is three new modules (desktop inputs page, shared generator block, phone band) plugged into the existing spec-panel / scrub-card wiring in `sim-setup/cppn.ts`.

**Tech Stack:** Astro + TypeScript, WebGPU/WGSL, vitest (new devDependency) for the pure modules, browser pane for UI verification.

**Spec:** `docs/superpowers/specs/2026-11-09-cppn-symbolic-inputs-design.md`

## Global Constraints

- No edit to an expression, input count, generator setting or normalize toggle may call `_ensurePipeline`; `archKey()` stays `layers.map(l => l.width).join(',')`.
- `MAX_INPUTS = 8`, `MAX_OPS = 64`, stack depth 16, channel clamp [−8, 8] before normalization.
- `t = 2π · ((exprClock mod 60) / 60)`; generated `t` harmonics are integers 1..12, generated `a` harmonics integers 1..7; the generator never emits bare `a` or `t`.
- Default inputs `['x', 'y', 'r']`; existing presets load with `normalizeInputs: false` and must render pixel-identically.
- Groups and colours: spatial `#8a8178` (`x y r const`), dynamic `#7cb87a` (`t px py`), smooth `#e4833f` (`a sin cos tanh gauss abs sqrt exp log + − × ÷ length min max pow mix smoothstep`), discrete `#5aa0d8` (`mod sign atan2 fract floor step`). Typed-only: `tan atan clamp`, constants `pi e`.
- Generator presets: default (all 1, discrete 0.15, `t` 0.3, `px`/`py` 0.15), uniform (all 1), smooth (discrete 0, rest as default), static (dynamic 0, rest as default). Complexity default 0.5. Complexity never changes group weights.
- UI copy: "normalize" (z), "Randomize inputs", group names `spatial · dynamic · smooth · discrete`, preset buttons `default · uniform · smooth · static`.
- Desktop panel stays 320px. Panel headers carry no background/blur (CLAUDE.md). Phone band: 300px at rest, 440px while editing, `left/right: 0.5rem`, above the control row; never full width *and* full height.
- Shared panel builders (`cppn-panel.ts` as `buildSpecPanel`, `scrub-panel.ts`) must behave identically for boids and field-boids unless an option is passed.
- Commit after every task; solo project, commit straight to the working branch (worktree per the user's memory).

## Review Focus

1. An expression that parses but is unfinished mid-keystroke (e.g. `sin(3*x +`) — the previous good program must stay live and the canvas must not flash or go black. → test in Task 2 (`compile` on error leaves prior program) and manual check in Task 10.
2. A hand-typed expression that divides by a variable crossing zero (`1 / x`) — every pixel must be finite; the safe divide keeps the sign. → `eval-js` test in Task 2 and WGSL parity test in Task 7.
3. A preset saved before this feature (no `inputs`, old weight length) imported via JSON on the gallery page — must load with `x, y, r`, normalize off, weights re-laid-out, identical image. → Task 8 migration tests + Task 8 manual import check.
4. Randomize with the smooth group drawn to 0 and discrete to 0 — only spatial leaves remain; the generator must still return valid expressions (bare `x`, `y`, `r`) instead of looping or throwing. → Task 5 test `generator survives an all-zero function vocabulary`.
5. Locked input at slot 2 while Randomize is pressed with 5 inputs on screen — slot 2 keeps its text, its lock survives, and the other four never duplicate it. → Task 5 dedupe test and Task 9 randomize test.

---

### Task 0: Test harness (vitest)

**Files:**
- Modify: `package.json` (devDependency `vitest`, script `"test": "vitest run"`)
- Create: `vitest.config.ts`
- Create: `tests/cppn-expr/smoke.test.ts`

- [ ] **Step 1: Install vitest**

Run: `npm i -D vitest@^3`
Expected: `package-lock.json` updated, no peer warnings about astro.

- [ ] **Step 2: Add config and a smoke test**

`vitest.config.ts`: `export default { test: { include: ['tests/**/*.test.ts'], environment: 'node' } }`.
`tests/cppn-expr/smoke.test.ts`: `import { test, expect } from 'vitest'; test('vitest runs', () => expect(1 + 1).toBe(2));`

- [ ] **Step 3: Run**

Run: `npm test`
Expected: `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/cppn-expr/smoke.test.ts
git commit -m "chore: add vitest for pure-module tests"
```

---

### Task 1: Op table and parser

**Files:**
- Create: `src/components/simulations/cppn/cppn-expr/optable.ts`
- Create: `src/components/simulations/cppn/cppn-expr/parser.ts`
- Test: `tests/cppn-expr/parser.test.ts`

**Interfaces:**
- Produces (optable):
  ```ts
  export type ExprGroup = 'spatial' | 'dynamic' | 'smooth' | 'discrete' | 'typed';
  export const GROUP_COLORS: Record<Exclude<ExprGroup,'typed'>, string>;   // the four hex colours above
  export interface OpDef { name: string; arity: 1 | 2 | 3; group: ExprGroup; desc: string; sig?: string; js: (...a: number[]) => number; wgsl: string /* body using a, b, c */ }
  export const OPS: readonly OpDef[];            // every function; opcode = 16 + index
  export const BINARY: readonly ['+','-','*','/','^'];   // opcodes 8..12
  export const VARS: readonly ['x','y','r','a','t','px','py'];   // PUSH_VAR id = index
  export const CONSTS: Record<'pi'|'e', number>;
  export const OPCODE = { END: 0, PUSH_CONST: 1, PUSH_VAR: 2, NEG: 3, ADD: 8, SUB: 9, MUL: 10, DIV: 11, POW: 12, FN0: 16 } as const;
  export function opByName(name: string): OpDef | undefined;
  ```
  `js` bodies implement the safe semantics table from the spec (§1) exactly: `log: v => Math.log(Math.abs(v) + 1e-6)`, `sqrt: v => Math.sqrt(Math.abs(v))`, `pow: (a,b) => Math.sign(a) * Math.pow(Math.abs(a), b)`, `exp: v => Math.exp(Math.max(-20, Math.min(20, v)))`, `tan: v => clamp(Math.tan(v), -20, 20)`, `gauss: v => Math.exp(-v*v)`, `mod: (a,b) => a - b * Math.floor(a / safeDiv(b))`. Safe divide: `a / (b + 1e-6 * (b < 0 ? -1 : 1))`. The `wgsl` string is the same formula in WGSL over `a`, `b`, `c`.
- Produces (parser):
  ```ts
  export type Ast = { k: 'num'; v: number } | { k: 'var'; name: typeof VARS[number] } | { k: 'neg'; a: Ast } | { k: 'bin'; op: '+'|'-'|'*'|'/'|'^'; a: Ast; b: Ast } | { k: 'call'; fn: string; args: Ast[] };
  export interface ParseError { msg: string; pos: number }
  export function parse(src: string): Ast;        // throws ParseError
  export function tryParse(src: string): { ast: Ast } | { error: ParseError };
  export function astToString(ast: Ast): string;  // canonical spacing: `a + b`, `a*b` kept as written? → No: emit `+`/`-` with spaces, `*`,`/`,`^` without; function args joined by `, `
  ```

- [ ] **Step 1: Write failing tests**

```ts
import { parse, tryParse, astToString } from '../../src/components/simulations/cppn/cppn-expr/parser';
test('precedence: ^ binds tighter than unary minus and *', () => {
  expect(astToString(parse('-x^2*3'))).toBe('-x^2*3');
  expect(parse('-x^2').k).toBe('neg');
  expect(parse('2*x^2').k).toBe('bin');
});
test('functions, arity and constants', () => {
  expect(parse('smoothstep(0, 1, r)').k).toBe('call');
  expect(parse('pi').k).toBe('num');
  expect(tryParse('smoothstep(0, r)')).toEqual({ error: { msg: 'smoothstep takes 3 arguments, got 2', pos: 0 } });
  expect(tryParse('sine(x)')).toEqual({ error: { msg: 'unknown function “sine”', pos: 0 } });
  expect(tryParse('sin(3*x +')).toEqual({ error: { msg: 'expression ends early', pos: 9 } });
  expect(tryParse('x $ y')).toEqual({ error: { msg: 'unexpected “$”', pos: 2 } });
  expect(tryParse('q')).toEqual({ error: { msg: 'unknown variable “q”', pos: 0 } });
});
test('no implicit multiplication', () => {
  expect('error' in tryParse('3x')).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/cppn-expr/parser.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `optable.ts` then `parser.ts`** (recursive descent: `expr → term (('+'|'-') term)*`, `term → unary (('*'|'/') unary)*`, `unary → '-' unary | power`, `power → atom ('^' unary)?`, `atom → num | '(' expr ')' | ident ['(' args ')']`). Tokenizer records `pos` per token; errors use the messages above verbatim.

- [ ] **Step 4: Run tests → PASS**

- [ ] **Step 5: Commit** — `feat(cppn-expr): op table and expression parser`

---

### Task 2: Bytecode compiler and JS evaluator

**Files:**
- Create: `src/components/simulations/cppn/cppn-expr/compile.ts`
- Create: `src/components/simulations/cppn/cppn-expr/eval-js.ts`
- Test: `tests/cppn-expr/compile.test.ts`

**Interfaces:**
- Consumes: `Ast`, `OPS`, `OPCODE`, `VARS` from Task 1.
- Produces:
  ```ts
  export const MAX_INPUTS = 8; export const MAX_OPS = 64; export const STACK_DEPTH = 16;
  export interface Program { ops: Float32Array /* length MAX_OPS*4, (opcode, imm, 0, 0) per op, END-terminated */; length: number }
  export function compile(ast: Ast): Program;               // throws { msg: 'expression too long' | 'expression too deep', pos: 0 }
  export interface Vars { x: number; y: number; r: number; a: number; t: number; px: number; py: number }
  export function evalProgram(p: Program, v: Vars): number;  // always finite, clamped to [-8, 8]
  export function makeVars(x: number, y: number, t?: number, px?: number, py?: number): Vars;  // r, a derived
  ```

- [ ] **Step 1: Failing tests**

```ts
test('round trip', () => { const p = compile(parse('sin(3*x + t)')); expect(evalProgram(p, makeVars(0.5, 0, 0))).toBeCloseTo(Math.sin(1.5)); });
test('safe semantics are total', () => {
  for (const [src, v] of [['log(x)', makeVars(-1, 0)], ['sqrt(x)', makeVars(-4, 0)], ['1 / x', makeVars(0, 0)], ['exp(100*x)', makeVars(1, 0)], ['pow(x, 0.5)', makeVars(-1, 0)], ['mod(x, 0)', makeVars(1, 0)], ['tan(pi/2)', makeVars(0,0)]] as const) {
    const out = evalProgram(compile(parse(src)), v);
    expect(Number.isFinite(out)).toBe(true); expect(Math.abs(out)).toBeLessThanOrEqual(8);
  }
  expect(evalProgram(compile(parse('1 / x')), makeVars(-1e-9, 0))).toBeLessThan(0);   // sign kept
});
test('limits', () => {
  expect(() => compile(parse('x + '.repeat(40) + 'x'))).toThrow(/expression too long/);          // 81 ops > 64
  expect(() => compile(parse('x + ('.repeat(17) + 'x' + ')'.repeat(17)))).toThrow(/expression too deep/);   // right-nested: stack height 18 > 16
});
test('program is END-terminated and fits MAX_OPS', () => { const p = compile(parse('x')); expect(p.length).toBe(2); expect(p.ops[(p.length - 1) * 4]).toBe(OPCODE.END); });
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement.** Post-order emit; `'^'` → `POW` using the same safe pow as the function. Depth check via a running stack-height simulation during emit.

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit** — `feat(cppn-expr): bytecode compiler and safe JS evaluator`

---

### Task 3: WGSL emitter

**Files:**
- Create: `src/components/simulations/cppn/cppn-expr/wgsl.ts`
- Test: `tests/cppn-expr/wgsl.test.ts`

**Interfaces:**
- Produces: `export function emitEvalProgram(): string` — WGSL source defining
  ```wgsl
  fn evalProgram(slot: u32, x: f32, y: f32, r: f32, a: f32, t: f32, px: f32, py: f32) -> f32
  ```
  reading `prog[slot * 64u + i]` from `@group(0) @binding(2) var<storage, read> prog : array<vec4f>;` (the binding declaration is emitted too), a `var st: array<f32, 16>`, `var sp = 0u`, a `loop` with `switch u32(op.x)` whose cases come from `OPCODE`/`BINARY`/`OPS` in table order, `break` on END, and the same safe formulas as `optable.ts` (`safeDiv`, clamps). Also `export function wgslPostProcess(): string` = `select(0.0, v, v == v && abs(v) < 1e30)` then `clamp(v, -8.0, 8.0)` as a helper `fn finiteClamp(v: f32) -> f32`.

- [ ] **Step 1: Failing tests**

```ts
test('one case per opcode, in table order', () => {
  const src = emitEvalProgram();
  for (const op of OPS) expect(src).toContain(`case ${OPCODE.FN0 + OPS.indexOf(op)}u`);
  expect(src).toContain('case 11u'); // DIV
  expect(src).toContain('array<f32, 16>');
  expect(src).toContain('@binding(2)');
});
test('no bare division or log in emitted bodies', () => {
  const src = emitEvalProgram();
  expect(src).not.toMatch(/[^f]\/ b\b/);   // every divide goes through safeDiv
  expect(src).toMatch(/log\(abs\(/);
});
```

- [ ] **Step 2: Run → FAIL**; **Step 3: Implement**; **Step 4: Run → PASS**

- [ ] **Step 5: Commit** — `feat(cppn-expr): WGSL stack-machine emitter`

---

### Task 4: Interval analysis

**Files:**
- Create: `src/components/simulations/cppn/cppn-expr/interval.ts`
- Modify: `optable.ts` — add `range: (child intervals) => Interval` and `dom?: (child: Interval) => boolean` per op
- Test: `tests/cppn-expr/interval.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Interval = [lo: number, hi: number];
  export const VAR_RANGES: Record<typeof VARS[number], Interval>;   // x,y,px,py [-1,1]; r [0, √2]; a [-π, π]; t [0, 2π]
  export function intervalOf(ast: Ast): Interval;                     // never NaN; may be ±Infinity for typed-only pathological cases
  ```
  Rules per spec §4: trig on wide intervals → [−1,1] (check critical points otherwise), `gauss` via squared interval, `log`/`sqrt` monotone on their (already-safe) argument, `exp` monotone, products/quotients from the four corners (quotient assumes divisor excludes 0; otherwise returns the safe-divide bound [−1e6, 1e6]), `min/max` componentwise, `length` from squared intervals, `mix(a,b,k)` hull of a and b, `smoothstep`/`step`/`fract` → [0,1], `floor` → [floor lo, floor hi], `sign` → [−1,1] subset, `atan2` → [−π, π].

- [ ] **Step 1: Failing tests**

```ts
const I = (s: string) => intervalOf(parse(s));
test('leaves and trig', () => { expect(I('x')).toEqual([-1, 1]); expect(I('r')[1]).toBeCloseTo(Math.SQRT2); expect(I('sin(7*x)')).toEqual([-1, 1]); expect(I('sin(0.5*x)')[1]).toBeCloseTo(Math.sin(0.5)); });
test('domain-shifted children stay finite', () => { const [lo, hi] = I('log(r + 1.37)'); expect(lo).toBeCloseTo(Math.log(1.37)); expect(Number.isFinite(hi)).toBe(true); });
test('products', () => { expect(I('x * y')).toEqual([-1, 1]); expect(I('gauss(2*r)')).toEqual([expect.closeTo(Math.exp(-8), 5), 1]); });
```

- [ ] **Step 2 → 4: FAIL, implement, PASS**

- [ ] **Step 5: Commit** — `feat(cppn-expr): interval analysis over the canvas`

---

### Task 5: Expression generator

**Files:**
- Create: `src/components/simulations/cppn/cppn-expr/generator.ts`
- Test: `tests/cppn-expr/generator.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4.
- Produces:
  ```ts
  export type GenItem = typeof VARS[number] | 'const' | typeof BINARY[number] | string /* op name */;
  export const GEN_ITEMS: readonly GenItem[];                     // everything the histogram shows, grouped order: spatial, dynamic, smooth, discrete
  export const GEN_GROUP: Record<GenItem, Exclude<ExprGroup,'typed'>>;   // 'a' → 'smooth'
  export type Weights = Record<GenItem, number>;                  // 0..1
  export const GEN_PRESETS: Record<'default'|'uniform'|'smooth'|'static', () => Weights>;
  export interface GenSettings { weights: Weights; complexity: number /* 0..1 */; normalize: boolean }
  export function generateExpression(settings: GenSettings, taken: ReadonlySet<string>, rng?: () => number): string;  // never throws; falls back to 'sin(3*x)'
  export function canonical(src: string): string;                 // whitespace stripped, for dedupe
  export function nodeCount(ast: Ast): number;
  ```
  Behaviour per spec §4: typed intervals via `intervalOf` on partial trees; `posify`/`tame`; `periodic a/t` harmonics; node budget `round(1 + 9c + (rng()-0.5)*(2+4c))`; early-stop `(1-c)*0.35`; kind weights `unary 1.5+4c`, `binary 2+3.5c`, `nary 0.3+3c`, `scaled 5-3c`; rejections (no spatial var, non-finite or <0.05 interval, flat 8×8 sample without dynamic var, constant-only child/arg, dedupe accept `0.08·0.5^retry`); 60 tries; span > 6 gets a leading `k*(…)` only when `normalize` is false; negative phases print as `- 1.1`.

- [ ] **Step 1: Failing tests** (seeded rng = mulberry32 copied from `cppn-controller.ts`'s `makePRNG`)

```ts
const S = (over: Partial<GenSettings> = {}): GenSettings => ({ weights: GEN_PRESETS.default(), complexity: 0.5, normalize: true, ...over });
test('500 rolls parse, are in-domain and spatial', () => {
  for (let i = 0; i < 500; i++) {
    const src = generateExpression(S(), new Set(), rng);
    const ast = parse(src); const [lo, hi] = intervalOf(ast);
    expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true);
    expect(/\b[xyr]\b|\ba\b/.test(src)).toBe(true);
    walk(ast, n => { if (n.k === 'call' && (n.fn === 'log')) expect(intervalOf(n.args[0])[0]).toBeGreaterThan(0.05);
                     if (n.k === 'call' && n.fn === 'sqrt') expect(intervalOf(n.args[0])[0]).toBeGreaterThanOrEqual(0);
                     if (n.k === 'bin' && n.op === '/') { const [l, h] = intervalOf(n.b); expect(l > 0 || h < 0).toBe(true); } });
    expect(src).not.toMatch(/(^|[^*\d.])a\b(?!\s*[*)])/);     // no bare a
    expect(src).not.toMatch(/(^|[^*\d.])t\b(?!\s*[*)])/);     // no bare t
    expect(src).not.toMatch(/\+ -/);
  }
});
test('zero weight means never', () => { const w = GEN_PRESETS.default(); w.sin = 0; w.cos = 0; for (let i = 0; i < 200; i++) expect(generateExpression(S({ weights: w }), new Set(), rng)).not.toMatch(/\b(sin|cos)\(/); });
test('complexity moves node count', () => { const avg = (c: number) => mean(Array.from({ length: 300 }, () => nodeCount(parse(generateExpression(S({ complexity: c }), new Set(), rng))))); expect(avg(0)).toBeLessThan(3); expect(avg(1)).toBeGreaterThan(6); });
test('dedupe', () => { const taken = new Set(['x', 'y', 'r']); let dup = 0; for (let i = 0; i < 400; i++) if (taken.has(canonical(generateExpression(S({ complexity: 0 }), taken, rng)))) dup++; expect(dup / 400).toBeLessThan(0.12); });
test('generator survives an all-zero function vocabulary', () => { const w = GEN_PRESETS.uniform(); for (const k of GEN_ITEMS) if (GEN_GROUP[k] === 'smooth' || GEN_GROUP[k] === 'discrete') w[k] = 0; expect(() => parse(generateExpression(S({ weights: w }), new Set(), rng))).not.toThrow(); });
test('presets', () => { const d = GEN_PRESETS.default(); expect(d.mod).toBe(0.15); expect(d.t).toBe(0.3); expect(d.px).toBe(0.15); expect(GEN_PRESETS.smooth().mod).toBe(0); expect(GEN_PRESETS.static().t).toBe(0); expect(GEN_GROUP.a).toBe('smooth'); });
```

- [ ] **Step 2 → 4: FAIL, implement, PASS**

- [ ] **Step 5: Commit** — `feat(cppn-expr): interval-typed expression generator`

---

### Task 6: Normalization range measurement

**Files:**
- Create: `src/components/simulations/cppn/cppn-expr/range.ts`
- Test: `tests/cppn-expr/range.test.ts`

**Interfaces:**
- Produces: `export function measureRange(p: Program, ast: Ast): { lo: number; hi: number; mid: number; half: number }` — 24×24 grid over x, y ∈ [−1, 1]; if the ast references `t` sample 8 phases of `t` in [0, 2π); if it references `px`/`py` sample pointer at (0,0) and the four corners; union of all, clamped inside `intervalOf(ast)`; `half = max((hi−lo)/2, 1e-6)`. Also `export function usesVars(ast: Ast): Set<string>`.

- [ ] **Step 1: Failing tests**

```ts
test('x is unchanged by normalization', () => { const r = measureRange(compile(parse('x')), parse('x')); expect(r.mid).toBeCloseTo(0, 5); expect(r.half).toBeCloseTo(1, 2); });
test('time-invariant for t', () => { const a = parse('sin(2*t) + x'); const r = measureRange(compile(a), a); expect(r.lo).toBeCloseTo(-2, 1); expect(r.hi).toBeCloseTo(2, 1); });
test('r maps 0..√2', () => { const a = parse('r'); const r = measureRange(compile(a), a); expect(r.lo).toBeCloseTo(0, 1); expect(r.hi).toBeCloseTo(Math.SQRT2, 1); });
```

- [ ] **Step 2 → 4**; **Step 5: Commit** — `feat(cppn-expr): unit-square range measurement for normalization`

---

### Task 7: Runtime — layout, shader, controller

**Files:**
- Modify: `src/components/simulations/cppn/cppn-codegen.ts`
- Modify: `src/components/simulations/cppn/cppn-controller.ts`
- Modify: `src/components/simulations/cppn/cppn-types.ts` (`CPPNConfig.inputs: string[]`, `normalizeInputs: boolean`; `normalizeConfig` fills defaults `['x','y','r']` / `false`)
- Modify: `src/lib/sim-page/sim-setup/cppn.ts` — add `if (import.meta.env.DEV) (window as any).__cppn = ctrl;` at the top of `setupCPPN` (used by the pixel check)
- Test: `tests/cppn-expr/layout.test.ts`

**Interfaces:**
- Produces (codegen): `WeightLayout.wInOffset` replaces `wxOffset/wyOffset/wrOffset` (`wIn + k*w0 + i`, k = 0..MAX_INPUTS−1); `weightGroups` yields two input groups per neuron then the four z groups; `generateShader` emits `emitEvalProgram()`, a `Params` struct extended **after `view`** with `numInputs: u32, exprTime: f32, normFlag: u32, _pad: u32, pointer: vec4f, norm: array<vec4f, 4>` and the fragment prologue
  ```wgsl
  var inp: array<f32, 8>;
  let a_ = atan2(cy, cx);
  for (var i = 0u; i < 8u; i++) {
    if (i < params.numInputs) { var v = finiteClamp(evalProgram(i, cx, cy, cr, a_, params.exprTime, params.pointer.x, params.pointer.y));
      if (params.normFlag != 0u) { let n = params.norm[i / 2u]; let mid = select(n.x, n.z, (i & 1u) == 1u); let half = select(n.y, n.w, (i & 1u) == 1u); v = (v - mid) / half; }
      inp[i] = v; } else { inp[i] = 0.0; }
  }
  let in0 = vec4f(inp[0], inp[1], inp[2], inp[3]); let in1 = vec4f(inp[4], inp[5], inp[6], inp[7]);
  ```
  and `h0_i = act(dot(in0, wv[s]) + dot(in1, wv[s+1]) + z dots)`.
  `export function migrateWeightsFromXYR(old: Float32Array, config: CPPNConfig): Float32Array` — re-lays an old-layout array (3 input columns) into the new one (8 columns, zeros in 3..7), copying hidden/output blocks to their new offsets.
- Produces (controller): `PARAMS_FLOATS = 4 + Z_DIM + 8 + 4 + 4 + 4 + 16` (160 floats); `setInputs(exprs: string[]): InputCompileResult[]` where `InputCompileResult = { ok: true; range: {lo,hi,mid,half} } | { ok: false; error: ParseError }` — compiles each with Tasks 1/2/6, writes `progBuffer` (binding 2, `MAX_INPUTS*MAX_OPS*16` bytes, created in `init`) and stores norm pairs; on a per-input error keeps that slot's previous program; `setNormalize(on: boolean)`; `exprClock` advanced by `dt` in `tick` when `!paused`, reset in `reset()` and `resetLatent()`; `pointer: [number, number]` with `setPointerWorld(x, y)`; `bindPointer(canvas)` mapping client → world via `viewExtent()` + `viewCx/Cy` (hover and single pointer move; hold last on leave). `_rebuildBindGroup` adds binding 2. `generateWeights` fills **all 8** `wIn` columns with `sample(1, w0)` (so an input added later already has weights, deterministic from the seed); columns ≥ `numInputs` are harmless because the shader feeds them 0. Migrated/exact weights are used as given, with their zero columns 3..7 — so when `setInputs` *grows* the count on a preset that carries exact weights, fill any all-zero new column from `makePRNG(seed ^ (0xa11ce + k))` with the current distribution and re-upload (buffer write, no recompile); never touch columns that already hold values.
- Produces (types): `CPPNConfig.inputs`, `CPPNConfig.normalizeInputs`.

- [ ] **Step 1: Capture reference frames BEFORE touching code.** Start `preview_start {name:"dev"}`, open `/gallery/cppn`. For each built-in preset id, run in the page (via `javascript_tool`): load the preset through the panel's pill (or `__cppn.loadPreset`) — note `__cppn` does not exist yet, so for the *reference* run add the DEV hook first as its own commit — then `__cppn.config.motion.depth = 0; __cppn.resetLatent(); __cppn.resetView(); __cppn.pause();` wait two frames, draw the WebGPU canvas into a 2D canvas (`ctx.drawImage(simCanvas,0,0)`), `getImageData`, and hash (FNV-1a over the bytes). Save `{id: hash}` to `tests/fixtures/cppn-reference-hashes.json`. Commit: `test(cppn): reference frame hashes for the input-layout migration`.

- [ ] **Step 2: Failing layout tests**

```ts
test('layout has 8 input columns and total grows by 5*w0', () => { const cfg = cfgWith(layers [32,32,32]); const L = computeWeightLayout(cfg); expect(L.wInOffset).toBe(0); expect(L.wzOffset).toBe(8 * 32); expect(L.totalCount).toBe(oldTotal(cfg) + 5 * 32); });
test('packed slot count: 2 input groups + 4 z groups per neuron', () => { expect(packedSlotCount(cfg, L)).toBe(32 * 6 + hiddenSlots + outSlots); });
test('migrateWeightsFromXYR preserves values and zeroes new columns', () => { const old = oldLayoutRandom(cfg); const nw = migrateWeightsFromXYR(old, cfg); expect(nw[L.wInOffset + 0*32 + 5]).toBe(old[5]); expect(nw[L.wInOffset + 2*32 + 5]).toBe(old[2*32 + 5]); expect(nw[L.wInOffset + 3*32 + 5]).toBe(0); expect(nw[L.hiddenWeightOffsets[0] + 7]).toBe(old[oldL.hiddenWeightOffsets[0] + 7]); });
test('params uniform offsets', () => { expect(PARAMS_FLOATS).toBe(160); });
```
(Export `PARAMS_FLOATS` for the test; `oldTotal`/`oldLayoutRandom` reimplement the pre-change formula inline in the test.)

- [ ] **Step 3: Run → FAIL**

- [ ] **Step 4: Implement codegen, types, controller.** Default `inputs` in `defaultConfig()`: `['x','y','r']`, `normalizeInputs: false` (the default preset is a built-in; new-preset default `true` is applied in Task 8's `DEFAULT_FLAT`). In `init`, after the pipeline: `this.setInputs(this.config.inputs)`. In `setState`: when `weights.length` equals the **old** layout total for this architecture, run `migrateWeightsFromXYR`.

- [ ] **Step 5: Run unit tests → PASS**

- [ ] **Step 6: Pixel check.** Repeat Step 1's procedure against the new build; compare hashes with `tests/fixtures/cppn-reference-hashes.json`. Expected: every built-in identical. If any differ, the culprit is the input weight packing or the `select` in normalization (normFlag must be 0 for built-ins); fix before continuing.

- [ ] **Step 7: Live-edit check.** In the page: `__cppn.setInputs(['sin(4*x)', 'y', 'r'])` — image changes immediately, `__cppn['compiledArch']` unchanged, no `.sim-busy` on the viewport, console clean. `__cppn.setInputs(['1/x','y','r'])` — no black pixels (sample a few via the 2D canvas).

- [ ] **Step 8: Commit** — `feat(cppn): expression inputs runtime — 8-slot layout, bytecode interpreter, expression clock, pointer`

---

### Task 8: Data model, presets, migration script

**Files:**
- Modify: `src/components/simulations/cppn/cppn-spec.ts` — `CPPNFlatParams.normalizeInputs: number`, `DEFAULT_FLAT.normalizeInputs = 1`, `Z_INPUTS` → `paramCount(layers, nInputs = 3)` uses `(nInputs + 16)`; `CPPNBody = PresetBody & { weights?: number[]; inputs?: string[] }`; `toFlat`/`configFromFlat` carry `normalizeInputs`; `presetToBody` copies `inputs`; `flatParamCount(f, nInputs)`.
- Modify: `src/components/simulations/cppn/cppn-types.ts` — `CPPNPreset.inputs?: string[]`, `normalizeInputs?: boolean` (nested type, written by the admin save).
- Modify: `src/lib/sim-page/sim-setup/cppn.ts` — binding `capture()` adds `inputs: [...ctrl.config.inputs]`; `apply()` calls `ctrl.setInputs(b.inputs ?? ['x','y','r'])` and `ctrl.setNormalize(b.params.normalizeInputs !== 0)`; `prepare(body)` pins `body.inputs[i]` to the controller's current for every locked `input${i}`.
- Modify: `src/components/simulations/cppn/cppn-randomize.ts` — `fanIns = [nInputs + 16, ...]`, budget uses active inputs.
- Create: `scripts/migrate-cppn-weights.mjs` — reads `src/data/cppn-presets.ts` + `src/data/cppn-weights/*.json`, rewrites each weights JSON through `migrateWeightsFromXYR` (import the TS via `node --experimental-strip-types` or duplicate the pure function in the script with a test asserting equality), adds `"inputs": ["x","y","r"], "normalizeInputs": false` to each preset entry. Run once; commit the regenerated data.
- Test: `tests/cppn-expr/spec.test.ts`

**Interfaces:**
- Consumes: `migrateWeightsFromXYR`, `setInputs`, `setNormalize` (Task 7).
- Produces: flat key `normalizeInputs`; body extra `inputs`; lock keys `input0..input7`.

- [ ] **Step 1: Failing tests**

```ts
test('toFlat/configFromFlat carry normalizeInputs', () => { const f = toFlat({ ...cfg, normalizeInputs: true }, 1, true); expect(f.normalizeInputs).toBe(1); expect(configFromFlat(cfg, { ...f, normalizeInputs: 0 }).normalizeInputs).toBe(false); });
test('presetToBody carries inputs and defaults', () => { expect(presetToBody({ ...legacyPreset }).inputs).toEqual(['x','y','r']); expect(presetToBody({ ...legacyPreset }).params.normalizeInputs).toBe(0); });
test('paramCount counts active inputs only', () => { expect(paramCount([{width: 32, activation:'tanh'}], 3)).toBe(19 * 32 + 3 * 32); expect(paramCount([{width: 32, activation:'tanh'}], 8)).toBe(24 * 32 + 3 * 32); });
```

- [ ] **Step 2 → 4: FAIL, implement, PASS**

- [ ] **Step 5: Run the migration script**, then `npm run build` (type check), then rerun the Task 7 pixel check with the regenerated built-ins (they now load without the runtime migration). Expected: all hashes identical.

- [ ] **Step 6: Import check.** On the gallery page import a JSON preset exported *before* this feature (export one from the reference build in Task 7 Step 1 and keep it in `tests/fixtures/cppn-legacy-preset.json`). Expected: loads, inputs `x y r`, normalize off, same image hash as its built-in twin.

- [ ] **Step 7: Commit** — `feat(cppn): inputs and normalizeInputs in presets; migrate built-in weights to the 8-slot layout`

---

### Task 9: Randomize surfaces, locks, generator settings store

**Files:**
- Create: `src/components/simulations/cppn/cppn-expr/settings.ts` — `loadGenSettings(): GenSettings` / `saveGenSettings(s)` under localStorage `cppn:generator` (weights + complexity; `normalize` is NOT stored here, it is a preset param).
- Modify: `src/components/simulations/cppn/cppn-randomize.ts` — `export function randomizeInputs(current: string[], lockedSlots: ReadonlySet<number>, settings: GenSettings, rng?): string[]` (keeps locked slots, passes locked + already-rolled into `taken`).
- Modify: `src/lib/sim-page/sim-setup/cppn.ts` — `randomize()` also rolls inputs (unless `group:Network` or `group:Inputs` locked) and calls `setInputs`; new `randomizeInputsOnly()`; group-lock expansion: `effectiveLockedKeys()` = `mgr.locks.keys()` plus every key of a group whose `group:<Name>` is locked (Network → `layers`, `layerNWidth/Act`, `input0..7`; Weights → `WEIGHT_KEYS`; Motion → motion keys; View → `scale`).
- Modify: `src/pages/gallery/[...slug].astro:522` — `else if (k === "r") (controls?.querySelector(e.shiftKey ? '[data-action="randomize"]:not([hidden])' : '[data-action="reset"]') as HTMLElement | null)?.click();`
- Test: `tests/cppn-expr/randomize.test.ts`

- [ ] **Step 1: Failing tests**

```ts
test('randomizeInputs keeps locked slots and never duplicates them', () => { const out = randomizeInputs(['x','y','sin(2*x)','r','a'], new Set([2]), S(), rng); expect(out[2]).toBe('sin(2*x)'); expect(out.length).toBe(5); const c = out.map(canonical); expect(new Set(c).size).toBeGreaterThanOrEqual(4); });
test('settings round trip', () => { saveGenSettings({ ...S(), complexity: 0.7 }); expect(loadGenSettings().complexity).toBe(0.7); });   // use a Map-backed localStorage shim in the test
```

- [ ] **Step 2 → 4: FAIL, implement, PASS**

- [ ] **Step 5: Manual:** on `/gallery/cppn`, press `R` → only the Seed row changes; `Shift+R` → layers, weights, motion **and** the `in` row thumbnails change; alt-click the Motion header (after Task 10) then Shift+R → motion rows unchanged.

- [ ] **Step 6: Commit** — `feat(cppn): Randomize rolls inputs; Shift+R full roll; group-aware locks; generator settings store`

---

### Task 10: Desktop UI — generator block, inputs page, `in` row, group locks

**Files:**
- Create: `src/components/simulations/cppn/cppn-generator-ui.ts` — `buildGeneratorBlock(container, { settings: () => GenSettings; onChange(s: GenSettings): void; compact: boolean }): { refresh(): void; dispose(): void }`: complexity row (`createMeterRow`-style slider, label `complexity`), preset buttons row (`default · uniform · smooth · static`, `.look-segmented`), histogram canvas (`.gen-hist`, DPR-aware, redraw on `ResizeObserver`), legend. Histogram API: `drawHistogram(canvas, weights, { openGroup?: string, onSet(item, w), onTouch(item, w) })` shared by phone. Desktop mode: all 31 bars in four tinted bands, labels 10px mono under bars (abbreviations `sstep`, `len`), pointer drag paints, snap `round(w*20)/20`, `<0.04 → 0`.
- Create: `src/components/simulations/cppn/cppn-inputs-panel.ts` — `buildInputsPage(container, api: InputsApi): { refresh(): void; dispose(): void }` where
  ```ts
  export interface InputsApi {
    inputs(): string[]; setInput(i: number, src: string): InputCompileResult; addInput(): void; removeInput(i: number): void;
    results(): InputCompileResult[];            // last compile result per slot
    normalize(): boolean; setNormalize(on: boolean): void;
    isLocked(i: number): boolean; setLocked(i: number, on: boolean): void;
    genSettings(): GenSettings; setGenSettings(s: GenSettings): void;
    randomizeInputs(): void; commit(label: string): void; back(): void;
    thumbnail(i: number, size: number): HTMLCanvasElement;   // painted by eval-js, fixed window mid-grey = 0
  }
  ```
  Layout per spec §6: `.fb-head` (‹ · INPUTS · spacer · ⚄ Randomize inputs · ×), `.fb-scroll` with the generator block, a `.inputs-head` line (`INPUTS · N of 8` + normalize toggle), rows (44px thumb, mono field, status line, ×; hover padlock; alt-click lock), `+ add input` (disabled at 8), variables chips. Autocomplete: `attachExprAutocomplete(input, { onAccept })` — prefix list from `OPS`+`VARS` with descriptions, ↑↓ Tab/Enter Esc, inserts `name()` with the caret inside and steps over an existing `)` when `)` is typed (same bracket behaviour as the phone keypad); signature hint inside a call with the current arg underlined (`openFn()` logic from the mockup).
- Modify: `src/components/simulations/cppn/cppn-panel.ts` — `CPPNPanelOpts.groupLocks?: boolean` (alt-click `h6.fb-group` toggles `group:<name>`, header gets `.locked` + ghost tag on hover; wraps each group in `div.fb-grp` so the tint can be applied) and `CPPNPanelOpts.inputsPage?: (container) => { dispose(): void }` plus `setMode('main'|'inputs')` on the handle; `renderNetworkRows` gets a 4th param `opts?: { inputsRow?: { count(): number; thumbs(): HTMLCanvasElement[]; onOpen(): void } }` that replaces the static `in` row with the filmstrip button.
- Modify: `src/lib/sim-page/sim-setup/cppn.ts` — wire `InputsApi` over `ctrl` + `mgr` (undo entries: `commit('Input')`, `'Add input'`, `'Remove input'`, `'Normalize'`, `'Randomize inputs'`); pass `groupLocks: true`.
- Modify: `src/styles/sim-page.css` — `.fb-grp.locked` tint (`border-left: 2px solid var(--accent); background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 10%, transparent), color-mix(in srgb, var(--accent) 3.5%, transparent) 60%, transparent)`), `.fb-group .lk-tag` ghost/visible, `.inputs-*` rows, `.gen-hist`, autocomplete list `.expr-ac`, `.cppn-layer.in` filmstrip.

- [ ] **Step 1: Build the generator block and inputs page against a stub `InputsApi` in a scratch Astro page?** No — wire directly in `sim-setup/cppn.ts` and verify in the browser pane (no DOM test runner in this repo).

- [ ] **Step 2: Implement** the three modules and the wiring.

- [ ] **Step 3: Verify in the browser pane (desktop viewport 1400×900, `/gallery/cppn`):**
  - `in` row shows 3 thumbnails and "3 inputs ›"; click → body swaps, header reads ‹ INPUTS … Randomize inputs; panel width still 320.
  - Type `s` in a row → list with `sin(`, `sign(`, `smoothstep(`, `sqrt(`, `step(`; Tab inserts `sin(` and the hint `sin(x)` appears; break the expression → red border + message with position; canvas keeps the last image.
  - Draw on the histogram → bars snap; "default" restores; reload page → weights persisted.
  - Toggle normalize → thumbnails and canvas change; `range … → −1 … 1` suffix toggles.
  - Alt-click **Motion** header → tint + "🔒 locked", "N locked" chip increments; Shift+R leaves motion rows alone.
  - Screenshot each state.

- [ ] **Step 4: Commit** — `feat(cppn): desktop inputs page, generator histogram, in-row filmstrip, group locks`

---

### Task 11: Phone band

**Files:**
- Create: `src/components/simulations/cppn/cppn-inputs-band.ts` — `createInputsBand(host, api: InputsApi & { onClose(): void }): { show(): void; hide(): void; isVisible(): boolean; dispose(): void }`. Three views (`list`, `edit`, `generator`) per spec §7: header (‹ · INPUTS · `list|generator` segmented · spacer · ⚄ inputs), left-edge sliver `.band-edge`, header handle; list = two columns (rows + `ALL INPUTS` header with normalize toggle + 2×2 tiles + hint); edit = field (`inputmode="none"`, rendered caret, ghost `)`), signature/error line, 92px thumb, 7-column keypad exactly as the spec grid, `ƒ(…)` drawer (groups from `GEN_GROUP`/`OPS`, colour bar per group, desc under name); generator = complexity, one-line presets, two-level histogram via `drawHistogram(canvas, w, { openGroup })` with group bars at rest (mean + value inside when full) and `‹ all groups`, readout line. Gestures: edge swipe-right (28px start, 70px threshold) = back; header swipe-down (60px) = `onClose`; row swipe-left reveals delete; long-press row/tile/group header 480ms = lock; band follows finger 0.6×/0.8×. Keys: `)` steps over `)`, implicit `*` after digit/`)`/variable, `done` → list.
- Modify: `src/lib/sim-page/sim-setup/cppn.ts` — on phones the `in` row's `onOpen` hides the scrub card (`setScrubOpen(false)` without persisting) and shows the band; band `back`/`onClose` → `show scrub` / nothing. Main scrub card header: swipe-down and swipe-left on `.scrub-head` close it (`onClose`), rows excluded.
- Modify: `src/styles/sim-page.css` — `.inputs-band` (position absolute, `left/right: .5rem; bottom: calc(.5rem + 40px + 8px); height: 300px; .edit { height: 440px }`, material = `.scrub-list` rules), keypad grid, drawer, `.scrub-list, .inputs-band { touch-action: pan-y pinch-zoom }` (CPPN page only: scope under `.sim-cppn` added to the viewport by `setupCPPN`).

- [ ] **Step 1: Implement.**

- [ ] **Step 2: Verify in the browser pane at the mobile preset (375×812, touch emulation):**
  - ⚙ → card; tap `in` → card hides, band appears at 300px with ~45% canvas visible above; list shows 3 rows + tiles.
  - Tap a row → band 440px, keypad; tap `ƒ(…)` → drawer; tap `smoothstep(` → field shows `smoothstep(|)` with hint `smoothstep(e0, e1, x)`; tap `x` `,` → implicit `*` logic not triggered after `(`; after `)` tap `x` → `)*x`.
  - `generator` → four group bars with values; tap smooth → 17 labelled bars, staggered labels readable in a zoomed screenshot; drag paints; `‹ all groups`.
  - Edge swipe right from list → band slides out, card returns. Header swipe down → band closes.
  - Long-press a row → padlock; swipe left → delete reveals.
  - `javascript_tool`: `getComputedStyle(document.querySelector('.inputs-band')).touchAction` → `"pan-y pinch-zoom"`.
  - Reset viewport with `preset: "desktop"` afterwards.

- [ ] **Step 3: Commit** — `feat(cppn phone): inputs bottom band with keypad, function drawer, two-level histogram and gestures`

---

### Task 12: Admin page, help card, docs

**Files:**
- Modify: `src/pages/admin/cppn.astro` — `buildCPPNPanel(..., { inputsPage, groupLocks: true })` via a `directBinding`-style `InputsApi` (no history: `commit` is a no-op); `capturePreset()` in the controller includes `inputs` and `normalizeInputs` (Task 7 already stores them on `config`; confirm the save endpoint writes them since it serialises the preset object).
- Modify: `src/lib/sim-page/sim-setup/cppn.ts` `helpSections` — Canvas rows unchanged; Parameters rows add `{ glyph: 'hp-lock', label: touch ? 'hold header' : 'alt + click header', effect: 'lock whole group' }`; new section `Inputs`: `in` row opens inputs · `ƒ` drawer (touch) / type for autocomplete (mouse) · swipe right = back, swipe down = close (touch); Keys row effect → `'pause / new seed / hide UI'` plus `{ label: 'shift R', effect: 'randomize everything' }`.
- Modify: `CLAUDE.md` — one gotcha bullet: expression inputs are a bytecode program in a storage buffer (`cppn-expr/`), 8 fixed slots, never a recompile; `t` wraps at 60 s on the expression clock; normalize ranges are over the unit square; generator taste is a device setting.
- Modify: `docs/superpowers/specs/2026-11-09-cppn-symbolic-inputs-design.md` — status `implemented`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify:** `/admin/cppn` shows the `in` row and inputs page; saving writes `inputs`/`normalizeInputs` into `src/data/cppn-presets.ts` (then `git checkout` the data files unless a preset was intentionally changed). `?` card on `/gallery/cppn` lists the new rows on both pointer types.
- [ ] **Step 3: `npm run build` passes; `npm test` passes.**
- [ ] **Step 4: Commit** — `feat(cppn): admin inputs editing, help card rows, docs`

---

## Self-review notes

- Spec coverage: §1 → T1/T2; §2 → T3/T7; §3 → T6/T7/T8; §4 → T5; §5 → T9/T10/T11; §6 → T10; §7 → T11; §8–9 → T8; §12 (R/Shift+R, `a` smooth, normalize placement) → T9/T5/T10–11; §13 builder items → T12 and T7 Step 7.
- Names used across tasks: `InputCompileResult`, `setInputs`, `setNormalize`, `GenSettings`, `GEN_GROUP`, `drawHistogram`, `InputsApi`, `migrateWeightsFromXYR`, `measureRange` — defined once each in their Interfaces block.
- Review Focus items are pinned: 1 → T2 + T10 step 3; 2 → T2 + T7 step 7; 3 → T8 steps 6; 4 → T5; 5 → T5 + T9.
