// src/lib/sim-page/icons.ts
// Inline SVG icons for panel headers. Randomize uses the same rounded
// isometric line dice as the capsule's reroll button (reroll-dice.ts).
import { diceIconSVG } from './reroll-dice';

export const DICE_SVG = diceIconSVG();

// Expand / shrink arrows for the phone tab card (⤢ / ⤡ are font glyphs that never sit centred).
export const EXPAND_SVG =
  '<svg class="ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/></svg>';
export const SHRINK_SVG =
  '<svg class="ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M13.5 6.5h-4v-4M9.5 6.5 14 2M2.5 9.5h4v4M6.5 9.5 2 14"/></svg>';

export const UNDO_SVG =
  '<svg class="ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M6 4 2.5 7.5 6 11"/><path d="M3 7.5h6.5a3.5 3.5 0 0 1 0 7H8"/></svg>';

export const REDO_SVG =
  '<svg class="ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="m10 4 3.5 3.5L10 11"/><path d="M13 7.5H6.5a3.5 3.5 0 0 0 0 7H8"/></svg>';

// Reset glyphs: the mark's own outline opens at a corner and ends in an arrowhead
// (bookmark = back to the loaded preset, diamond = back to the default). Unsized: style the svg.
export const BACK_TO_PRESET_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4h7v16l-5-4-5 4V7.5"/><path d="M4.5 10 7 7.5 9.5 10"/></svg>';
export const BACK_TO_DEFAULT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 9-9 9-9-9 5-5"/><path d="M4.3 7H8v3.7"/></svg>';
