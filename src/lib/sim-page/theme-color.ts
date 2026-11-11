/**
 * Theme tokens for code that can't use `var(--…)` (canvas 2D styles).
 * Reads the computed custom property, so a theme switch recolours the next draw.
 */
export function themeVar(name: string, fallback: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}
