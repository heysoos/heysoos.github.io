# Portfolio Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dark, minimal portfolio website for Sina Khajehabdollahi with WebGPU simulation art, Markdown-driven content, and a swappable theme system.

**Architecture:** Astro static site generator with TypeScript. WebGPU simulations are self-contained Astro components (`.astro` wrapper + TS controller + WGSL shader). Content (publications, blog, projects) lives in Markdown collections. CSS custom properties power a theme system with 4 presets.

**Tech Stack:** Astro 5, TypeScript, WebGPU/WGSL, CSS custom properties, GitHub Pages

**Spec:** `docs/superpowers/specs/2026-04-02-portfolio-website-design.md`

---

## File Map

```
website/
├── .github/workflows/deploy.yml         # GitHub Pages CI/CD
├── .gitignore
├── astro.config.mjs                     # Astro configuration
├── package.json
├── tsconfig.json
├── public/
│   └── images/                          # Static images, thumbnails
├── src/
│   ├── config.ts                        # Site-wide settings
│   ├── content.config.ts                # Content collection schemas
│   ├── components/
│   │   ├── Nav.astro                    # Sticky navigation bar
│   │   ├── Footer.astro                 # Site footer
│   │   ├── PublicationCard.astro        # Publication list item
│   │   ├── SimulationCard.astro         # Gallery preview card
│   │   ├── Controls.astro              # Shared simulation controls UI
│   │   └── simulations/
│   │       ├── boids/
│   │       │   ├── Boids.astro
│   │       │   ├── boids-controller.ts
│   │       │   └── boids.wgsl
│   │       ├── particle-life/
│   │       │   ├── ParticleLife.astro
│   │       │   ├── particle-life-controller.ts
│   │       │   └── particle-life.wgsl
│   │       ├── nca/
│   │       │   ├── NCA.astro
│   │       │   ├── nca-controller.ts
│   │       │   └── nca.wgsl
│   │       └── cppn/
│   │           ├── CPPN.astro
│   │           ├── cppn-controller.ts
│   │           └── cppn.wgsl
│   ├── content/
│   │   ├── publications/
│   │   │   └── example-paper.md
│   │   ├── blog/
│   │   │   └── hello-world.md
│   │   └── projects/
│   │       ├── boids.md
│   │       ├── particle-life.md
│   │       ├── nca.md
│   │       └── cppn.md
│   ├── layouts/
│   │   ├── BaseLayout.astro             # Main layout (nav + footer + theme)
│   │   └── SimLayout.astro              # Full-viewport simulation layout
│   ├── lib/
│   │   └── webgpu/
│   │       ├── device.ts                # WebGPU device initialization
│   │       └── utils.ts                 # Shared helpers
│   ├── pages/
│   │   ├── index.astro                  # Home page
│   │   ├── about.astro
│   │   ├── publications.astro
│   │   ├── gallery/
│   │   │   ├── index.astro
│   │   │   └── [...slug].astro
│   │   ├── blog/
│   │   │   ├── index.astro
│   │   │   └── [...slug].astro
│   │   └── contact.astro
│   └── styles/
│       ├── global.css                   # Base styles, typography, reset
│       └── themes/
│           ├── warm-ember.css
│           ├── deep-space.css
│           ├── monochrome.css
│           └── muted-violet.css
└── docs/
    └── superpowers/                     # Design docs and plans
```

---

## Phase 1: Foundation

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `.gitignore`

- [ ] **Step 1: Initialize git repository**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git init
```

- [ ] **Step 2: Create Astro project**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
npm create astro@latest -- . --template minimal --typescript strict --install --git false
```

When prompted, accept defaults. The `--git false` flag prevents re-initializing git since we already did that.

- [ ] **Step 3: Verify project runs**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
npm run dev
```

Expected: Astro dev server starts at `http://localhost:4321/`

- [ ] **Step 4: Create directory structure**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
mkdir -p src/components/simulations/boids
mkdir -p src/components/simulations/particle-life
mkdir -p src/components/simulations/nca
mkdir -p src/components/simulations/cppn
mkdir -p src/content/publications
mkdir -p src/content/blog
mkdir -p src/content/projects
mkdir -p src/layouts
mkdir -p src/lib/webgpu
mkdir -p src/styles/themes
mkdir -p public/images
mkdir -p .github/workflows
```

- [ ] **Step 5: Update .gitignore**

Add to `.gitignore`:
```
node_modules/
dist/
.astro/
.superpowers/
*.env
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Astro project with directory structure"
```

---

### Task 2: Theme System

**Files:**
- Create: `src/styles/themes/warm-ember.css`, `src/styles/themes/deep-space.css`, `src/styles/themes/monochrome.css`, `src/styles/themes/muted-violet.css`, `src/styles/global.css`

- [ ] **Step 1: Create Warm Ember theme (default)**

Create `src/styles/themes/warm-ember.css`:
```css
:root {
  --bg-primary: #0a0804;
  --bg-surface: #1a1408;
  --bg-surface-hover: #221a0c;
  --bg-surface-border: #2a2018;
  --bg-nav: rgba(10, 8, 4, 0.85);

  --text-primary: #f0e8e0;
  --text-body: #a09080;
  --text-muted: #665840;
  --text-link: #c08030;
  --text-link-hover: #e8a040;

  --accent: #c08030;
  --accent-glow: #e8a040;
  --accent-subtle: rgba(192, 128, 48, 0.1);

  --hero-gradient-start: #1a1008;
  --hero-gradient-end: #0a0804;

  --border-radius: 8px;
  --transition-speed: 0.2s;
}
```

- [ ] **Step 2: Create Deep Space theme**

Create `src/styles/themes/deep-space.css`:
```css
:root {
  --bg-primary: #060612;
  --bg-surface: #0d1530;
  --bg-surface-hover: #111a3a;
  --bg-surface-border: #1a1a3a;
  --bg-nav: rgba(6, 6, 18, 0.85);

  --text-primary: #e0e0f0;
  --text-body: #8888aa;
  --text-muted: #556;
  --text-link: #5577aa;
  --text-link-hover: #6cf;

  --accent: #4af;
  --accent-glow: #6cf;
  --accent-subtle: rgba(68, 170, 255, 0.1);

  --hero-gradient-start: #0d1b3e;
  --hero-gradient-end: #060612;

  --border-radius: 8px;
  --transition-speed: 0.2s;
}
```

- [ ] **Step 3: Create Monochrome theme**

Create `src/styles/themes/monochrome.css`:
```css
:root {
  --bg-primary: #0a0a0a;
  --bg-surface: #161616;
  --bg-surface-hover: #1c1c1c;
  --bg-surface-border: #222;
  --bg-nav: rgba(10, 10, 10, 0.85);

  --text-primary: #f0f0f0;
  --text-body: #888;
  --text-muted: #555;
  --text-link: #ccc;
  --text-link-hover: #fff;

  --accent: #fff;
  --accent-glow: rgba(255, 255, 255, 0.5);
  --accent-subtle: rgba(255, 255, 255, 0.05);

  --hero-gradient-start: #141414;
  --hero-gradient-end: #0a0a0a;

  --border-radius: 8px;
  --transition-speed: 0.2s;
}
```

- [ ] **Step 4: Create Muted Violet theme**

Create `src/styles/themes/muted-violet.css`:
```css
:root {
  --bg-primary: #080610;
  --bg-surface: #120e1a;
  --bg-surface-hover: #181228;
  --bg-surface-border: #201830;
  --bg-nav: rgba(8, 6, 16, 0.85);

  --text-primary: #e8e0f4;
  --text-body: #887799;
  --text-muted: #554466;
  --text-link: #8060b0;
  --text-link-hover: #b080f0;

  --accent: #a070e0;
  --accent-glow: #b080f0;
  --accent-subtle: rgba(160, 112, 224, 0.1);

  --hero-gradient-start: #140e20;
  --hero-gradient-end: #080610;

  --border-radius: 8px;
  --transition-speed: 0.2s;
}
```

- [ ] **Step 5: Create global styles**

Create `src/styles/global.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600&display=swap');

/* Default theme — swap this import to change the site theme */
@import './themes/warm-ember.css';

*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  font-family: 'Space Grotesk', system-ui, -apple-system, sans-serif;
  font-weight: 400;
  background-color: var(--bg-primary);
  color: var(--text-body);
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1, h2, h3, h4 {
  color: var(--text-primary);
  font-weight: 300;
  line-height: 1.3;
}

h1 { font-size: 2.5rem; }
h2 { font-size: 1.75rem; }
h3 { font-size: 1.25rem; }

