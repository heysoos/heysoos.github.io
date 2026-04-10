# Publications Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the publications page into a two-column layout with a sticky tag-filter sidebar and a left-border timeline grouped by year.

**Architecture:** `publications.astro` is rewritten with server-side year grouping and tag extraction, a sticky sidebar of `<button>` filters, and an inline `<script>` that toggles `display` on articles and collapses empty year sections. `PublicationCard.astro` is updated to use the left-border timeline style and expose a `data-tags` attribute for the filter script to read.

**Tech Stack:** Astro, TypeScript (frontmatter), vanilla JS (inline `<script>`), CSS custom properties (Warm Ember theme)

---

## File Map

| File | Change |
|------|--------|
| `src/components/PublicationCard.astro` | Update styles to left-border timeline; add `data-tags` attribute |
| `src/pages/publications.astro` | Full rewrite: year grouping, sidebar, two-column layout, filter script |

---

### Task 1: Update PublicationCard.astro

**Files:**
- Modify: `src/components/PublicationCard.astro`

- [ ] **Step 1: Replace the file with the updated component**

```astro
---
interface Props {
  title: string;
  authors: string[];
  journal: string;
  year: number;
  doi?: string;
  url?: string;
  tags?: string[];
}

const { title, authors, journal, year, doi, url, tags = [] } = Astro.props;
const link = doi ? `https://doi.org/${doi}` : url;
const isMe = (a: string) => a.includes('Khajehabdollahi');
const slugify = (tag: string) => tag.toLowerCase().replace(/\s+/g, '-');
const dataTagsValue = tags.map(slugify).join(' ');
---

<article class="pub-entry" data-tags={dataTagsValue}>
  <h3 class="pub-title">
    {link ? <a href={link} target="_blank" rel="noopener">{title}</a> : title}
  </h3>
  <p class="pub-authors">
    {authors.map((a, i) => (
      <>
        {isMe(a) ? <strong>{a}</strong> : a}
        {i < authors.length - 1 ? ', ' : ''}
      </>
    ))}
  </p>
  <p class="pub-meta">
    <span class="pub-journal">{journal}</span>
  </p>
  {tags.length > 0 && (
    <div class="pub-tags">
      {tags.map((tag) => <span class="pub-tag">{tag}</span>)}
    </div>
  )}
</article>

<style>
  .pub-entry {
    border-left: 2px solid var(--accent);
    padding: 0 0 0 1rem;
    margin-bottom: 1.25rem;
  }

  .pub-title {
    font-size: 1rem;
    font-weight: 400;
    margin-bottom: 0.35rem;
    line-height: 1.4;
  }

  .pub-title a {
    color: var(--text-primary);
    text-decoration: none;
  }

  .pub-title a:hover {
    color: var(--text-link-hover);
  }

  .pub-authors {
    font-size: 0.85rem;
    color: var(--text-body);
    margin-bottom: 0.2rem;
  }

  .pub-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 0.35rem;
  }

  .pub-journal {
    font-style: italic;
  }

  .pub-tags {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .pub-tag {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--accent);
    background: var(--accent-subtle);
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
  }
</style>
```

- [ ] **Step 2: Verify dev server accepts the change**

Run: `npm run dev`

Open `http://localhost:4321/publications` and confirm the page still loads (papers still visible, no console errors). The style will look wrong until `publications.astro` is updated in Task 2 — that's expected.

- [ ] **Step 3: Commit**

```bash
git add src/components/PublicationCard.astro
git commit -m "feat(publications): update card to left-border timeline style with data-tags"
```

---

### Task 2: Rewrite publications.astro

**Files:**
- Modify: `src/pages/publications.astro`

- [ ] **Step 1: Replace the file with the full rewrite**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import PublicationCard from '../components/PublicationCard.astro';
import { getCollection } from 'astro:content';

const publications = await getCollection('publications');
const sorted = publications.sort((a, b) => b.data.year - a.data.year);

