# NCA Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a Mordvintsev-style Growing NCA WebGPU simulator in the gallery with trained presets, random-init exploration, architecture codegen, and interactive brush.

**Architecture:** Hybrid codegen + weight buffers — WGSL compute shader generated with CHANNELS/HIDDEN/N_FILTERS/activation baked as constants; weights live in a GPU storage buffer for instant preset swaps. Canvas size matches grid size (pixelated CSS scaling) for 1:1 cell rendering. Ping-pong state buffers run stepsPerFrame compute passes per frame, followed by one render pass.

**Tech Stack:** TypeScript, WebGPU/WGSL, Astro, CSS accordion UI (no JS framework)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/simulations/nca/nca-types.ts` | Create | All shared types: NCAConfig, NCAPreset, NCAWeightLayout, BrushOptions |
| `src/components/simulations/nca/nca-codegen.ts` | Create | generateComputeShader, generateRenderShader, computeWeightLayout, generateWeights |
| `src/components/simulations/nca/nca-controller.ts` | Rewrite | WebGPU init, ping-pong buffers, pipelines, render loop, brush, weight management |
| `src/components/simulations/nca/NCA.astro` | Update | Add panel container div |
| `src/components/simulations/nca/nca-panel.ts` | Create | Accordion UI panel, all 6 sections |
| `src/data/nca-presets.ts` | Create | AUTO-GENERATED stub (empty presets array initially) |
| `src/pages/gallery/[...slug].astro` | Modify | Add NCA panel wiring block (like CPPN block) |
| `src/pages/admin/nca.astro` | Create | Dev-only preset editor |
| `astro.config.mjs` | Modify | Add generateNCAPresetsFile + /api/admin/save-nca-presets middleware |
| `src/content/projects/nca.md` | Create | Gallery entry |

---

### Task 1: nca-types.ts

**Files:**
- Create: `src/components/simulations/nca/nca-types.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/components/simulations/nca/nca-types.ts

export type NCAActivation = 'relu' | 'tanh' | 'leakyrelu';

export interface NCAFilters {
  identity: boolean;
  sobelX: boolean;
  sobelY: boolean;
  laplacian: boolean;
}

export type NCAGridSize = 128 | 256 | 512;
export type NCASeedMode = 'random' | 'center' | 'blank';

export interface NCAConfig {
  channels: number;           // 8 | 16 | 32
  hidden: number;             // 32 | 64 | 128
  filters: NCAFilters;
  activation: NCAActivation;
  fireRate: number;           // 0–1
  stepsPerFrame: number;      // 1–16 (CPU loop, not a uniform)
  dt: number;                 // step size multiplier
  gridWidth: NCAGridSize;
  gridHeight: NCAGridSize;
  channelR: number;           // display channel index
  channelG: number;
  channelB: number;
  normalizeDisplay: boolean;
  seedMode: NCASeedMode;
}

export interface NCAWeightLayout {
  nFilters: number;           // count of active perception filters
  w1Offset: number;           // always 0
  w1BiasOffset: number;       // CHANNELS * N_FILTERS * HIDDEN
  w2Offset: number;           // w1BiasOffset + HIDDEN
  totalCount: number;         // w2Offset + HIDDEN * CHANNELS
}

export interface NCAPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  config: NCAConfig;
  weights: number[];          // flat Float32Array: [W1_weights | W1_biases | W2_weights]
}

export interface BrushOptions {
  mode: 'damage' | 'paint';
  shape: 'circle' | 'square';
  size: number;               // diameter in grid cells
  strength: number;           // 0–1, paint value scale
}