a {
  color: var(--text-link);
  text-decoration: none;
  transition: color var(--transition-speed);
}

a:hover {
  color: var(--text-link-hover);
}

code {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.9em;
}

img {
  max-width: 100%;
  height: auto;
}

.content-width {
  max-width: 800px;
  margin: 0 auto;
  padding: 0 1.5rem;
}

.section {
  padding: 5rem 0;
}

.section-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--accent);
  margin-bottom: 1rem;
}

/* Scroll fade-in animation */
.fade-in {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}

.fade-in.visible {
  opacity: 1;
  transform: translateY(0);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/styles/
git commit -m "feat: add theme system with 4 presets and global styles"
```

---

### Task 3: Site Configuration

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: Create site config**

Create `src/config.ts`:
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
};
```

- [ ] **Step 2: Commit**

```bash
git add src/config.ts
git commit -m "feat: add site configuration"
```

---

### Task 4: Base Layout & Navigation

**Files:**
- Create: `src/layouts/BaseLayout.astro`, `src/components/Nav.astro`, `src/components/Footer.astro`

- [ ] **Step 1: Create Nav component**

Create `src/components/Nav.astro`:
```astro
---
import { siteConfig } from '../config';

const currentPath = Astro.url.pathname;
---

<nav class="nav">
  <div class="nav-inner">
    <a href="/" class="nav-logo">{siteConfig.name.toUpperCase()}</a>
    <button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false">
      <span class="nav-toggle-bar"></span>
      <span class="nav-toggle-bar"></span>
      <span class="nav-toggle-bar"></span>
    </button>
    <ul class="nav-links">
      {siteConfig.navItems.map((item) => (
        <li>
          <a
            href={item.href}
            class:list={[{ active: currentPath.startsWith(item.href) }]}
          >
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  </div>
</nav>

<style>
  .nav {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    background: var(--bg-nav);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--bg-surface-border);
  }

  .nav-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1.5rem;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .nav-logo {
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--text-primary);
  }

  .nav-logo:hover {
    color: var(--text-primary);
  }

  .nav-links {
    display: flex;
    list-style: none;
    gap: 2rem;
  }

  .nav-links a {
    font-size: 0.75rem;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-muted);
    transition: color var(--transition-speed);
  }

  .nav-links a:hover,
  .nav-links a.active {
    color: var(--text-primary);
  }

  .nav-toggle {
    display: none;
    flex-direction: column;
    gap: 4px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
  }

  .nav-toggle-bar {
    display: block;
    width: 20px;
    height: 2px;
    background: var(--text-primary);
    transition: transform var(--transition-speed), opacity var(--transition-speed);
  }

  @media (max-width: 768px) {
    .nav-toggle {
      display: flex;
    }

    .nav-links {
      display: none;
      position: absolute;
      top: 60px;
      left: 0;
      right: 0;
      flex-direction: column;
      background: var(--bg-nav);
      backdrop-filter: blur(12px);
      padding: 1rem 1.5rem;
      gap: 1rem;
      border-bottom: 1px solid var(--bg-surface-border);
    }

    .nav-links.open {
      display: flex;
    }
  }
</style>

<script>
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  toggle?.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    links?.classList.toggle('open');
  });
</script>
```

- [ ] **Step 2: Create Footer component**

Create `src/components/Footer.astro`:
```astro
---
import { siteConfig } from '../config';
---

<footer class="footer">
  <div class="footer-inner">
    <p>&copy; {new Date().getFullYear()} {siteConfig.name}</p>
  </div>
</footer>

<style>
  .footer {
    border-top: 1px solid var(--bg-surface-border);
    padding: 2rem 1.5rem;
    text-align: center;
  }

  .footer-inner {
    max-width: 1200px;
    margin: 0 auto;
  }

  .footer p {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
</style>
```

- [ ] **Step 3: Create BaseLayout**

Create `src/layouts/BaseLayout.astro`:
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

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <title>{pageTitle}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body>
    <Nav />
    <main>
      <slot />
    </main>
    <Footer />
  </body>
</html>

<style>
  main {
    min-height: 100vh;
    padding-top: 60px; /* nav height */
  }
</style>

<script>
  // Scroll fade-in observer
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    { threshold: 0.1 }
  );

  document.querySelectorAll('.fade-in').forEach((el) => observer.observe(el));
</script>
```

- [ ] **Step 4: Create a placeholder home page to verify layout works**

Replace `src/pages/index.astro`:
```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { siteConfig } from '../config';
---

<BaseLayout>
  <section class="hero">
    <div class="hero-content">
      <h1>{siteConfig.name}</h1>
      <p class="tagline">{siteConfig.tagline}</p>
    </div>
  </section>
</BaseLayout>

<style>
  .hero {
    min-height: calc(100vh - 60px);
    display: flex;
    align-items: flex-end;
    padding: 4rem 1.5rem;
    background: radial-gradient(ellipse at 60% 50%, var(--hero-gradient-start), var(--hero-gradient-end));
  }

  .hero-content {
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
  }

  .hero h1 {
    font-size: 3rem;
    font-weight: 300;
    letter-spacing: -0.5px;
  }

  .tagline {
    font-size: 0.85rem;
    color: var(--accent);
    letter-spacing: 1px;
    margin-top: 0.5rem;
  }

  @media (max-width: 768px) {
    .hero h1 {
      font-size: 2rem;
    }
  }
</style>
```

- [ ] **Step 5: Run dev server and verify**

```bash
npm run dev
```

Expected: Site loads at `http://localhost:4321/` showing the hero section with name and tagline, navigation bar at top, and footer at bottom. Theme colors (Warm Ember) should be applied.

- [ ] **Step 6: Commit**

```bash
git add src/layouts/ src/components/Nav.astro src/components/Footer.astro src/pages/index.astro
git commit -m "feat: add base layout, navigation, footer, and placeholder home page"
```

---

## Phase 2: Content Pages

### Task 5: Content Collections Schema

**Files:**
- Create: `src/content.config.ts`

- [ ] **Step 1: Create content collection schemas**

Create `src/content.config.ts`:
```typescript
import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

const publications = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/publications" }),
  schema: z.object({
    title: z.string(),
    authors: z.array(z.string()),
    journal: z.string(),
    year: z.number(),
    doi: z.string().optional(),
    abstract: z.string().optional(),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    description: z.string(),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    thumbnail: z.string().optional(),
    simulation: z.string(),
    order: z.number(),
  }),
});

export const collections = { publications, blog, projects };
```

- [ ] **Step 2: Create example publication**

Create `src/content/publications/example-paper.md`:
```markdown
---
title: "Example Publication Title"
authors: ["Sina Khajehabdollahi", "Co-Author Name"]
journal: "Example Journal"
year: 2024
doi: "10.1234/example"
abstract: "This is a placeholder abstract for an example publication."
tags: ["emergence", "criticality"]
featured: true
---
```

- [ ] **Step 3: Create example blog post**

Create `src/content/blog/hello-world.md`:
```markdown
---
title: "Hello World"
date: 2026-04-02
tags: ["meta"]
description: "First post on the new site."
---

Welcome to my new portfolio and blog. More to come.
```

- [ ] **Step 4: Create project entries for simulations**

Create `src/content/projects/boids.md`:
```markdown
---
title: "Boids"
description: "Flocking behavior emergent from three simple rules — separation, alignment, and cohesion."
simulation: "boids"
order: 1
---

Craig Reynolds' boids model demonstrates how complex flocking behavior emerges from three simple local rules applied to each agent: avoid crowding nearby agents (separation), steer towards the average heading of nearby agents (alignment), and steer towards the average position of nearby agents (cohesion).
```

Create `src/content/projects/particle-life.md`:
```markdown
---
title: "Particle Life"
description: "Emergent structures from simple attraction and repulsion rules between particle species."
simulation: "particle-life"
order: 2
---

Particle Life is a system where multiple species of particles interact through simple attraction and repulsion forces. The interaction strengths between species are defined by a random or structured matrix, leading to emergent self-organizing structures — clusters, chains, oscillators, and more.
```

Create `src/content/projects/nca.md`:
```markdown
---
title: "Neural Cellular Automata"
description: "Trainable cellular automata that learn to grow and maintain patterns."
simulation: "nca"
order: 3
---

Neural Cellular Automata (NCA) replace the hand-designed rules of traditional cellular automata with small neural networks. Each cell observes its neighbors and updates its state through a learned function, enabling the system to grow, regenerate, and maintain complex patterns from simple initial conditions.
```

