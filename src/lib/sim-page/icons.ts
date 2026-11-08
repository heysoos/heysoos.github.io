// src/lib/sim-page/icons.ts
// Inline SVG icons for panel headers. The dice glyph U+2684 is missing from
// the site font and rendered as a box, so Randomize draws its own die.

export const DICE_SVG =
  '<svg class="ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
  '<rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
  '<circle cx="5" cy="5" r="1.4" fill="currentColor"/><circle cx="11" cy="5" r="1.4" fill="currentColor"/>' +
  '<circle cx="8" cy="8" r="1.4" fill="currentColor"/>' +
  '<circle cx="5" cy="11" r="1.4" fill="currentColor"/><circle cx="11" cy="11" r="1.4" fill="currentColor"/></svg>';

export const UNDO_SVG =
  '<svg class="ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M6 4 2.5 7.5 6 11"/><path d="M3 7.5h6.5a3.5 3.5 0 0 1 0 7H8"/></svg>';

export const REDO_SVG =
  '<svg class="ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="m10 4 3.5 3.5L10 11"/><path d="M13 7.5H6.5a3.5 3.5 0 0 0 0 7H8"/></svg>';