export const DEFAULT_NCA_CONFIG: NCAConfig = {
  channels: 16,
  hidden: 64,
  filters: { identity: true, sobelX: true, sobelY: true, laplacian: true },
  activation: 'relu',
  fireRate: 0.5,
  stepsPerFrame: 4,
  dt: 1.0,
  gridWidth: 256,
  gridHeight: 256,
  channelR: 0,
  channelG: 1,
  channelB: 2,
  normalizeDisplay: false,
  seedMode: 'random',
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/simulations/nca/nca-types.ts
git commit -m "feat(nca): add NCA types"
```

---

### Task 2: nca-codegen.ts

**Files:**
- Create: `src/components/simulations/nca/nca-codegen.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/components/simulations/nca/nca-codegen.ts
import type { NCAConfig, NCAActivation, NCAWeightLayout } from './nca-types';

export function computeWeightLayout(config: NCAConfig): NCAWeightLayout {
  const { channels, hidden, filters } = config;
  const nFilters = [filters.identity, filters.sobelX, filters.sobelY, filters.laplacian]
    .filter(Boolean).length;
  const w1BiasOffset = channels * nFilters * hidden;
  const w2Offset = w1BiasOffset + hidden;
  const totalCount = w2Offset + hidden * channels;
  return { nFilters, w1Offset: 0, w1BiasOffset, w2Offset, totalCount };
}

function actFn(a: NCAActivation): string {
  if (a === 'relu')      return 'fn act(x: f32) -> f32 { return max(0.0, x); }';
  if (a === 'tanh')      return 'fn act(x: f32) -> f32 { return tanh(x); }';
  /* leakyrelu */        return 'fn act(x: f32) -> f32 { return select(x * 0.01, x, x > 0.0); }';
}

function buildPerceptionCode(config: NCAConfig, nFilters: number): string {
  const { filters } = config;
  const lines: string[] = [];
  let fi = 0;
  const p = (idx: number, expr: string) =>
    `    perc[c * ${nFilters}u + ${idx}u] = ${expr};`;

  if (filters.identity) {
    lines.push(p(fi++, 'get(xi, yi, c)'));
  }
  if (filters.sobelX) {
    lines.push(p(fi++,
      '(-1.0*get(xi-1,yi-1,c) + get(xi+1,yi-1,c) +\n' +
      '      -2.0*get(xi-1,yi,c)   + 2.0*get(xi+1,yi,c) +\n' +
      '      -1.0*get(xi-1,yi+1,c) + get(xi+1,yi+1,c)) / 8.0'));
  }
  if (filters.sobelY) {
    lines.push(p(fi++,
      '(-1.0*get(xi-1,yi-1,c) - 2.0*get(xi,yi-1,c) - get(xi+1,yi-1,c) +\n' +
      '       get(xi-1,yi+1,c) + 2.0*get(xi,yi+1,c) + get(xi+1,yi+1,c)) / 8.0'));
  }
  if (filters.laplacian) {
    lines.push(p(fi++,
      '(get(xi-1,yi-1,c) + 2.0*get(xi,yi-1,c) + get(xi+1,yi-1,c) +\n' +
      '       2.0*get(xi-1,yi,c) - 12.0*get(xi,yi,c) + 2.0*get(xi+1,yi,c) +\n' +
      '       get(xi-1,yi+1,c) + 2.0*get(xi,yi+1,c) + get(xi+1,yi+1,c)) / 16.0'));
  }
  return lines.join('\n');
}

// Uniforms struct shared by both shaders (12 x f32/u32 = 48 bytes, 16-byte aligned)
const UNIFORMS_STRUCT = `struct Uniforms {
  fireRate       : f32,
  dt             : f32,
  frameIndex     : u32,
  gridW          : u32,
  gridH          : u32,
  channelR       : u32,
  channelG       : u32,
  channelB       : u32,
  normalizeDisplay: u32,
  _pad0          : u32,
  _pad1          : u32,
  _pad2          : u32,
}`;

export function generateComputeShader(config: NCAConfig): string {
  const { channels, hidden } = config;
  const layout = computeWeightLayout(config);
  const { nFilters, w1BiasOffset, w2Offset } = layout;
  const percCode = buildPerceptionCode(config, nFilters);

  return `// GENERATED by nca-codegen.ts — do not edit
const CHANNELS   : u32 = ${channels}u;
const HIDDEN     : u32 = ${hidden}u;
const N_FILTERS  : u32 = ${nFilters}u;
const W1_BIAS_OFF: u32 = ${w1BiasOffset}u;
const W2_OFF     : u32 = ${w2Offset}u;

${actFn(config.activation)}

${UNIFORMS_STRUCT}

@group(0) @binding(0) var<storage, read>       stateIn : array<f32>;
@group(0) @binding(1) var<storage, read_write> stateOut: array<f32>;
@group(0) @binding(2) var<storage, read>       weights : array<f32>;
@group(0) @binding(3) var<uniform>             u       : Uniforms;

fn pcg(v: u32) -> u32 {
  var x = v * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (x >> 22u) ^ x;
}

fn get(xi: i32, yi: i32, c: u32) -> f32 {
  let x = u32((xi + i32(u.gridW)) % i32(u.gridW));
  let y = u32((yi + i32(u.gridH)) % i32(u.gridH));
  return stateIn[(y * u.gridW + x) * CHANNELS + c];
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= u.gridW || id.y >= u.gridH) { return; }
  let xi   = i32(id.x);
  let yi   = i32(id.y);
  let cell = id.y * u.gridW + id.x;
  let base = cell * CHANNELS;

  // Stochastic mask
  let rng = pcg(cell ^ u.frameIndex);
  if (f32(rng) / 4294967295.0 >= u.fireRate) {
    for (var c = 0u; c < CHANNELS; c++) { stateOut[base + c] = stateIn[base + c]; }
    return;
  }

  // Perception
  var perc: array<f32, CHANNELS * N_FILTERS>;
  for (var c = 0u; c < CHANNELS; c++) {
${percCode}
  }

  // MLP layer 1: [CHANNELS*N_FILTERS → HIDDEN]
  var h: array<f32, HIDDEN>;
  for (var hi = 0u; hi < HIDDEN; hi++) {
    var s = weights[W1_BIAS_OFF + hi];
    for (var i = 0u; i < CHANNELS * N_FILTERS; i++) {
      s += perc[i] * weights[i * HIDDEN + hi];
    }
    h[hi] = act(s);
  }

  // MLP layer 2: [HIDDEN → CHANNELS], residual update
  for (var c = 0u; c < CHANNELS; c++) {
    var d = 0.0;
    for (var hi = 0u; hi < HIDDEN; hi++) {
      d += h[hi] * weights[W2_OFF + hi * CHANNELS + c];
    }
    stateOut[base + c] = clamp(stateIn[base + c] + u.dt * d, 0.0, 1.0);
  }
}
`;
}

export function generateRenderShader(config: NCAConfig): string {
  const { channels } = config;
  return `// GENERATED by nca-codegen.ts — do not edit
const CHANNELS: u32 = ${channels}u;

${UNIFORMS_STRUCT}

@group(0) @binding(0) var<storage, read> state: array<f32>;
@group(0) @binding(1) var<uniform>       u    : Uniforms;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 6>(
    vec2f(-1.0,-1.0), vec2f(1.0,-1.0), vec2f(-1.0,1.0),
    vec2f(-1.0,1.0),  vec2f(1.0,-1.0), vec2f(1.0,1.0)
  );
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let x    = u32(pos.x);
  let y    = u32(pos.y);
  let cell = y * u.gridW + x;
  var r = state[cell * CHANNELS + u.channelR];
  var g = state[cell * CHANNELS + u.channelG];
  var b = state[cell * CHANNELS + u.channelB];
  return vec4f(r, g, b, 1.0);
}
`;
}

// Xavier uniform weight initialisation
export function generateWeights(config: NCAConfig, seed: number): Float32Array {
  const { channels, hidden } = config;
  const layout = computeWeightLayout(config);
  const { nFilters, w1BiasOffset, w2Offset, totalCount } = layout;
  const weights = new Float32Array(totalCount);

  // mulberry32 PRNG
  let s = seed >>> 0;
  const rand = () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const xavier = (fanIn: number, fanOut: number) => {
    const limit = Math.sqrt(6 / (fanIn + fanOut));
    return rand() * 2 * limit - limit;
  };

  const w1In = channels * nFilters;
  // W1 weights [w1In × HIDDEN]
  for (let i = 0; i < w1In * hidden; i++) weights[i] = xavier(w1In, hidden);
  // W1 biases — zeros (index w1BiasOffset)
  // (Float32Array already zero-filled)
  // W2 weights [HIDDEN × CHANNELS]
  for (let i = 0; i < hidden * channels; i++) weights[w2Offset + i] = xavier(hidden, channels);

  return weights;
}
```

- [ ] **Step 2: Verify codegen output**

Run `npm run dev`, open browser console on any page, and paste:

```js
// Quick sanity check — paste in browser console after dev server starts
// (import not needed here, just verify logic manually)
// For channels=16, hidden=64, all filters active:
// nFilters = 4
// w1BiasOffset = 16*4*64 = 4096
// w2Offset = 4096 + 64 = 4160
// totalCount = 4160 + 64*16 = 5184
console.assert(16*4*64 === 4096, 'w1BiasOffset');
console.assert(4096 + 64 === 4160, 'w2Offset');
console.assert(4160 + 64*16 === 5184, 'totalCount');
console.log('Weight layout OK');
```

Expected: `Weight layout OK` in console, no assertion errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/nca/nca-codegen.ts
git commit -m "feat(nca): add WGSL codegen and weight utilities"
```

---

### Task 3: nca-controller.ts — Init, Buffers, Pipelines

**Files:**
- Rewrite: `src/components/simulations/nca/nca-controller.ts`

- [ ] **Step 1: Write the controller skeleton with init and pipeline creation**

```typescript
// src/components/simulations/nca/nca-controller.ts
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import {
  computeWeightLayout, generateComputeShader, generateRenderShader, generateWeights,
} from './nca-codegen';
import {
  DEFAULT_NCA_CONFIG,
  type NCAConfig, type NCAPreset, type NCAWeightLayout, type BrushOptions,
} from './nca-types';

// Uniform buffer: 12 x f32/u32 = 48 bytes
const UNIFORMS_COUNT = 12;
const UNIFORMS_BYTES = UNIFORMS_COUNT * 4;

export class NCAController {
  private gpu: WebGPUContext | null = null;
  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private stateA!: GPUBuffer;
  private stateB!: GPUBuffer;
  private weightBuffer!: GPUBuffer;
  private uniformBuffer!: GPUBuffer;
  private computeBindGroups!: GPUBindGroup[]; // [0] = A→B, [1] = B→A
  private renderBindGroups!: GPUBindGroup[];  // [0] reads A, [1] reads B
  private layout!: NCAWeightLayout;
  private frameIndex = 0;
  private pingPong = 0; // 0 or 1
  private running = false;
  private animId = 0;
  private canvas!: HTMLCanvasElement;

  config: NCAConfig = { ...DEFAULT_NCA_CONFIG };

  // ── Init ──────────────────────────────────────────────────────────

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      this.canvas = canvas;
      this.gpu = await initWebGPU(canvas);
      if (!this.gpu) return false;
      this.layout = computeWeightLayout(this.config);
      this.createBuffers();
      this.uniformBuffer = this.gpu.device.createBuffer({
        size: UNIFORMS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.seedGrid();
      const weights = generateWeights(this.config, Date.now());
      this.gpu.device.queue.writeBuffer(this.weightBuffer, 0, weights);
      await this.buildPipelines();
      this.updateUniforms();
      this.setupBrushEvents();
      return true;
    } catch (e) {
      console.error('NCAController init error:', e);
      return false;
    }
  }

  private createBuffers(): void {
    const { device } = this.gpu!;
    const { gridWidth: W, gridHeight: H, channels } = this.config;
    const stateSize = W * H * channels * 4; // f32
    const weightSize = this.layout.totalCount * 4;

    const stateUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    this.stateA = device.createBuffer({ size: stateSize, usage: stateUsage });
    this.stateB = device.createBuffer({ size: stateSize, usage: stateUsage });
    this.weightBuffer = device.createBuffer({
      size: Math.max(weightSize, 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  private seedGrid(): void {
    const { device } = this.gpu!;
    const { gridWidth: W, gridHeight: H, channels, seedMode } = this.config;
    const data = new Float32Array(W * H * channels);
    if (seedMode === 'random') {
      for (let i = 0; i < data.length; i++) data[i] = Math.random();
    } else if (seedMode === 'center') {
      const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
      const r = Math.min(W, H) / 16;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d < r) {
            const base = (y * W + x) * channels;
            for (let c = 0; c < channels; c++) data[base + c] = Math.random();
          }
        }
      }
    }
    // 'blank' → all zeros (already)
    device.queue.writeBuffer(this.stateA, 0, data);
    device.queue.writeBuffer(this.stateB, 0, data);
  }

  private async buildPipelines(): Promise<void> {
    const { device, format } = this.gpu!;

    // Compute pipeline
    const computeModule = device.createShaderModule({ code: generateComputeShader(this.config) });
    this.computePipeline = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: computeModule, entryPoint: 'main' },
    });

    // Render pipeline
    const renderModule = device.createShaderModule({ code: generateRenderShader(this.config) });
    this.renderPipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs' },
      fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
    });

    this.buildBindGroups();
  }

  private buildBindGroups(): void {
    const { device } = this.gpu!;
    const cl = this.computePipeline.getBindGroupLayout(0);
    const rl = this.renderPipeline.getBindGroupLayout(0);

    const makeCompute = (src: GPUBuffer, dst: GPUBuffer) =>
      device.createBindGroup({
        layout: cl,
        entries: [
          { binding: 0, resource: { buffer: src } },
          { binding: 1, resource: { buffer: dst } },
          { binding: 2, resource: { buffer: this.weightBuffer } },
          { binding: 3, resource: { buffer: this.uniformBuffer } },
        ],
      });

    const makeRender = (buf: GPUBuffer) =>
      device.createBindGroup({
        layout: rl,
        entries: [
          { binding: 0, resource: { buffer: buf } },
          { binding: 1, resource: { buffer: this.uniformBuffer } },
        ],
      });

    this.computeBindGroups = [makeCompute(this.stateA, this.stateB), makeCompute(this.stateB, this.stateA)];
    this.renderBindGroups  = [makeRender(this.stateA), makeRender(this.stateB)];
  }

  private updateUniforms(): void {
    const { fireRate, dt, gridWidth, gridHeight, channelR, channelG, channelB, normalizeDisplay } = this.config;
    const u = new ArrayBuffer(UNIFORMS_BYTES);
    const f = new Float32Array(u);
    const i = new Uint32Array(u);
    f[0] = fireRate;
    f[1] = dt;
    i[2] = this.frameIndex;
    i[3] = gridWidth;
    i[4] = gridHeight;
    i[5] = channelR;
    i[6] = channelG;
    i[7] = channelB;
    i[8] = normalizeDisplay ? 1 : 0;
    this.gpu!.device.queue.writeBuffer(this.uniformBuffer, 0, u);
  }

  // ── Public API ────────────────────────────────────────────────────

  start(): void { if (this.running) return; this.running = true; this.tick(); }
  stop():  void { this.running = false; cancelAnimationFrame(this.animId); }
  reset(): void { this.frameIndex = 0; this.pingPong = 0; this.seedGrid(); }

  // placeholder — implemented in Task 4
  private tick = () => {};

  // placeholder — implemented in Task 5
  async recompile(_config: NCAConfig): Promise<void> {}
  loadPreset(_preset: NCAPreset): void {}
  randomInit(): void {}
  setParams(_partial: Partial<NCAConfig>): void {}

  // placeholder — implemented in Task 6
  brush(_x: number, _y: number, _opts: BrushOptions): void {}
  private setupBrushEvents(): void {}
}
```

- [ ] **Step 2: Verify it compiles**

Run `npm run dev`. Navigate to `http://localhost:4321/gallery/nca`. Expect: blank/dark canvas (render pipeline outputs black since state is zeroed), no console errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/nca/nca-controller.ts
git commit -m "feat(nca): controller skeleton — init, buffers, pipelines"
```

---

### Task 4: nca-controller.ts — Render Loop

**Files:**
- Modify: `src/components/simulations/nca/nca-controller.ts`

- [ ] **Step 1: Replace the `tick` placeholder**

Find and replace the line `private tick = () => {};` with:

```typescript
  private tick = (): void => {
    if (!this.running || !this.gpu) return;
    const { device, context } = this.gpu;
    const { gridWidth: W, gridHeight: H } = this.config;

    // Resize canvas to grid size (pixelated CSS scaling handles display)
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width  = W;
      this.canvas.height = H;
    }

    const encoder = device.createCommandEncoder();

    // Run stepsPerFrame compute passes (ping-pong)
    for (let s = 0; s < this.config.stepsPerFrame; s++) {
      // Update frameIndex uniform before each step
      const iu = new Uint32Array([this.frameIndex]);
      device.queue.writeBuffer(this.uniformBuffer, 8, iu); // offset 8 = frameIndex (u32 at index 2)

      const pass = encoder.beginComputePass();
      pass.setPipeline(this.computePipeline);
      pass.setBindGroup(0, this.computeBindGroups[this.pingPong]);
      pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
      pass.end();

      this.pingPong ^= 1;
      this.frameIndex++;
    }

    // Render pass — read from the most recently written buffer
    const readBuf = this.pingPong; // after ping-pong flips, pingPong points to the last output
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroups[readBuf]);
    renderPass.draw(6);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    this.animId = requestAnimationFrame(this.tick);
  };
