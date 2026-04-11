# Portfolio Website — Customization Guide

Personal portfolio for Sina Khajehabdollahi. Dark, minimal frame where WebGPU simulations provide all the visual richness.

## Quick Start

```bash
npm install
npm run dev       # Dev server at http://localhost:4321
npm run build     # Static build → dist/
npm run preview   # Preview built site locally
```

Pushes to `main` deploy automatically to GitHub Pages.

---

## Site-Wide Config

**`src/config.ts`** — the single source of truth for global settings:

- Your name, tagline, bio
- Social links (GitHub, Twitter, Google Scholar, email)
- Navigation items
- Active theme

Change these first when personalizing the site.

---

## Publications

Each publication is a Markdown file in **`src/content/publications/`**.

**Create a new file** (e.g., `my-paper-2024.md`):

```markdown
---
title: "Your Paper Title"
authors: ["Sina Khajehabdollahi", "Co-Author Name"]
journal: "Journal Name"
year: 2024
doi: "10.1234/your.doi"
abstract: "Brief description of the paper."
tags: ["emergence", "criticality"]
featured: true
---
```

- `featured: true` — shows the paper on the home page
- `featured: false` — appears only on the full publications list
- The body below the frontmatter is optional (currently unused)
- Delete `example-paper.md` when you add your real publications

---

## Blog Posts

Each post is a Markdown file in **`src/content/blog/`**.

**Create a new file** (e.g., `my-post.md`):

```markdown
---
title: "Post Title"
date: 2024-06-15
tags: ["neuroscience", "webgpu"]
description: "One-sentence summary shown in listings."
---

Your post content here in standard Markdown.
```

- Posts are sorted by `date` descending
- `tags` are used for filtering/display
- `description` appears in post previews

---

## Gallery Simulations

Each simulation entry is a Markdown file in **`src/content/projects/`** paired with a WebGPU implementation.

**To add a new simulation:**

1. Create the implementation in `src/components/simulations/<name>/`:
   - `<name>.astro` — component wrapper
   - `<name>-controller.ts` — WebGPU setup and render loop
   - `<name>.wgsl` — compute and render shaders

2. Create `src/content/projects/<name>.md`:

```markdown
---
title: "Simulation Name"
description: "One-sentence description."
simulation: "<name>"
order: 5
---

Longer description shown on the gallery detail page.
```

- `simulation` must match the folder name in `src/components/simulations/`
- `order` controls the display order in the gallery (lower = first)

---

## Themes

Themes live in **`src/styles/themes/`**. The active theme is imported in `src/layouts/BaseLayout.astro`.

Available themes:
- `warm-ember.css` (default)
- `deep-space.css`
- `monochrome.css`
- `muted-violet.css`

To switch themes, change the import in `BaseLayout.astro`:

```astro
import '../styles/themes/deep-space.css';
```

All colors are CSS custom properties. To create a custom theme, copy an existing file and adjust the key tokens: `--bg-primary`, `--bg-surface`, `--text-primary`, `--text-body`, `--accent`, `--accent-glow`.

---

## Deployment

The site deploys to GitHub Pages via `.github/workflows/deploy.yml` on every push to `main`. No manual steps required.

The base path for GitHub Pages is configured in `astro.config.mjs` — do not remove the `base` option or asset paths will break.