Create `src/content/projects/cppn.md`:
```markdown
---
title: "CPPN Art"
description: "Pattern generation through compositional pattern-producing networks."
simulation: "cppn"
order: 4
---

Compositional Pattern-Producing Networks (CPPNs) are neural networks that take spatial coordinates as input and output color values, producing infinitely scalable abstract patterns. By composing periodic functions (sin, cos, gaussian), CPPNs generate intricate, symmetrical, and organic-looking imagery.
```

- [ ] **Step 5: Verify collections load**

```bash
npm run dev
```

Expected: Dev server starts without content collection errors.

- [ ] **Step 6: Commit**

```bash
git add src/content.config.ts src/content/
git commit -m "feat: add content collections for publications, blog, and projects"
```

---

### Task 6: Publications Page

**Files:**
- Create: `src/components/PublicationCard.astro`, `src/pages/publications.astro`

- [ ] **Step 1: Create PublicationCard component**

Create `src/components/PublicationCard.astro`:
```astro
---
interface Props {
  title: string;
  authors: string[];
  journal: string;
  year: number;
  doi?: string;
  tags?: string[];
}

const { title, authors, journal, year, doi, tags = [] } = Astro.props;
---

<article class="pub-card">
  <h3 class="pub-title">
    {doi ? <a href={`https://doi.org/${doi}`} target="_blank" rel="noopener">{title}</a> : title}
  </h3>
  <p class="pub-authors">{authors.join(', ')}</p>
  <p class="pub-meta">
    <span class="pub-journal">{journal}</span> &middot; {year}
  </p>
  {tags.length > 0 && (
    <div class="pub-tags">
      {tags.map((tag) => <span class="pub-tag">{tag}</span>)}
    </div>
  )}
</article>

<style>
  .pub-card {
    padding: 1.5rem 0;
    border-bottom: 1px solid var(--bg-surface-border);
  }

  .pub-title {
    font-size: 1.1rem;
    font-weight: 400;
    margin-bottom: 0.4rem;
  }

  .pub-title a {
    color: var(--text-primary);
  }

  .pub-title a:hover {
    color: var(--text-link-hover);
  }

  .pub-authors {
    font-size: 0.9rem;
    color: var(--text-body);
    margin-bottom: 0.25rem;
  }

  .pub-meta {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .pub-journal {
    font-style: italic;
  }

  .pub-tags {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    flex-wrap: wrap;
  }

  .pub-tag {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--accent);
    background: var(--accent-subtle);
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
  }
</style>
```

- [ ] **Step 2: Create Publications page**

Create `src/pages/publications.astro`:
```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import PublicationCard from '../components/PublicationCard.astro';
import { getCollection } from 'astro:content';

const publications = await getCollection('publications');
const sorted = publications.sort((a, b) => b.data.year - a.data.year);
---

<BaseLayout title="Publications">
  <div class="content-width section">
    <p class="section-label">Publications</p>
    <h1>Research Papers</h1>

    <div class="pub-list">
      {sorted.map((pub) => (
        <PublicationCard
          title={pub.data.title}
          authors={pub.data.authors}
          journal={pub.data.journal}
          year={pub.data.year}
          doi={pub.data.doi}
          tags={pub.data.tags}
        />
      ))}
    </div>
  </div>
</BaseLayout>

<style>
  h1 {
    margin-bottom: 2rem;
  }
</style>
```

- [ ] **Step 3: Verify page renders**

```bash
npm run dev
```

Visit `http://localhost:4321/publications` — should show the example publication.

- [ ] **Step 4: Commit**

```bash
git add src/components/PublicationCard.astro src/pages/publications.astro
git commit -m "feat: add publications page with card component"
```

---

### Task 7: About Page

**Files:**
- Create: `src/pages/about.astro`

- [ ] **Step 1: Create About page**

Create `src/pages/about.astro`:
```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { siteConfig } from '../config';
---

<BaseLayout title="About">
  <div class="content-width section">
    <p class="section-label">About</p>
    <h1>{siteConfig.name}</h1>

    <div class="bio">
      <p>
        I am a researcher working at the intersection of computational neuroscience, artificial life, and machine learning. My work focuses on understanding how complexity emerges from simple systems.
      </p>

      <h2>Research Trajectory</h2>
      <p>
        My journey began in astrophysics (BSc), where I developed a foundation in mathematical physics. During my Master's in physics, I studied integrated information theory, the Ising model, and critical brain theory — exploring the hypothesis that the brain operates near a critical phase transition.
      </p>
      <p>
        I then moved into artificial life, experimenting with evolutionary algorithms, small embodied neural networks, and their relationship to criticality. My PhD in computational neuroscience at the University of Tubingen focused on models of self-organization — how complexity emerges from simple systems, and nature-inspired approaches to machine learning and AI.
      </p>
      <p>
        Most recently, during my post-doc at INRIA Bordeaux, I worked on open-endedness through autotelic exploration of complex systems using vision-language models and foundation models.
      </p>

      <p><a href="/resume.pdf" class="resume-link" target="_blank">Download CV (PDF)</a></p>

      <h2>As an Artist</h2>
      <p>
        The simulations and computational systems I study are also my artistic medium. I create generative and interactive art through boids, particle systems, neural cellular automata, and compositional pattern-producing networks — exploring the aesthetic dimension of emergence and self-organization.
      </p>
    </div>
  </div>
</BaseLayout>

<style>
  .bio {
    margin-top: 2rem;
  }

  .bio p {
    margin-bottom: 1.2rem;
  }

  .bio h2 {
    margin-top: 2.5rem;
    margin-bottom: 1rem;
  }

  .resume-link {
    display: inline-block;
    margin-top: 1.5rem;
    padding: 0.6rem 1.2rem;
    border: 1px solid var(--accent);
    border-radius: var(--border-radius);
    font-size: 0.85rem;
    color: var(--accent);
    transition: background var(--transition-speed), color var(--transition-speed);
  }

  .resume-link:hover {
    background: var(--accent);
    color: var(--bg-primary);
  }
</style>
```

- [ ] **Step 2: Verify and commit**

```bash
npm run dev
```

Visit `http://localhost:4321/about`.

```bash
git add src/pages/about.astro
git commit -m "feat: add about page with bio and research trajectory"
```

---

### Task 8: Blog Pages

**Files:**
- Create: `src/pages/blog/index.astro`, `src/pages/blog/[...slug].astro`

- [ ] **Step 1: Create blog index page**

Create `src/pages/blog/index.astro`:
```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';

const posts = await getCollection('blog');
const sorted = posts.sort((a, b) =>
  new Date(b.data.date).getTime() - new Date(a.data.date).getTime()
);
---

<BaseLayout title="Blog">
  <div class="content-width section">
    <p class="section-label">Blog</p>
    <h1>Writing</h1>

    <div class="post-list">
      {sorted.map((post) => (
        <a href={`/blog/${post.id}`} class="post-item">
          <article>
            <h3>{post.data.title}</h3>
            <p class="post-desc">{post.data.description}</p>
            <time>{new Date(post.data.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>
          </article>
        </a>
      ))}
    </div>
  </div>
</BaseLayout>

<style>
  h1 {
    margin-bottom: 2rem;
  }

  .post-item {
    display: block;
    padding: 1.5rem 0;
    border-bottom: 1px solid var(--bg-surface-border);
    color: inherit;
  }

  .post-item:hover h3 {
    color: var(--text-link-hover);
  }

  .post-item h3 {
    font-weight: 400;
    margin-bottom: 0.4rem;
    transition: color var(--transition-speed);
  }

  .post-desc {
    font-size: 0.9rem;
    margin-bottom: 0.4rem;
  }

  time {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
</style>
```

- [ ] **Step 2: Create blog post page**

Create `src/pages/blog/[...slug].astro`:
```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getCollection, render } from 'astro:content';

export async function getStaticPaths() {
  const posts = await getCollection('blog');
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content } = await render(post);
---

<BaseLayout title={post.data.title}>
  <article class="content-width section">
    <p class="section-label">Blog</p>
    <h1>{post.data.title}</h1>
    <time>{new Date(post.data.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>

    {post.data.tags.length > 0 && (
      <div class="tags">
        {post.data.tags.map((tag: string) => <span class="tag">{tag}</span>)}
      </div>
    )}

    <div class="prose">
      <Content />
    </div>
  </article>
</BaseLayout>

<style>
  h1 {
    margin-bottom: 0.5rem;
  }

  time {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .tags {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }

  .tag {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--accent);
    background: var(--accent-subtle);
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
  }

  .prose {
    margin-top: 2.5rem;
  }

  .prose :global(p) {
    margin-bottom: 1.2rem;
  }

  .prose :global(h2) {
    margin-top: 2.5rem;
    margin-bottom: 1rem;
  }

  .prose :global(h3) {
    margin-top: 2rem;
    margin-bottom: 0.75rem;
  }

  .prose :global(code) {
    background: var(--bg-surface);
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    font-size: 0.85em;
  }

  .prose :global(pre) {
    background: var(--bg-surface);
    border: 1px solid var(--bg-surface-border);
    border-radius: var(--border-radius);
    padding: 1.25rem;
    overflow-x: auto;
    margin-bottom: 1.5rem;
  }

  .prose :global(pre code) {
    background: none;
    padding: 0;
  }
</style>
```