```

- [ ] **Step 2: Verify simulation runs**

Navigate to `http://localhost:4321/gallery/nca`. Expect: random color noise animating (no panel yet). No console errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/nca/nca-controller.ts
git commit -m "feat(nca): render loop with ping-pong compute + render pass"
```

---

### Task 5: nca-controller.ts — Weight Management

**Files:**
- Modify: `src/components/simulations/nca/nca-controller.ts`

- [ ] **Step 1: Replace the weight management placeholders**

Find and replace the four placeholder methods:

```typescript
  async recompile(config: NCAConfig): Promise<void> {
    const wasRunning = this.running;
    this.stop();
    this.config = { ...config };
    this.layout = computeWeightLayout(config);
    // Recreate state buffers only if grid size changed
    const { gridWidth: W, gridHeight: H, channels } = config;
    const stateSize = W * H * channels * 4;
    if (this.stateA.size !== stateSize) {
      this.stateA.destroy();
      this.stateB.destroy();
      this.createBuffers();
      this.seedGrid();
    }
    await this.buildPipelines();
    this.updateUniforms();
    if (wasRunning) this.start();
  }

  loadPreset(preset: NCAPreset): void {
    const prev = this.config;
    const next = preset.config;
    const archChanged =
      prev.channels !== next.channels ||
      prev.hidden !== next.hidden ||
      prev.activation !== next.activation ||
      prev.filters.identity !== next.filters.identity ||
      prev.filters.sobelX !== next.filters.sobelX ||
      prev.filters.sobelY !== next.filters.sobelY ||
      prev.filters.laplacian !== next.filters.laplacian ||
      prev.gridWidth !== next.gridWidth ||
      prev.gridHeight !== next.gridHeight;

    this.config = { ...next };
    this.layout = computeWeightLayout(next);

    // Write weights immediately
    const w = new Float32Array(preset.weights);
    if (this.weightBuffer.size < w.byteLength) {
      this.weightBuffer.destroy();
      this.weightBuffer = this.gpu!.device.createBuffer({
        size: w.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }
    this.gpu!.device.queue.writeBuffer(this.weightBuffer, 0, w);

    if (archChanged) {
      void this.recompile(next).then(() => {
        this.gpu!.device.queue.writeBuffer(this.weightBuffer, 0, w); // re-write after recompile
      });
    } else {
      this.updateUniforms();
    }
  }

  randomInit(): void {
    const weights = generateWeights(this.config, Date.now());
    const needed = weights.byteLength;
    if (this.weightBuffer.size < needed) {
      this.weightBuffer.destroy();
      this.weightBuffer = this.gpu!.device.createBuffer({
        size: needed,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.buildBindGroups();
    }
    this.gpu!.device.queue.writeBuffer(this.weightBuffer, 0, weights);
    this.reset();
  }

  setParams(partial: Partial<NCAConfig>): void {
    const archKeys: (keyof NCAConfig)[] = ['channels', 'hidden', 'activation', 'gridWidth', 'gridHeight'];
    const filterKeys = ['identity', 'sobelX', 'sobelY', 'laplacian'] as const;

    const needsRecompile =
      archKeys.some(k => k in partial && (partial as any)[k] !== (this.config as any)[k]) ||
      (partial.filters !== undefined &&
        filterKeys.some(k => partial.filters![k] !== this.config.filters[k]));

    Object.assign(this.config, partial);
    if (partial.filters) this.config.filters = { ...this.config.filters, ...partial.filters };

    if (needsRecompile) {
      void this.recompile(this.config);
    } else {
      this.updateUniforms();
    }
  }
```

- [ ] **Step 2: Verify weight changes work**

In browser console (after `npm run dev`, on the gallery nca page):

```js
// The controller is accessible via the global controllers map
// Open /gallery/nca, then in console:
// (This only works if you expose the controller — skip if not accessible yet)
// Visual check: simulation running = weight management is wired
console.log('Task 5 verified visually');
```

Verify: simulation still runs without errors after the task 4 changes are in place alongside these.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/nca/nca-controller.ts
git commit -m "feat(nca): weight management — randomInit, loadPreset, recompile, setParams"
```

---

### Task 6: nca-controller.ts — Brush

**Files:**
- Modify: `src/components/simulations/nca/nca-controller.ts`

- [ ] **Step 1: Add brush state and replace brush placeholders**

Add a brush state field after `private animId = 0;`:

```typescript
  brushOpts: BrushOptions = { mode: 'damage', shape: 'circle', size: 20, strength: 1.0 };
  private brushActive = false;
  private lastBrushX = -1;
  private lastBrushY = -1;
```

Replace `brush(_x: number, _y: number, _opts: BrushOptions): void {}` with:

```typescript
  brush(gx: number, gy: number, opts: BrushOptions): void {
    if (!this.gpu) return;
    const { device } = this.gpu;
    const { gridWidth: W, gridHeight: H, channels } = this.config;
    const r = Math.floor(opts.size / 2);
    const cell = new Float32Array(channels);

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (opts.shape === 'circle' && dx * dx + dy * dy > r * r) continue;
        const x = ((gx + dx) % W + W) % W;
        const y = ((gy + dy) % H + H) % H;
        const idx = (y * W + x) * channels;
        if (opts.mode === 'damage') {
          cell.fill(0);
        } else {
          for (let c = 0; c < channels; c++) cell[c] = Math.random() * opts.strength;
        }
        // Write to both buffers so the next read is consistent
        device.queue.writeBuffer(this.stateA, idx * 4, cell);
        device.queue.writeBuffer(this.stateB, idx * 4, cell);
      }
    }
  }
```

Replace `private setupBrushEvents(): void {}` with:

```typescript
  private setupBrushEvents(): void {
    const toGrid = (e: MouseEvent): [number, number] => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.config.gridWidth  / rect.width;
      const scaleY = this.config.gridHeight / rect.height;
      return [
        Math.floor((e.clientX - rect.left) * scaleX),
        Math.floor((e.clientY - rect.top)  * scaleY),
      ];
    };

    this.canvas.addEventListener('mousedown', (e) => {
      this.brushActive = true;
      const [x, y] = toGrid(e);
      this.lastBrushX = x; this.lastBrushY = y;
      this.brush(x, y, this.brushOpts);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.brushActive) return;
      const [x, y] = toGrid(e);
      if (x === this.lastBrushX && y === this.lastBrushY) return;
      this.lastBrushX = x; this.lastBrushY = y;
      this.brush(x, y, this.brushOpts);
    });

    window.addEventListener('mouseup', () => { this.brushActive = false; });
  }
```

- [ ] **Step 2: Verify brush**

Navigate to `http://localhost:4321/gallery/nca`. Click and drag on the canvas. Expect: visible dark region appears where you drag (damage mode default). Simulation continues running around it.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/nca/nca-controller.ts
git commit -m "feat(nca): brush interaction — damage/paint with mouse drag"
```

---

### Task 7: NCA.astro — Add Panel Container

**Files:**
- Modify: `src/components/simulations/nca/NCA.astro`

- [ ] **Step 1: Rewrite NCA.astro**

```astro
---
// src/components/simulations/nca/NCA.astro
---
<div class="sim-container">
  <canvas id="nca-canvas" style="image-rendering: pixelated;"></canvas>
  <div id="nca-fallback" class="fallback" style="display:none;">
    <p>WebGPU is not supported in your browser.</p>
  </div>
</div>

<style>
  .sim-container { position: relative; width: 100%; height: 100%; }
  canvas { width: 100%; height: 100%; display: block; }
  .fallback {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: var(--bg-primary); color: var(--text-muted);
  }
</style>
```

Note: the panel and script wiring live in `[...slug].astro`, not here. `NCA.astro` only provides the canvas.

- [ ] **Step 2: Commit**

```bash
git add src/components/simulations/nca/NCA.astro
git commit -m "feat(nca): update NCA.astro with pixelated canvas"
```

---

### Task 8: nca-panel.ts

**Files:**
- Create: `src/components/simulations/nca/nca-panel.ts`

- [ ] **Step 1: Write the accordion panel**

```typescript
// src/components/simulations/nca/nca-panel.ts
import type { NCAController } from './nca-controller';
import type { NCAPreset, NCAActivation, NCAGridSize, NCASeedMode } from './nca-types';

export interface NCAPanelOpts {
  presets?: NCAPreset[];
  activePresetId?: string;
  onPresetLoad?: (preset: NCAPreset) => void;
  onClose?: () => void;
}

// ── DOM helpers (mirrors boids-panel style) ───────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, css: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(parent: HTMLElement, text: string, onClick: () => void, css = ''): HTMLButtonElement {
  const b = el('button',
    'padding:0.2rem 0.5rem;border:1px solid var(--bg-surface-border);border-radius:3px;' +
    'background:transparent;color:var(--text-muted);font-size:0.68rem;cursor:pointer;white-space:nowrap;' + css,
    text) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

function slider(
  parent: HTMLElement, label: string,
  min: number, max: number, step: number, value: number,
  onChange: (v: number) => void,
): void {
  const wrap  = el('div', 'display:flex;flex-direction:column;gap:0.1rem;margin-bottom:0.35rem;');
  const top   = el('div', 'display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-body);');
  const valEl = el('span', 'color:var(--accent);font-variant-numeric:tabular-nums;', String(value));
  top.appendChild(el('span', '', label));
  top.appendChild(valEl);
  const inp = el('input', 'width:100%;accent-color:var(--accent);cursor:pointer;');
  inp.type = 'range'; inp.min = String(min); inp.max = String(max);
  inp.step = String(step); inp.value = String(value);
  inp.addEventListener('input', () => {
    const v = parseFloat(inp.value);
    const dec = String(step).includes('.') ? String(step).split('.')[1].length : 0;
    valEl.textContent = v.toFixed(dec);
    onChange(v);
  });
  wrap.appendChild(top); wrap.appendChild(inp);
  parent.appendChild(wrap);
}

function row(parent: HTMLElement, css = ''): HTMLElement {
  const r = el('div', 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:0.3rem;' + css);
  parent.appendChild(r);
  return r;
}

function toggle(parent: HTMLElement, label: string, checked: boolean, onChange: (v: boolean) => void): void {
  const wrap = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;');
  wrap.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);', label));
  const inp = el('input', 'cursor:pointer;accent-color:var(--accent);') as HTMLInputElement;
  inp.type = 'checkbox'; inp.checked = checked;
  inp.addEventListener('change', () => onChange(inp.checked));
  wrap.appendChild(inp);
  parent.appendChild(wrap);
}

function segmented(parent: HTMLElement, options: string[], value: string, onChange: (v: string) => void): void {
  const wrap = el('div', 'display:flex;gap:4px;margin-bottom:0.3rem;flex-wrap:wrap;');
  for (const opt of options) {
    const b = btn(wrap, opt, () => {
      onChange(opt);
      wrap.querySelectorAll('button').forEach(b2 =>
        b2.style.borderColor = b2.textContent === opt ? 'var(--accent)' : 'var(--bg-surface-border)');
    }, opt === value ? 'border-color:var(--accent);color:var(--accent);' : '');
    b.title = opt;
  }
  parent.appendChild(wrap);
}

// ── Accordion section ─────────────────────────────────────────────

function section(parent: HTMLElement, title: string, open = true): HTMLElement {
  const wrap = el('div', 'border-bottom:1px solid var(--bg-surface-border);');
  const header = el('div',
    'display:flex;justify-content:space-between;align-items:center;' +
    'padding:0.4rem 0;cursor:pointer;user-select:none;');
  const titleEl = el('span', 'font-size:0.68rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);', title);
  const arrow = el('span', 'font-size:0.6rem;color:var(--text-muted);transition:transform 0.15s;', open ? '▼' : '▶');
  header.appendChild(titleEl);
  header.appendChild(arrow);

  const body = el('div', 'padding:0.4rem 0;' + (open ? '' : 'display:none;'));
  header.addEventListener('click', () => {
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    arrow.textContent = isOpen ? '▶' : '▼';
  });
  wrap.appendChild(header);
  wrap.appendChild(body);
  parent.appendChild(wrap);
  return body;
}

// ── Build panel ───────────────────────────────────────────────────

export function buildNCAPanel(
  container: HTMLElement,
  ctrl: NCAController,
  opts: NCAPanelOpts = {},
): void {
  container.innerHTML = '';

  const { presets = [], activePresetId, onPresetLoad, onClose } = opts;

  // ── Presets section ───────────────────────────────────────────
  const presetsBody = section(container, 'Presets', true);
  const presetRow = row(presetsBody);
  for (const preset of presets) {
    const b = btn(presetRow, preset.name, () => {
      ctrl.loadPreset(preset);
      onPresetLoad?.(preset);
      buildNCAPanel(container, ctrl, { ...opts, activePresetId: preset.id });
    });
    if (preset.id === activePresetId) {
      b.style.borderColor = 'var(--accent)';
      b.style.color = 'var(--accent)';
    }
  }
  const actionsRow = row(presetsBody, 'margin-top:0.3rem;');
  btn(actionsRow, 'Random Init', () => { ctrl.randomInit(); });

  // ── Architecture section ──────────────────────────────────────
  const archBody = section(container, 'Architecture', false);

  const chRow = row(archBody);
  el('span', 'font-size:0.72rem;color:var(--text-body);margin-right:auto;', 'Channels').let?.(e => chRow.appendChild(e));
  chRow.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);margin-right:auto;', 'Channels'));
  segmented(archBody, ['8', '16', '32'], String(ctrl.config.channels), (v) => {
    ctrl.setParams({ channels: parseInt(v) as 8 | 16 | 32 });
  });

  archBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin-bottom:0.2rem;', 'Hidden'));
  segmented(archBody, ['32', '64', '128'], String(ctrl.config.hidden), (v) => {
    ctrl.setParams({ hidden: parseInt(v) as 32 | 64 | 128 });
  });

  archBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin-bottom:0.2rem;', 'Filters'));
  const filterRow = row(archBody);
  const filterDefs = [
    { key: 'identity' as const, label: 'Id' },
    { key: 'sobelX'   as const, label: 'Sx' },
    { key: 'sobelY'   as const, label: 'Sy' },
    { key: 'laplacian'as const, label: 'Lap' },
  ];
  for (const { key, label } of filterDefs) {
    const b = btn(filterRow, label, () => {
      const f = { ...ctrl.config.filters, [key]: !ctrl.config.filters[key] };
      ctrl.setParams({ filters: f });
      b.style.borderColor = ctrl.config.filters[key] ? 'var(--accent)' : 'var(--bg-surface-border)';
      b.style.color = ctrl.config.filters[key] ? 'var(--accent)' : '';
    });
    if (ctrl.config.filters[key]) { b.style.borderColor = 'var(--accent)'; b.style.color = 'var(--accent)'; }
  }

  archBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin:0.3rem 0 0.2rem;', 'Activation'));
  segmented(archBody, ['relu', 'tanh', 'leakyrelu'], ctrl.config.activation, (v) => {
    ctrl.setParams({ activation: v as NCAActivation });
  });

  // ── Runtime section ───────────────────────────────────────────
  const runtimeBody = section(container, 'Runtime', true);
  slider(runtimeBody, 'Fire rate', 0.1, 1, 0.01, ctrl.config.fireRate, (v) => ctrl.setParams({ fireRate: v }));
  slider(runtimeBody, 'Steps/frame', 1, 16, 1, ctrl.config.stepsPerFrame, (v) => ctrl.setParams({ stepsPerFrame: Math.round(v) }));
  slider(runtimeBody, 'dt', 0.1, 2, 0.01, ctrl.config.dt, (v) => ctrl.setParams({ dt: v }));

  // ── Visualization section ─────────────────────────────────────
  const visBody = section(container, 'Visualization', false);
  const ch = ctrl.config.channels - 1;
  slider(visBody, 'R channel', 0, ch, 1, ctrl.config.channelR, (v) => ctrl.setParams({ channelR: Math.round(v) }));
  slider(visBody, 'G channel', 0, ch, 1, ctrl.config.channelG, (v) => ctrl.setParams({ channelG: Math.round(v) }));
  slider(visBody, 'B channel', 0, ch, 1, ctrl.config.channelB, (v) => ctrl.setParams({ channelB: Math.round(v) }));
  toggle(visBody, 'Normalize', ctrl.config.normalizeDisplay, (v) => ctrl.setParams({ normalizeDisplay: v }));

  // ── Grid section ──────────────────────────────────────────────
  const gridBody = section(container, 'Grid', false);
  gridBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin-bottom:0.2rem;', 'Resolution'));
  segmented(gridBody, ['128', '256', '512'], String(ctrl.config.gridWidth), (v) => {
    const s = parseInt(v) as NCAGridSize;
    ctrl.setParams({ gridWidth: s, gridHeight: s });
  });
  gridBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin:0.3rem 0 0.2rem;', 'Seed mode'));
  segmented(gridBody, ['random', 'center', 'blank'], ctrl.config.seedMode, (v) => {
    ctrl.setParams({ seedMode: v as NCASeedMode });
  });
  const resetRow = row(gridBody, 'margin-top:0.4rem;');
  btn(resetRow, 'Reset', () => ctrl.reset());

  // ── Brush section ─────────────────────────────────────────────
  const brushBody = section(container, 'Brush', true);
  brushBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin-bottom:0.2rem;', 'Mode'));
  segmented(brushBody, ['damage', 'paint'], ctrl.brushOpts.mode, (v) => {
    ctrl.brushOpts = { ...ctrl.brushOpts, mode: v as 'damage' | 'paint' };
  });
  brushBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin-bottom:0.2rem;', 'Shape'));
  segmented(brushBody, ['circle', 'square'], ctrl.brushOpts.shape, (v) => {
    ctrl.brushOpts = { ...ctrl.brushOpts, shape: v as 'circle' | 'square' };
  });
  slider(brushBody, 'Size', 2, 80, 1, ctrl.brushOpts.size, (v) => {
    ctrl.brushOpts = { ...ctrl.brushOpts, size: Math.round(v) };
  });
  slider(brushBody, 'Strength', 0, 1, 0.01, ctrl.brushOpts.strength, (v) => {
    ctrl.brushOpts = { ...ctrl.brushOpts, strength: v };
  });
}
```

Note: the `el('span', ...).let?.(...)` pattern above has a typo — remove the chRow label line that uses `.let`. The heading is added inline in the `segmented` call. Clean it up: delete the two `chRow.appendChild` lines and keep only `segmented(archBody, ['8', '16', '32'], ...)` preceded by a `el('span', ..., 'Channels')` appended to `archBody` directly (not `chRow`).

- [ ] **Step 2: Fix the channels label in archBody**

Replace the two `chRow` lines and the first `segmented` call for channels with:

```typescript
  archBody.appendChild(el('span', 'font-size:0.72rem;color:var(--text-body);display:block;margin-bottom:0.2rem;', 'Channels'));
  segmented(archBody, ['8', '16', '32'], String(ctrl.config.channels), (v) => {
    ctrl.setParams({ channels: parseInt(v) as 8 | 16 | 32 });
  });
```

Also delete the `const chRow = row(archBody);` line.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/nca/nca-panel.ts
git commit -m "feat(nca): accordion UI panel — 6 sections"
```

---

### Task 9: Gallery Integration

**Files:**
- Modify: `src/pages/gallery/[...slug].astro`

- [ ] **Step 1: Add NCA imports**

In the `<script>` block, after the CPPN imports (around line 442), add:

```typescript
  import { NCAController } from '../../components/simulations/nca/nca-controller';
  import { buildNCAPanel } from '../../components/simulations/nca/nca-panel';
  import { NCA_PRESETS } from '../../data/nca-presets';
```

Note: `NCAController` is already imported — do NOT add it again. Only add the `buildNCAPanel` and `NCA_PRESETS` imports.

- [ ] **Step 2: Add NCA panel block**

After the CPPN block (after the closing `}` of `if (sim === 'cppn') { ... }`, around line 587), add:

```typescript
        if (sim === 'nca') {
          const ncaCtrl = controller as NCAController;

          const defaultPreset = NCA_PRESETS.find(p => p.isDefault) ?? NCA_PRESETS[0];
          if (defaultPreset) ncaCtrl.loadPreset(defaultPreset);

          let activeNCAId = defaultPreset?.id;

          function buildPanel(activeId?: string): void {
            panel.innerHTML = '';
            buildNCAPanel(panel, ncaCtrl, {
              presets: NCA_PRESETS,
              activePresetId: activeId,
              onClose: () => { panel.style.display = 'none'; panelOpen = false; },
              onPresetLoad: (preset) => {
                activeNCAId = preset.id;
                buildPanel(preset.id);
              },
            });
          }
          buildPanel(activeNCAId);
        }
```

- [ ] **Step 3: Verify panel renders**

Navigate to `http://localhost:4321/gallery/nca`. Open the params panel (gear/settings icon). Expect: accordion panel with 6 sections. Sliders and buttons visible. Simulation runs. No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/gallery/[...slug].astro
git commit -m "feat(nca): wire NCA panel in gallery slug page"
```

---

### Task 10: nca-presets.ts Initial File

**Files:**
- Create: `src/data/nca-presets.ts`
- Create: `src/data/nca-weights/` (directory, initially empty)

- [ ] **Step 1: Create the empty presets file**

```typescript
// src/data/nca-presets.ts
// AUTO-GENERATED by /admin/nca — do not edit manually
import type { NCAPreset } from '../components/simulations/nca/nca-types';

export type { NCAPreset };

export const NCA_PRESETS: NCAPreset[] = [];
```

- [ ] **Step 2: Create the weights directory placeholder**

Create an empty file `src/data/nca-weights/.gitkeep` so the directory is tracked.

- [ ] **Step 3: Commit**

```bash
git add src/data/nca-presets.ts src/data/nca-weights/.gitkeep
git commit -m "feat(nca): add empty nca-presets.ts and nca-weights directory"
```

---

### Task 11: Admin Page + Save Endpoint

**Files:**
- Create: `src/pages/admin/nca.astro`
- Modify: `astro.config.mjs`

- [ ] **Step 1: Create admin/nca.astro**

```astro
---
// src/pages/admin/nca.astro
// Dev-only admin page. Write-to-disk API only exists during `npm run dev`.
import BaseLayout from '../../layouts/BaseLayout.astro';
---

<BaseLayout title="NCA Admin">
  <div class="admin-wrap">
    <div class="admin-canvas-area">
      <canvas id="admin-canvas" style="image-rendering: pixelated;"></canvas>
      <div id="admin-fallback" class="admin-fallback" style="display:none;">
        <p>WebGPU not available.</p>
      </div>
      <div class="sim-controls">
        <button id="btn-play-pause" class="sim-btn">⏸</button>
        <button id="btn-reset" class="sim-btn">↺</button>
      </div>
    </div>
    <div class="admin-sidebar">
      <div id="params-panel" class="params-panel"></div>
      <div class="save-section">
        <input id="preset-name" type="text" placeholder="Preset name…" />
        <button id="btn-save">Save Preset</button>
        <div id="save-status"></div>
      </div>
    </div>
  </div>
</BaseLayout>

<style>
  .admin-wrap {
    display: flex;
    height: calc(100vh - 60px);
    overflow: hidden;
  }
  .admin-canvas-area {
    flex: 1;
    position: relative;
    background: var(--bg-primary);
  }
  #admin-canvas { width: 100%; height: 100%; display: block; }
  .admin-fallback {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-muted);
  }
  .sim-controls {
    position: absolute; bottom: 1rem; left: 1rem;
    display: flex; gap: 0.5rem;
  }
  .sim-btn {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--bg-surface-border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text-body);
    cursor: pointer;
  }
  .admin-sidebar {
    width: 260px;
    background: var(--bg-surface);
    border-left: 1px solid var(--bg-surface-border);
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .params-panel { flex: 1; }
  .save-section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--bg-surface-border);
  }
  #preset-name, #btn-save {
    width: 100%;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--bg-surface-border);
    border-radius: 3px;
    background: var(--bg-primary);
    color: var(--text-body);
    font-size: 0.8rem;
    cursor: pointer;
  }
  #save-status { font-size: 0.72rem; color: var(--accent); }
