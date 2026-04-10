# Simulation Card Hover Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace gradient placeholders on gallery/home simulation cards with a live WebGPU preview that warms up on scroll-into-view, freezes as a still frame, and resumes seamlessly on hover.

**Architecture:** A new `SimulationPreview.astro` component renders a canvas + placeholder stack inside each card, and a `preview-registry.ts` factory lazily inits a `BoidsController` per card. The canvas stays alive (frozen) between hovers — no state is destroyed or re-initialized.

**Tech Stack:** Astro, TypeScript, WebGPU, IntersectionObserver

**Spec:** `docs/superpowers/specs/2026-04-09-simulation-card-hover-preview-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/webgpu/preview-registry.ts` | **Create** | `PreviewController` interface + `createPreviewController` factory (wraps `BoidsController`) |
| `src/components/SimulationPreview.astro` | **Create** | DOM (canvas + placeholder), CSS, inline script (IntersectionObserver + hover lifecycle) |
| `src/components/SimulationCard.astro` | **Modify** | Swap placeholder block for `<SimulationPreview>` |

---

## Task 1: Create `preview-registry.ts`

**Files:**
- Create: `src/lib/webgpu/preview-registry.ts`

- [ ] **Step 1: Create the file with the interface and factory**

```ts
// src/lib/webgpu/preview-registry.ts

export interface PreviewController {
  pause(): void
  resume(): void
}

export async function createPreviewController(
  sim: string,
  canvas: HTMLCanvasElement,
): Promise<PreviewController | null> {
  if (sim === 'boids') {
    const { BoidsController } = await import(
      '../../components/simulations/boids/boids-controller'
    )
    const ctrl = new BoidsController()
    const ok = await ctrl.init(canvas)
    if (!ok) return null
    ctrl.params.numParticles = 150
    ctrl.params.size = 0.018
    ctrl.trailsEnabled = false
    return {
      pause: () => ctrl.stop(),
      resume: () => ctrl.start(),
    }
  }
  return null
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: build succeeds with no type errors in `preview-registry.ts`. (Ignore any pre-existing warnings.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/webgpu/preview-registry.ts
git commit -m "feat(preview): add preview-registry with BoidsPreviewController"
```

---

## Task 2: Create `SimulationPreview.astro`

**Files:**
- Create: `src/components/SimulationPreview.astro`

- [ ] **Step 1: Create the component**

```astro
---
// src/components/SimulationPreview.astro
interface Props {
  simulation: string
}
const { simulation } = Astro.props
---

<div class="preview-wrap" data-preview-sim={simulation}>
  <div class="preview-placeholder"></div>
  <canvas class="preview-canvas"></canvas>
</div>

<style>
  .preview-wrap {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .preview-placeholder {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      ellipse at 50% 50%,
      var(--hero-gradient-start),
      var(--hero-gradient-end)
    );
    transition: opacity 0.3s ease;
  }

  .preview-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }
</style>

<script>
  import {
    createPreviewController,
    type PreviewController,
  } from '../lib/webgpu/preview-registry'

  const wraps = document.querySelectorAll<HTMLElement>('[data-preview-sim]')

  for (const wrap of wraps) {
    const sim = wrap.dataset.previewSim!
    const canvas = wrap.querySelector<HTMLCanvasElement>('.preview-canvas')!
    const placeholder = wrap.querySelector<HTMLElement>('.preview-placeholder')!
    const card = wrap.closest<HTMLElement>('.sim-card')

    let controller: PreviewController | null = null
    let ready = false

    const observer = new IntersectionObserver(
      async (entries) => {
        if (!entries[0].isIntersecting) return
        observer.disconnect()

        controller = await createPreviewController(sim, canvas)
        if (!controller) return

        controller.resume()
        await new Promise<void>((r) => setTimeout(r, 800))
        controller.pause()

        canvas.style.opacity = '1'
        placeholder.style.opacity = '0'
        ready = true
      },
      { threshold: 0.1 },
    )

    observer.observe(wrap)

    if (!card) continue

    card.addEventListener('mouseenter', () => {
      if (!ready || !controller) return
      controller.resume()
    })

    card.addEventListener('mouseleave', () => {
      if (!ready || !controller) return
      controller.pause()
    })
  }
</script>
```

