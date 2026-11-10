// src/components/simulations/cppn/cppn-codegen.ts
import type { CPPNConfig, Activation } from './cppn-types';
import { emitEvalProgram, wgslPostProcess } from './cppn-expr/wgsl';
import { MAX_INPUTS } from './cppn-expr/compile';

export const Z_DIM = 16; // fixed — not user-configurable
export { MAX_INPUTS };

export interface WeightLayout {
  /** Input weights: column k (0..MAX_INPUTS-1) for neuron i is at wInOffset + k*w0 + i. */
  wInOffset: number;
  wzOffset: number;
  hiddenWeightOffsets: number[]; // [i] = weights for transition layers[i] → layers[i+1]
  hiddenBiasOffsets: number[];   // [i] = biases for that transition
  outWeightOffset: number;
  totalCount: number;
}

/**
 * The first layer always has MAX_INPUTS (8) input columns, whatever the
 * number of expressions in use: adding or removing an input is then a buffer
 * write, never a layout change. Unused columns are fed 0 by the shader.
 */
export function computeWeightLayout(config: CPPNConfig): WeightLayout {
  const { layers } = config;
  const w0 = layers[0].width;

  const wInOffset = 0;
  const wzOffset = MAX_INPUTS * w0;
  let offset = wzOffset + Z_DIM * w0;

  const hiddenWeightOffsets: number[] = [];
  const hiddenBiasOffsets: number[] = [];

  for (let i = 0; i < layers.length - 1; i++) {
    hiddenWeightOffsets.push(offset);
    offset += layers[i].width * layers[i + 1].width;
    hiddenBiasOffsets.push(offset);
    offset += layers[i + 1].width;
  }

  const outWeightOffset = offset;
  offset += layers[layers.length - 1].width * 3;

  return {
    wInOffset, wzOffset,
    hiddenWeightOffsets, hiddenBiasOffsets,
    outWeightOffset, totalCount: offset,
  };
}

/** Weight count of the pre-expression layout (3 input columns: x, y, r). */
export function legacyWeightCount(config: CPPNConfig): number {
  const w0 = config.layers[0].width;
  return computeWeightLayout(config).totalCount - (MAX_INPUTS - 3) * w0;
}

/**
 * Re-lay a pre-expression weights array (x, y, r columns, then z, hidden,
 * out) into the 8-column layout: the three columns keep their values,
 * columns 3..7 are zero, and every later block moves to its new offset.
 */
export function migrateWeightsFromXYR(old: ArrayLike<number>, config: CPPNConfig): Float32Array {
  const layout = computeWeightLayout(config);
  const w0 = config.layers[0].width;
  const out = new Float32Array(layout.totalCount);
  const head = 3 * w0;                      // x, y, r columns: same offsets
  for (let i = 0; i < head; i++) out[i] = old[i];
  const shift = (MAX_INPUTS - 3) * w0;      // everything after moves up by the five new columns
  for (let i = head; i < old.length; i++) out[i + shift] = old[i];
  return out;
}

/** Drop input column `k` in place: columns k+1..7 move down one, column 7 is zeroed. */
export function removeInputColumn(weights: Float32Array, layout: WeightLayout, w0: number, k: number): void {
  for (let c = k; c < MAX_INPUTS - 1; c++) {
    const dst = layout.wInOffset + c * w0, src = layout.wInOffset + (c + 1) * w0;
    for (let i = 0; i < w0; i++) weights[dst + i] = weights[src + i];
  }
  weights.fill(0, layout.wInOffset + (MAX_INPUTS - 1) * w0, layout.wInOffset + MAX_INPUTS * w0);
}

/** Activation ids as packed into Params.acts0/acts1 (two vec4<u32> = 8 layers). */
export const ACTIVATION_IDS: readonly Activation[] = ['tanh', 'sin', 'cos', 'abs', 'sigmoid'];
export const MAX_SHADER_LAYERS = 8;

// Activations are uniforms, not literals: the switch is uniform across all
// pixels so the GPU takes one path, and changing an activation is a buffer
// write instead of a recompile. `li` is static per layer at codegen time.
function actExpr(li: number, x: string): string {
  const vec = li < 4 ? 'acts0' : 'acts1';
  const comp = 'xyzw'[li % 4];
  return `act(params.${vec}.${comp}, ${x})`;
}

// ── Weight packing ────────────────────────────────────────────────
//
// The shader reads weights from a storage buffer of vec4f slots, so weights
// can be swapped at runtime without recompiling. The shader is still fully
// unrolled with constant slot indices; only the *values* live in the buffer.
//
// `weightGroups` is the single source of truth for slot order: it yields, in
// the exact order the fragment shader consumes them, groups of four layout
// offsets (−1 = zero pad). `generateShader` and `packWeights` both walk it,
// so they can never disagree.