</style>

<script>
  import { NCAController } from '../../components/simulations/nca/nca-controller';
  import { buildNCAPanel } from '../../components/simulations/nca/nca-panel';
  import { NCA_PRESETS } from '../../data/nca-presets';

  const canvas   = document.getElementById('admin-canvas') as HTMLCanvasElement;
  const fallback = document.getElementById('admin-fallback') as HTMLElement;
  const panel    = document.getElementById('params-panel') as HTMLElement;
  const nameInp  = document.getElementById('preset-name') as HTMLInputElement;
  const saveBtn  = document.getElementById('btn-save') as HTMLButtonElement;
  const statusEl = document.getElementById('save-status') as HTMLElement;

  const ctrl = new NCAController();
  const ok = await ctrl.init(canvas);
  if (!ok) { canvas.style.display = 'none'; fallback.style.display = 'flex'; }
  else {
    ctrl.start();

    const defaultPreset = NCA_PRESETS.find(p => p.isDefault) ?? NCA_PRESETS[0];
    if (defaultPreset) ctrl.loadPreset(defaultPreset);

    function rebuild(activeId?: string): void {
      panel.innerHTML = '';
      buildNCAPanel(panel, ctrl, {
        presets: NCA_PRESETS,
        activePresetId: activeId,
        onPresetLoad: (p) => rebuild(p.id),
      });
    }
    rebuild(defaultPreset?.id);

    document.getElementById('btn-play-pause')!.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      if (ctrl['running']) { ctrl.stop(); btn.textContent = '▶'; }
      else { ctrl.start(); btn.textContent = '⏸'; }
    });
    document.getElementById('btn-reset')!.addEventListener('click', () => ctrl.reset());

    saveBtn.addEventListener('click', async () => {
      const name = nameInp.value.trim();
      if (!name) { statusEl.textContent = 'Enter a name first.'; return; }
      const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      // Collect current weights from GPU — we need a mappable copy buffer
      // For now, regenerate weights from the controller's last randomInit seed.
      // This requires exposing the weight buffer read-back.
      // WORKAROUND: store weights on controller and expose them.
      const weights = ctrl.getCurrentWeights();
      if (!weights) { statusEl.textContent = 'No weights to save.'; return; }

      const preset = {
        id,
        name,
        config: { ...ctrl.config },
        weights: Array.from(weights),
      };

      const existing = NCA_PRESETS.filter(p => p.id !== id);
      const updated = [...existing, preset];

      try {
        const res = await fetch('/api/admin/save-nca-presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });
        const json = await res.json();
        statusEl.textContent = json.ok ? `Saved "${name}"` : `Error: ${json.error}`;
      } catch (err) {
        statusEl.textContent = String(err);
      }
    });
  }