- [ ] **Step 3: Verify and commit**

```bash
npm run dev
```

Visit `http://localhost:4321/blog` and click through to the hello-world post.

```bash
git add src/pages/blog/
git commit -m "feat: add blog index and post pages"
```

---

### Task 9: Contact Page

**Files:**
- Create: `src/pages/contact.astro`

- [ ] **Step 1: Create Contact page**

Create `src/pages/contact.astro`:
```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { siteConfig } from '../config';
---

<BaseLayout title="Contact">
  <div class="content-width section">
    <p class="section-label">Contact</p>
    <h1>Get in Touch</h1>

    <div class="contact-links">
      {siteConfig.email && (
        <a href={`mailto:${siteConfig.email}`} class="contact-item">
          <span class="contact-label">Email</span>
          <span class="contact-value">{siteConfig.email}</span>
        </a>
      )}

      {Object.entries(siteConfig.socialLinks).map(([platform, url]) =>
        url ? (
          <a href={url} target="_blank" rel="noopener" class="contact-item">
            <span class="contact-label">{platform.replace(/([A-Z])/g, ' $1').trim()}</span>
            <span class="contact-value">{url}</span>
          </a>
        ) : null
      )}
    </div>
  </div>
</BaseLayout>

<style>
  h1 {
    margin-bottom: 2rem;
  }

  .contact-links {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .contact-item {
    display: block;
    padding: 1.25rem;
    background: var(--bg-surface);
    border: 1px solid var(--bg-surface-border);
    border-radius: var(--border-radius);
    color: inherit;
    transition: border-color var(--transition-speed), background var(--transition-speed);
  }

  .contact-item:hover {
    border-color: var(--accent);
    background: var(--bg-surface-hover);
  }

  .contact-label {
    display: block;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--accent);
    margin-bottom: 0.3rem;
  }

  .contact-value {
    font-size: 0.95rem;
    color: var(--text-primary);
  }
</style>
```

- [ ] **Step 2: Verify and commit**

```bash
npm run dev
```

Visit `http://localhost:4321/contact`.

```bash
git add src/pages/contact.astro
git commit -m "feat: add contact page"
```

---

## Phase 3: WebGPU Infrastructure & Simulations

### Task 10: WebGPU Shared Infrastructure

**Files:**
- Create: `src/lib/webgpu/device.ts`, `src/lib/webgpu/utils.ts`

- [ ] **Step 1: Create device initialization utility**

Create `src/lib/webgpu/device.ts`:
```typescript
export interface WebGPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
}

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<WebGPUContext | null> {
  if (!navigator.gpu) {
    return null;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return null;
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) {
    return null;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  return { device, context, format, canvas };
}
```

- [ ] **Step 2: Create shared utilities**

Create `src/lib/webgpu/utils.ts`:
```typescript
export function createBuffer(
  device: GPUDevice,
  data: Float32Array | Uint32Array,
  usage: GPUBufferUsageFlags,
): GPUBuffer {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage,
    mappedAtCreation: true,
  });
  if (data instanceof Float32Array) {
    new Float32Array(buffer.getMappedRange()).set(data);
  } else {
    new Uint32Array(buffer.getMappedRange()).set(data);
  }
  buffer.unmap();
  return buffer;
}

export function createUniformBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

export function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement): boolean {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.floor(canvas.clientWidth * dpr);
  const height = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    return true;
  }
  return false;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/webgpu/
git commit -m "feat: add WebGPU shared infrastructure (device init, buffer utils)"
```

---

### Task 11: Boids Simulation

**Files:**
- Create: `src/components/simulations/boids/boids.wgsl`, `src/components/simulations/boids/boids-controller.ts`, `src/components/simulations/boids/Boids.astro`

> **Note:** The user may provide reference scripts in `./docs`. If reference files exist at implementation time, use them to guide the shader and controller logic. The code below provides a complete working boids implementation that can be refined from those references.

- [ ] **Step 1: Create boids WGSL shader**

Create `src/components/simulations/boids/boids.wgsl`:
```wgsl
struct Particle {
  pos: vec2f,
  vel: vec2f,
}

struct Params {
  deltaTime: f32,
  separationDistance: f32,
  alignmentDistance: f32,
  cohesionDistance: f32,
  separationScale: f32,
  alignmentScale: f32,
  cohesionScale: f32,
  numParticles: u32,
  mouseX: f32,
  mouseY: f32,
  mouseActive: f32,
  mouseRadius: f32,
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

  var separation = vec2f(0.0);
  var alignment = vec2f(0.0);
  var cohesion = vec2f(0.0);
  var sepCount = 0u;
  var aliCount = 0u;
  var cohCount = 0u;

  for (var i = 0u; i < params.numParticles; i++) {
    if (i == index) { continue; }
    let other = particlesA[i];
    let diff = pos - other.pos;
    let dist = length(diff);

    if (dist < params.separationDistance && dist > 0.0) {
      separation += normalize(diff) / dist;
      sepCount++;
    }
    if (dist < params.alignmentDistance) {
      alignment += other.vel;
      aliCount++;
    }
    if (dist < params.cohesionDistance) {
      cohesion += other.pos;
      cohCount++;
    }
  }

  if (sepCount > 0u) { vel += normalize(separation) * params.separationScale; }
  if (aliCount > 0u) { vel += normalize(alignment / f32(aliCount) - vel) * params.alignmentScale; }
  if (cohCount > 0u) { vel += normalize(cohesion / f32(cohCount) - pos) * params.cohesionScale; }

  // Mouse interaction
  if (params.mouseActive > 0.5) {
    let mousePos = vec2f(params.mouseX, params.mouseY);
    let toMouse = mousePos - pos;
    let mouseDist = length(toMouse);
    if (mouseDist < params.mouseRadius && mouseDist > 0.0) {
      vel += normalize(toMouse) * 0.001;
    }
  }

  // Clamp speed
  let speed = length(vel);
  if (speed > 0.01) { vel = normalize(vel) * 0.01; }
  if (speed < 0.001) { vel = normalize(vel) * 0.001; }

  // Wrap around edges
  pos = pos + vel * params.deltaTime;
  if (pos.x < -1.0) { pos.x += 2.0; }
  if (pos.x > 1.0)  { pos.x -= 2.0; }
  if (pos.y < -1.0) { pos.y += 2.0; }
  if (pos.y > 1.0)  { pos.y -= 2.0; }

  particlesB[index] = Particle(pos, vel);
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
}

@vertex
fn vertexMain(
  @location(0) particlePos: vec2f,
  @location(1) particleVel: vec2f,
  @location(2) vertexPos: vec2f,
) -> VertexOutput {
  let angle = atan2(particleVel.y, particleVel.x);
  let cosA = cos(angle);
  let sinA = sin(angle);
  let rotated = vec2f(
    vertexPos.x * cosA - vertexPos.y * sinA,
    vertexPos.x * sinA + vertexPos.y * cosA,
  );
  var out: VertexOutput;
  out.position = vec4f(particlePos + rotated, 0.0, 1.0);
  out.alpha = clamp(length(particleVel) * 100.0, 0.3, 1.0);
  return out;
}

@fragment
fn fragmentMain(@location(0) alpha: f32) -> @location(0) vec4f {
  return vec4f(0.88, 0.63, 0.25, alpha);
}
```

- [ ] **Step 2: Create boids controller**

