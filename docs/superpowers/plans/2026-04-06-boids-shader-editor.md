# Boids Shader Editor & Appearance Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live WGSL shader editor, GPU trails, particle size/shape/color controls, and a reorganized closeable params panel to the boids simulation.

**Architecture:** A new `TrailRenderer` class handles ping-pong trail textures and compositing. `BoidsController` is extended with appearance params and a `reloadShader()` method. The gallery page's params panel is reorganized with categories and new appearance controls, plus a CodeMirror 6 editor panel.

**Tech Stack:** WebGPU/WGSL, TypeScript, Astro, CodeMirror 6 (`codemirror`, `@codemirror/legacy-modes`, `@codemirror/language`)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/components/simulations/boids/trail.wgsl` | Fade and blit fullscreen-quad shaders |
| Create | `src/components/simulations/boids/trail-renderer.ts` | Ping-pong trail textures, fade pass, blit pass |
| Modify | `src/components/simulations/boids/boids.wgsl` | Expanded Params struct, quad vertex, SDF shapes, color uniforms |
| Modify | `src/components/simulations/boids/boids-controller.ts` | New params, pipeline extraction, TrailRenderer wiring, reloadShader() |
| Modify | `src/pages/gallery/[...slug].astro` | Panel close button, categorized params, shape/color/trail controls, CodeMirror panel |

---

## Task 1: Install CodeMirror Dependencies

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install packages**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
npm install codemirror @codemirror/legacy-modes @codemirror/language
```

Expected output: packages added with no peer dependency errors.

- [ ] **Step 2: Verify install**

```bash
grep -E "codemirror|legacy-modes" package.json
```

Expected: all three packages appear in `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add codemirror dependencies for shader editor"
```

---

## Task 2: Update `boids.wgsl` — Params, Quad Vertex, SDF Shapes, Color

**Files:**
- Modify: `src/components/simulations/boids/boids.wgsl`

Replace the entire file with the following. The compute shader body is unchanged — only the `Params` struct, vertex shader, and fragment shader change.

- [ ] **Step 1: Replace `boids.wgsl` with expanded version**

```wgsl
struct Particle {
  pos: vec2f,
  vel: vec2f,
}

struct Params {
  deltaTime:    f32,  // 0
  outerRadius:  f32,  // 4  — attraction + alignment range
  innerRadius:  f32,  // 8  — repulsion range
  attraction:   f32,  // 12
  repulsion:    f32,  // 16
  alignment:    f32,  // 20
  friction:     f32,  // 24 — quadratic drag coefficient
  maxSpeed:     f32,  // 28
  numParticles: u32,  // 32
  mouseX:       f32,  // 36
  mouseY:       f32,  // 40
  mouseActive:  f32,  // 44
  mouseRadius:  f32,  // 48
  coneAngle:    f32,  // 52 — FOV threshold
  aspect:       f32,  // 56 — canvas width/height
  size:         f32,  // 60 — particle scale (default 0.02)
  shapeId:      u32,  // 64 — 0=triangle 1=circle 2=diamond 3=blob
  colorR:       f32,  // 68
  colorG:       f32,  // 72
  colorB:       f32,  // 76
  _pad0:        f32,  // 80
  _pad1:        f32,  // 84
  _pad2:        f32,  // 88
  _pad3:        f32,  // 92
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particlesA: array<Particle>;
@group(0) @binding(2) var<storage, read_write> particlesB: array<Particle>;

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.numParticles) { return; }

  var pos = particlesA[index].pos;
  var vel = particlesA[index].vel;

  var force = vec2f(0.0);
  let speed = length(vel);
  let has_vel = speed > 0.0001;

  for (var i = 0u; i < params.numParticles; i++) {
    if (i == index) { continue; }
    let other = particlesA[i];
    let diff = other.pos - pos;
    let r = length(diff);
    if (r < 0.0001) { continue; }

    let diff_dir = diff / r;

    var pointing = 0.0;
    if (has_vel) {
      pointing = dot(vel / speed, diff_dir);
    }

    if (r < params.outerRadius && pointing > params.coneAngle) {
      force += params.attraction * diff_dir / (r * r + 0.001);
      force += params.alignment * (other.vel - vel);
    }

    if (r < params.innerRadius) {
      force -= params.repulsion * diff_dir / (r * r + 0.0001);
    }
  }

  let friction = -params.friction * sign(vel) * vel * vel;

  vel = vel + params.deltaTime * (force + friction);

  let sp = length(vel);
  if (sp > params.maxSpeed && sp > 0.0001) {
    vel = vel * (params.maxSpeed / sp);
  }

  if (params.mouseActive > 0.5) {
    let toMouse = vec2f(params.mouseX, params.mouseY) - pos;
    let mouseDist = length(toMouse);
    if (mouseDist < params.mouseRadius && mouseDist > 0.0001) {
      vel += normalize(toMouse) * 0.005;
    }
  }

  pos = pos + vel * params.deltaTime;

  if (pos.x < -1.0) { pos.x += 2.0; }
  if (pos.x > 1.0)  { pos.x -= 2.0; }
  if (pos.y < -1.0) { pos.y += 2.0; }
  if (pos.y > 1.0)  { pos.y -= 2.0; }

  particlesB[index] = Particle(pos, vel);
}

// --- Render ---

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
  @location(1) uv: vec2f,
}

@vertex
fn vertexMain(
  @location(0) particlePos: vec2f,
  @location(1) particleVel: vec2f,
  @location(2) vertexPos: vec2f,
) -> VertexOutput {
  // Subtract π/2 so tip (starting at +y) aligns with velocity
  let angle = atan2(particleVel.y, particleVel.x) - 1.5707963;
  let cosA = cos(angle);
  let sinA = sin(angle);
  let scaled = vertexPos * params.size;
  let rotated = vec2f(
    scaled.x * cosA - scaled.y * sinA,
    scaled.x * sinA + scaled.y * cosA,
  );
  var out: VertexOutput;
  out.position = vec4f(particlePos + vec2f(rotated.x / params.aspect, rotated.y), 0.0, 1.0);
  out.alpha = clamp(length(particleVel) * 5.0, 0.3, 1.0);
  out.uv = vertexPos; // pre-rotation UV for SDF (-1..1)
  return out;
}

// Equilateral triangle SDF (IQ), inside <= 0, pointing +y
fn sdTriangle(p: vec2f) -> f32 {
  let k = sqrt(3.0);
  var q = vec2f(abs(p.x) - 1.0, p.y + 1.0 / k);
  if q.x + k * q.y > 0.0 {
    q = vec2f(q.x - k * q.y, -k * q.x - q.y) / 2.0;
  }
  q.x = q.x - clamp(q.x, -2.0, 0.0);
  return -length(q) * sign(q.y);
}

@fragment
fn fragmentMain(@location(0) alpha: f32, @location(1) uv: vec2f) -> @location(0) vec4f {
  var mask: f32 = 1.0;

  switch params.shapeId {
    case 0u: { // triangle
      if sdTriangle(uv) > 0.0 { discard; }
    }
    case 1u: { // circle
      if length(uv) > 1.0 { discard; }
    }
    case 2u: { // diamond
      if abs(uv.x) + abs(uv.y) > 1.0 { discard; }
    }
    case 3u: { // soft blob — feathered circle
      let d = length(uv);
      if d > 1.0 { discard; }
      mask = 1.0 - smoothstep(0.4, 1.0, d);
    }
    default: {}
  }

  return vec4f(params.colorR, params.colorG, params.colorB, alpha * mask);
}
```