const PAD = -1;

type Group = [number, number, number, number];

function* chunk4(count: number, offsetOf: (i: number) => number): Generator<Group> {
  for (let i = 0; i < count; i += 4) {
    yield [
      offsetOf(i),
      i + 1 < count ? offsetOf(i + 1) : PAD,
      i + 2 < count ? offsetOf(i + 2) : PAD,
      i + 3 < count ? offsetOf(i + 3) : PAD,
    ];
  }
}

function* weightGroups(config: CPPNConfig, layout: WeightLayout): Generator<Group> {
  const { layers } = config;
  const w0 = layers[0].width;

  // Input layer: per neuron, two input groups (8 expression inputs) then z groups.
  for (let i = 0; i < w0; i++) {
    yield* chunk4(MAX_INPUTS, (k) => layout.wInOffset + k * w0 + i);
    yield* chunk4(Z_DIM, (j) => layout.wzOffset + j * w0 + i);
  }

  // Hidden transitions: per output neuron, bias slot then input groups.
  for (let li = 0; li < layers.length - 1; li++) {
    const inW  = layers[li].width;
    const outW = layers[li + 1].width;
    const wOff = layout.hiddenWeightOffsets[li];
    const bOff = layout.hiddenBiasOffsets[li];
    for (let i = 0; i < outW; i++) {
      yield [bOff + i, PAD, PAD, PAD];
      yield* chunk4(inW, (j) => wOff + j * outW + i);
    }
  }

  // Output: three channels, no bias.
  const lastW = layers[layers.length - 1].width;
  for (let i = 0; i < 3; i++) {
    yield* chunk4(lastW, (j) => layout.outWeightOffset + j * 3 + i);
  }
}

/** Number of vec4 slots the packed buffer needs for this architecture. */
export function packedSlotCount(config: CPPNConfig, layout: WeightLayout): number {
  let n = 0;
  for (const _ of weightGroups(config, layout)) n++;
  return n;
}

/** Pack layout-ordered weights into the vec4 slot order the shader reads. */
export function packWeights(config: CPPNConfig, layout: WeightLayout, weights: Float32Array): Float32Array {
  const out = new Float32Array(packedSlotCount(config, layout) * 4);
  let k = 0;
  for (const g of weightGroups(config, layout)) {
    for (let c = 0; c < 4; c++) {
      const off = g[c];
      const v = off === PAD ? 0 : (weights[off] ?? 0);
      out[k * 4 + c] = isFinite(v) ? v : 0;
    }
    k++;
  }
  return out;
}

// Build a dot4 sum over `count` inputs, consuming one slot per 4 inputs.
function dot4Sum(
  count: number,
  getVal: (i: number) => string,
  nextSlot: () => number,
  init: string,
): string {
  let expr = init;
  for (let i = 0; i < count; i += 4) {
    const v = (j: number) => (j < count ? getVal(j) : '0.0');
    expr += ` + dot(vec4f(${v(i)},${v(i + 1)},${v(i + 2)},${v(i + 3)}), wv[${nextSlot()}])`;
  }
  return expr;
}

/**
 * Generate a WGSL shader for an architecture. Weights are read from a
 * `wv: array<vec4f>` storage buffer (binding 1) packed by `packWeights`, and
 * the input expressions from a `prog` bytecode buffer (binding 2), so the
 * shader depends only on layer widths and recompiles only when those change.
 */