Create `src/components/simulations/boids/boids-controller.ts`:
```typescript
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { createBuffer, createUniformBuffer, resizeCanvasToDisplaySize } from '../../../lib/webgpu/utils';
import shaderCode from './boids.wgsl?raw';

const NUM_PARTICLES = 1500;
const TRIANGLE_SIZE = 0.006;
const TRIANGLE_VERTS = new Float32Array([
  0.0, TRIANGLE_SIZE,
  -TRIANGLE_SIZE * 0.5, -TRIANGLE_SIZE * 0.5,
  TRIANGLE_SIZE * 0.5, -TRIANGLE_SIZE * 0.5,
]);

export interface BoidsParams {
  separationDistance: number;
  alignmentDistance: number;
  cohesionDistance: number;
  separationScale: number;
  alignmentScale: number;
  cohesionScale: number;
  mouseRadius: number;
}

const DEFAULT_PARAMS: BoidsParams = {
  separationDistance: 0.03,
  alignmentDistance: 0.06,
  cohesionDistance: 0.08,
  separationScale: 0.05,
  alignmentScale: 0.04,
  cohesionScale: 0.03,
  mouseRadius: 0.15,
};

export class BoidsController {
  private gpu: WebGPUContext | null = null;
  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
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
  params: BoidsParams = { ...DEFAULT_PARAMS };

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    this.gpu = await initWebGPU(canvas);
    if (!this.gpu) return false;

    const { device, format } = this.gpu;

    // Shader module
    const shaderModule = device.createShaderModule({ code: shaderCode });

    // Uniform buffer (12 floats = 48 bytes)
    this.uniformBuffer = createUniformBuffer(device, 48);

    // Particle data
    const initialData = new Float32Array(NUM_PARTICLES * 4);
    for (let i = 0; i < NUM_PARTICLES; i++) {
      initialData[i * 4 + 0] = (Math.random() - 0.5) * 2; // x
      initialData[i * 4 + 1] = (Math.random() - 0.5) * 2; // y
      initialData[i * 4 + 2] = (Math.random() - 0.5) * 0.01; // vx
      initialData[i * 4 + 3] = (Math.random() - 0.5) * 0.01; // vy
    }

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX;
    this.particleBuffers = [
      createBuffer(device, initialData, usage),
      createBuffer(device, initialData, usage),
    ];

    this.vertexBuffer = createBuffer(device, TRIANGLE_VERTS, GPUBufferUsage.VERTEX);

    // Compute pipeline
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    this.computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'computeMain' },
    });

    // Bind groups (ping-pong)
    this.bindGroups = [
      device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.particleBuffers[0] } },
          { binding: 2, resource: { buffer: this.particleBuffers[1] } },
        ],
      }),
      device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.particleBuffers[1] } },
          { binding: 2, resource: { buffer: this.particleBuffers[0] } },
        ],
      }),
    ];

    // Render pipeline
    this.renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
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
        module: shaderModule,
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

    // Mouse events
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      this.mouseActive = true;
    });
    canvas.addEventListener('mouseleave', () => { this.mouseActive = false; });

    return true;
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
    const data = new Float32Array(NUM_PARTICLES * 4);
    for (let i = 0; i < NUM_PARTICLES; i++) {
      data[i * 4 + 0] = (Math.random() - 0.5) * 2;
      data[i * 4 + 1] = (Math.random() - 0.5) * 2;
      data[i * 4 + 2] = (Math.random() - 0.5) * 0.01;
      data[i * 4 + 3] = (Math.random() - 0.5) * 0.01;
    }
    device.queue.writeBuffer(this.particleBuffers[0], 0, data);
    device.queue.writeBuffer(this.particleBuffers[1], 0, data);
    this.frame = 0;
  }

  private tick = () => {
    if (!this.running || !this.gpu) return;
    const { device, context, canvas } = this.gpu;

    resizeCanvasToDisplaySize(canvas);

    // Update uniforms
    const uniformData = new Float32Array([
      1.0, // deltaTime
      this.params.separationDistance,
      this.params.alignmentDistance,
      this.params.cohesionDistance,
      this.params.separationScale,
      this.params.alignmentScale,
      this.params.cohesionScale,
      NUM_PARTICLES,
      this.mouseX,
      this.mouseY,
      this.mouseActive ? 1.0 : 0.0,
      this.params.mouseRadius,
    ]);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    const encoder = device.createCommandEncoder();

    // Compute pass
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.bindGroups[this.frame % 2]);
    computePass.dispatchWorkgroups(Math.ceil(NUM_PARTICLES / 64));
    computePass.end();

    // Render pass
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
    renderPass.setVertexBuffer(0, this.particleBuffers[(this.frame + 1) % 2]);
    renderPass.setVertexBuffer(1, this.vertexBuffer);
    renderPass.draw(3, NUM_PARTICLES);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    this.frame++;
    this.animId = requestAnimationFrame(this.tick);
  };
}
```

- [ ] **Step 3: Create Boids Astro component**

Create `src/components/simulations/boids/Boids.astro`:
```astro
---
interface Props {
  fullscreen?: boolean;
}
const { fullscreen = false } = Astro.props;
---

<div class:list={['boids-container', { fullscreen }]}>
  <canvas id="boids-canvas"></canvas>
  <div id="boids-fallback" class="fallback" style="display:none;">
    <p>WebGPU is not supported in your browser.</p>
    <p>Try Chrome, Edge, or Firefox Nightly.</p>
  </div>
</div>

<style>
  .boids-container {
    position: relative;
    width: 100%;
    height: 400px;
  }

  .boids-container.fullscreen {
    height: 100vh;
  }

  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .fallback {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    color: var(--text-muted);
    font-size: 0.9rem;
    gap: 0.25rem;
  }
</style>

<script>
  import { BoidsController } from './boids-controller';

  const canvas = document.getElementById('boids-canvas') as HTMLCanvasElement;
  const fallback = document.getElementById('boids-fallback') as HTMLElement;

  const controller = new BoidsController();
  const ok = await controller.init(canvas);

  if (ok) {
    controller.start();
  } else {
    canvas.style.display = 'none';
    fallback.style.display = 'flex';
  }
</script>
```

- [ ] **Step 4: Verify boids render**

Update `src/pages/index.astro` to use the boids hero:
```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { siteConfig } from '../config';
---

<BaseLayout>
  <section class="hero">
    <div class="hero-sim">
      <canvas id="boids-canvas"></canvas>
      <div id="boids-fallback" class="fallback" style="display:none;">
        <p>WebGPU is not supported in your browser.</p>
      </div>
    </div>
    <div class="hero-content">
      <h1>{siteConfig.name}</h1>
      <p class="tagline">{siteConfig.tagline}</p>
    </div>
  </section>
</BaseLayout>

<style>
  .hero {
    position: relative;
    min-height: 100vh;
    display: flex;
    align-items: flex-end;
    padding: 4rem 1.5rem;
  }

  .hero-sim {
    position: absolute;
    inset: 0;
    z-index: 0;
  }

  .hero-sim canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .hero-content {
    position: relative;
    z-index: 1;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
  }

  .hero h1 {
    font-size: 3rem;
    font-weight: 300;
    letter-spacing: -0.5px;
  }

  .tagline {
    font-size: 0.85rem;
    color: var(--accent);
    letter-spacing: 1px;
    margin-top: 0.5rem;
  }

  .fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(ellipse at 60% 50%, var(--hero-gradient-start), var(--hero-gradient-end));
    color: var(--text-muted);
  }

  @media (max-width: 768px) {
    .hero h1 { font-size: 2rem; }
  }
</style>

<script>
  import { BoidsController } from '../components/simulations/boids/boids-controller';

  const canvas = document.getElementById('boids-canvas') as HTMLCanvasElement;
  const fallback = document.getElementById('boids-fallback') as HTMLElement;

  const controller = new BoidsController();
  const ok = await controller.init(canvas);

  if (ok) {
    controller.start();
  } else {
    canvas.style.display = 'none';
    fallback!.style.display = 'flex';
  }
</script>
```

```bash
npm run dev
```

Expected: `http://localhost:4321/` shows a full-viewport boids simulation with your name overlaid.

- [ ] **Step 5: Commit**

```bash
git add src/components/simulations/boids/ src/pages/index.astro
git commit -m "feat: add boids WebGPU simulation as hero on home page"
```

---

### Task 12: Simulation Layout & Gallery Page

**Files:**
- Create: `src/layouts/SimLayout.astro`, `src/components/SimulationCard.astro`, `src/components/Controls.astro`, `src/pages/gallery/index.astro`, `src/pages/gallery/[...slug].astro`

- [ ] **Step 1: Create Controls component**