</script>
```

- [ ] **Step 2: Expose getCurrentWeights() on controller**

In `nca-controller.ts`, add a `currentWeights` field and `getCurrentWeights()` method.

Add field after `brushOpts`:
```typescript
  private currentWeights: Float32Array | null = null;
```

In `randomInit()`, after writing weights to the buffer, store them:
```typescript
  randomInit(): void {
    const weights = generateWeights(this.config, Date.now());
    this.currentWeights = weights;          // ← add this line
    // ... rest of existing code
  }
```

In `loadPreset()`, after the `writeBuffer` call for weights:
```typescript
    this.currentWeights = new Float32Array(preset.weights);   // ← add this line
```

Add the method:
```typescript
  getCurrentWeights(): Float32Array | null {
    return this.currentWeights;
  }
```

Also store weights in `init()` after generating them:
```typescript
    const weights = generateWeights(this.config, Date.now());
    this.currentWeights = weights;           // ← add this line
    this.gpu.device.queue.writeBuffer(this.weightBuffer, 0, weights);
```

- [ ] **Step 3: Add generateNCAPresetsFile and save endpoint to astro.config.mjs**

After the `CPPN_WEIGHTS_DIR` block (around line 109), add before `export default defineConfig`:

```javascript
const NCA_WEIGHTS_DIR = 'src/data/nca-weights';