- [ ] **Step 2: Verify the shader compiles**

Run the dev server and open `http://localhost:4321/gallery/boids`. The simulation should render orange triangles exactly as before. Check browser console for WebGPU errors.

```bash
npm run dev
```

Expected: boids flocking visible, no console errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/boids/boids.wgsl
git commit -m "feat(boids): expand shader — quad vertex, SDF shapes, color uniforms"
```

---

## Task 3: Update `boids-controller.ts` — New Params, Pipeline Extraction, reloadShader()

**Files:**
- Modify: `src/components/simulations/boids/boids-controller.ts`

Key changes:
- `TRIANGLE_VERTS` → `QUAD_VERTS` (6-vertex billboard quad, -1..1)
- `BoidsParams` gains: `size`, `shapeId`, `colorR`, `colorG`, `colorB`
- Uniform buffer: 64 → 96 bytes
- Extract `_createPipelines(module)` private method (used by `init` and `reloadShader`)
- Store `bindGroupLayout` on instance
- Add `reloadShader()` and expose `shaderSource`

- [ ] **Step 1: Replace `boids-controller.ts`**

```typescript
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { createBuffer, createUniformBuffer, resizeCanvasToDisplaySize } from '../../../lib/webgpu/utils';
import shaderCode from './boids.wgsl?raw';

const MAX_PARTICLES = 2000;

// Quad billboard (-1..1), 6 vertices = 2 triangles. Scaled by params.size in vertex shader.
const QUAD_VERTS = new Float32Array([
  -1.0, -1.0,
   1.0, -1.0,
  -1.0,  1.0,
  -1.0,  1.0,
   1.0, -1.0,
   1.0,  1.0,
]);

export interface BoidsParams {
  dt: number;
  numParticles: number;
  outerRadius: number;
  innerRadius: number;
  attraction: number;
  repulsion: number;
  alignment: number;
  friction: number;
  maxSpeed: number;
  mouseRadius: number;
  coneAngle: number;
  size: number;
  shapeId: number;
  colorR: number;
  colorG: number;
  colorB: number;
}

const DEFAULT_PARAMS: BoidsParams = {
  dt: 0.016,
  numParticles: 200,
  outerRadius: 0.2,
  innerRadius: 0.05,
  attraction: 0.3,
  repulsion: 1.5,
  alignment: 0.1,
  friction: 2.0,
  maxSpeed: 0.22,
  mouseRadius: 0.15,
  coneAngle: -0.5,
  size: 0.02,
  shapeId: 0,
  colorR: 0.88,
  colorG: 0.63,
  colorB: 0.25,
};

export class BoidsController {
  private gpu: WebGPUContext | null = null;
  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private bindGroupLayout!: GPUBindGroupLayout;
  private particleBuffers!: GPUBuffer[];
  private uniformBuffer!: GPUBuffer;
  private vertexBuffer!: GPUBuffer;
  private bindGroups!: GPUBindGroup[];
  private frame = 0;
  private running = false;
  private animId = 0;
  private mouseX = 0;
  private mouseY = 0;
  private mouseActive = false;
  private renderParamsBindGroup!: GPUBindGroup;

  params: BoidsParams = { ...DEFAULT_PARAMS };
  trailsEnabled = false;
  trailDecay = 0.92;
  readonly shaderSource = shaderCode;

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      this.gpu = await initWebGPU(canvas);
      if (!this.gpu) return false;

      const { device } = this.gpu;

      this.uniformBuffer = createUniformBuffer(device, 96);

      const initialData = new Float32Array(MAX_PARTICLES * 4);
      for (let i = 0; i < MAX_PARTICLES; i++) {
        initialData[i * 4 + 0] = (Math.random() - 0.5) * 2;
        initialData[i * 4 + 1] = (Math.random() - 0.5) * 2;
        initialData[i * 4 + 2] = (Math.random() - 0.5) * 0.1;
        initialData[i * 4 + 3] = (Math.random() - 0.5) * 0.1;
      }

      const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX;
      this.particleBuffers = [
        createBuffer(device, initialData, usage),
        createBuffer(device, initialData, usage),
      ];

      this.vertexBuffer = createBuffer(device, QUAD_VERTS, GPUBufferUsage.VERTEX);