Create `src/components/Controls.astro`:
```astro
---
interface Props {
  simId: string;
}
const { simId } = Astro.props;
---

<div class="controls" id={`controls-${simId}`}>
  <button class="ctrl-btn" data-action="play-pause" title="Play/Pause">
    <span class="ctrl-icon">⏸</span>
  </button>
  <button class="ctrl-btn" data-action="reset" title="Reset">
    <span class="ctrl-icon">↺</span>
  </button>
  <button class="ctrl-btn" data-action="fullscreen" title="Fullscreen">
    <span class="ctrl-icon">⛶</span>
  </button>
</div>

<style>
  .controls {
    position: absolute;
    bottom: 1rem;
    right: 1rem;
    display: flex;
    gap: 0.5rem;
    z-index: 10;
  }

  .ctrl-btn {
    width: 36px;
    height: 36px;
    border: 1px solid var(--bg-surface-border);
    border-radius: 6px;
    background: var(--bg-nav);
    backdrop-filter: blur(8px);
    color: var(--text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    transition: border-color var(--transition-speed);
  }

  .ctrl-btn:hover {
    border-color: var(--accent);
  }
</style>
```

- [ ] **Step 2: Create SimLayout**

Create `src/layouts/SimLayout.astro`:
```astro
---
import Nav from '../components/Nav.astro';
import '../styles/global.css';
import { siteConfig } from '../config';

interface Props {
  title: string;
  description?: string;
}

const { title, description } = Astro.props;
const pageTitle = `${title} — ${siteConfig.name}`;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description || title} />
    <title>{pageTitle}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body>
    <Nav />
    <main class="sim-main">
      <slot />
    </main>
  </body>
</html>

<style>
  .sim-main {
    padding-top: 60px;
  }
</style>
```

- [ ] **Step 3: Create SimulationCard component**

Create `src/components/SimulationCard.astro`:
```astro
---
interface Props {
  title: string;
  description: string;
  slug: string;
  thumbnail?: string;
}

const { title, description, slug, thumbnail } = Astro.props;
---

<a href={`/gallery/${slug}`} class="sim-card">
  <div class="sim-card-preview">
    {thumbnail
      ? <img src={thumbnail} alt={title} />
      : <div class="sim-card-placeholder"></div>
    }
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

  .sim-card-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .sim-card-placeholder {
    width: 100%;
    height: 100%;
    background: radial-gradient(ellipse at 50% 50%, var(--hero-gradient-start), var(--hero-gradient-end));
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

- [ ] **Step 4: Create gallery index page**

Create `src/pages/gallery/index.astro`:
```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import SimulationCard from '../../components/SimulationCard.astro';
import { getCollection } from 'astro:content';

const projects = await getCollection('projects');
const sorted = projects.sort((a, b) => a.data.order - b.data.order);
---

<BaseLayout title="Gallery">
  <div class="content-width section">
    <p class="section-label">Gallery</p>
    <h1>Simulation Art</h1>

    <div class="gallery-grid">
      {sorted.map((project) => (
        <SimulationCard
          title={project.data.title}
          description={project.data.description}
          slug={project.data.simulation}
          thumbnail={project.data.thumbnail}
        />
      ))}
    </div>
  </div>
</BaseLayout>

<style>
  h1 {
    margin-bottom: 2rem;
  }

  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1.5rem;
  }
</style>
```

- [ ] **Step 5: Create gallery detail page (dynamic route)**

Create `src/pages/gallery/[...slug].astro`:
```astro
---
import SimLayout from '../../layouts/SimLayout.astro';
import Controls from '../../components/Controls.astro';
import { getCollection, render } from 'astro:content';

export async function getStaticPaths() {
  const projects = await getCollection('projects');
  return projects.map((project) => ({
    params: { slug: project.data.simulation },
    props: { project },
  }));
}

const { project } = Astro.props;
const { Content } = await render(project);
const sim = project.data.simulation;
---

<SimLayout title={project.data.title} description={project.data.description}>
  <div class="sim-page">
    <div class="sim-viewport" id="sim-viewport">
      <canvas id="sim-canvas"></canvas>
      <Controls simId={sim} />
      <div id="sim-fallback" class="fallback" style="display:none;">
        <p>WebGPU is not supported in your browser.</p>
        <p>Try Chrome, Edge, or Firefox Nightly.</p>
      </div>
    </div>

    <div class="content-width section">
      <h1>{project.data.title}</h1>
      <div class="prose">
        <Content />
      </div>
      <a href="/gallery" class="back-link">← Back to Gallery</a>
    </div>
  </div>
</SimLayout>

<style>
  .sim-viewport {
    position: relative;
    width: 100%;
    height: 70vh;
  }

  .sim-viewport canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .fallback {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: radial-gradient(ellipse at 50% 50%, var(--hero-gradient-start), var(--hero-gradient-end));
    color: var(--text-muted);
    gap: 0.25rem;
  }

  h1 {
    margin-bottom: 1.5rem;
  }

  .prose {
    margin-bottom: 2rem;
  }

  .prose :global(p) {
    margin-bottom: 1.2rem;
  }

  .back-link {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .back-link:hover {
    color: var(--text-link-hover);
  }
</style>

<script define:vars={{ sim }}>
  // Dynamic simulation loader
  async function loadSimulation() {
    const canvas = document.getElementById('sim-canvas');
    const fallback = document.getElementById('sim-fallback');

    let Controller;
    switch (sim) {
      case 'boids':
        Controller = (await import('../../components/simulations/boids/boids-controller')).BoidsController;
        break;
      // Future simulations will be added here as cases
      default:
        if (fallback) {
          fallback.style.display = 'flex';
          fallback.querySelector('p')!.textContent = 'Simulation coming soon.';
        }
        return;
    }

    const controller = new Controller();
    const ok = await controller.init(canvas);

    if (ok) {
      controller.start();

      // Wire up controls
      const controls = document.getElementById(`controls-${sim}`);
      let playing = true;
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
        }
      });
    } else {
      canvas.style.display = 'none';
      fallback.style.display = 'flex';
    }
  }

  loadSimulation();
</script>
```

- [ ] **Step 6: Verify gallery and detail pages**

```bash
npm run dev
```

Visit `http://localhost:4321/gallery` — should show 4 simulation cards. Click "Boids" — should open the boids simulation with controls. Other simulations will show "coming soon" for now.

- [ ] **Step 7: Commit**

```bash
git add src/layouts/SimLayout.astro src/components/Controls.astro src/components/SimulationCard.astro src/pages/gallery/
git commit -m "feat: add gallery page, simulation detail page with controls"
```

---

### Task 13: Home Page — Full Layout

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Complete home page with all sections**

Replace `src/pages/index.astro`:
```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import PublicationCard from '../components/PublicationCard.astro';
import SimulationCard from '../components/SimulationCard.astro';
import { siteConfig } from '../config';
import { getCollection } from 'astro:content';

const featuredPubs = (await getCollection('publications'))
  .filter((p) => p.data.featured)
  .sort((a, b) => b.data.year - a.data.year)
  .slice(0, 5);

const projects = (await getCollection('projects'))
  .sort((a, b) => a.data.order - b.data.order);
---

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

  {/* About teaser */}
  <section class="section fade-in">
    <div class="content-width">
      <p class="section-label">About</p>
      <p class="about-teaser">
        Researcher at the intersection of computational neuroscience, artificial life, and machine learning.
        Studying how complexity emerges from simple systems — from critical phase transitions to open-ended evolution.
      </p>
      <a href="/about" class="section-link">Read more →</a>
    </div>
  </section>

  {/* Selected publications */}
  {featuredPubs.length > 0 && (
    <section class="section fade-in">
      <div class="content-width">
        <p class="section-label">Selected Publications</p>
        {featuredPubs.map((pub) => (
          <PublicationCard
            title={pub.data.title}
            authors={pub.data.authors}
            journal={pub.data.journal}
            year={pub.data.year}
            doi={pub.data.doi}
            tags={pub.data.tags}
          />
        ))}
        <a href="/publications" class="section-link">All publications →</a>
      </div>
    </section>
  )}

  {/* Gallery teaser */}
  <section class="section fade-in">
    <div class="content-width">
      <p class="section-label">Simulation Art</p>
      <div class="gallery-teaser">
        {projects.map((project) => (
          <SimulationCard
            title={project.data.title}
            description={project.data.description}
            slug={project.data.simulation}
            thumbnail={project.data.thumbnail}
          />
        ))}
      </div>
      <a href="/gallery" class="section-link">View gallery →</a>
    </div>
  </section>
</BaseLayout>

<style>
  .hero {
    position: relative;
    min-height: 100vh;
    display: flex;
    align-items: flex-end;
    padding: 4rem 1.5rem;
  }

  .hero-sim {
    position: absolute;
    inset: 0;
    z-index: 0;
  }

  .hero-sim canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .hero-content {
    position: relative;
    z-index: 1;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
  }

  .hero h1 {
    font-size: 3rem;
    font-weight: 300;
    letter-spacing: -0.5px;
  }

  .tagline {
    font-size: 0.85rem;
    color: var(--accent);
    letter-spacing: 1px;
    margin-top: 0.5rem;
  }

  .fallback {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at 60% 50%, var(--hero-gradient-start), var(--hero-gradient-end));
  }

  .about-teaser {
    font-size: 1.15rem;
    line-height: 1.8;
    color: var(--text-body);
    max-width: 600px;
  }

  .section-link {
    display: inline-block;
    margin-top: 1.5rem;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .section-link:hover {
    color: var(--text-link-hover);
  }

  .gallery-teaser {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1.25rem;
  }

  @media (max-width: 768px) {
    .hero h1 { font-size: 2rem; }
  }
</style>

<script>
  import { BoidsController } from '../components/simulations/boids/boids-controller';

  const canvas = document.getElementById('boids-canvas') as HTMLCanvasElement;
  const fallback = document.getElementById('boids-fallback') as HTMLElement;

  const controller = new BoidsController();
  const ok = await controller.init(canvas);

  if (ok) {
    controller.start();
  } else {
    canvas.style.display = 'none';
    fallback.style.display = 'flex';
  }
</script>
```

