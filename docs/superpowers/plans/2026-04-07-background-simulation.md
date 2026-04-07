# Background Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed-viewport WebGPU boids simulation that runs behind all content on opt-in pages, with smooth density-void repulsion fields driven by DOM element positions.

**Architecture:** A `position: fixed` canvas (z-index 0) runs behind page content (z-index 1+). An `ObstacleTracker` watches DOM elements with `IntersectionObserver`, converts their viewport rects to NDC, and pushes them to the GPU via a 272-byte uniform buffer. The boids compute shader reads these rects each step and applies a smooth `smoothstep`-based repulsion force, creating low-density voids beneath text. Pages opt in via a `backgroundSim` prop on `BaseLayout`; `siteConfig.enableBackgroundSim` is the master kill switch.

**Tech Stack:** Astro, TypeScript, WebGPU, WGSL. No test framework — verification is `npm run build` (TypeScript) + visual inspection in `npm run dev`.

---

### Task 1: Add `enableBackgroundSim` flag to siteConfig

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add the flag**

In `src/config.ts`, add `enableBackgroundSim` as the last property:

```typescript
export const siteConfig = {
  name: "Sina Khajehabdollahi",
  tagline: "Computational Neuroscience · Artificial Life · Emergence",
  description: "Personal portfolio and research website of Sina Khajehabdollahi — computational neuroscientist, artificial life researcher, and computational artist.",
  email: "",
  socialLinks: {
    github: "",
    googleScholar: "",
    orcid: "",
  },
  navItems: [
    { label: "About", href: "/about" },
    { label: "Publications", href: "/publications" },
    { label: "Gallery", href: "/gallery" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "/contact" },
  ],
  enableBackgroundSim: true,  // set false to disable sitewide and restore original hero
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add enableBackgroundSim flag to siteConfig"
```

---

### Task 2: Create ObstacleTracker

**Files:**
- Create: `src/lib/webgpu/obstacle-tracker.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/lib/webgpu/obstacle-tracker.ts
//
// Tracks DOM elements as obstacle zones and converts their viewport rects
// to NDC coordinates for GPU consumption.
//
// NDC conversion (x: -1 left → +1 right, y: -1 bottom → +1 top):
//   cx = (rect.left + rect.right)  / innerWidth  - 1
//   cy = 1 - (rect.top + rect.bottom) / innerHeight
//   hw = rect.width  / innerWidth
//   hh = rect.height / innerHeight

const MAX_OBSTACLES = 16;

export class ObstacleTracker {
  private selectors: string[];
  private onUpdate: (rects: Float32Array, count: number) => void;
  private elements: Element[] = [];
  private visibleSet = new Set<Element>();
  private intersectionObserver: IntersectionObserver | null = null;
  private dirty = false;
  private rafId = 0;
  private running = false;
  private boundScroll: () => void;
  private boundResize: () => void;

  constructor(
    selectors: string[],
    onUpdate: (rects: Float32Array, count: number) => void,
  ) {
    this.selectors = selectors;
    this.onUpdate = onUpdate;
    this.boundScroll = () => { this.dirty = true; };
    this.boundResize = () => { this.dirty = true; };
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Collect all matching elements
    this.elements = this.selectors.flatMap((sel) =>
      Array.from(document.querySelectorAll(sel))
    );

    // IntersectionObserver to track which elements are in the viewport
    this.intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          this.visibleSet.add(entry.target);
        } else {
          this.visibleSet.delete(entry.target);
        }
      }
      this.dirty = true;
    });

    for (const el of this.elements) {
      this.intersectionObserver.observe(el);
    }

    window.addEventListener('scroll', this.boundScroll, { passive: true });
    window.addEventListener('resize', this.boundResize, { passive: true });

    // Initial update
    this.dirty = true;
    this._loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    window.removeEventListener('scroll', this.boundScroll);
    window.removeEventListener('resize', this.boundResize);
  }

  private _loop = (): void => {
    if (!this.running) return;
    if (this.dirty) {
      this.dirty = false;
      this._flush();
    }
    this.rafId = requestAnimationFrame(this._loop);
  };

  private _flush(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rects = new Float32Array(MAX_OBSTACLES * 4);
    let count = 0;

    for (const el of this.visibleSet) {
      if (count >= MAX_OBSTACLES) break;
      const r = el.getBoundingClientRect();
      const cx = (r.left + r.right)  / w - 1.0;
      const cy = 1.0 - (r.top + r.bottom) / h;
      const hw = r.width  / w;
      const hh = r.height / h;
      rects[count * 4 + 0] = cx;
      rects[count * 4 + 1] = cy;
      rects[count * 4 + 2] = hw;
      rects[count * 4 + 3] = hh;
      count++;
    }

    this.onUpdate(rects, count);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/webgpu/obstacle-tracker.ts
git commit -m "feat: add ObstacleTracker for DOM-to-NDC obstacle conversion"
```

