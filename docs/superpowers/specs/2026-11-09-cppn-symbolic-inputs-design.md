# CPPN symbolic inputs — design

**Date:** 2026-11-09
**Status:** reviewed; awaiting approval
**Mockups:** `.superpowers/brainstorm/606-1794196289/content/` — `cppn-inputs.html` (expression editor + generator), `cppn-panel-integration.html` (desktop panel), `cppn-phone-band-v2.html` (phone band)

## Intent

The CPPN today feeds the network a fixed input vector: `x`, `y`, `r`, and sixteen latent `z` dims driven by the motion ladder. This feature replaces the fixed spatial trio with a user-defined list of **input expressions** — short formulas over `x, y, r, a, t, px, py` such as `sin(3*x + t)` or `cos(6*a) * gauss(2*r)` — so the network sees whatever coordinate system the user invents. Each expression is rendered as a greyscale thumbnail so the user can see what the network sees.

Two things make this worth building rather than a curiosity:

1. **Live.** Editing an expression must never recompile the shader. The CPPN already treats weights and activations as buffer writes; inputs must be the same. Every keystroke redraws.
2. **Generative.** A Randomize for inputs that produces interesting, well-behaved expressions, with the user steering its taste through a probability histogram and a complexity slider. This is the part the user is most excited about: "a great way to include more and stranger functions in the future".

## Goals

- Up to **8** input expressions per preset, edited live, no shader recompile on edit, add or remove.
- Every expression is **total and finite**: no NaN or Inf can ever reach the network, whether typed or generated.
- **Greyscale thumbnail** per input (rows, filmstrip in the Network block, large tile while editing on phone).
- **Expression generator** with: four colour-coded groups (spatial, dynamic, smooth, discrete), a drawable per-function probability histogram with presets, a complexity slider, per-input locks, de-duplication, and interval-typed construction so every generated expression is in-domain by construction.
- **Normalize** toggle: each channel is mapped to [−1, 1] before entering the network.
- **Group locks**: alt-click (desktop) / long-press (phone) a group header locks the whole group through Randomize, with a clear but subtle tint.
- Desktop: inputs mode is a drilled-in page inside the existing 320px panel. Phone: inputs mode is a bottom band that leaves ~45% of the canvas visible, with its own keypad.
- Presets carry inputs; existing presets keep rendering identically.

## Non-goals

- Desmos-style rendered math (fractions, superscripts). Plain text with hints.
- An "evolve / mutate" mode. Randomize always produces fresh expressions. (Easy later; the interval machinery supports it.)
- Expression inputs for other sims.
- Changing the `z` motion ladder. It stays as is, alongside the expression inputs.
- Hand-editing of generated weights; `weights` stays a body extra as today.

## Anti-goals

- Any edit path that triggers `_ensurePipeline`. If the design needs a recompile for anything other than layer widths changing, it is wrong.
- A phone layout that takes the full width *and* full height. The user rejected that explicitly.
- Dynamic/discrete behaviour that depends on the complexity slider. Complexity controls expression *size*; the histogram alone controls *which* functions and variables appear.
- Illegible histogram labels. If a label can't be read, the histogram is useless.

## Constraints

- WebGPU / WGSL; one shared `GPUDevice`; pipelines are expensive, buffers are cheap.
- Expression inputs must work in the gallery thumbnail warm-up and the admin page with no special casing beyond defaults.
- Preset files are auto-generated (`src/data/cppn-presets.ts`); format changes go through `FORMAT_VERSION` + `MIGRATIONS`.
- Phone panel conventions from CLAUDE.md apply: no header tint on desktop panels, header outside the scroller, `touch-action` discipline, `createRangeSlider` for coarse pointers.

---

## 1. Expression language

### Variables