      this.bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
      });

      this.bindGroups = [
        device.createBindGroup({
          layout: this.bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer } },
            { binding: 1, resource: { buffer: this.particleBuffers[0] } },
            { binding: 2, resource: { buffer: this.particleBuffers[1] } },
          ],
        }),
        device.createBindGroup({
          layout: this.bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer } },
            { binding: 1, resource: { buffer: this.particleBuffers[1] } },
            { binding: 2, resource: { buffer: this.particleBuffers[0] } },
          ],
        }),
      ];

      const shaderModule = device.createShaderModule({ code: shaderCode });
      this._createPipelines(shaderModule);

      canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        this.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        this.mouseActive = true;
      });
      canvas.addEventListener('mouseleave', () => { this.mouseActive = false; });

      return true;
    } catch (e) {
      console.error('BoidsController init error:', e);
      return false;
    }
  }

  private _createPipelines(module: GPUShaderModule): void {
    const { device, format } = this.gpu!;

    this.computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      compute: { module, entryPoint: 'computeMain' },
    });

    this.renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 4 * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
            ],
          },
          {
            arrayStride: 4 * 2,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 2, offset: 0, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fragmentMain',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.renderParamsBindGroup = device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  async reloadShader(code: string): Promise<{ success: boolean; errors: GPUCompilationMessage[] }> {
    if (!this.gpu) return { success: false, errors: [] };
    const { device } = this.gpu;
    const module = device.createShaderModule({ code });
    const info = await module.compilationInfo();
    const errors = Array.from(info.messages).filter(m => m.type === 'error');
    if (errors.length > 0) return { success: false, errors };
    this._createPipelines(module);
    return { success: true, errors: [] };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.animId);
  }

  reset() {
    if (!this.gpu) return;
    const { device } = this.gpu;
    const data = new Float32Array(MAX_PARTICLES * 4);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      data[i * 4 + 0] = (Math.random() - 0.5) * 2;
      data[i * 4 + 1] = (Math.random() - 0.5) * 2;
      data[i * 4 + 2] = (Math.random() - 0.5) * 0.1;
      data[i * 4 + 3] = (Math.random() - 0.5) * 0.1;
    }
    device.queue.writeBuffer(this.particleBuffers[0], 0, data);
    device.queue.writeBuffer(this.particleBuffers[1], 0, data);
    this.frame = 0;
  }

  private tick = () => {
    if (!this.running || !this.gpu) return;
    const { device, context, canvas } = this.gpu;

    resizeCanvasToDisplaySize(canvas);

    const aspect = canvas.width > 0 && canvas.height > 0
      ? canvas.width / canvas.height : 1.0;

    const uniformArray = new ArrayBuffer(96);
    const v = new DataView(uniformArray);
    v.setFloat32( 0, this.params.dt,                   true);
    v.setFloat32( 4, this.params.outerRadius,          true);
    v.setFloat32( 8, this.params.innerRadius,          true);
    v.setFloat32(12, this.params.attraction,           true);
    v.setFloat32(16, this.params.repulsion,            true);
    v.setFloat32(20, this.params.alignment,            true);
    v.setFloat32(24, this.params.friction,             true);
    v.setFloat32(28, this.params.maxSpeed,             true);
    v.setUint32 (32, this.params.numParticles,         true);
    v.setFloat32(36, this.mouseX,                      true);
    v.setFloat32(40, this.mouseY,                      true);
    v.setFloat32(44, this.mouseActive ? 1.0 : 0.0,     true);
    v.setFloat32(48, this.params.mouseRadius,          true);
    v.setFloat32(52, this.params.coneAngle,            true);
    v.setFloat32(56, aspect,                           true);
    v.setFloat32(60, this.params.size,                 true);
    v.setUint32 (64, this.params.shapeId,              true);
    v.setFloat32(68, this.params.colorR,               true);
    v.setFloat32(72, this.params.colorG,               true);
    v.setFloat32(76, this.params.colorB,               true);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniformArray);

    const encoder = device.createCommandEncoder();

    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.bindGroups[this.frame % 2]);
    computePass.dispatchWorkgroups(Math.ceil(this.params.numParticles / 64));
    computePass.end();

    const textureView = context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.039, g: 0.031, b: 0.016, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderParamsBindGroup);
    renderPass.setVertexBuffer(0, this.particleBuffers[(this.frame + 1) % 2]);
    renderPass.setVertexBuffer(1, this.vertexBuffer);
    renderPass.draw(6, this.params.numParticles);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    this.frame++;
    this.animId = requestAnimationFrame(this.tick);
  };
}
```

Note: `trailsEnabled` and `trailDecay` are properties on the controller but not yet wired into rendering — that happens in Task 6. The `tick()` here still renders directly to the swapchain; TrailRenderer integration comes later.

- [ ] **Step 2: Verify in browser**

Open `http://localhost:4321/gallery/boids`. Boids should look identical to before (orange triangles, same size). Check console for errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulations/boids/boids-controller.ts
git commit -m "feat(boids): new params, pipeline extraction, reloadShader, quad vertex buffer"
```

---

## Task 4: Create `trail.wgsl`

**Files:**
- Create: `src/components/simulations/boids/trail.wgsl`

- [ ] **Step 1: Create the file**

```wgsl
// Shared vertex shader for fullscreen quad passes.
// Covers clip space using a 6-vertex triangle list (no vertex buffer needed).
struct QuadOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn quadVert(@builtin(vertex_index) vi: u32) -> QuadOutput {
  var pos = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),
  );
  // UV: (0,0) top-left → (1,1) bottom-right, flipped y for texture coordinates
  var uv = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0),
  );
  var out: QuadOutput;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.uv = uv[vi];
  return out;
}

// Fade pass: sample trail texture, multiply by decay factor.
@group(0) @binding(0) var fadeSampler: sampler;
@group(0) @binding(1) var fadeTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> decayFactor: f32;

@fragment
fn fadeFrag(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSample(fadeTex, fadeSampler, uv);
  return vec4f(c.rgb * decayFactor, c.a);
}

// Blit pass: copy trail texture to swapchain unchanged.
@group(0) @binding(0) var blitSampler: sampler;
@group(0) @binding(1) var blitTex: texture_2d<f32>;

