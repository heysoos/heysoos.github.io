// src/components/simulations/cppn/cppn-codegen.ts
import type { CPPNConfig, Activation } from './cppn-types';

export const Z_DIM = 16; // fixed — not user-configurable

export interface WeightLayout {
  wxOffset: number;
  wyOffset: number;
  wrOffset: number;
  wzOffset: number;
  hiddenWeightOffsets: number[]; // [i] = weights for transition layers[i] → layers[i+1]
  hiddenBiasOffsets: number[];   // [i] = biases for that transition
  outWeightOffset: number;
  totalCount: number;
}

export function computeWeightLayout(config: CPPNConfig): WeightLayout {
  const { layers } = config;
  const w0 = layers[0].width;

  const wxOffset = 0;
  const wyOffset = w0;
  const wrOffset = 2 * w0;
  const wzOffset = 3 * w0;
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
    wxOffset, wyOffset, wrOffset, wzOffset,
    hiddenWeightOffsets, hiddenBiasOffsets,
    outWeightOffset, totalCount: offset,
  };
}

function actExpr(act: Activation, x: string): string {
  switch (act) {
    case 'tanh':    return `tanh(${x})`;
    case 'sin':     return `sin(${x})`;
    case 'cos':     return `cos(${x})`;
    case 'abs':     return `abs(${x})`;
    case 'sigmoid': return `sigmoid_f(${x})`;
  }
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

  // Input layer: per neuron, one spatial group (cx, cy, cr, 0) then z groups.
  for (let i = 0; i < w0; i++) {
    yield [layout.wxOffset + i, layout.wyOffset + i, layout.wrOffset + i, PAD];
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
 * `wv: array<vec4f>` storage buffer (binding 1) packed by `packWeights`, so the
 * shader depends only on layer widths/activations and recompiles only when
 * those change.
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
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> wv : array<vec4f>;

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
  let cx     = (uv.x * 2.0 - 1.0) * aspect * params.scale;
  let cy     = (uv.y * 2.0 - 1.0) * params.scale;
  let cr     = sqrt(cx * cx + cy * cy);
  let sp     = vec4f(cx, cy, cr, 0.0);
  let z0     = vec4f(params.z[0],  params.z[1],  params.z[2],  params.z[3]);
  let z1     = vec4f(params.z[4],  params.z[5],  params.z[6],  params.z[7]);
  let z2     = vec4f(params.z[8],  params.z[9],  params.z[10], params.z[11]);
  let z3     = vec4f(params.z[12], params.z[13], params.z[14], params.z[15]);

`;

  // Input layer — spatial slot + 4 z slots, no bias
  const w0 = layers[0].width;
  for (let i = 0; i < w0; i++) {
    let expr = `dot(sp, wv[${nextSlot()}])`;
    for (const zv of ['z0', 'z1', 'z2', 'z3']) {
      expr += ` + dot(${zv}, wv[${nextSlot()}])`;
    }
    src += `  let h0_${i} = ${actExpr(layers[0].activation, expr)};\n`;
  }
  src += '\n';

  // Hidden transitions — bias slot (.x) + dot4 over previous layer
  for (let li = 0; li < layers.length - 1; li++) {
    const inW  = layers[li].width;
    const outW = layers[li + 1].width;
    const act  = layers[li + 1].activation;
    for (let i = 0; i < outW; i++) {
      const bias = `wv[${nextSlot()}].x`;
      const expr = dot4Sum(inW, (j) => `h${li}_${j}`, nextSlot, bias);
      src += `  let h${li + 1}_${i} = ${actExpr(act, expr)};\n`;
    }
    src += '\n';
  }

  // Output — dot4 over last layer, no bias, sigmoid
  const lastIdx = layers.length - 1;
  const lastW   = layers[lastIdx].width;
  for (let i = 0; i < 3; i++) {
    const expr = dot4Sum(lastW, (j) => `h${lastIdx}_${j}`, nextSlot, '0.0');
    src += `  let rgb_${i} = sigmoid_f(${expr});\n`;
  }

  if (!groups.next().done) throw new Error('CPPN codegen: unconsumed weight slots');

  src += `\n  return vec4f(rgb_0, rgb_1, rgb_2, 1.0);\n}\n`;
  return src;
}