| name | meaning | range on canvas |
|---|---|---|
| `x`, `y` | clip-space coordinates after view transform (same as today's `x`, `y` inputs) | [−1, 1] |
| `r` | `length(x, y)` | [0, √2] |
| `a` | `atan2(y, x)` | (−π, π] — has a seam; see §4 |
| `t` | wrapped time: `2π · ((elapsed mod P) / P)`, **P = 60 s** | [0, 2π) |
| `px`, `py` | pointer position in the same space as `x`, `y`; (0, 0) when no pointer | [−1, 1] |
| `pi`, `e` | constants | — |

Time is **wrapped** so float32 precision never degrades and `exp(t)`, `t*t`, `pow(x, t)` stay bounded forever. Typed expressions that use `t` non-periodically see one jump per minute; the generator never emits such expressions (§4).

### Functions

| group | functions |
|---|---|
| smooth | `sin cos tanh gauss abs sqrt exp log` · `+ − × ÷ ^` · `length min max pow mix smoothstep` |
| discrete | `mod sign atan2 fract floor step` |
| typed-only (parser knows them, generator never emits them) | `tan atan clamp` |

`gauss(x) = exp(−x²)`. `^` is `pow`. Function arities and the one-line descriptions shown in UI live in one table (§6).

### Grammar

Standard infix: `+ − * / ^`, unary minus, parentheses, numeric literals, identifiers, function calls with comma-separated args. Precedence: `^` (right-assoc) > unary minus > `* /` > `+ −`. Implicit multiplication is **not** parsed; the phone keypad inserts `*` for you (§8).

Parse errors carry a character position and a message (`unknown function "sine"`, `smoothstep takes 3 arguments, got 2`, `expression ends early`). The last good program stays active while the field is in error.

### Safe runtime semantics (total functions)

The WGSL and JS evaluators implement these, identically:

| op | implemented as |
|---|---|
| `log(x)` | `log(abs(x) + 1e-6)` |
| `sqrt(x)` | `sqrt(abs(x))` |
| `pow(a, b)` | `sign(a) · pow(abs(a), b)` |
| `exp(x)` | `exp(clamp(x, −20, 20))` |
| `a / b` | `a / (b + 1e-6 · sign(b))`, with `sign(0)` treated as +1 |
| `mod(a, b)` | `a − b · floor(a / b)` with the safe divide |
| `tan(x)` | `clamp(tan(x), −20, 20)` |
| `tanh`, `sigmoid` | argument clamped as the activation functions already do |

After evaluation each channel value passes through `select(0, v, isFinite(v))` and is clamped to [−8, 8] before normalization. A black canvas from a typo is impossible.

---

## 2. Runtime: bytecode interpreter in WGSL

Expressions are compiled on the CPU to a **stack-machine program** and written to a storage buffer. The fragment shader runs a fixed loop over the program. The pipeline never changes.

### Program encoding

- Storage buffer `prog: array<vec4f>`, binding 2 (next free). Fixed region per input: `MAX_INPUTS = 8` inputs × `MAX_OPS = 64` ops; one op per `vec4f` = `(opcode, immediate, 0, 0)`. 8 × 64 × 16 B = 8 KiB. Over-budget expressions fail to compile with a clear message ("expression too long"); 64 ops is ~20 nested calls, far beyond what fits in a field.
- Uniform additions, **appended after `view`** so existing offsets (`PARAMS_FLOATS`, `ACTS_OFFSET`) stay valid; keep `packUniforms()` and the WGSL struct in sync: `numInputs: u32`, `exprTime: f32` (the wrapped `t`), `pointer: vec2f`, `normFlag: u32`, and `norm: array<vec4f, 4>` = per-input `(mid, half)` pairs packed two inputs per vec4.
- `exprTime` is **not** wall-clock: the controller accumulates frame `dt` into an expression clock the same way the motion ladder integrates, so `t` freezes on pause (the display pass keeps redrawing with the frozen value), resumes without a jump, and resets to 0 on reset **and on the minimap double-tap** (`resetLatent()` in `cppn-gestures.ts` also zeroes the expression clock, so one gesture returns both the latent and `t` to their origin).
- `pointer` is the pointer position mapped through the view transform into the same space as `x`, `y` (world space, like field-boids). The controller gains a `bindPointer(canvas)` like the other sims': hover and single-touch update it; it **holds its last value** on pointer leave / touch end (never snaps to (0, 0), which would pop the image), and starts at (0, 0). It coexists with the existing wheel/space/alt pan and two-finger pinch: those gestures still work and also move the pointer, which is fine.
- Opcodes: `PUSH_CONST imm`, `PUSH_VAR id` (x, y, r, a, t, px, py), binary ops, one opcode per function. Stack depth ≤ 16, `array<f32, 16>` in the shader, statically indexed by a loop-carried `sp`.
- The program is identical for every pixel, so the `switch` is uniform control flow and the GPU takes one path per op. Cost: a 30-op expression is a fraction of one hidden layer.

### Evaluation in the shader

```
for (var i = 0u; i < params.numInputs; i++) {
  var v = evalProgram(i, x, y, r, a, t, px, py);   // loop over prog[i*64 ..], switch per opcode, breaks on END
  v = select(0.0, v, isFinite(v));
  v = clamp(v, -8.0, 8.0);
  if (params.normFlag != 0u) { v = (v - mid(i)) / half(i); }
  inputs[i] = v;
}
```

`inputs: array<f32, 8>`; unused slots are 0 and their weights are 0.

### Weight layout change

`computeWeightLayout` / `weightGroups`: the per-neuron spatial group `(cx, cy, cr, PAD)` becomes **two** vec4 groups covering 8 input weights (`wInOffset + k·w0 + i`, k = 0..7). `Z_DIM` groups follow unchanged. Weight **count** no longer depends on how many inputs are in use, so adding or removing an input is a buffer write of a few zeros, never a layout change. `Z_INPUTS` in `cppn-spec.ts` becomes `MAX_INPUTS + 16` for the layout, but the **weight-budget note and Randomize's budget count only the active inputs** (`inputs.length + 16`), so a three-input preset keeps today's budget.

**Default inputs are `x`, `y`, `r`** (slots 0–2), which reproduces today's images exactly when normalization is off (§3). Existing presets' `weights` arrays are migrated by inserting five zero columns per input neuron (see §9).

### Where each piece lives

- `cppn-expr/` (new folder under `src/components/simulations/cppn/`): `lexer-parser.ts` (string → AST), `optable.ts` (the single table of ops: name, arity, group, description, WGSL body, JS impl, interval rule), `compile.ts` (AST → bytecode), `eval-js.ts` (bytecode → number, used for thumbnails, range sampling and tests), `interval.ts` (AST → [lo, hi], §4), `generator.ts` (§4), `wgsl.ts` (emits the `evalProgram` function and the opcode `switch` from `optable.ts` so the two evaluators cannot drift).
- `cppn-codegen.ts` includes the emitted `evalProgram` in the generated shader; it is architecture-independent, so it does not enter `archKey()`.
- Controller: `setInputs(exprs: string[])` compiles, writes `prog` and the norm pairs, and returns per-input compile results; `inputs` becomes part of `CPPNConfig`.

---

## 3. Normalization

Per-input affine map to [−1, 1]: `v' = (v − mid) / half` where `[lo, hi]` is the channel's range over the canvas, `mid = (lo+hi)/2`, `half = max((hi−lo)/2, 1e-6)`.

- The range is computed over the **canonical unit square** x, y ∈ [−1, 1]², never over the current view, aspect or zoom. So it is a property of the expression alone: resizing the window, zooming or panning never changes `mid`/`half`, and `x`, `y` pass through normalization literally unchanged.
- The range comes from the **interval analysis tightened by sampling**: interval bounds (§4) are an over-estimate, so a 24×24 sample of the JS evaluator over the unit square supplies the actual `[lo, hi]`, clamped inside the interval. The same pass produces the "range a … b → −1 … 1" readout under each row.
- Channels that use `t`, `px` or `py` are **time-invariant by construction**: for those the sample runs over 8 phases of `t` and 5 pointer positions (centre and four corners) and takes the union, so the range never changes as time runs or the pointer moves, and nothing is re-sampled per frame. `mid`/`half` are recomputed only when an expression changes.
- `normalizeInputs: boolean` is a **preset param** (default `true` for new presets; migration sets `false` on existing presets so they render identically). It is one global toggle labelled "normalize" that sits **with the input rows, not in the generator block**: on desktop in the small header line above the rows (next to the input count), on phone in the list view's right-column header. It belongs to the inputs, not to the generator's taste.
- Thumbnails use a **fixed window**: mid-grey = 0, black = −1, white = +1, values outside clip. With normalization off, a 0.3-span channel renders nearly flat grey and a 3.5-span one burns out, which is exactly the information the toggle is for.
- `x`, `y` are unchanged by normalization (already [−1, 1]); `r` maps from [0, √2] to [−1, 1].

Rationale: the first layer multiplies each input by a random weight; without normalization a wide channel dominates every hidden unit and narrow ones vanish, which defeats Randomize.

---

## 4. Expression generator

### Shape

A grammar-based generator producing an AST with a **node budget**, where every subtree carries an interval `[lo, hi]` over the canvas (x, y ∈ [−1, 1], r ∈ [0, √2], sin/cos ∈ [−1, 1], gauss ∈ (0, 1], etc.). A function is applied only where its domain contains the child's interval; otherwise the child is first **shifted** (`posify`: `(child + k)` so `lo ≥ min`) or **scaled** (`tame`: `k * child` so `hi ≤ max`). Consequences:

- `log` and `sqrt` only ever see positive children (`log(r + 1.37)`), divisors are bounded away from zero (`x / (y + 1.78)`), `pow` gets a non-negative base and a constant exponent in [0.5, 3], `exp`'s argument is capped at 4, `mod` uses a positive constant modulus, `step`/`smoothstep` edges are placed inside the child's actual range so an edge always appears on screen, `mix`'s blend is `r`.
- Interval rules per op are part of `optable.ts`, which is what makes "add a stranger function later" a one-row change.

### Seams: `a` and `t`

The generator never emits bare `a` or `t`. It emits `sin(k·a + φ)` / `cos(k·a)` with **integer k ∈ 1..7** (continuous around the circle) and `sin(k·t + φ)` / `cos(k·t)` with **integer k ∈ 1..12** (continuous across the 60 s wrap; periods 60 s down to 5 s). Hand-typed bare `a`/`t` remain available and have seams; that is the user's choice.

### Groups and probabilities

Every generatable item belongs to exactly one group with a colour:

| group | colour | items |
|---|---|---|
| spatial | grey `#8a8178` | `x y r const` |

(`a` is a variable but is listed under smooth because, as generated, it behaves like one.)
| dynamic | green `#7cb87a` | `t px py` |
| smooth | ember `#e4833f` | `sin cos tanh gauss abs sqrt exp log + − × ÷ length min max pow mix smoothstep`, and `a` (always emitted as a seamless harmonic, §Seams) |
| discrete | blue `#5aa0d8` | `mod sign atan2 fract floor step` |

Each item has a weight in [0, 1] (0 = never). Weighted choice among the applicable candidates at every decision. Presets:

| preset | weights |
|---|---|
| **default** | everything 1, discrete 0.15, `t` 0.3, `px`/`py` 0.15 |
| uniform | everything 1 |
| smooth | discrete 0, rest as default |
| static | dynamic 0, rest as default |

The weights (and complexity) are **device settings** in localStorage (`cppn:generator`), not preset params — they describe the user's taste, not an image. **Complexity never alters group weights.** The user was explicit: dynamic and discrete content is controlled only by the histogram.

### Complexity c ∈ [0, 1], default 0.5

Three coupled effects:

1. Node budget ≈ `round(1 + 9c + jitter)`, jitter width growing with c. c = 0 gives 1–2 nodes (`x`, `r`, `sin(2.1*y)`); c = 1 gives 6–12.
2. Early stop: at every node a `(1 − c) · 0.35` chance of emitting a leaf regardless of budget — what keeps low complexity at bare variables.
3. Kind weights shift: unary `1.5 + 4c`, binary `2 + 3.5c`, n-ary `0.3 + 3c`, "scaled leaf" idiom (`sin(k·x)`) `5 − 3c`.

Depth alone is a poor proxy (`sin(a)+sin(b)+sin(c)` is shallow but busy; `tanh(tanh(tanh(x)))` is deep but trivial); node count plus early stopping models what the user described.

### Rejection and de-duplication

A roll is rejected and retried (up to 60 times, falling back to `sin(3*x)`) when: it contains no spatial variable; its interval is non-finite or narrower than 0.05; a sampled 8×8 evaluation is flat (span < 0.05) and it uses no dynamic variable; any function argument or unary child is a bare constant; or it is **identical** (whitespace-insensitive) to an expression already on screen, which is accepted only with probability `0.08 · 0.5^retry`. Expressions whose interval span exceeds 6 get a leading scale factor when normalization is off. Negative phase constants format as `− 1.1`, not `+ -1.1`.

### Randomize surfaces

- **Randomize inputs** (inputs mode header): re-rolls every unlocked input expression only.
- **`R` key**: re-rolls the **weights only** (a new seed; buffer write, never a recompile). This is what `R` / ↺ already do on the CPPN page (the setup relabels reset to "new seed"); unchanged.
- **Shift+R, the panel-header dice and the control-bar dice**: roll **everything** unlocked — architecture, weights, motion and input expressions — honouring row and group locks.

---

## 5. Locks

- **Per input**: lock keys `input0..input7` in the existing `param-locks` store. Desktop: alt-click the row / click the padlock that appears on hover over the thumbnail. Phone: long-press the row or its tile. Locked rows show a padlock over the thumbnail and an accent outline; they survive Randomize and are passed into the generator's de-dup set.
- **Group locks**: a group lock is stored as its own entry (`group:Network`, `group:Weights`, `group:Motion`, `group:View`, `group:Inputs`) so items added to the group later are covered. Desktop: alt-click the group header; the header shows a ghosted "🔒 locked" on hover so the affordance is discoverable. Phone: long-press the header (480 ms, haptic tick where available). Locked group styling: 2px accent hairline on the left, an accent wash fading right (`linear-gradient(90deg, rgba(accent, .10), rgba(accent, .035) 60%, transparent)`), rows at 78% opacity, "🔒 locked" in the header, and the existing "N locked ×" chip counts the group as one. Randomize and `prepare()` treat every key in a locked group as locked.
- Locking `Network` locks layer widths, activations, order **and** the inputs (the `in` row is part of the Network block). The normalize toggle is never randomized, so it needs no lock.
- Storage: the `param-locks` store stays shared. `prepare()` currently drops keys the sim doesn't know; the CPPN spec layer declares its extra lock keys (`input0..7`, `group:*`) through a new optional `extraLockKeys` on the sim's lock binding so they survive. Group-lock UI is an **opt-in** of `buildSpecPanel` / the scrub list (`opts.groupLocks`), enabled for the CPPN only in this feature; boids and field-boids are untouched.

---

## 6. Desktop UI

Lives in the existing 320px `.params-panel` built by `buildSpecPanel` / `cppn-panel.ts`. **No width change** (the user compared 320 vs 400 and chose 320).

**Main mode** is today's panel. The Network block's `in` row (currently `x · y · r · z 16`, unclickable) becomes a button: a filmstrip of up to six 16px thumbnails, `+N` overflow, and "N inputs ›". Clicking it swaps the panel body to inputs mode. Header shape is unchanged.

**Inputs mode** (same `.fb-head` + `.fb-scroll` shell; header: `‹` · INPUTS · spacer · `⚄ Randomize inputs` · `×`):

1. **Generator block**: complexity slider on one line; "probabilities" with the four preset buttons on one line; the histogram; a legend line.
2. **Histogram** (canvas, device-pixel-ratio aware, redrawn on resize): four visually separated bands with tinted backgrounds and group names; 31 bars at ~9px; labels under the bars at 10px mono, abbreviated when needed (`sstep`, `len`). Draw with the pointer to set bars (snap to 0.05, below 0.04 → 0); a bar at 0 renders dimmed. The user's weights persist (device setting).
3. **Rows**, under a small line reading `INPUTS · N of 8` with the "normalize" toggle at its right: 44px thumbnail (click to enlarge to 128px, click again to shrink), one-line mono text field, a status line (`range −0.99 … 0.99 → −1 … 1`, or the parse error in red with position), `×` remove. Padlock appears on hover over the thumbnail.
4. **Autocomplete**: typing letters opens a list of prefix matches (functions show `name(`, variables plain, one-line descriptions right-aligned), ↑↓ to move, Tab/Enter to accept, Esc to close. Accepting a function inserts `name(` and the caret stays inside. Inside a call, a signature hint shows with the current argument underlined. Implemented as a small custom widget, not CodeMirror — one-line fields don't need an editor, and the panel already has its own look.
5. `+ add input` (disabled at 8), then a variables line whose chips insert at the caret.

Rebuilds preserve `.fb-scroll` scrollTop as today. Thumbnails are painted by the JS evaluator at 32² (rows) / 16² (filmstrip) / 96² (enlarged), from the same bytecode the GPU runs.

---

## 7. Phone UI — the bottom band

Inputs mode on phones is a **band over the bottom of the canvas**: `left/right: 0.5rem`, above the control row, **300px tall at rest, 440px while editing**, same material as the scrub card. It uses the geometry the boids Audio strip already has (`min(40vh, 320px)` band), not the full card. About 45% of the canvas stays visible. The 180px scrub card is hidden while the band is up; `‹` brings it back.

Header: `‹` · INPUTS · a `list | generator` segmented switch · spacer · `⚄ inputs`. A faint 28px handle sits at the header's top edge (swipe-down affordance); a 3px accent sliver, ~35% opaque, 36px tall, sits on the band's left edge (swipe-right affordance).

### List view (at rest)

Two columns. Left: rows of 34px thumbnail + expression (ellipsised) + range line, then `+ add input`. Right: an "ALL INPUTS" header line with the "normalize" toggle at its right, a 2×2 grid of larger tiles so a roll reads at a glance, and a hint line. Tap a row or a tile to edit. Long-press locks. **Swipe left** on a row reveals a red delete; tapping it deletes.

### Edit view

The band grows to 440px. Top: the expression field (mono, 13px, caret rendered by us, dim ghost `)` while a bracket is open), the signature hint / error line, and a 92px live thumbnail with the range under it. Below: the band's **own keypad** — the field is `inputmode="none"` so the phone keyboard never opens:

```
 x    y    r    a    t    px   py
 7    8    9    (    )    ,    ^
 4    5    6    +    −    ×    ÷
 1    2    3    .    ←    →    ⌫
 0    pi  [ ƒ(…) ]    [  done  ]
```

38px keys, 7 columns, nothing scrolls. `ƒ(…)` opens a **function drawer** over the band listing every function grouped and colour-coded with a one-line description; tapping inserts `name()` with the caret inside. `)` over an existing `)` steps past it. A variable after a digit, `)` or another variable inserts `*` first. `done` returns to the list.

### Generator view

Line 1: complexity slider. Line 2: the four presets as one segmented control (`default · uniform · smooth · static`). Then the histogram at two levels:

- **Groups** (at rest): four wide bars labelled with the group name and its mean weight, values drawn inside the bar when it's full. Drag across group bars to set every member at once.
- **Open group**: tap a group bar; its members fill the width with horizontal labels, staggered on two baselines when a group has more than nine members (smooth has 17), abbreviated where needed. Tap or drag to set bars. A readout line shows `name · value` on any touch. `‹ all groups` button and the edge swipe go back.

### Gestures

| gesture | effect | conflict avoided |
|---|---|---|
| swipe right from the left edge (first 28px) | back: open group → groups; edit → list; list → leave inputs mode (band slides out, scrub card returns) | histogram painting and row swipes happen elsewhere; iOS convention |
| swipe down on the header | close the band entirely | list columns scroll; only the header is a handle |
| swipe left on a row | reveal delete | rows have no sideways scrub in this list |
| long-press row / tile / group header | lock | no sideways scrub to time out against |
| swipe left or down on the **main scrub card**'s header or on non-row areas (group headers, gaps) | close the card | numeric rows scrub sideways, so rows are excluded; tap-outside remains the primary close |

The band follows the finger a little during edge/handle drags (0.6×/0.8×) and snaps back under threshold (70px right / 60px down).

### Pinch-zoom

The viewport meta already permits scaling, but every card element sets `touch-action: pan-y`, which blocks pinch. Change the scrub card and the band to `touch-action: pan-y pinch-zoom` so native browser zoom works on the UI. No custom UI-scale setting unless native zoom feels wrong in practice.

---

## 8. Data model and presets

- `CPPNConfig` gains `inputs: string[]` (1–8) and `normalizeInputs: boolean`.
- Flat view (`cppn-spec.ts`): `normalizeInputs` is a numeric flat key (0/1, enum `segmented`, lives in the generator block rather than a group list); `inputs` is a **body extra** like `weights` (strings, not sliders), carried through presets, undo/redo and import/export unchanged. Dirty check includes it.
- Migration is **CPPN-specific**, in the CPPN body normalizer (`normalizeConfig` / `presetToBody`), not in the global `FORMAT_VERSION`/`MIGRATIONS` mechanism, which is shared with boids and field-boids and has no sim id. Rule: missing `inputs` → `['x', 'y', 'r']`, missing `normalizeInputs` → `false`, and `weights` of the old layout **re-laid-out in full** into the 8-slot layout (the layer-0 block grows from 3 to 8 columns per neuron, which shifts every hidden and output offset; detected by `weights.length` matching the old `computeWeightLayout` total).
- Built-in presets: `inputs` and `normalizeInputs` become plain fields on `CPPNPreset` in `src/data/cppn-presets.ts`; the weight JSONs in `cppn-weights/` are rewritten **once by a script** into the new layout (same values, new positions), so built-ins load without the runtime migration and render pixel-identically. The admin save endpoint writes the new fields.
- Generator taste (`weights` per item, `complexity`) → localStorage `cppn:generator`. Not in presets, not touched by Randomize.
- Locks → existing `presets:cppn:locks`, with the new `inputN` and `group:*` keys.
- Thumbnails never persist.

---

## 9. Migration and defaults

- New preset / reset: inputs `['x', 'y', 'r']`, normalize **true**, generator default preset, complexity 0.5.
- Existing presets (built-in and the user's saved ones): inputs `['x', 'y', 'r']`, normalize **false**, weights carried over into the new layout with the same values. **Pixel-identical to today** — this is a hard requirement, verified by rendering every built-in before and after and diffing.
- Gallery thumbnail and the home page (if the CPPN is ever used there) need nothing: defaults are the old behaviour.

---

## 10. Decided by the user (and why)

- **No recompile on edit** → bytecode interpreter, fixed 8-slot weight layout. "Huge" for them; recompile friction is the thing they are fighting.
- **Plain text with autocomplete**, not rendered math.
- **Thumbnails as greyscale fields** — they loved it immediately; it carries the whole UI.
- **Fresh expressions** on Randomize, not mutations.
- **Four groups**: smooth vs discrete (`mod sign atan2 fract step floor`), plus a **dynamic** group for `t px py`, separate from spatial. `a` counts as smooth.
- **Dynamic/discrete only via the histogram**, never via complexity.
- **Default taste**: smooth + rare discrete + rare dynamics, normalized, medium complexity.
- **Histogram grouped visually** by category, with legible labels; presets on one line; spelled "normalize".
- **Desktop panel stays 320px**; inputs mode is a drilled-in page from the `in` row; **group locks** via alt-click header with a visible-but-subtle tint.
- **Phone: bottom band (option B)**, explicitly not full-width-and-full-height; **keypad instead of chips** because chips did not fit.
- **Gestures**: swipe right = back, swipe down = close, swipe left closes the main card, each with a subtle cue.
- Interval-typed generation and `exp`/`log` in the smooth group: "sounds really cool".

## 11. My calls (reviewable)

- `P = 60 s` for the time wrap; integer harmonics 1..12 for generated `t`, 1..7 for `a`.
- `MAX_INPUTS = 8`, `MAX_OPS = 64`, stack depth 16, clamp [−8, 8] before normalization.
- Normalization range = interval tightened by a 24×24 sample over the current view; re-sampled when the view changes meaningfully (zoom/pan end), not per frame.
- Custom one-line autocomplete widget on desktop, not CodeMirror.
- Band heights 300 / 440 px; keypad layout as drawn; `ƒ` drawer replaces autocomplete on phones.
- Pointer `px, py` are the raw pointer position with no smoothing; (0, 0) when absent.
- Group locks persist as `group:*` keys; locking Network also locks inputs.
- Generator taste is a device setting, not a preset param.
- Normalization ranges are computed over the unit square and are time-invariant (union over t phases and pointer positions); never re-sampled per frame or on view change.
- `t` runs on an integrated expression clock, wrapped to one 60 s period, that pauses with ⏸ and resets with ↺ and with the minimap double-tap; pointer holds its last position when absent.
- Weight budget counts active inputs only; normalize is never randomized.
- CPPN-specific migration; built-in weight JSONs rewritten once by a script.
- Group-lock UI is opt-in in the shared panel builders and enabled only for the CPPN.

## 12. Resolved with the user after review

1. `R` re-rolls weights only (new seed, no recompile). Shift+R and both dice re-roll everything unlocked, expressions included.
2. `a` is in the **smooth** group: as generated it has no seam.
3. The normalize toggle lives with the inputs list, not in the generator block.

## 13. Left to the builder

- Exact op table contents and WGSL emission; test harness comparing JS and WGSL evaluators on a grid of expressions (the JS evaluator is the oracle for thumbnails, so divergence would be visible).
- Admin page: expose inputs via the same panel section; the save endpoint writes `inputs`/`normalizeInputs` alongside existing fields.
- Help card (`help-popover.ts`) rows for the new gestures and alt-click/long-press locks.
- Reduced-motion and `H` (hide overlays) behaviour for the band: same as the scrub card.
- Scope the `touch-action: pan-y pinch-zoom` change to the CPPN band and the CPPN scrub card; flag whether to extend it to the other sims later.
- Gallery thumbnails of presets with `t` or pointer inputs animate on hover like any other; nothing special.
- Performance check at 960px max resolution with 8 inputs of 30 ops on a mid-range phone; if needed, lower `maxResolution` while inputs mode is editing, as the busy spinner path already does for recompiles.