@fragment
fn blitFrag(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(blitTex, blitSampler, uv);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/simulations/boids/trail.wgsl
git commit -m "feat(boids): add trail.wgsl for fade and blit passes"
```

---

## Task 5: Create `trail-renderer.ts`

**Files:**
- Create: `src/components/simulations/boids/trail-renderer.ts`

- [ ] **Step 1: Create the file**

```typescript
import trailShader from './trail.wgsl?raw';

export class TrailRenderer {
  private fadePipeline!: GPURenderPipeline;
  private blitPipeline!: GPURenderPipeline;
  private sampler!: GPUSampler;
  private decayBuffer!: GPUBuffer;
  private trailTextures: GPUTexture[] = [];
  private trailViews: GPUTextureView[] = [];
  private fadeBindGroups: GPUBindGroup[] = [];
  private blitBindGroups: GPUBindGroup[] = [];
  private readIdx = 0;
  private writeIdx = 1;

  init(device: GPUDevice, format: GPUTextureFormat, width: number, height: number): void {
    const module = device.createShaderModule({ code: trailShader });

    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    this.decayBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.fadePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'quadVert' },
      fragment: {
        module,
        entryPoint: 'fadeFrag',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.blitPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'quadVert' },
      fragment: {
        module,
        entryPoint: 'blitFrag',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this._createTextures(device, width, height);
  }

  private _createTextures(device: GPUDevice, width: number, height: number): void {
    this.trailTextures.forEach(t => t.destroy());

    const desc: GPUTextureDescriptor = {
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    };
    this.trailTextures = [device.createTexture(desc), device.createTexture(desc)];
    this.trailViews = this.trailTextures.map(t => t.createView());

    this.fadeBindGroups = [0, 1].map(i =>
      device.createBindGroup({
        layout: this.fadePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: this.trailViews[i] },
          { binding: 2, resource: { buffer: this.decayBuffer } },
        ],
      })
    );

    this.blitBindGroups = [0, 1].map(i =>
      device.createBindGroup({
        layout: this.blitPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: this.trailViews[i] },
        ],
      })
    );

    this.readIdx = 0;
    this.writeIdx = 1;
  }

  resize(device: GPUDevice, width: number, height: number): void {
    this._createTextures(device, width, height);
  }

  /**
   * Orchestrates one composited frame.
   *
   * When trailsEnabled:
   *   1. Fade pass: trailTex[read] * decayFactor → trailTex[write]
   *   2. Particle pass: particlePassFn adds boids onto trailTex[write] (loadOp: 'load')
   *   3. Blit pass: trailTex[write] → swapchain
   *
   * When !trailsEnabled:
   *   particlePassFn renders directly to swapchain (loadOp: 'clear'), no trail cost.
   */
  render(
    device: GPUDevice,
    context: GPUCanvasContext,
    decayFactor: number,
    trailsEnabled: boolean,
    particlePassFn: (encoder: GPUCommandEncoder, targetView: GPUTextureView, loadOp: GPULoadOp) => void,
  ): void {
    if (!trailsEnabled) {
      const encoder = device.createCommandEncoder();
      particlePassFn(encoder, context.getCurrentTexture().createView(), 'clear');
      device.queue.submit([encoder.finish()]);
      return;
    }

    device.queue.writeBuffer(this.decayBuffer, 0, new Float32Array([decayFactor]));

    const encoder = device.createCommandEncoder();

    // 1. Fade: read → write
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.trailViews[this.writeIdx],
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setPipeline(this.fadePipeline);
      pass.setBindGroup(0, this.fadeBindGroups[this.readIdx]);
      pass.draw(6);
      pass.end();
    }

    // 2. Particle pass onto trail write texture
    particlePassFn(encoder, this.trailViews[this.writeIdx], 'load');

    // 3. Blit write → swapchain
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setPipeline(this.blitPipeline);
      pass.setBindGroup(0, this.blitBindGroups[this.writeIdx]);
      pass.draw(6);
      pass.end();
    }

    device.queue.submit([encoder.finish()]);

    // Swap ping-pong indices
    this.readIdx = this.writeIdx;
    this.writeIdx = 1 - this.writeIdx;
  }

  destroy(): void {
    this.trailTextures.forEach(t => t.destroy());
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/simulations/boids/trail-renderer.ts
git commit -m "feat(boids): add TrailRenderer — ping-pong trail textures, fade, blit"
```

---

## Task 6: Wire `TrailRenderer` into `boids-controller.ts`

**Files:**
- Modify: `src/components/simulations/boids/boids-controller.ts`

Replace the `tick()` method and add `TrailRenderer` instantiation.

- [ ] **Step 1: Add import at the top of `boids-controller.ts`**

Add after existing imports:
```typescript
import { TrailRenderer } from './trail-renderer';
```

- [ ] **Step 2: Add `trailRenderer` field to the class**

Add to the class fields (alongside `private gpu`, etc.):
```typescript
private trailRenderer = new TrailRenderer();
private prevCanvasWidth = 0;
private prevCanvasHeight = 0;
```

- [ ] **Step 3: Initialize TrailRenderer in `init()` after `_createPipelines(shaderModule)`**

Add these two lines immediately after `this._createPipelines(shaderModule);`:
```typescript
this.trailRenderer.init(device, this.gpu!.format, canvas.width || 1, canvas.height || 1);
this.prevCanvasWidth = canvas.width;
this.prevCanvasHeight = canvas.height;
```

- [ ] **Step 4: Replace the entire `tick` method**

Replace the existing `private tick = () => { ... };` with:

```typescript
private tick = () => {
  if (!this.running || !this.gpu) return;
  const { device, context, canvas } = this.gpu;

  const resized = resizeCanvasToDisplaySize(canvas);
  if (resized || canvas.width !== this.prevCanvasWidth || canvas.height !== this.prevCanvasHeight) {
    this.trailRenderer.resize(device, canvas.width, canvas.height);
    this.prevCanvasWidth = canvas.width;
    this.prevCanvasHeight = canvas.height;
  }

  const aspect = canvas.width > 0 && canvas.height > 0
    ? canvas.width / canvas.height : 1.0;

  const uniformArray = new ArrayBuffer(96);
  const v = new DataView(uniformArray);
  v.setFloat32( 0, this.params.dt,                   true);
  v.setFloat32( 4, this.params.outerRadius,          true);
  v.setFloat32( 8, this.params.innerRadius,          true);
  v.setFloat32(12, this.params.attraction,           true);
  v.setFloat32(16, this.params.repulsion,            true);
  v.setFloat32(20, this.params.alignment,            true);
  v.setFloat32(24, this.params.friction,             true);
  v.setFloat32(28, this.params.maxSpeed,             true);
  v.setUint32 (32, this.params.numParticles,         true);
  v.setFloat32(36, this.mouseX,                      true);
  v.setFloat32(40, this.mouseY,                      true);
  v.setFloat32(44, this.mouseActive ? 1.0 : 0.0,     true);
  v.setFloat32(48, this.params.mouseRadius,          true);
  v.setFloat32(52, this.params.coneAngle,            true);
  v.setFloat32(56, aspect,                           true);
  v.setFloat32(60, this.params.size,                 true);
  v.setUint32 (64, this.params.shapeId,              true);
  v.setFloat32(68, this.params.colorR,               true);
  v.setFloat32(72, this.params.colorG,               true);
  v.setFloat32(76, this.params.colorB,               true);
  device.queue.writeBuffer(this.uniformBuffer, 0, uniformArray);

  // Compute pass
  const computeEncoder = device.createCommandEncoder();
  const computePass = computeEncoder.beginComputePass();
  computePass.setPipeline(this.computePipeline);
  computePass.setBindGroup(0, this.bindGroups[this.frame % 2]);
  computePass.dispatchWorkgroups(Math.ceil(this.params.numParticles / 64));
  computePass.end();
  device.queue.submit([computeEncoder.finish()]);

  // Render pass (delegated to TrailRenderer for compositing)
  this.trailRenderer.render(
    device,
    context,
    this.trailDecay,
    this.trailsEnabled,
    (encoder, targetView, loadOp) => {
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: targetView,
          clearValue: { r: 0.039, g: 0.031, b: 0.016, a: 1 },
          loadOp,
          storeOp: 'store',
        }],
      });
      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.renderParamsBindGroup);
      renderPass.setVertexBuffer(0, this.particleBuffers[(this.frame + 1) % 2]);
      renderPass.setVertexBuffer(1, this.vertexBuffer);
      renderPass.draw(6, this.params.numParticles);
      renderPass.end();
    },
  );

  this.frame++;
  this.animId = requestAnimationFrame(this.tick);
};
```

- [ ] **Step 5: Verify in browser**

Open `http://localhost:4321/gallery/boids`. Boids should look identical to before. No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/simulations/boids/boids-controller.ts
git commit -m "feat(boids): wire TrailRenderer into tick(), trails off by default"
```

---

## Task 7: Update `[...slug].astro` — Panel, Controls, Shader Editor

**Files:**
- Modify: `src/pages/gallery/[...slug].astro`

This task replaces the entire `<script>` block and adds new CSS. The HTML structure is unchanged.

- [ ] **Step 1: Add new CSS classes inside the existing `<style>` block**

Add the following inside the `<style>` block, after the existing `.params-panel :global(input[type=range])` rule:

```css
  .params-panel :global(.panel-header) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.2rem;
  }

  .params-panel :global(.panel-close) {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0;
  }

  .params-panel :global(.panel-close:hover) {
    color: var(--text-primary);
  }

  .params-panel :global(.section-divider) {
    height: 1px;
    background: var(--bg-surface-border);
    margin: 0.4rem 0 0.3rem;
  }

  .params-panel :global(.section-heading) {
    font-size: 0.6rem;
    letter-spacing: 1.5px;
    color: var(--text-muted);
    text-transform: uppercase;
    margin: 0 0 0.25rem;
  }

  .params-panel :global(.shape-row) {
    display: flex;
    gap: 0.35rem;
    margin-top: 0.15rem;
  }

  .params-panel :global(.shape-btn) {
    flex: 1;
    height: 28px;
    border: 1px solid var(--bg-surface-border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-body);
    cursor: pointer;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color var(--transition-speed);
  }

  .params-panel :global(.shape-btn.active) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .params-panel :global(.color-row) {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    margin-top: 0.15rem;
    flex-wrap: wrap;
  }

  .params-panel :global(.color-swatch) {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    flex-shrink: 0;
  }

  .params-panel :global(.color-swatch.active) {
    border-color: var(--text-primary);
  }

  .params-panel :global(.color-picker) {
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 50%;
    padding: 0;
    cursor: pointer;
    background: none;
    flex-shrink: 0;
  }

  .params-panel :global(.trail-row) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.72rem;
    color: var(--text-body);
  }

  .params-panel :global(.toggle-switch) {
    position: relative;
    width: 32px;
    height: 18px;
  }

  .params-panel :global(.toggle-switch input) {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .params-panel :global(.toggle-slider) {
    position: absolute;
    inset: 0;
    background: var(--bg-surface-border);
    border-radius: 18px;
    cursor: pointer;
    transition: background var(--transition-speed);
  }

  .params-panel :global(.toggle-slider::before) {
    content: '';
    position: absolute;
    width: 12px;
    height: 12px;
    left: 3px;
    top: 3px;
    background: var(--text-muted);
    border-radius: 50%;
    transition: transform var(--transition-speed), background var(--transition-speed);
  }

  .params-panel :global(.toggle-switch input:checked + .toggle-slider) {
    background: var(--accent);
  }

  .params-panel :global(.toggle-switch input:checked + .toggle-slider::before) {
    transform: translateX(14px);
    background: var(--bg-primary);
  }

  .params-panel :global(.edit-shader-btn) {
    width: 100%;
    padding: 0.35rem 0;
    background: transparent;
    border: 1px solid var(--bg-surface-border);
    border-radius: 4px;
    color: var(--text-body);
    font-size: 0.72rem;
    cursor: pointer;
    text-align: center;
    transition: border-color var(--transition-speed), color var(--transition-speed);
  }

  .params-panel :global(.edit-shader-btn:hover) {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Shader editor panel */
  .shader-panel {
    position: absolute;
    top: 1rem;
    right: 250px;
    width: 520px;
    max-height: 75vh;
    background: var(--bg-nav);
    border: 1px solid var(--bg-surface-border);
    border-radius: var(--border-radius);
    backdrop-filter: blur(8px);
    z-index: 20;
    display: flex;
    flex-direction: column;
  }

  .shader-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--bg-surface-border);
    font-size: 0.65rem;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .shader-panel-close {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0;
  }

  .shader-panel-close:hover {
    color: var(--text-primary);
  }

  .shader-editor-wrap {
    flex: 1;
    overflow: auto;
    font-size: 0.72rem;
  }

  /* CodeMirror overrides */
  .shader-editor-wrap :global(.cm-editor) {
    height: 100%;
    min-height: 200px;
    max-height: 55vh;
  }

  .shader-editor-wrap :global(.cm-scroller) {
    overflow: auto;
    font-family: monospace;
    font-size: 0.72rem;
  }

  .shader-panel-footer {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.6rem 0.75rem;
    border-top: 1px solid var(--bg-surface-border);
    flex-direction: column;
  }

  .shader-btn-row {
    display: flex;
    gap: 0.5rem;
  }

  .shader-apply-btn,
  .shader-reset-btn {
    padding: 0.3rem 0.75rem;
    border-radius: 4px;
    border: 1px solid var(--bg-surface-border);
    background: transparent;
    color: var(--text-body);
    font-size: 0.72rem;
    cursor: pointer;
    transition: border-color var(--transition-speed);
  }

  .shader-apply-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .shader-reset-btn:hover {
    border-color: var(--text-muted);
  }

  .shader-errors {
    font-family: monospace;
    font-size: 0.68rem;
    color: #e05060;
    white-space: pre-wrap;
    max-height: 80px;
    overflow-y: auto;
    width: 100%;
  }
```

- [ ] **Step 2: Add shader panel HTML to the `.sim-viewport` div**

In the HTML section, inside `.sim-viewport`, after the `<div id="params-panel">` line, add:

```html
      <div id="shader-panel" class="shader-panel" style="display:none;">
        <div class="shader-panel-header">
          <span>Shader Editor</span>
          <button class="shader-panel-close" id="shader-panel-close">×</button>
        </div>
        <div class="shader-editor-wrap" id="shader-editor-wrap"></div>
        <div class="shader-panel-footer">
          <div class="shader-btn-row">
            <button class="shader-apply-btn" id="shader-apply">Apply</button>
            <button class="shader-reset-btn" id="shader-reset">Reset to Default</button>
          </div>
          <div class="shader-errors" id="shader-errors" style="display:none;"></div>
        </div>
      </div>
```

- [ ] **Step 3: Replace the entire `<script>` block**

Replace everything inside the `<script>` tags with:

```typescript
  import { BoidsController, type BoidsParams } from '../../components/simulations/boids/boids-controller';
  import { ParticleLifeController } from '../../components/simulations/particle-life/particle-life-controller';
  import { NCAController } from '../../components/simulations/nca/nca-controller';
  import { CPPNController } from '../../components/simulations/cppn/cppn-controller';
  import { EditorView, basicSetup } from 'codemirror';
  import { StreamLanguage } from '@codemirror/language';
  import { cpp } from '@codemirror/legacy-modes/mode/clike';

  const viewport = document.getElementById('sim-viewport') as HTMLElement;
  const sim = viewport.dataset.sim!;
  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
  const fallback = document.getElementById('sim-fallback') as HTMLElement;
  const panel = document.getElementById('params-panel') as HTMLElement;
  const shaderPanelEl = document.getElementById('shader-panel') as HTMLElement;

  const controllers: Record<string, { init(c: HTMLCanvasElement): Promise<boolean>; start(): void; stop(): void; reset(): void }> = {
    boids: new BoidsController(),
    'particle-life': new ParticleLifeController(),
    nca: new NCAController(),
    cppn: new CPPNController(),
  };

  const controller = controllers[sim];
  if (!controller) {
    fallback.style.display = 'flex';
    (fallback.querySelector('p') as HTMLElement).textContent = 'Simulation coming soon.';
  } else {
    try {
      const ok = await controller.init(canvas);
      if (ok) {
        controller.start();

        if (sim === 'boids') {
          const boidsCtrl = controller as BoidsController;

          // ── Helpers ──────────────────────────────────────────────────────

          function addHeader(parent: HTMLElement): void {
            const header = document.createElement('div');
            header.className = 'panel-header';
            const title = document.createElement('p');
            title.className = 'panel-title';
            title.textContent = 'Parameters';
            const closeBtn = document.createElement('button');
            closeBtn.className = 'panel-close';
            closeBtn.textContent = '×';
            closeBtn.addEventListener('click', () => {
              panel.style.display = 'none';
              panelOpen = false;
            });
            header.appendChild(title);
            header.appendChild(closeBtn);
            parent.appendChild(header);
          }

          function addSection(parent: HTMLElement, label: string): void {
            const divider = document.createElement('div');
            divider.className = 'section-divider';
            parent.appendChild(divider);
            const heading = document.createElement('p');
            heading.className = 'section-heading';
            heading.textContent = label;
            parent.appendChild(heading);
          }

          function addSlider(
            parent: HTMLElement,
            label: string,
            min: number, max: number, step: number,
            get: () => number,
            set: (v: number) => void,
          ): void {
            const row = document.createElement('div');
            row.className = 'param-row';
            const labelEl = document.createElement('div');
            labelEl.className = 'param-label';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = label;
            const valueSpan = document.createElement('span');
            valueSpan.className = 'param-value';
            labelEl.appendChild(nameSpan);
            labelEl.appendChild(valueSpan);
            const input = document.createElement('input');
            input.type = 'range';
            input.min = String(min);
            input.max = String(max);
            input.step = String(step);
            input.value = String(get());
            const decimals = step >= 1 ? 0 : (String(step).split('.')[1]?.length ?? 2);
            valueSpan.textContent = get().toFixed(decimals);
            input.addEventListener('input', () => {
              const val = parseFloat(input.value);
              set(val);
              valueSpan.textContent = val.toFixed(decimals);
            });
            row.appendChild(labelEl);
            row.appendChild(input);
            parent.appendChild(row);
            return;
          }

          // ── Build panel ───────────────────────────────────────────────────

          addHeader(panel);

          // Simulation
          addSection(panel, 'Simulation');
          addSlider(panel, 'Time Step',  0.001, 0.1,  0.001, () => boidsCtrl.params.dt,           v => { boidsCtrl.params.dt = v; });
          addSlider(panel, 'Particles',  10,    2000, 10,    () => boidsCtrl.params.numParticles,  v => { boidsCtrl.params.numParticles = v; });

          // Forces
          addSection(panel, 'Forces');
          addSlider(panel, 'Outer Radius',  0.02, 0.6,  0.01,  () => boidsCtrl.params.outerRadius, v => { boidsCtrl.params.outerRadius = v; });
          addSlider(panel, 'Inner Radius',  0.01, 0.3,  0.005, () => boidsCtrl.params.innerRadius, v => { boidsCtrl.params.innerRadius = v; });
          addSlider(panel, 'Attraction',    0,    2.0,  0.01,  () => boidsCtrl.params.attraction,  v => { boidsCtrl.params.attraction = v; });
          addSlider(panel, 'Repulsion',     0,    5.0,  0.05,  () => boidsCtrl.params.repulsion,   v => { boidsCtrl.params.repulsion = v; });
          addSlider(panel, 'Alignment',     0,    1.0,  0.01,  () => boidsCtrl.params.alignment,   v => { boidsCtrl.params.alignment = v; });
          addSlider(panel, 'Friction',      0,    10.0, 0.1,   () => boidsCtrl.params.friction,    v => { boidsCtrl.params.friction = v; });
          addSlider(panel, 'Max Speed',     0.01, 1.0,  0.01,  () => boidsCtrl.params.maxSpeed,    v => { boidsCtrl.params.maxSpeed = v; });

          // Perception
          addSection(panel, 'Perception');
          addSlider(panel, 'Vision Cone',   -1.0, 0.99, 0.05, () => boidsCtrl.params.coneAngle,   v => { boidsCtrl.params.coneAngle = v; });
          addSlider(panel, 'Mouse Radius',  0.05, 0.5,  0.01, () => boidsCtrl.params.mouseRadius, v => { boidsCtrl.params.mouseRadius = v; });

          // Appearance
          addSection(panel, 'Appearance');
          addSlider(panel, 'Size', 0.005, 0.08, 0.001, () => boidsCtrl.params.size, v => { boidsCtrl.params.size = v; });

          // Shape selector
          {
            const labelEl = document.createElement('div');
            labelEl.className = 'param-label';
            labelEl.innerHTML = '<span>Shape</span>';
            panel.appendChild(labelEl);

            const shapeRow = document.createElement('div');
            shapeRow.className = 'shape-row';
            const shapes = [
              { id: 0, glyph: '▲' },
              { id: 1, glyph: '●' },
              { id: 2, glyph: '◆' },
              { id: 3, glyph: '✦' },
            ];
            const shapeBtns: HTMLButtonElement[] = [];
            for (const s of shapes) {
              const btn = document.createElement('button');
              btn.className = 'shape-btn' + (boidsCtrl.params.shapeId === s.id ? ' active' : '');
              btn.textContent = s.glyph;
              btn.title = ['Triangle', 'Circle', 'Diamond', 'Blob'][s.id];
              btn.addEventListener('click', () => {
                boidsCtrl.params.shapeId = s.id;
                shapeBtns.forEach((b, i) => b.classList.toggle('active', i === s.id));
              });
              shapeBtns.push(btn);
              shapeRow.appendChild(btn);
            }
            panel.appendChild(shapeRow);
          }

          // Color presets + picker
          {
            const labelEl = document.createElement('div');
            labelEl.className = 'param-label';
            labelEl.innerHTML = '<span>Color</span>';
            panel.appendChild(labelEl);

            const colorRow = document.createElement('div');
            colorRow.className = 'color-row';

            const presets = [
              { hex: '#e0a040', r: 0.88, g: 0.63, b: 0.25, label: 'Amber' },
              { hex: '#4090e0', r: 0.25, g: 0.56, b: 0.88, label: 'Blue' },
              { hex: '#50c878', r: 0.31, g: 0.78, b: 0.47, label: 'Green' },
              { hex: '#e05080', r: 0.88, g: 0.31, b: 0.50, label: 'Rose' },
              { hex: '#ffffff', r: 1.00, g: 1.00, b: 1.00, label: 'White' },
            ];

            const swatches: HTMLButtonElement[] = [];
            let activeSwatch = 0;

            function applyColor(r: number, g: number, b: number): void {
              boidsCtrl.params.colorR = r;
              boidsCtrl.params.colorG = g;
              boidsCtrl.params.colorB = b;
            }

            function hexToRgb(hex: string): [number, number, number] {
              const n = parseInt(hex.slice(1), 16);
              return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
            }

            for (let i = 0; i < presets.length; i++) {
              const p = presets[i];
              const btn = document.createElement('button');
              btn.className = 'color-swatch' + (i === 0 ? ' active' : '');
              btn.style.background = p.hex;
              btn.title = p.label;
              btn.addEventListener('click', () => {
                activeSwatch = i;
                applyColor(p.r, p.g, p.b);
                swatches.forEach((s, j) => s.classList.toggle('active', j === i));
                colorPicker.value = p.hex;
              });
              swatches.push(btn);
              colorRow.appendChild(btn);
            }

            const colorPicker = document.createElement('input');
            colorPicker.type = 'color';
            colorPicker.className = 'color-picker';
            colorPicker.value = presets[0].hex;
            colorPicker.title = 'Custom color';
            colorPicker.addEventListener('input', () => {
              const [r, g, b] = hexToRgb(colorPicker.value);
              applyColor(r, g, b);
              swatches.forEach(s => s.classList.remove('active'));
              activeSwatch = -1;
            });
            colorRow.appendChild(colorPicker);
            panel.appendChild(colorRow);
          }

          // Trails toggle
          {
            const trailRow = document.createElement('div');
            trailRow.className = 'trail-row';
            const trailLabel = document.createElement('span');
            trailLabel.textContent = 'Trails';

            const toggleWrap = document.createElement('label');
            toggleWrap.className = 'toggle-switch';
            const toggleInput = document.createElement('input');
            toggleInput.type = 'checkbox';
            toggleInput.checked = boidsCtrl.trailsEnabled;
            const toggleSlider = document.createElement('span');
            toggleSlider.className = 'toggle-slider';
            toggleWrap.appendChild(toggleInput);
            toggleWrap.appendChild(toggleSlider);

            trailRow.appendChild(trailLabel);
            trailRow.appendChild(toggleWrap);
            panel.appendChild(trailRow);

            // Trail decay slider (hidden when trails off)
            const decayWrapper = document.createElement('div');
            decayWrapper.style.display = boidsCtrl.trailsEnabled ? 'block' : 'none';
            addSlider(decayWrapper, 'Trail Decay', 0.80, 0.99, 0.01,
              () => boidsCtrl.trailDecay,
              v => { boidsCtrl.trailDecay = v; },
            );
            panel.appendChild(decayWrapper);

            toggleInput.addEventListener('change', () => {
              boidsCtrl.trailsEnabled = toggleInput.checked;
              decayWrapper.style.display = toggleInput.checked ? 'block' : 'none';
            });
          }

          // Shader section
          addSection(panel, 'Shader');
          {
            const editBtn = document.createElement('button');
            editBtn.className = 'edit-shader-btn';
            editBtn.textContent = 'Edit Shader';
            editBtn.addEventListener('click', () => {
              shaderEditorOpen = !shaderEditorOpen;
              shaderPanelEl.style.display = shaderEditorOpen ? 'flex' : 'none';
              editBtn.textContent = shaderEditorOpen ? 'Close Shader' : 'Edit Shader';
            });
            panel.appendChild(editBtn);
          }

          // ── Shader editor (CodeMirror) ─────────────────────────────────

          const editorWrap = document.getElementById('shader-editor-wrap') as HTMLElement;
          const shaderErrors = document.getElementById('shader-errors') as HTMLElement;

          const editorView = new EditorView({
            doc: boidsCtrl.shaderSource,
            extensions: [
              basicSetup,
              StreamLanguage.define(cpp),
              EditorView.theme({
                '&': { background: 'var(--bg-primary)' },
                '.cm-content': { color: 'var(--text-body)', caretColor: 'var(--accent)' },
                '.cm-gutters': {
                  background: 'var(--bg-surface)',
                  color: 'var(--text-muted)',
                  borderRight: '1px solid var(--bg-surface-border)',
                },
                '.cm-activeLineGutter': { background: 'var(--bg-surface)' },
                '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
                '.cm-selectionBackground': { background: 'rgba(224,160,64,0.2) !important' },
              }),
            ],
            parent: editorWrap,
          });

          document.getElementById('shader-apply')!.addEventListener('click', async () => {
            const code = editorView.state.doc.toString();
            const result = await boidsCtrl.reloadShader(code);
            if (result.success) {
              shaderErrors.style.display = 'none';
              shaderErrors.textContent = '';
            } else {
              const msg = result.errors
                .map(e => `[${e.lineNum}:${e.linePos}] ${e.message}`)
                .join('\n');
              shaderErrors.textContent = msg;
              shaderErrors.style.display = 'block';
            }
          });

          document.getElementById('shader-reset')!.addEventListener('click', async () => {
            editorView.dispatch({
              changes: { from: 0, to: editorView.state.doc.length, insert: boidsCtrl.shaderSource },
            });
            await boidsCtrl.reloadShader(boidsCtrl.shaderSource);
            shaderErrors.style.display = 'none';
          });

          document.getElementById('shader-panel-close')!.addEventListener('click', () => {
            shaderPanelEl.style.display = 'none';
            shaderEditorOpen = false;
            const editBtn = panel.querySelector('.edit-shader-btn') as HTMLButtonElement;
            if (editBtn) editBtn.textContent = 'Edit Shader';
          });
        }

        // ── Controls bar ───────────────────────────────────────────────────

        const controls = document.getElementById(`controls-${sim}`);
        let playing = true;
        let panelOpen = false;
        let shaderEditorOpen = false;

        controls?.addEventListener('click', (e) => {
          const btn = (e.target as HTMLElement).closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'play-pause') {
            if (playing) { controller.stop(); btn.querySelector('.ctrl-icon')!.textContent = '▶'; }
            else { controller.start(); btn.querySelector('.ctrl-icon')!.textContent = '⏸'; }
            playing = !playing;
          } else if (action === 'reset') {
            controller.reset();
          } else if (action === 'fullscreen') {
            document.getElementById('sim-viewport')?.requestFullscreen();
          } else if (action === 'settings' && sim === 'boids') {
            panelOpen = !panelOpen;
            panel.style.display = panelOpen ? 'flex' : 'none';
          }
        });
      } else {
        canvas.style.display = 'none';
        fallback.style.display = 'flex';
      }
    } catch (e) {
      console.error('Simulation failed to start:', e);
      canvas.style.display = 'none';
      fallback.style.display = 'flex';
    }
  }