// Group by year, descending
const byYear: Record<number, typeof sorted> = {};
for (const pub of sorted) {
  if (!byYear[pub.data.year]) byYear[pub.data.year] = [];
  byYear[pub.data.year].push(pub);
}
const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);

// Unique tags sorted alphabetically (for sidebar)
const slugify = (tag: string) => tag.toLowerCase().replace(/\s+/g, '-');
const allTags = [...new Set(sorted.flatMap(p => p.data.tags))].sort();
---

<BaseLayout title="Publications">
  <div class="pub-page section">

    <aside class="pub-sidebar">
      <div class="sidebar-label">Filter by topic</div>
      <nav class="tag-list" aria-label="Filter publications by tag">
        <button class="tag-btn active" data-tag="all" aria-pressed="true">all papers</button>
        {allTags.map(tag => (
          <button class="tag-btn" data-tag={slugify(tag)} aria-pressed="false">{tag}</button>
        ))}
      </nav>
    </aside>

    <div class="pub-content">
      <p class="section-label">Publications</p>
      <h1>Research Papers</h1>

      {years.map(year => (
        <section class="year-section" aria-label={String(year)}>
          <div class="year-label">{year}</div>
          {byYear[year].map(pub => (
            <PublicationCard
              title={pub.data.title}
              authors={pub.data.authors}
              journal={pub.data.journal}
              year={pub.data.year}
              doi={pub.data.doi}
              url={pub.data.url}
              tags={pub.data.tags}
            />
          ))}
        </section>
      ))}
    </div>

  </div>
</BaseLayout>

<style>
  /* Page container — replaces content-width for this page */
  .pub-page {
    max-width: 960px;
    margin: 0 auto;
    padding-left: 1.5rem;
    padding-right: 1.5rem;
    display: flex;
    gap: 2.5rem;
    align-items: flex-start;
  }

  /* ── Sidebar ── */
  .pub-sidebar {
    width: 160px;
    flex-shrink: 0;
    position: sticky;
    top: 4.5rem; /* below fixed nav (60px) */
    border-right: 1px solid var(--bg-surface-border);
    padding-right: 1.5rem;
    padding-top: 4.25rem; /* visually align tag list with paper list start */
  }

  .sidebar-label {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 3px;
    color: var(--text-muted);
    margin-bottom: 1rem;
  }

  .tag-list {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .tag-btn {
    background: none;
    border: none;
    padding: 0.3rem 0.5rem;
    text-align: left;
    font-size: 0.75rem;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 3px;
    transition: color var(--transition-speed);
    font-family: inherit;
    line-height: 1.5;
  }

  .tag-btn:hover {
    color: var(--text-body);
  }

  .tag-btn.active {
    color: var(--accent);
    background: var(--accent-subtle);
  }

  /* ── Content ── */
  .pub-content {
    flex: 1;
    min-width: 0;
  }

  .pub-content h1 {
    margin-bottom: 2rem;
  }

  /* ── Year sections ── */
  .year-section {
    margin-bottom: 2.5rem;
  }

  .year-label {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 3px;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }

  /* ── Mobile ── */
  @media (max-width: 640px) {
    .pub-page {
      flex-direction: column;
      gap: 0;
    }

    .pub-sidebar {
      width: 100%;
      position: static;
      border-right: none;
      border-bottom: 1px solid var(--bg-surface-border);
      padding-right: 0;
      padding-top: 0;
      padding-bottom: 1rem;
      margin-bottom: 1.5rem;
    }

    .tag-list {
      flex-direction: row;
      flex-wrap: nowrap;
      overflow-x: auto;
      gap: 0.4rem;
      padding-bottom: 0.25rem;
      -webkit-overflow-scrolling: touch;
    }

    .tag-btn {
      white-space: nowrap;
      border: 1px solid var(--bg-surface-border);
    }
  }
</style>

<script>
  const buttons = document.querySelectorAll<HTMLButtonElement>('.tag-btn');
  const articles = document.querySelectorAll<HTMLElement>('.pub-entry');
  const sections = document.querySelectorAll<HTMLElement>('.year-section');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag!;
      const isActive = btn.getAttribute('aria-pressed') === 'true';

      // Deactivate all buttons
      buttons.forEach(b => {
        b.setAttribute('aria-pressed', 'false');
        b.classList.remove('active');
      });

      if (tag === 'all' || isActive) {
        // Reset: show everything
        const allBtn = document.querySelector<HTMLButtonElement>('[data-tag="all"]')!;
        allBtn.setAttribute('aria-pressed', 'true');
        allBtn.classList.add('active');
        articles.forEach(a => (a.style.display = ''));
        sections.forEach(s => (s.style.display = ''));
        return;
      }

      // Activate clicked button
      btn.setAttribute('aria-pressed', 'true');
      btn.classList.add('active');

      // Filter articles
      articles.forEach(article => {
        const tags = article.dataset.tags ? article.dataset.tags.split(' ') : [];
        article.style.display = tags.includes(tag) ? '' : 'none';
      });

      // Collapse empty year sections
      sections.forEach(section => {
        const hasVisible = [...section.querySelectorAll<HTMLElement>('.pub-entry')]
          .some(a => a.style.display !== 'none');
        section.style.display = hasVisible ? '' : 'none';
      });
    });
  });