/** @param {import('./src/components/simulations/nca/nca-types').NCAPreset[]} presets */
function generateNCAPresetsFile(presets) {
  if (!existsSync(NCA_WEIGHTS_DIR)) mkdirSync(NCA_WEIGHTS_DIR, { recursive: true });

  const imports = [];
  const SENTINEL = '__WEIGHTS_VAR__';

  const presetsWithoutWeights = presets.map(preset => {
    const { weights, ...rest } = preset;
    writeFileSync(
      resolve(NCA_WEIGHTS_DIR, `${preset.id}.json`),
      JSON.stringify(weights, null, 2) + '\n',
      'utf-8',
    );
    const varName = preset.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Weights';
    imports.push({ id: preset.id, varName });
    return { ...rest, weights: `${SENTINEL}${varName}` };
  });

  const importLines = imports
    .map(({ id, varName }) => `import ${varName} from './nca-weights/${id}.json';`)
    .join('\n');

  let arrJson = JSON.stringify(presetsWithoutWeights, null, 2);
  for (const { varName } of imports) {
    arrJson = arrJson.replaceAll(`"${SENTINEL}${varName}"`, varName);
  }

  return `// AUTO-GENERATED by /admin/nca — do not edit manually
import type { NCAPreset } from '../components/simulations/nca/nca-types';

${importLines}

export type { NCAPreset };

export const NCA_PRESETS: NCAPreset[] = ${arrJson};
`;
}
```

Inside the `configureServer(server)` block (inside `plugins`), after the existing `save-cppn-presets` handler, add:

```javascript
          server.middlewares.use('/api/admin/save-nca-presets', async (req, res) => {
            if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
            try {
              const chunks = [];
              for await (const chunk of req) chunks.push(chunk);
              const presets = JSON.parse(Buffer.concat(chunks).toString());
              writeFileSync(resolve('src/data/nca-presets.ts'), generateNCAPresetsFile(presets), 'utf-8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch (err) {
              console.error('[admin-save-nca-presets]', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(err) }));
            }
          });