- [ ] **Step 2: Verify build compiles**

```bash
npm run build
```

Expected: no new errors. The script import resolves correctly to `preview-registry.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/components/SimulationPreview.astro
git commit -m "feat(preview): add SimulationPreview component with hover lifecycle"
```

---

## Task 3: Wire `SimulationPreview` into `SimulationCard`

**Files:**
- Modify: `src/components/SimulationCard.astro`

- [ ] **Step 1: Update `SimulationCard.astro`**

Replace the entire file content with:

```astro
---
import SimulationPreview from './SimulationPreview.astro'

interface Props {
  title: string
  description: string
  slug: string
  thumbnail?: string  // kept for call-site compatibility, unused
}

const { title, description, slug } = Astro.props
---

<a href={`/gallery/${slug}`} class="sim-card">
  <div class="sim-card-preview">
    <SimulationPreview simulation={slug} />
  </div>
  <div class="sim-card-body">
    <h3>{title}</h3>
    <p>{description}</p>
  </div>
</a>

<style>
  .sim-card {
    display: block;
    background: var(--bg-surface);
    border: 1px solid var(--bg-surface-border);
    border-radius: var(--border-radius);
    overflow: hidden;
    color: inherit;
    transition: border-color var(--transition-speed), transform var(--transition-speed);
  }

  .sim-card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
  }

  .sim-card-preview {
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: var(--bg-primary);
  }

  .sim-card-body {
    padding: 1rem;
  }

  .sim-card-body h3 {
    font-size: 1rem;
    font-weight: 500;
    margin-bottom: 0.4rem;
  }

  .sim-card-body p {
    font-size: 0.85rem;
    color: var(--text-body);
  }
</style>
```

Note: the `.sim-card-preview img` and `.sim-card-placeholder` rules are removed — they're replaced by `SimulationPreview`'s own styles.

- [ ] **Step 2: Build check**

```bash
npm run build
```

Expected: clean build. If you see "Property 'thumbnail' does not exist" errors from call sites in `index.astro` or `gallery/index.astro`, they pass `thumbnail` as a prop which the interface accepts as optional — this should not error.

- [ ] **Step 3: Commit**

```bash
git add src/components/SimulationCard.astro
git commit -m "feat(preview): wire SimulationPreview into SimulationCard"
```

---

## Task 4: End-to-End Browser Verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Expected: server starts at `http://localhost:4321` (or similar), no startup errors.

- [ ] **Step 2: Home page — initial state**

Open `http://localhost:4321`. Scroll down to the "Simulation Art" section.  
Expected: all 4 cards show the dark gradient placeholder. No WebGPU activity yet (check DevTools → Performance: no GPU workloads).

- [ ] **Step 3: Home page — scroll-into-view init**

Scroll the gallery teaser into view and wait ~1.5s.  
Expected: the boids card transitions from gradient → live frozen boids frame (opacity fade, ~0.3s). The other 3 cards remain as gradient. Check DevTools Console — no errors.

- [ ] **Step 4: Home page — hover to resume**

Hover over the boids card.  
Expected: boids start moving immediately from the frozen frame — no jump cut, no reset to random positions.

- [ ] **Step 5: Home page — mouse-out to freeze**

Move mouse off the boids card.  
Expected: boids freeze on the current frame. The card looks like a still image.

- [ ] **Step 6: Home page — re-hover continues**

Hover again.  
Expected: boids resume from the frozen frame (not a reset).

- [ ] **Step 7: Gallery page — same behavior**

Navigate to `http://localhost:4321/gallery`.  
Repeat steps 2–6 on the gallery grid. Boids card should behave identically. Stub cards (particle-life, nca, cppn) should remain gradient throughout.

- [ ] **Step 8: Click-through works**

Click any card (including the boids card).  
Expected: navigates to `/gallery/{slug}` correctly. The `pointer-events: none` on the canvas must not block the click.

- [ ] **Step 9: No WebGPU errors**

Open DevTools Console throughout the above. Expected: no errors mentioning "GPUDevice", "lost", "WebGPU not supported", or uncaught promise rejections.

- [ ] **Step 10: Commit verification**

```bash
git add -p  # nothing unstaged
git log --oneline -4
```

Expected: the three feature commits from Tasks 1–3 appear cleanly in log.
