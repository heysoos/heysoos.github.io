# Portfolio Website Design Spec

## Overview

A personal portfolio website for Sina Khajehabdollahi — scientist, computational neuroscientist, and computational artist. The site serves as both a professional CV and a living gallery of WebGPU-powered simulation art. The core philosophy: **complexity arising from simplicity** — a dark, minimal frame where the simulations provide all the visual richness.

## Tech Stack

- **Framework:** Astro (static site generator)
- **Language:** TypeScript
- **GPU:** WebGPU (WGSL shaders)
- **Styling:** CSS with custom properties (theme system)
- **Hosting:** GitHub Pages (free), deployed via GitHub Actions
- **Content:** Markdown collections

## Site Architecture

### Pages

| Page | Route | Purpose |
|------|-------|---------|
| Home | `/` | Hero simulation (boids) + name overlay, scroll to brief bio, selected publications, simulation teasers |
| About | `/about` | Extended bio, research trajectory, CV/resume PDF download |
| Publications | `/publications` | Filterable list of papers from Markdown collection |
| Gallery | `/gallery` | Grid of simulation art pieces with previews |
| Simulation detail | `/gallery/[slug]` | Full-viewport interactive WebGPU canvas + controls + description |
| Blog | `/blog` | Markdown-driven posts, newest first, with tags |
| Contact | `/contact` | Email, academic profiles (Google Scholar, ORCID, GitHub, etc.) |

### Navigation

- Minimal sticky top bar
- Name/logo on left, page links on right
- Translucent dark background so it doesn't compete with simulations
- Collapses to hamburger menu on mobile

### Home Page Layout

1. **Hero section** — full-viewport WebGPU boids simulation as background, name and tagline overlaid in lower-left
2. **About teaser** — brief 2-3 sentence bio with link to full about page
3. **Selected publications** — 3-5 highlighted papers
4. **Simulation gallery teaser** — row of simulation preview cards linking to `/gallery`

## Visual Design

### Theme: Warm Ember (Default)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#0a0804` | Page background |
| `--bg-surface` | `#1a1408` | Cards, surfaces |
| `--bg-surface-border` | `#2a2018` | Card borders |
| `--text-primary` | `#f0e8e0` | Headings |
| `--text-body` | `#887766` | Body text |
| `--text-muted` | `#554830` | Nav links, secondary text |
| `--accent` | `#c08030` | Accent color, labels, highlights |
| `--accent-glow` | `#e8a040` | Particle glow, hover states |
| `--hero-gradient-start` | `#1a1008` | Hero radial gradient center |
| `--hero-gradient-end` | `#0a0804` | Hero radial gradient edge |

### Theme System

- All colors defined as CSS custom properties in a single theme file
- Theme files stored in `src/styles/themes/`:
  - `warm-ember.css` (default)
  - `deep-space.css` (blue-black, cyan accents)
  - `monochrome.css` (pure black/white/grey, no accent)
  - `muted-violet.css` (purple-black, violet accents)
- Swapping themes = changing one import in the base layout
- Each theme file defines the same set of CSS custom properties with different values

### Typography

- **Headings:** Space Grotesk (geometric sans-serif), light weight (300)
- **Body:** Space Grotesk, regular weight
- **Code:** System monospace stack
- **Scale:** Generous, with clear hierarchy (hero name ~2.5rem, section headings ~1.5rem, body 1rem)

### Layout Principles

- Full-bleed simulation canvases (edge to edge)
- Content sections max-width ~800px, centered
- Generous whitespace
- Subtle fade-in transitions on scroll (not flashy)
- Dark background throughout — simulations are the color

## WebGPU Simulation Architecture

### Component Structure

Each simulation is a self-contained Astro component with three parts:

```
src/components/simulations/boids/
  ├── Boids.astro          # Astro component wrapper
  ├── boids-controller.ts  # WebGPU setup, buffers, render loop
  └── boids.wgsl           # Compute + render shaders
```

### Shared Infrastructure

```
src/lib/webgpu/
  ├── device.ts            # WebGPU device/adapter initialization
  ├── utils.ts             # Shared buffer helpers, shader compilation
  └── fallback.ts          # "WebGPU not supported" message component
```

### Interaction Model

- **Mouse interaction:** attract/repel particles, draw on NCA grid, etc. (per-simulation)
- **Controls panel:** collapsible sidebar or bottom drawer with parameter sliders
- **Transport controls:** play/pause, reset, fullscreen toggle
- **FPS limiter:** optional, for battery/performance

### Simulation Pipeline

1. Check WebGPU support → show fallback if unavailable
2. Request adapter + device
3. Create buffers (particle positions, velocities, grid state, etc.)
4. Load WGSL shaders, create compute + render pipelines
5. `requestAnimationFrame` loop:
   - Run compute pass (simulation step)
   - Run render pass (draw to canvas)
   - Read mouse/parameter inputs

### Initial Simulations