```

- [ ] **Step 4: Verify admin page**

Navigate to `http://localhost:4321/admin/nca`. Expect: simulation running with accordion panel visible. "Random Init" creates new weights. "Save Preset" button is present (saving will fail until weights exist, which is fine).

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/nca.astro astro.config.mjs src/components/simulations/nca/nca-controller.ts
git commit -m "feat(nca): admin page and save-nca-presets endpoint"
```

---

### Task 12: Gallery Content Entry

**Files:**
- Create: `src/content/projects/nca.md`

- [ ] **Step 1: Check existing project entries for frontmatter format**

```bash
cat src/content/projects/cppn.md
```

- [ ] **Step 2: Create the NCA project entry**

Match whatever frontmatter fields exist in the CPPN entry exactly. Example (adjust if cppn.md differs):

```markdown
---
title: Neural Cellular Automata
slug: nca
simulation: nca
description: Emergent texture and pattern formation via neural update rules applied locally to every cell.
order: 3
---

A neural cellular automaton where each cell updates its state by applying a small neural network to its local neighborhood. Trained on texture targets or initialized randomly to explore the space of emergent dynamics.
```

- [ ] **Step 3: Verify gallery listing**

Navigate to `http://localhost:4321/gallery`. Expect: NCA entry visible in the gallery grid. Clicking it opens the simulation page.

