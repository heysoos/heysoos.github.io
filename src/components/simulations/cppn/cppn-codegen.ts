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

export function generateShader(config: CPPNConfig, layout: WeightLayout): string {
  const { layers } = config;
  let src = `
fn sigmoid_f(x: f32) -> f32 { return 1.0 / (1.0 + exp(-x)); }

struct Params {
  resolution : vec2f,
  time       : f32,
  scale      : f32,
  z          : array<f32, ${Z_DIM}>,
}

@group(0) @binding(0) var<uniform> params  : Params;
@group(0) @binding(1) var<storage, read> weights : array<f32>;

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

  // Input projection → h0 (no bias, activation = layers[0].activation)
  const w0 = layers[0].width;
  src += `  var h0: array<f32, ${w0}>;\n`;
  src += `  for (var i = 0u; i < ${w0}u; i++) {\n`;
  src += `    var s = cx * weights[${layout.wxOffset}u + i]\n`;
  src += `          + cy * weights[${layout.wyOffset}u + i]\n`;
  src += `          + cr * weights[${layout.wrOffset}u + i];\n`;
  src += `    for (var j = 0u; j < ${Z_DIM}u; j++) {\n`;
  src += `      s += params.z[j] * weights[${layout.wzOffset}u + j * ${w0}u + i];\n`;
  src += `    }\n`;
  src += `    h0[i] = ${actExpr(layers[0].activation, 's')};\n`;
  src += `  }\n\n`;

  // Hidden transitions
  for (let li = 0; li < layers.length - 1; li++) {
    const inW  = layers[li].width;
    const outW = layers[li + 1].width;
    const wOff = layout.hiddenWeightOffsets[li];
    const bOff = layout.hiddenBiasOffsets[li];
    const act  = layers[li + 1].activation;
    src += `  var h${li + 1}: array<f32, ${outW}>;\n`;
    src += `  for (var i = 0u; i < ${outW}u; i++) {\n`;
    src += `    var s = weights[${bOff}u + i];\n`;
    src += `    for (var j = 0u; j < ${inW}u; j++) {\n`;
    src += `      s += h${li}[j] * weights[${wOff}u + j * ${outW}u + i];\n`;
    src += `    }\n`;
    src += `    h${li + 1}[i] = ${actExpr(act, 's')};\n`;
    src += `  }\n\n`;
  }

  // Output → RGB (no bias, sigmoid)
  const lastIdx = layers.length - 1;
  const lastW   = layers[lastIdx].width;
  src += `  var rgb: array<f32, 3>;\n`;
  src += `  for (var i = 0u; i < 3u; i++) {\n`;
  src += `    var s = 0.0;\n`;
  src += `    for (var j = 0u; j < ${lastW}u; j++) {\n`;
  src += `      s += h${lastIdx}[j] * weights[${layout.outWeightOffset}u + j * 3u + i];\n`;
  src += `    }\n`;
  src += `    rgb[i] = sigmoid_f(s);\n`;
  src += `  }\n\n`;

  src += `  return vec4f(rgb[0], rgb[1], rgb[2], 1.0);\n}\n`;
  return src;
}