- [ ] **Step 2: Verify and commit**

```bash
npm run dev
```

Visit `http://localhost:4321/` — hero with boids, about teaser, selected publications, and gallery teaser should all be visible.

```bash
git add src/pages/index.astro
git commit -m "feat: complete home page with hero, about teaser, publications, and gallery"
```

---

## Phase 4: Remaining Simulations (Stubs)

### Task 14: Particle Life, NCA, and CPPN Stubs

**Files:**
- Create: `src/components/simulations/particle-life/ParticleLife.astro`, `src/components/simulations/particle-life/particle-life-controller.ts`, `src/components/simulations/particle-life/particle-life.wgsl`
- Create: `src/components/simulations/nca/NCA.astro`, `src/components/simulations/nca/nca-controller.ts`, `src/components/simulations/nca/nca.wgsl`
- Create: `src/components/simulations/cppn/CPPN.astro`, `src/components/simulations/cppn/cppn-controller.ts`, `src/components/simulations/cppn/cppn.wgsl`
- Modify: `src/pages/gallery/[...slug].astro`

> **Note:** These are scaffold stubs with a minimal visual (colored particles for particle-life, random grid for NCA, gradient for CPPN). The full implementations will be built in follow-up tasks using the user's reference scripts from `./docs`.

- [ ] **Step 1: Create Particle Life stub**

Create `src/components/simulations/particle-life/particle-life.wgsl`:
```wgsl
struct Particle {
  pos: vec2f,
  vel: vec2f,
  species: f32,
  _pad: f32,
}

struct Params {
  deltaTime: f32,
  numParticles: u32,
  numSpecies: u32,
  friction: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particlesIn: array<Particle>;
@group(0) @binding(2) var<storage, read_write> particlesOut: array<Particle>;

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.numParticles) { return; }

  var p = particlesIn[i];
  var force = vec2f(0.0);

  for (var j = 0u; j < params.numParticles; j++) {
    if (i == j) { continue; }
    let other = particlesIn[j];
    let diff = other.pos - p.pos;
    let dist = length(diff);
    if (dist > 0.0 && dist < 0.3) {
      let f = select(0.01, -0.01, dist < 0.05) / dist;
      force += normalize(diff) * f;
    }
  }

  p.vel = (p.vel + force) * params.friction;
  p.pos = p.pos + p.vel * params.deltaTime;

  if (p.pos.x < -1.0) { p.pos.x += 2.0; }
  if (p.pos.x > 1.0)  { p.pos.x -= 2.0; }
  if (p.pos.y < -1.0) { p.pos.y += 2.0; }
  if (p.pos.y > 1.0)  { p.pos.y -= 2.0; }

  particlesOut[i] = p;
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}

@vertex
fn vertexMain(
  @location(0) particlePos: vec2f,
  @location(1) particleVel: vec2f,
  @location(2) species: f32,
  @location(3) vertexPos: vec2f,
) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(particlePos + vertexPos * 0.004, 0.0, 1.0);
  // Color by species
  let hue = species / 6.0;
  out.color = vec3f(
    abs(hue * 6.0 - 3.0) - 1.0,
    2.0 - abs(hue * 6.0 - 2.0),
    2.0 - abs(hue * 6.0 - 4.0),
  );
  return out;
}

@fragment
fn fragmentMain(@location(0) color: vec3f) -> @location(0) vec4f {
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
```

Create `src/components/simulations/particle-life/particle-life-controller.ts`:
```typescript
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { createBuffer, createUniformBuffer, resizeCanvasToDisplaySize } from '../../../lib/webgpu/utils';
import shaderCode from './particle-life.wgsl?raw';

const NUM_PARTICLES = 1000;
const NUM_SPECIES = 6;

// Quad vertices for point rendering
const QUAD_VERTS = new Float32Array([
  -1, -1,  1, -1,  -1, 1,
  -1,  1,  1, -1,   1, 1,
]);

export class ParticleLifeController {
  private gpu: WebGPUContext | null = null;
  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private particleBuffers!: GPUBuffer[];
  private uniformBuffer!: GPUBuffer;
  private vertexBuffer!: GPUBuffer;
  private bindGroups!: GPUBindGroup[];
  private frame = 0;
  private running = false;
  private animId = 0;

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    this.gpu = await initWebGPU(canvas);
    if (!this.gpu) return false;

    const { device, format } = this.gpu;
    const shaderModule = device.createShaderModule({ code: shaderCode });

    this.uniformBuffer = createUniformBuffer(device, 16);

    // Particle data: pos(2) + vel(2) + species(1) + pad(1) = 6 floats
    const initialData = new Float32Array(NUM_PARTICLES * 6);
    for (let i = 0; i < NUM_PARTICLES; i++) {
      initialData[i * 6 + 0] = (Math.random() - 0.5) * 1.8;
      initialData[i * 6 + 1] = (Math.random() - 0.5) * 1.8;
      initialData[i * 6 + 2] = 0;
      initialData[i * 6 + 3] = 0;
      initialData[i * 6 + 4] = Math.floor(Math.random() * NUM_SPECIES);
      initialData[i * 6 + 5] = 0;
    }

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX;
    this.particleBuffers = [
      createBuffer(device, initialData, usage),
      createBuffer(device, initialData, usage),
    ];

    this.vertexBuffer = createBuffer(device, QUAD_VERTS, GPUBufferUsage.VERTEX);

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    this.computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'computeMain' },
    });

    this.bindGroups = [
      device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.particleBuffers[0] } },
          { binding: 2, resource: { buffer: this.particleBuffers[1] } },
        ],
      }),
      device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.particleBuffers[1] } },
          { binding: 2, resource: { buffer: this.particleBuffers[0] } },
        ],
      }),
    ];

    this.renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 6 * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
              { shaderLocation: 2, offset: 16, format: 'float32' },
            ],
          },
          {
            arrayStride: 2 * 4,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 3, offset: 0, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
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

    return true;
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
    const data = new Float32Array(NUM_PARTICLES * 6);
    for (let i = 0; i < NUM_PARTICLES; i++) {
      data[i * 6 + 0] = (Math.random() - 0.5) * 1.8;
      data[i * 6 + 1] = (Math.random() - 0.5) * 1.8;
      data[i * 6 + 4] = Math.floor(Math.random() * NUM_SPECIES);
    }
    device.queue.writeBuffer(this.particleBuffers[0], 0, data);
    device.queue.writeBuffer(this.particleBuffers[1], 0, data);
    this.frame = 0;
  }

  private tick = () => {
    if (!this.running || !this.gpu) return;
    const { device, context, canvas } = this.gpu;

    resizeCanvasToDisplaySize(canvas);

    const uniformData = new Float32Array([1.0, NUM_PARTICLES, NUM_SPECIES, 0.98]);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    const encoder = device.createCommandEncoder();

    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.bindGroups[this.frame % 2]);
    computePass.dispatchWorkgroups(Math.ceil(NUM_PARTICLES / 64));
    computePass.end();

    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.039, g: 0.031, b: 0.016, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setVertexBuffer(0, this.particleBuffers[(this.frame + 1) % 2]);
    renderPass.setVertexBuffer(1, this.vertexBuffer);
    renderPass.draw(6, NUM_PARTICLES);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    this.frame++;
    this.animId = requestAnimationFrame(this.tick);
  };
}
```

