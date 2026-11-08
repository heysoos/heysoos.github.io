// src/components/simulations/field-boids/field-boids-randomize.ts
// Random dynamics for the "Randomize" button: every physics and field param
// drawn uniformly over its own slider range (log sliders uniform in log
// space, so the slider thumb lands anywhere with equal probability).
// Particle count, steps per frame, dt, mouse radius and the Look group stay
// as they are except the palette, which is rolled too; the caller restores
// locked params afterwards.

import type { FieldBoidsParams } from './field-boids-types';
import { FIELD_BOIDS_GROUPS, PALETTES, type NumSpec } from './field-boids-spec';

const SKIP = new Set<string>(['numParticles', 'stepsPerFrame']);

function roll(spec: NumSpec): number {
  const lo = spec.scale === 'log' ? Math.log(spec.min) : spec.min;
  const hi = spec.scale === 'log' ? Math.log(spec.max) : spec.max;
  let v = lo + Math.random() * (hi - lo);
  if (spec.scale === 'log') v = Math.exp(v);
  v = Math.round(v / spec.step) * spec.step;
  if (spec.int) v = Math.round(v);
  return Math.min(spec.max, Math.max(spec.min, v));
}

/** Mutates `p` in place with a fresh random set of dynamics. */
export function randomizeFieldBoidsParams(p: FieldBoidsParams): void {
  const pr = p as unknown as Record<string, number>;
  for (const group of FIELD_BOIDS_GROUPS) {
    if (group.name === 'Look') continue;
    for (const item of group.items) {
      if (item.kind !== 'num' || SKIP.has(item.key as string)) continue;
      pr[item.key as string] = roll(item);
    }
  }
  p.palette = Math.floor(Math.random() * PALETTES.length);
}