---

### Task 3: Add obstacle uniform and smooth repulsion to boids.wgsl

**Files:**
- Modify: `src/components/simulations/boids/boids.wgsl`

The shader currently has bindings 0/1/2. We add binding 3 (`obstacles`) and a `obstacleForce()` function. The force is applied after mouse interaction, before position integration.

- [ ] **Step 1: Add `Obstacles` struct and binding after the existing bindings (line 35)**

After this existing line:
```wgsl
@group(0) @binding(2) var<storage, read_write> particlesB: array<Particle>;
```

Add:
```wgsl
struct Obstacles {
  rects: array<vec4f, 16>,  // x=cx, y=cy, z=hw, w=hh in NDC
  count: u32,
  _pad: vec3u,
}

@group(0) @binding(3) var<uniform> obstacles: Obstacles;

fn obstacleForce(pos: vec2f) -> vec2f {
  var force = vec2f(0.0);
  let falloffRadius = 0.18;  // NDC units — tunable

  for (var i = 0u; i < obstacles.count; i++) {
    let r = obstacles.rects[i];
    let center = r.xy;
    let half   = r.zw;

    // Signed distance to nearest rect edge (negative = inside rect)
    let d    = abs(pos - center) - half;
    let dist = length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);

    if (dist < falloffRadius) {
      // smoothstep: 1.0 at rect edge, 0.0 at falloffRadius — C¹ continuous
      let t      = smoothstep(falloffRadius, 0.0, dist);
      let strength = t * t;  // squared for softer onset, steeper near edge

      // Direction: away from nearest point on rect surface
      let nearest  = clamp(pos, center - half, center + half);
      let away     = pos - nearest;
      let awayLen  = length(away);
      let awayDir  = select(vec2f(0.0, 1.0), away / awayLen, awayLen > 0.0001);
      force += awayDir * strength * 2.0;
    }
  }
  return force;
}
```

- [ ] **Step 2: Apply `obstacleForce` in `computeMain` after the mouse interaction block**

After this existing block (around line 113):
```wgsl
  if (params.mouseActive > 0.5) {
    let toMouse = vec2f(params.mouseX, params.mouseY) - pos;
    let toMouseS = vec2f(toMouse.x * params.aspect, toMouse.y);
    let mouseDist = length(toMouseS);
    if (mouseDist < params.mouseRadius && mouseDist > 0.0001) {
      // Screen-space direction converted back to clip space: aspect cancels
      vel += 0.005 * normalize(toMouse) / mouseDist ;
    }
  }
```

Add immediately after:
```wgsl
  // Obstacle repulsion (smooth density void)
  vel += params.deltaTime * obstacleForce(pos);
```

- [ ] **Step 3: Verify the shader compiles**

Run `npm run dev` and open the page in a browser. Open the browser console — WebGPU shader compilation errors appear there. Expected: no errors, boids render normally.

- [ ] **Step 4: Commit**

```bash
git add src/components/simulations/boids/boids.wgsl
git commit -m "feat(boids): add obstacle uniform and smooth repulsion force"
```

---

### Task 4: Add obstacle buffer and `setObstacles` to BoidsController

**Files:**
- Modify: `src/components/simulations/boids/boids-controller.ts`