</script>
```

- [ ] **Step 2: Verify in browser**

Run: `npm run dev`

Open `http://localhost:4321/publications` and confirm:
1. Two-column layout renders (sidebar on left, papers on right)
2. Papers are grouped under year labels (2025, 2024, 2023, …)
3. Each paper has the accent left border
4. Sidebar lists all unique tags alphabetically with "all papers" at top
5. "all papers" is highlighted in accent color on load

- [ ] **Step 3: Verify filtering**

Still in the browser:
1. Click any tag in the sidebar — only papers with that tag should remain visible; empty year sections should disappear
2. Click the same tag again — all papers return (toggle off)
3. Click "all papers" while a tag is active — all papers return
4. Click a different tag while one is already active — switches to new tag

- [ ] **Step 4: Verify mobile layout**

In browser devtools, set viewport to 375px wide. Confirm:
1. Sidebar collapses to a horizontal scrollable pill row above the list
2. Tags are still clickable and filtering still works
3. No horizontal overflow on the page

- [ ] **Step 5: Verify production build**

Run: `npm run build`

Expected: exits with no errors. If TypeScript errors appear in the `byYear` typing, change the declaration to:

```typescript
const byYear = {} as Record<number, typeof sorted>;
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/publications.astro
git commit -m "feat(publications): two-column timeline layout with sticky tag filter sidebar"
```

---

## Self-Review

**Spec coverage:**
- [x] Left-border timeline — `pub-entry` style in PublicationCard
- [x] Year grouping with year label — `year-section` + `year-label`
- [x] Sticky sidebar with alphabetical tags — `.pub-sidebar { position: sticky }` + `allTags.sort()`
- [x] Single-select filter — deactivate-all before activating clicked tag
- [x] Toggle off by clicking active tag — `isActive` check
- [x] Empty year sections collapse — `hasVisible` check per section
- [x] "all papers" default state — `active` class + `aria-pressed="true"` in markup
- [x] `aria-pressed` on filter buttons — set in markup and updated in script
- [x] `aria-label` on year sections — `aria-label={String(year)}`
- [x] Mobile: sidebar → horizontal scrollable row — `@media (max-width: 640px)`
- [x] Tags on cards are decorative only — `.pub-tag` has no click handler
- [x] Slugification consistent between sidebar and card — same `slugify` one-liner in both files
- [x] No abstract display — not rendered anywhere

**Placeholder scan:** None found.

**Type consistency:** `slugify` defined identically in both files. `byYear` typed as `Record<number, typeof sorted>`. `tag` accessed via `btn.dataset.tag!` (non-null assertion valid because every button has `data-tag` set in markup).