Create `src/components/simulations/particle-life/ParticleLife.astro`:
```astro
<div class="sim-container">
  <canvas id="particle-life-canvas"></canvas>
  <div id="particle-life-fallback" class="fallback" style="display:none;">
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

<script>
  import { ParticleLifeController } from './particle-life-controller';
  const canvas = document.getElementById('particle-life-canvas') as HTMLCanvasElement;
  const fallback = document.getElementById('particle-life-fallback') as HTMLElement;
  const ctrl = new ParticleLifeController();
  const ok = await ctrl.init(canvas);
  if (ok) { ctrl.start(); } else { canvas.style.display = 'none'; fallback.style.display = 'flex'; }
</script>
```

- [ ] **Step 2: Create NCA and CPPN placeholder files**

Create `src/components/simulations/nca/nca.wgsl`:
```wgsl
// NCA stub — to be implemented with user's reference scripts
@vertex
fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 6>(
    vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
    vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1),
  );
  return vec4f(pos[i], 0, 1);
}

@fragment
fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(800.0, 600.0);
  return vec4f(uv.x * 0.3, uv.y * 0.2, 0.1, 1.0);
}
```

Create `src/components/simulations/nca/nca-controller.ts`:
```typescript
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { resizeCanvasToDisplaySize } from '../../../lib/webgpu/utils';
import shaderCode from './nca.wgsl?raw';

export class NCAController {
  private gpu: WebGPUContext | null = null;
  private pipeline!: GPURenderPipeline;
  private running = false;
  private animId = 0;

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    this.gpu = await initWebGPU(canvas);
    if (!this.gpu) return false;
    const { device, format } = this.gpu;
    const module = device.createShaderModule({ code: shaderCode });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
    });
    return true;
  }

  start() { if (this.running) return; this.running = true; this.tick(); }
  stop() { this.running = false; cancelAnimationFrame(this.animId); }
  reset() { /* stub */ }

  private tick = () => {
    if (!this.running || !this.gpu) return;
    const { device, context, canvas } = this.gpu;
    resizeCanvasToDisplaySize(canvas);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);
    this.animId = requestAnimationFrame(this.tick);
  };
}
```

Create `src/components/simulations/nca/NCA.astro`:
```astro
<div class="sim-container">
  <canvas id="nca-canvas"></canvas>
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

<script>
  import { NCAController } from './nca-controller';
  const canvas = document.getElementById('nca-canvas') as HTMLCanvasElement;
  const fallback = document.getElementById('nca-fallback') as HTMLElement;
  const ctrl = new NCAController();
  const ok = await ctrl.init(canvas);
  if (ok) { ctrl.start(); } else { canvas.style.display = 'none'; fallback.style.display = 'flex'; }
</script>
```

Create `src/components/simulations/cppn/cppn.wgsl`:
```wgsl
// CPPN stub — to be implemented with user's reference scripts
@vertex
fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 6>(
    vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
    vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1),
  );
  return vec4f(pos[i], 0, 1);
}

@fragment
fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(800.0, 600.0);
  let r = sin(uv.x * 10.0) * 0.5 + 0.5;
  let g = cos(uv.y * 8.0 + uv.x * 3.0) * 0.5 + 0.5;
  let b = sin((uv.x + uv.y) * 6.0) * 0.5 + 0.5;
  return vec4f(r * 0.6, g * 0.4, b * 0.3, 1.0);
}
```

Create `src/components/simulations/cppn/cppn-controller.ts`:
```typescript
import { initWebGPU, type WebGPUContext } from '../../../lib/webgpu/device';
import { resizeCanvasToDisplaySize } from '../../../lib/webgpu/utils';
import shaderCode from './cppn.wgsl?raw';

export class CPPNController {
  private gpu: WebGPUContext | null = null;
  private pipeline!: GPURenderPipeline;
  private running = false;
  private animId = 0;

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    this.gpu = await initWebGPU(canvas);
    if (!this.gpu) return false;
    const { device, format } = this.gpu;
    const module = device.createShaderModule({ code: shaderCode });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
    });
    return true;
  }

  start() { if (this.running) return; this.running = true; this.tick(); }
  stop() { this.running = false; cancelAnimationFrame(this.animId); }
  reset() { /* stub */ }

  private tick = () => {
    if (!this.running || !this.gpu) return;
    const { device, context, canvas } = this.gpu;
    resizeCanvasToDisplaySize(canvas);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);
    this.animId = requestAnimationFrame(this.tick);
  };
}
```

Create `src/components/simulations/cppn/CPPN.astro`:
```astro
<div class="sim-container">
  <canvas id="cppn-canvas"></canvas>
  <div id="cppn-fallback" class="fallback" style="display:none;">
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

<script>
  import { CPPNController } from './cppn-controller';
  const canvas = document.getElementById('cppn-canvas') as HTMLCanvasElement;
  const fallback = document.getElementById('cppn-fallback') as HTMLElement;
  const ctrl = new CPPNController();
  const ok = await ctrl.init(canvas);
  if (ok) { ctrl.start(); } else { canvas.style.display = 'none'; fallback.style.display = 'flex'; }
</script>
```

- [ ] **Step 3: Update gallery detail page to support all simulations**

In `src/pages/gallery/[...slug].astro`, update the switch statement in the `<script>` block:

Replace:
```javascript
    switch (sim) {
      case 'boids':
        Controller = (await import('../../components/simulations/boids/boids-controller')).BoidsController;
        break;
      // Future simulations will be added here as cases
      default:
        if (fallback) {
          fallback.style.display = 'flex';
          fallback.querySelector('p')!.textContent = 'Simulation coming soon.';
        }
        return;
    }
```

With:
```javascript
    switch (sim) {
      case 'boids':
        Controller = (await import('../../components/simulations/boids/boids-controller')).BoidsController;
        break;
      case 'particle-life':
        Controller = (await import('../../components/simulations/particle-life/particle-life-controller')).ParticleLifeController;
        break;
      case 'nca':
        Controller = (await import('../../components/simulations/nca/nca-controller')).NCAController;
        break;
      case 'cppn':
        Controller = (await import('../../components/simulations/cppn/cppn-controller')).CPPNController;
        break;
      default:
        if (fallback) {
          fallback.style.display = 'flex';
          fallback.querySelector('p')!.textContent = 'Simulation coming soon.';
        }
        return;
    }
```

- [ ] **Step 4: Verify all gallery pages render**

```bash
npm run dev
```

Visit each:
- `http://localhost:4321/gallery/boids` — boids simulation
- `http://localhost:4321/gallery/particle-life` — colored particles
- `http://localhost:4321/gallery/nca` — gradient placeholder
- `http://localhost:4321/gallery/cppn` — pattern placeholder

- [ ] **Step 5: Commit**

```bash
git add src/components/simulations/ src/pages/gallery/
git commit -m "feat: add particle life, NCA, and CPPN simulation stubs"
```

---

## Phase 5: Deployment

### Task 15: GitHub Pages Deployment

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `astro.config.mjs`

- [ ] **Step 1: Update Astro config for GitHub Pages**

Replace `astro.config.mjs`:
```javascript
// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://YOUR_USERNAME.github.io',
  // Uncomment and set if deploying to a repo subpath (not username.github.io):
  // base: '/website',
});
```

> Replace `YOUR_USERNAME` with actual GitHub username when ready.

- [ ] **Step 2: Create GitHub Actions workflow**

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout your repository using git
        uses: actions/checkout@v5
      - name: Install, build, and upload your site
        uses: withastro/action@v5

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Verify build locally**

```bash
npm run build
```

Expected: Build completes successfully, outputs to `dist/`.

- [ ] **Step 4: Commit**

```bash
git add astro.config.mjs .github/
git commit -m "feat: add GitHub Pages deployment workflow"
```

---

## Summary

| Phase | Tasks | What It Delivers |
|-------|-------|------------------|
| 1: Foundation | Tasks 1-4 | Scaffolding, themes, layout, navigation |
| 2: Content | Tasks 5-9 | Publications, about, blog, contact pages |
| 3: WebGPU | Tasks 10-12 | Shared GPU infra, boids hero, gallery system |
| 4: Home + Stubs | Tasks 13-14 | Complete home page, all simulation stubs |
| 5: Deploy | Task 15 | GitHub Pages CI/CD |

**Follow-up work (not in this plan):**
- Replace simulation stubs with full implementations using reference scripts from `./docs`
- Add audio-reactive CPPN (port from PyTorch)
- Fill in real publications, social links, email in config
- Add simulation thumbnails/screenshots
- Custom domain configuration