The obstacle uniform buffer is 272 bytes:
- `array<vec4f, 16>` = 256 bytes (rects)
- `u32` (count) = 4 bytes
- `vec3u` (padding) = 12 bytes

- [ ] **Step 1: Add `obstacleBuffer` field to the class (after `uniformBuffer` declaration ~line 63)**

After:
```typescript
  private uniformBuffer!: GPUBuffer;
```

Add:
```typescript
  private obstacleBuffer!: GPUBuffer;
```

- [ ] **Step 2: Create the obstacle buffer in `init()` after `this.uniformBuffer` is created (~line 88)**

After:
```typescript
      this.uniformBuffer = createUniformBuffer(device, 96);
```

Add:
```typescript
      // 16 × vec4f (256 bytes) + u32 count (4) + vec3u padding (12) = 272 bytes
      this.obstacleBuffer = createUniformBuffer(device, 272);
```

- [ ] **Step 3: Add binding 3 to `bindGroupLayout` in `init()` (~line 106)**

Replace the existing `bindGroupLayout` creation:
```typescript
      this.bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
      });
```

With:
```typescript
      this.bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ],
      });
```

- [ ] **Step 4: Add binding 3 to both bind groups in `init()` (~line 114)**

Replace the existing `bindGroups` creation:
```typescript
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
```

With:
```typescript
      this.bindGroups = [
        device.createBindGroup({
          layout: this.bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer } },
            { binding: 1, resource: { buffer: this.particleBuffers[0] } },
            { binding: 2, resource: { buffer: this.particleBuffers[1] } },
            { binding: 3, resource: { buffer: this.obstacleBuffer } },
          ],
        }),
        device.createBindGroup({
          layout: this.bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer } },
            { binding: 1, resource: { buffer: this.particleBuffers[1] } },
            { binding: 2, resource: { buffer: this.particleBuffers[0] } },
            { binding: 3, resource: { buffer: this.obstacleBuffer } },
          ],
        }),
      ];
```

- [ ] **Step 5: Add `setObstacles` method to the class (after the `reset()` method, ~line 252)**

```typescript
  setObstacles(rects: Float32Array, count: number): void {
    if (!this.gpu) return;
    // Buffer layout: 16 × vec4f (256 bytes) + u32 count (4) + vec3u pad (12) = 272 bytes
    const buf = new ArrayBuffer(272);
    const floats = new Float32Array(buf);
    const uints  = new Uint32Array(buf);
    floats.set(rects.subarray(0, count * 4), 0);  // rects at offset 0
    uints[64] = count;                             // count at byte offset 256
    this.gpu.device.queue.writeBuffer(this.obstacleBuffer, 0, buf);
  }
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 7: Verify boids still work in dev server**

Run: `npm run dev`
Open the home page. Boids should render exactly as before (count is 0, no repulsion active yet).

- [ ] **Step 8: Commit**

```bash
git add src/components/simulations/boids/boids-controller.ts
git commit -m "feat(boids): add obstacle uniform buffer and setObstacles method"
```

---

### Task 5: Create BackgroundSim.astro

**Files:**
- Create: `src/components/BackgroundSim.astro`

- [ ] **Step 1: Create the component**

```astro
---
// src/components/BackgroundSim.astro
// Fixed-viewport background simulation component.
// Renders a position:fixed canvas behind all page content.
// Initialises the sim controller and wires ObstacleTracker for density voids.

interface Props {
  sim: 'boids';
}

const { sim } = Astro.props;
---

<canvas id="bg-sim-canvas"></canvas>

<style>
  #bg-sim-canvas {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    pointer-events: none;
  }
</style>

<script>
  import { BoidsController } from './simulations/boids/boids-controller';
  import { ObstacleTracker } from '../lib/webgpu/obstacle-tracker';

  const canvas = document.getElementById('bg-sim-canvas') as HTMLCanvasElement;

  const controller = new BoidsController();
  const ok = await controller.init(canvas);

  if (ok) {
    // Ambient background defaults — lighter than the hero
    controller.params.numParticles = 120;
    controller.params.size         = 0.016;
    controller.params.maxSpeed     = 0.18;
    controller.trailsEnabled       = false;

    const tracker = new ObstacleTracker(
      ['nav', 'footer', '.section', '.content-width'],
      (rects, count) => controller.setObstacles(rects, count),
    );
    tracker.start();

    controller.start();
  }
