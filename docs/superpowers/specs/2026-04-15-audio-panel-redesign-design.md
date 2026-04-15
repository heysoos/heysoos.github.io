# Audio Panel Redesign — Param × Band Matrix

**Date:** 2026-04-15
**Status:** Approved

## Problem

The current audio tab displays mappings as a flat list of rows, one row per `AudioMapping` object. When multiple bands drive the same param the param name appears multiple times, and scanning for "which bands affect param X?" requires reading every row in sequence. With 6–10 mappings this becomes an unreadable wall of identical-looking controls.

## Goal

Replace the flat mapping list with a **param × band matrix** that makes the full mapping picture immediately scannable. Each param is always one row; each band is always one column; each active mapping is a colored dot at their intersection. Editing is done through an inline drawer that opens below the selected param row.

---

## Data Model

No changes. `AudioMapping`, `AudioReactor`, `PARAM_META`, `BAND_COLORS`, and all storage/load/save logic in `boids-audio.ts` are untouched. The redesign is purely in `buildAudioTab` inside `boids-panel.ts`.

---

## Layout

The tab structure above the mappings section is unchanged:

1. Source row (Microphone / System Audio toggles + status dot)
2. Spectrum canvas + 5 band meters

The mappings section replaces the flat `mappingsList` div with two new components: the **matrix** and the **drawer**.

---

## The Matrix

A table: 9 param rows × 5 band columns (B · M · P · H · V).

**Column headers** use the existing `BAND_COLORS` per band, abbreviated (B M P H V).

**Param rows** show the short label from `PARAM_META`. Params with no active mappings render at reduced opacity (~40%) to keep the grid readable without hiding them.

**Cells:**
- **Empty cell** — a small dim circle (8 px, 20% opacity). Clickable to add a mapping.
- **Mapped cell** — a filled colored dot using `BAND_COLORS[band]`. Dot diameter encodes depth:
  - depth < 0.33 → 6 px (small)
  - depth 0.33–0.66 → 9 px (medium)
  - depth > 0.66 → 11 px (large)
- **Live amplitude bar** — a 2 px tall bar beneath each mapped dot, updated every rAF tick, filled with `BAND_COLORS[band]` at `amplitude × 100%` width.

Only one drawer is open at a time. The currently-selected param row has a subtle background highlight.

---

## The Drawer

Opens inline between the selected param row and the row below it.

- Clicking an **already-active (glowing) dot** on the open row closes the drawer.
- Clicking an **empty cell** on any row (including the currently-open row) creates a new mapping and adds its band tab to the drawer for that row. If the row is already open the drawer stays open and the new tab becomes active.
- Clicking any **cell on a different row** closes the current drawer and opens a new one for that row.

### Tab strip

One tab per active band mapping on the param, in band color, labeled `● bass`, `● mid`, etc. A **remove** link sits at the trailing edge of the tab strip and removes the mapping for the currently active tab (the dot disappears from the grid; if it was the last tab the drawer closes).

**∑ total tab** — present only when the param has 2 or more active band mappings. When present, it is the default tab opened when the drawer first opens for that param.

### Band tabs (bass / mid / presence / hi / volume)

Each band tab contains the same controls as the current mapping row:

- Depth slider (0–1, accent color = band color)
- Gain slider (0–4, accent color = band color)
- Mode toggle button (`+ add` / `× mul`)
- Min / max clamp text inputs
- Trace sparkline canvas (HiDPI, ring buffer, with min/max/current labels as per current implementation)

### ∑ total tab

Read-only. Updated every rAF tick alongside the individual band updaters.

**Live value header:**
```
1.43    base 0.80    +0.63
```
- Left: current modulated param value (after all mappings applied), large text
- Center: base value (the slider value before modulation), muted
- Right: signed delta (modulated − base), green if positive / red if negative

**Range bar:** A horizontal track spanning the param's natural range (`PARAM_META[param].min` → `PARAM_META[param].max`). A bright cursor marks the current modulated value's position. Shows three tick labels: min, current value, max.

**Stacked trace canvas:**
- Individual band traces drawn faint (opacity ~0.45) in their band color
- Combined output trace drawn bright (opacity 0.9) in `--text-body` white/cream
- Legend below: `— bass  — mid  — combined`

**Contributions breakdown:**
One row per active band mapping:
```
● bass   +add   ████░░░░   +0.91
● mid    ×mul   ██░░░░░░   ×1.28
```
Each row: colored swatch, band name, mode label, a proportional bar, and the numeric contribution at the current moment. Additive contributions show `+X.XX`; multiplicative show `×X.XX`.

### Adding a mapping

- Clicking an empty cell creates a new `AudioMapping` with defaults (using `defaultMapping()`), saves it, and opens the drawer at that param row with the new band tab active.
- A `+ add another band` footer link in the drawer picks the next unmapped band for this param and creates a mapping for it.

---

## rAF Update Path

The existing `updateAudioViz` function currently:
1. Calls `reactor.analyze()` to get a `BandSnapshot`
2. Updates the spectrum canvas and band meters
3. Iterates `mappingRowUpdaters` to push amplitude fractions to each row's bar + trace

After the redesign:

1. Same spectrum + meter update (unchanged)
2. A `cellUpdaters: Map<string, (amplitude: number) => void>` map keyed by `"${param}::${band}"` replaces `mappingRowUpdaters`. Each mapped cell registers an updater that sets its live amplitude bar width and pushes a sample into its trace ring buffer.
3. For params with 2+ active mappings, a `totalUpdaters: Map<string, (snapshot: BandSnapshot, baseVal: number, modulatedVal: number) => void>` map is maintained. The controller snapshots `params[param]` **before** calling `applyMappings` to get the base value, then passes both base and modulated values to each total-tab updater, which updates the live header, range cursor, stacked trace, and contributions breakdown.

The `applyMappings` call that actually modulates `BoidsParams` is unchanged.

---

## File Changes

| File | Change |
|------|--------|
| `src/components/simulations/boids/boids-panel.ts` | Rewrite `buildAudioTab`: replace `buildMappingRow` + `mappingsList` with `buildMappingMatrix` + `buildMappingDrawer`. Update `mappingRowUpdaters` → `cellUpdaters` + `totalUpdaters`. |
| `src/components/simulations/boids/boids-audio.ts` | No changes. |
| All other files | No changes. |

---

## Out of Scope

- Changes to any other simulation's panel
- Changes to the audio engine (`AudioReactor`, `applyMappings`, band definitions)
- Changes to preset saving/loading (mappings are already persisted in `localStorage` under `boids-audio-mappings`)
- Min/max clamp inputs are retained in each band tab exactly as they are today
