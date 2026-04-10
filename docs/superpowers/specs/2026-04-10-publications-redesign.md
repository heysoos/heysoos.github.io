# Publications Page Redesign — Design Spec

**Date:** 2026-04-10  
**Status:** Approved

## Overview

Redesign the publications page from a flat card list into an elegant two-column layout: a sticky sidebar for tag-based filtering and a left-border timeline grouped by year. Filtering is client-side, single-select, with year sections collapsing when empty.

---

## Layout

Two-column layout at desktop widths:

- **Left sidebar** (~160px, fixed width): sticky filter panel. Contains a "Filter by topic" label, an "all papers" entry (selected by default), then all unique tags extracted from the publications collection sorted alphabetically. Stays fixed relative to the viewport as the user scrolls.
- **Right content area** (flex: 1): page title + publications grouped by year, descending.

On mobile (< ~640px): sidebar collapses to a horizontally scrollable pill row above the timeline.

---

## Year Sections

Each distinct year gets a section:

```
[YYYY]                  ← small uppercase label, --text-muted color, 3px letter-spacing
│
├─ Paper title (link)   ← left border: 2px solid --accent
│  Authors (bold self)
│  Journal · Year
│  [tag] [tag]
│
├─ Paper title (link)   ← same left-border treatment for every paper in the year
│  ...
```

All papers within a year share the same `2px solid --accent` left border. The year label sits above the group with `margin-bottom: 0.75rem`.

Year sections that contain zero visible papers (after filtering) are hidden entirely (`display: none`).

---

## Sidebar Filter

- Tags are derived server-side in `publications.astro` by collecting all unique tags across all publications, sorted alphabetically.
- Rendered as a vertical list of `<button>` elements (not `<span>`) for accessibility.
- "all papers" is the default active state.
- Active tag: `--accent` color + subtle `--accent-subtle` background.
- Inactive tags: `--text-muted` color, no background, hover lightens to `--text-body`.
- Clicking an active tag deselects it (returns to "all papers").

---

## Filtering Logic (inline `<script>`)

Data model:
- Each paper `<article>` carries `data-tags="tag-one tag-two"` (slugified, space-separated).
- Each year `<section>` wraps all papers for that year.

On tag click:
1. Mark clicked button as active (toggle `--accent` style), deactivate others.
2. If "all papers" or the already-active tag: show everything, return.
3. Otherwise: iterate all `<article>` elements. Show if `data-tags` includes the selected tag, hide otherwise.
4. After filtering articles, iterate year `<section>` elements: hide any whose visible article count is zero.

Tag slugification: lowercase, spaces replaced with hyphens (e.g. `"recurrent networks"` → `recurrent-networks`). Applied consistently when rendering `data-tags` and when building sidebar buttons.

---

## Component Changes

### `publications.astro`
- Replace flat `pub-list` div with two-column `publications-layout` wrapper.
- Add sidebar with dynamically generated tag list (unique tags from collection, sorted).
- Group papers by year (server-side sort + groupBy in template).
- Add inline `<script>` for filtering logic.

### `PublicationCard.astro`
- Remove `.pub-card` border-bottom treatment (was used for flat list separation).
- Add left-border timeline style (`border-left: 2px solid var(--accent)`).
- Tags on cards remain decorative (not clickable) — filtering is sidebar-only.
- Pass `data-tags` attribute through to the `<article>` element.

---

## No Abstract Expansion

The `abstract` field exists in the schema but is not displayed. This is intentional — the page is a concise reference list, not a reading interface. Abstracts may be added in a future enhancement.

---

## Accessibility

- Filter buttons use `<button>` elements with `aria-pressed` reflecting active state.
- Year sections use `<section>` with an `aria-label` of the year (e.g. `aria-label="2024"`).
- Hidden papers use `display: none` (fully removed from tab order).

---

## Files Affected

- `src/pages/publications.astro` — major rewrite
- `src/components/PublicationCard.astro` — style update + `data-tags` prop