| Simulation | Role | Key Features |
|------------|------|--------------|
| Boids | Hero (home page) | Flocking behavior, mouse attraction/repulsion |
| Particle Life | Gallery piece | Multi-species particles with random/structured interaction rules |
| Neural Cellular Automata | Gallery piece | Random seeds, trainable patterns, interactive drawing |
| CPPN Art | Gallery piece | Pattern generation from neural networks; audio-reactive version later (port from existing PyTorch repo) |

### Graceful Degradation

- If WebGPU is not available: show a static screenshot of the simulation with a message explaining WebGPU requirement
- Consider WebGL2 fallback for simpler simulations in the future (not in initial scope)

## Content Management

### Markdown Collections

**Publications** (`src/content/publications/*.md`):
```yaml
---
title: "Paper Title"
authors: ["Sina Khajehabdollahi", "Co-Author"]
journal: "Journal Name"
year: 2024
doi: "10.xxxx/xxxxx"
abstract: "Brief abstract text"
tags: ["criticality", "emergence"]
featured: true  # shows on home page
---
```

**Blog posts** (`src/content/blog/*.md`):
```yaml
---
title: "Post Title"
date: 2026-04-02
tags: ["ALIFE", "WebGPU"]
description: "Brief description for previews"
---

Post content in Markdown...
```

**Projects** (`src/content/projects/*.md`):
```yaml
---
title: "Boids Simulation"
slug: "boids"
description: "Flocking behavior emergent from three simple rules"
thumbnail: "/images/boids-preview.png"
simulation: "boids"  # maps to component
order: 1
---

Extended description and explanation...
```

### Site Configuration

`src/config.ts` — single file for site-wide settings:
```typescript
export const siteConfig = {
  name: "Sina Khajehabdollahi",
  tagline: "Computational Neuroscience · Artificial Life · Emergence",
  email: "...",
  socialLinks: {
    github: "...",
    googleScholar: "...",
    orcid: "...",
  },
  navItems: [
    { label: "About", href: "/about" },
    { label: "Publications", href: "/publications" },
    { label: "Gallery", href: "/gallery" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "/contact" },
  ],
  theme: "warm-ember",  // swap to change site theme
};
```

## Deployment

- **Local dev:** `npm run dev` — Astro dev server with hot reload
- **Build:** `npm run build` — outputs static files to `dist/`
- **Deploy:** GitHub Actions workflow triggers on push to `main`, builds and deploys to GitHub Pages
- **Domain:** GitHub Pages default (`username.github.io/repo`) initially; custom domain can be added later

## Project Directory Structure

```
website/
├── public/
│   ├── images/              # Static images, simulation thumbnails
│   └── resume.pdf           # Downloadable CV
├── src/
│   ├── components/
│   │   ├── simulations/     # WebGPU simulation components
│   │   │   ├── boids/
│   │   │   ├── particle-life/
│   │   │   ├── nca/
│   │   │   └── cppn/
│   │   ├── Nav.astro
│   │   ├── Footer.astro
│   │   ├── PublicationCard.astro
│   │   ├── SimulationCard.astro
│   │   └── Controls.astro   # Shared simulation controls UI
│   ├── content/
│   │   ├── publications/    # Markdown paper entries
│   │   ├── blog/            # Markdown blog posts
│   │   └── projects/        # Markdown project descriptions
│   ├── layouts/
│   │   ├── BaseLayout.astro # Main layout (nav + footer + theme)
│   │   └── SimLayout.astro  # Full-viewport simulation layout
│   ├── lib/
│   │   └── webgpu/          # Shared WebGPU utilities
│   ├── pages/
│   │   ├── index.astro
│   │   ├── about.astro
│   │   ├── publications.astro
│   │   ├── gallery/
│   │   │   ├── index.astro
│   │   │   └── [slug].astro # Dynamic simulation pages
│   │   ├── blog/
│   │   │   ├── index.astro
│   │   │   └── [slug].astro
│   │   └── contact.astro
│   ├── styles/
│   │   ├── global.css       # Base styles, typography, reset
│   │   └── themes/
│   │       ├── warm-ember.css
│   │       ├── deep-space.css
│   │       ├── monochrome.css
│   │       └── muted-violet.css
│   └── config.ts            # Site configuration
├── docs/                    # Reference files, design docs
├── astro.config.mjs
├── tsconfig.json
├── package.json
└── .github/
    └── workflows/
        └── deploy.yml       # GitHub Pages deployment
```

## Future Extensibility

- **New simulations:** Create a new folder in `src/components/simulations/`, add a project Markdown file, and it appears in the gallery
- **New theme:** Copy an existing theme CSS file, change the color values, update the import
- **Audio-reactive CPPN:** Port existing PyTorch code to WebGPU compute shaders, add Web Audio API integration
- **Custom domain:** Add CNAME file to `public/`, configure DNS
- **WebGL2 fallbacks:** Can be added per-simulation for broader browser support