</script>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/BackgroundSim.astro
git commit -m "feat: add BackgroundSim component with ObstacleTracker wiring"
```

---

### Task 6: Update BaseLayout.astro

**Files:**
- Modify: `src/layouts/BaseLayout.astro`

Two changes: add the `backgroundSim` prop + conditionally render `<BackgroundSim>`, and add `position: relative; z-index: 1` to `<main>` so it sits above the fixed canvas.

- [ ] **Step 1: Add `backgroundSim` to the Props interface and import BackgroundSim**

Replace the existing frontmatter:
```astro
---
import Nav from '../components/Nav.astro';
import Footer from '../components/Footer.astro';
import { siteConfig } from '../config';
import '../styles/global.css';

interface Props {
  title?: string;
  description?: string;
}

const {
  title = siteConfig.name,
  description = siteConfig.description,
} = Astro.props;

const pageTitle = title === siteConfig.name
  ? title
  : `${title} — ${siteConfig.name}`;
---
```

With:
```astro
---
import Nav from '../components/Nav.astro';
import Footer from '../components/Footer.astro';
import BackgroundSim from '../components/BackgroundSim.astro';
import { siteConfig } from '../config';
import '../styles/global.css';

interface Props {
  title?: string;
  description?: string;
  backgroundSim?: 'boids';
}

const {
  title = siteConfig.name,
  description = siteConfig.description,
  backgroundSim,
} = Astro.props;

const pageTitle = title === siteConfig.name
  ? title
  : `${title} — ${siteConfig.name}`;
---
```

- [ ] **Step 2: Render `<BackgroundSim>` conditionally in the `<body>`**

Replace the existing `<body>` content:
```html
  <body>
    <Nav />
    <main>
      <slot />
    </main>
    <Footer />
  </body>
```

With:
```astro
  <body>
    {backgroundSim && <BackgroundSim sim={backgroundSim} />}
    <Nav />
    <main>
      <slot />
    </main>
    <Footer />
  </body>
```

- [ ] **Step 3: Add `position: relative; z-index: 1` to the `<main>` style**

Replace the existing `<style>` block:
```css
<style>
  main {
    min-height: 100vh;
    padding-top: 60px; /* nav height */
  }
</style>
```

With:
```css
<style>
  main {
    min-height: 100vh;
    padding-top: 60px; /* nav height */
    position: relative;
    z-index: 1;
  }
</style>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/layouts/BaseLayout.astro
git commit -m "feat: add backgroundSim prop to BaseLayout, render BackgroundSim conditionally"
```

---

### Task 7: Migrate index.astro

**Files:**
- Modify: `src/pages/index.astro`

The hero canvas markup is preserved (not deleted) inside an `!enableBackgroundSim` branch. When the flag is true, the background sim takes over and the hero canvas is suppressed.

- [ ] **Step 1: Update the `<BaseLayout>` opening tag and hero section**

Replace:
```astro
<BaseLayout>
  {/* Hero */}
  <section class="hero">
    <div class="hero-sim">
      <canvas id="boids-canvas"></canvas>
      <div id="boids-fallback" class="fallback" style="display:none;"></div>
    </div>
    <div class="hero-content">
      <h1>{siteConfig.name}</h1>
      <p class="tagline">{siteConfig.tagline}</p>
    </div>
  </section>
```

With:
```astro
<BaseLayout backgroundSim={siteConfig.enableBackgroundSim ? 'boids' : undefined}>
  {/* Hero */}
  <section class="hero">
    {!siteConfig.enableBackgroundSim && (
      <div class="hero-sim">
        <canvas id="boids-canvas"></canvas>
        <div id="boids-fallback" class="fallback" style="display:none;"></div>
      </div>
    )}
    <div class="hero-content">
      <h1>{siteConfig.name}</h1>
      <p class="tagline">{siteConfig.tagline}</p>
    </div>
  </section>