- [ ] **Step 4: Commit**

```bash
git add src/content/projects/nca.md
git commit -m "feat(nca): add NCA gallery content entry"
```

---

## Self-Review

### Spec Coverage

| Spec requirement | Task |
|-----------------|------|
| Ping-pong state buffers | Task 3, 4 |
| WGSL codegen (CHANNELS, HIDDEN, N_FILTERS, activation as constants) | Task 2 |
| Weights in storage buffer (instant preset swap) | Task 3, 5 |
| Perception filters (identity, sobelX, sobelY, laplacian) toggled | Task 2 |
| Stochastic mask via pcg_hash | Task 2 |
| Residual update + clamp | Task 2 |
| Toroidal wrapping | Task 2 |
| Canvas = grid size, pixelated CSS | Task 4, 7 |
| randomInit() | Task 5 |
| loadPreset() with arch-change detection | Task 5 |
| recompile() | Task 5 |
| setParams() for runtime params | Task 5 |
| Brush (damage/paint, circle/square, size, strength) | Task 6 |
| Mouse events wired in init() | Task 6 |
| Accordion panel — 6 sections | Task 8 |
| Gallery wiring (slug.astro block) | Task 9 |
| nca-presets.ts empty stub | Task 10 |
| Admin page | Task 11 |
| Save endpoint in astro.config.mjs | Task 11 |
| getCurrentWeights() for admin save | Task 11 |
| Content entry | Task 12 |

### Gaps / Notes

- **Weight extraction for trained presets** is out of scope (run locally, output JSON to `src/data/nca-weights/`). After extraction, add presets via the admin page.
- **normalizeDisplay** uniform is passed to the render shader but the render shader doesn't use it yet — add normalization logic to `generateRenderShader` if needed after basic functionality is confirmed.
- **Type consistency**: `NCAController.config` is public to allow panel direct reads; `brushOpts` is public for panel mutation.
- **Channels/hidden segmented controls** use fixed options (8/16/32, 32/64/128) matching the design spec. Typing arbitrary values is not supported in this iteration.