```

- [ ] **Step 4: Verify everything in browser**

Open `http://localhost:4321/gallery/boids`. Verify:
- Simulation runs
- Settings button opens panel
- Panel has a `×` close button that works
- Categories and dividers are visible
- Size slider changes particle size
- Shape buttons switch between triangle/circle/diamond/blob
- Color swatches and color picker update particle color
- Trails toggle enables trails with visible decay
- Trail Decay slider appears only when trails are on
- "Edit Shader" button opens the CodeMirror panel
- Apply button compiles and hot-reloads the shader
- Shader compilation errors appear in red with line numbers
- Reset button restores default shader
- Shader panel `×` closes it

- [ ] **Step 5: Commit**

```bash
git add src/pages/gallery/\[...slug\].astro
git commit -m "feat(boids): params panel categories, appearance controls, CodeMirror shader editor"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** TrailRenderer (ping-pong, fade, blit) ✓ | Shader editor (CodeMirror, Apply, Reset, errors) ✓ | Close button ✓ | Size slider ✓ | Shape selector (4 shapes, SDF) ✓ | Color picker + presets ✓ | Trails toggle ✓ | Trail decay slider ✓ | Categorized params with dividers ✓
- [x] **Placeholder scan:** No TBD/TODO. All code blocks complete.
- [x] **Type consistency:** `BoidsParams` defined in Task 3 used identically in Task 7. `TrailRenderer.render()` signature defined in Task 5 used identically in Task 6. `reloadShader()` return type consistent across Task 3 and Task 7.
