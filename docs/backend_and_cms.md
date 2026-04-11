# Backend & CMS Options

## Current Setup

The site is pure static Astro deployed to GitHub Pages — no server-side code runs in production. The only "server" code is a local-dev-only Vite middleware (`astro.config.mjs`) that writes boids presets to disk when using the admin panel.

---

## Do You Need a Backend or a CMS?

**CMS** (content management system): a UI to edit blog posts, publications, and projects without touching Markdown or code. This is likely what you want.

**Backend**: an API server + database for features like auth, user data, or heavy server-side compute. Only needed if you build something interactive that requires persistent state.

---

## CMS Recommendation: Keystatic

**https://keystatic.com**

Built specifically for Astro content collections. Best fit for your existing setup.

### How it works
- Adds an admin UI at `/keystatic` (local: `localhost:4321/keystatic`)
- Reads and writes your existing Markdown files in `src/content/`
- In **GitHub mode**: deploy it and edit from any browser — saves commit to `main` via GitHub API, which triggers your existing GitHub Actions deploy

### Why it fits
- No hosting changes required
- No new infrastructure
- Works with your existing content collections (`publications`, `blog`, `projects`)
- Free and open source
- Official Astro integration: `@keystatic/astro`

### Setup
```bash
npm install @keystatic/core @keystatic/astro
```

Then add a `keystatic.config.ts` defining your collections, and a `src/pages/keystatic/[...params].astro` route. Docs: https://keystatic.com/docs/installation-astro

---

## If You Need a Real Backend

If you eventually need an API (auth, user data, server-side compute), the options below are ordered by ease of migration from your current setup.

### Option 1: Vercel (easiest migration)
- Deploy your Astro site to Vercel instead of GitHub Pages
- Add `@astrojs/vercel` adapter for SSR and serverless API routes
- Write API endpoints as `src/pages/api/foo.ts` — same repo, no separate service
- Free tier is generous for a portfolio site
- https://vercel.com / https://docs.astro.build/en/guides/integrations-guide/vercel/

### Option 2: Netlify
- Same idea as Vercel — deploy there, use `@astrojs/netlify` adapter
- Netlify Functions for serverless endpoints
- Also supports Decap CMS natively if you go this route
- https://netlify.com / https://docs.astro.build/en/guides/integrations-guide/netlify/

### Option 3: Keep GitHub Pages + Separate API Server
- Keep the static site as-is on GitHub Pages
- Run a Node/Python API on Railway, Render, or Fly.io
- Frontend fetches `https://api.yourserver.com/...`
- More moving parts, but zero disruption to the existing deploy pipeline
- https://railway.app / https://render.com / https://fly.io

### Option 4: Cloudflare Pages + Workers
- Deploy to Cloudflare Pages with `@astrojs/cloudflare` adapter
- Workers are edge serverless functions (very fast, global)
- More complex mental model but excellent performance
- https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/

---

## CMS Alternatives

| CMS | Notes |
|---|---|
| [Tina CMS](https://tina.io) | Visual inline editing on the live page; requires their cloud service |
| [Decap CMS](https://decapcms.org) | Mature Git-based CMS; needs Netlify or a separate OAuth server for auth |
| [Sanity](https://sanity.io) | Powerful hosted studio with structured content; more setup, separate service |

---

## Recommended Path

1. **Right now**: add Keystatic for CMS — no infrastructure changes, works with GitHub Pages
2. **If you need an API later**: migrate hosting to Vercel (smallest disruption, best Astro support)