```

- [ ] **Step 2: Wrap the hero `<script>` in a conditional**

Replace the existing script block at the bottom of the file:
```astro
<script>
  import { BoidsController } from '../components/simulations/boids/boids-controller';

  const canvas = document.getElementById('boids-canvas') as HTMLCanvasElement;
  const fallback = document.getElementById('boids-fallback') as HTMLElement;

  try {
    const controller = new BoidsController();
    const ok = await controller.init(canvas);

    if (ok) {
      controller.start();
    } else {
      canvas.style.display = 'none';
      fallback.style.display = 'flex';
    }
  } catch (e) {
    console.error('Boids failed to start:', e);
    canvas.style.display = 'none';
    fallback.style.display = 'flex';
  }
</script>
```

With:
```astro
{!siteConfig.enableBackgroundSim && (
  <script>
    import { BoidsController } from '../components/simulations/boids/boids-controller';

    const canvas = document.getElementById('boids-canvas') as HTMLCanvasElement;
    const fallback = document.getElementById('boids-fallback') as HTMLElement;

    try {
      const controller = new BoidsController();
      const ok = await controller.init(canvas);

      if (ok) {
        controller.start();
      } else {
        canvas.style.display = 'none';
        fallback.style.display = 'flex';
      }
    } catch (e) {
      console.error('Boids failed to start:', e);
      canvas.style.display = 'none';
      fallback.style.display = 'flex';
    }
  </script>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat: migrate index.astro to use background sim with reversibility flag"
```

---

### Task 8: Visual verification and reversibility check

**Files:** None — manual verification only.

- [ ] **Step 1: Run the dev server**

```bash
npm run dev
```

Open `http://localhost:4321` in a browser with WebGPU support (Chrome 113+, Edge 113+).

- [ ] **Step 2: Verify layer stack**

Open DevTools → Elements. Confirm:
- `#bg-sim-canvas` is a direct child of `<body>` (rendered by BackgroundSim via BaseLayout), with computed style `position: fixed; z-index: 0`
- `<nav>` has `z-index: 100` (already set — no change needed)
- `<main>` has `position: relative; z-index: 1`
- The canvas is visually behind all text content

- [ ] **Step 3: Verify boids render full-page**

Boids should be visible across the entire viewport — behind the hero text, behind the About section, behind Publications, behind Gallery cards. Scroll down and confirm the simulation continues running beneath every section.

- [ ] **Step 4: Verify density voids appear**

As sections scroll into view, boids should noticeably thin out beneath them. The thinning should have a gradient falloff — no sharp edges. Clusters of boids should appear around the edges of content blocks.

- [ ] **Step 5: Verify smooth falloff (no hard edges)**

Watch a section scroll slowly into view. The boid density should reduce progressively as the content approaches — not jump suddenly at a boundary. This confirms `smoothstep` is working correctly.

- [ ] **Step 6: Verify obstacle count in console (optional)**

Temporarily add this to `BackgroundSim.astro`'s script to inspect obstacle data:
```typescript
    const tracker = new ObstacleTracker(
      ['nav', 'footer', '.section', '.content-width'],
      (rects, count) => {
        console.log('obstacles:', count, rects.subarray(0, count * 4));
        controller.setObstacles(rects, count);
      },
    );
```
Scroll the page and verify count changes as sections enter/leave the viewport. Remove the `console.log` before committing.

- [ ] **Step 7: Verify reversibility — toggle off**

In `src/config.ts`, temporarily set `enableBackgroundSim: false`. Run `npm run dev` and reload.

Expected:
- No `#bg-sim-canvas` in the DOM
- Hero section has `<div class="hero-sim">` with `<canvas id="boids-canvas">` — original boids running in hero only
- Sections below hero have plain dark background
- Exactly original behaviour

Set `enableBackgroundSim: true` again and confirm the background sim is back.

- [ ] **Step 8: Commit final verification note**

```bash
git add -p  # stage only if any debug code was removed
git commit -m "feat: background simulation — full-page density void boids complete"
```
