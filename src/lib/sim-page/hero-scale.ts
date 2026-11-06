// src/lib/sim-page/hero-scale.ts
// Scales the home-page hero swarm to the canvas area so a phone-sized canvas
// does not read as a wall of particles. Gallery pages never use this —
// there the preset count is the user's to control.

/** Desktop canvas area the presets were tuned against (CSS px). */
export const HERO_REFERENCE_AREA = 1600 * 900;
/** Floor so the swarm never looks empty on a tiny viewport. */
export const HERO_MIN_SCALE = 0.2;

/** Multiplier in [HERO_MIN_SCALE, 1] for a canvas of the given CSS size. */
export function heroParticleScale(cssWidth: number, cssHeight: number): number {
  const area = Math.max(0, cssWidth) * Math.max(0, cssHeight);
  if (area <= 0) return 1;
  return Math.min(1, Math.max(HERO_MIN_SCALE, area / HERO_REFERENCE_AREA));
}

/** Particle count for the hero after scaling a preset's count to the canvas. */
export function scaledHeroCount(presetCount: number, cssWidth: number, cssHeight: number): number {
  return Math.max(1, Math.round(presetCount * heroParticleScale(cssWidth, cssHeight)));
}