export function generateShader(config: CPPNConfig, layout: WeightLayout): string {
  const { layers } = config;
  const groups = weightGroups(config, layout);
  const nextSlot = (): number => {
    const r = groups.next();
    if (r.done) throw new Error('CPPN codegen: slot order out of sync');
    return slotIndex++;
  };
  let slotIndex = 0;

  let src = `
fn sigmoid_f(x: f32) -> f32 { return 1.0 / (1.0 + exp(-x)); }

struct Params {
  resolution : vec2f,
  time       : f32,
  scale      : f32,
  z          : array<f32, ${Z_DIM}>,
  acts0      : vec4<u32>,
  acts1      : vec4<u32>,
  view       : vec4f,          // world centre x, y (high f32), zoom, centre x low bits
  numInputs  : u32,
  exprTime   : f32,            // wrapped expression clock, 0..2π
  normFlag   : u32,
  viewLoY    : f32,            // centre y low bits (hi + lo ≈ an f64 centre)
  pointer    : vec4f,          // pointer x, y in world space
  norm       : array<vec4f, 4>, // per input (mid, half), two inputs per vec4
}

// tanh is evaluated as (e^2x-1)/(e^2x+1) on most GPUs and overflows to
// inf/inf = NaN past |x| ~ 44 (black pixels when zoomed far out); tanh(15)
// is already 1.0 in f32, so clamp. sigmoid is clamped the same way.
fn act(id: u32, x: f32) -> f32 {
  switch id {
    case 0u: { return tanh(clamp(x, -15.0, 15.0)); }
    case 1u: { return sin(x); }
    case 2u: { return cos(x); }
    case 3u: { return abs(x); }
    default: { return sigmoid_f(clamp(x, -40.0, 40.0)); }
  }
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> wv : array<vec4f>;
${emitEvalProgram()}
${wgslPostProcess()}
@vertex
fn vertexMain(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 6>(
    vec2f(-1.0,-1.0), vec2f(1.0,-1.0), vec2f(-1.0,1.0),
    vec2f(-1.0,1.0),  vec2f(1.0,-1.0), vec2f(1.0,1.0)
  );
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) fragPos: vec4f) -> @location(0) vec4f {
  let aspect = params.resolution.x / params.resolution.y;
  let uv     = fragPos.xy / params.resolution;
  // View: the screen maps to a window of the coordinate plane centred on
  // view.xy with half-extent (aspect·scale, scale) / zoom, so zooming
  // samples the function at a new scale instead of magnifying pixels.
  // The low bits join the small screen offset before the big centre, so the
  // view pans smoothly at any zoom (cx itself is still one f32 per pixel).
  let cx     = params.view.x + (params.view.w + (uv.x * 2.0 - 1.0) * aspect * params.scale / params.view.z);
  let cy     = params.view.y + (params.viewLoY + (uv.y * 2.0 - 1.0) * params.scale / params.view.z);
  let cr     = sqrt(cx * cx + cy * cy);
  let ca     = atan2(cy, cx);
  // Expression inputs: one bytecode program per slot, unused slots read 0.
  var inp: array<f32, ${MAX_INPUTS}>;
  for (var i = 0u; i < ${MAX_INPUTS}u; i++) {
    if (i < params.numInputs) {
      var v = finiteClamp(evalProgram(i, cx, cy, cr, ca, params.exprTime, params.pointer.x, params.pointer.y));
      if (params.normFlag != 0u) {
        let n = params.norm[i / 2u];
        let odd = (i & 1u) == 1u;
        let mid = select(n.x, n.z, odd);
        let half = select(n.y, n.w, odd);
        v = (v - mid) / half;
      }
      inp[i] = v;
    } else {
      inp[i] = 0.0;
    }
  }
  let in0    = vec4f(inp[0], inp[1], inp[2], inp[3]);
  let in1    = vec4f(inp[4], inp[5], inp[6], inp[7]);
  let z0     = vec4f(params.z[0],  params.z[1],  params.z[2],  params.z[3]);
  let z1     = vec4f(params.z[4],  params.z[5],  params.z[6],  params.z[7]);
  let z2     = vec4f(params.z[8],  params.z[9],  params.z[10], params.z[11]);
  let z3     = vec4f(params.z[12], params.z[13], params.z[14], params.z[15]);

`;

  // Input layer — two input slots + 4 z slots, no bias
  const w0 = layers[0].width;
  for (let i = 0; i < w0; i++) {
    let expr = `dot(in0, wv[${nextSlot()}]) + dot(in1, wv[${nextSlot()}])`;
    for (const zv of ['z0', 'z1', 'z2', 'z3']) {
      expr += ` + dot(${zv}, wv[${nextSlot()}])`;
    }
    src += `  let h0_${i} = ${actExpr(0, expr)};\n`;
  }
  src += '\n';

  // Hidden transitions — bias slot (.x) + dot4 over previous layer
  for (let li = 0; li < layers.length - 1; li++) {
    const inW  = layers[li].width;
    const outW = layers[li + 1].width;
    for (let i = 0; i < outW; i++) {
      const bias = `wv[${nextSlot()}].x`;
      const expr = dot4Sum(inW, (j) => `h${li}_${j}`, nextSlot, bias);
      src += `  let h${li + 1}_${i} = ${actExpr(li + 1, expr)};\n`;
    }
    src += '\n';
  }

  // Output — dot4 over last layer, no bias, sigmoid
  const lastIdx = layers.length - 1;
  const lastW   = layers[lastIdx].width;
  for (let i = 0; i < 3; i++) {
    const expr = dot4Sum(lastW, (j) => `h${lastIdx}_${j}`, nextSlot, '0.0');
    src += `  let rgb_${i} = sigmoid_f(clamp(${expr}, -40.0, 40.0));\n`;
  }

  if (!groups.next().done) throw new Error('CPPN codegen: unconsumed weight slots');

  src += `\n  return vec4f(rgb_0, rgb_1, rgb_2, 1.0);\n}\n`;
  return src;
}
