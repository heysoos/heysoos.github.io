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

// Format a weight as a WGSL f32 literal. Guards against non-finite values.
function flit(v: number): string {
  if (!isFinite(v)) return '0.0f';
  return v.toFixed(8) + 'f';
}

// Build a dot4-based inner product expression.
// Groups `count` (name[0]..name[count-1]) × (wBase..wBase+count-1) into vec4 dot calls.
// Remainder terms (when count % 4 != 0) are emitted as scalar MADs.
function dot4Sum(
  count: number,
  getVal: (i: number) => string,   // variable name for the i-th input
  getW:   (i: number) => string,   // literal for the i-th weight
  init = '0.0f',
): string {
  let expr = init;
  let i = 0;
  for (; i + 3 < count; i += 4) {
    expr += ` + dot(vec4f(${getVal(i)},${getVal(i+1)},${getVal(i+2)},${getVal(i+3)}),`
          +        `vec4f(${getW(i)},${getW(i+1)},${getW(i+2)},${getW(i+3)}))`;
  }
  for (; i < count; i++) {
    expr += ` + ${getW(i)} * ${getVal(i)}`;
  }
  return expr;
}

/**
 * Generate a WGSL shader with weights baked in as literals.
 * No storage buffer — only a params uniform (resolution, time, scale, z[]).
 * Every neuron is fully unrolled; inner products use dot(vec4f,vec4f) for throughput.
 */
export function generateShader(config: CPPNConfig, layout: WeightLayout, weights: Float32Array): string {
  const { layers } = config;
  const w = (offset: number) => flit(weights[offset] ?? 0);

  let src = `
fn sigmoid_f(x: f32) -> f32 { return 1.0 / (1.0 + exp(-x)); }

struct Params {
  resolution : vec2f,
  time       : f32,
  scale      : f32,
  z          : array<f32, ${Z_DIM}>,
}

@group(0) @binding(0) var<uniform> params : Params;

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

`;

  // Input layer — scalar spatial terms + dot4 z-bands, no bias
  const w0 = layers[0].width;
  for (let i = 0; i < w0; i++) {
    // spatial terms are only 3 — emit as scalars
    let expr = `${w(layout.wxOffset + i)} * cx`
             + ` + ${w(layout.wyOffset + i)} * cy`
             + ` + ${w(layout.wrOffset + i)} * cr`;
    // z terms: dot4 over Z_DIM (16) inputs
    expr = dot4Sum(
      Z_DIM,
      (j) => `params.z[${j}]`,
      (j) => w(layout.wzOffset + j * w0 + i),
      expr,
    );
    src += `  let h0_${i} = ${actExpr(layers[0].activation, expr)};\n`;
  }
  src += '\n';

  // Hidden transitions — bias scalar + dot4 over previous layer, with bias
  for (let li = 0; li < layers.length - 1; li++) {
    const inW  = layers[li].width;
    const outW = layers[li + 1].width;
    const wOff = layout.hiddenWeightOffsets[li];
    const bOff = layout.hiddenBiasOffsets[li];
    const act  = layers[li + 1].activation;
    for (let i = 0; i < outW; i++) {
      const expr = dot4Sum(
        inW,
        (j) => `h${li}_${j}`,
        (j) => w(wOff + j * outW + i),
        w(bOff + i),
      );
      src += `  let h${li + 1}_${i} = ${actExpr(act, expr)};\n`;
    }
    src += '\n';
  }

  // Output — dot4 over last layer, no bias, sigmoid
  const lastIdx = layers.length - 1;
  const lastW   = layers[lastIdx].width;
  for (let i = 0; i < 3; i++) {
    const expr = dot4Sum(
      lastW,
      (j) => `h${lastIdx}_${j}`,
      (j) => w(layout.outWeightOffset + j * 3 + i),
    );
    src += `  let rgb_${i} = sigmoid_f(${expr});\n`;
  }

  src += `\n  return vec4f(rgb_0, rgb_1, rgb_2, 1.0);\n}\n`;
  return src;
}
