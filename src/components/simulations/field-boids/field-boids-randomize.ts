// src/components/simulations/field-boids/field-boids-randomize.ts
// Random dynamics for the "Randomize" button. Only the physics and field
// params are touched: particle count, steps per frame, dt, mouse radius and
// the View section stay as they are (they are performance/display choices,
// not part of what makes a preset behave differently).

import type { FieldBoidsParams } from './field-boids-types';

const uniform = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const logUniform = (lo: number, hi: number) => Math.exp(uniform(Math.log(lo), Math.log(hi)));
const chance = (p: number) => Math.random() < p;
const round = (v: number, step: number) => Math.round(v / step) * step;

/** Mutates `p` in place with a fresh random set of dynamics. */
export function randomizeFieldBoidsParams(p: FieldBoidsParams): void {
  const attractionRadius = logUniform(0.02, 0.4);
  // Repulsion radius stays inside the attraction radius so flocks can form.
  const repulsionRadius = logUniform(0.005, Math.min(0.15, attractionRadius * 0.8));

  p.attractionRadius = round(attractionRadius, 0.005);
  p.repulsionRadius  = round(repulsionRadius, 0.005);
  p.attraction       = round(logUniform(0.05, 4), 0.01);
  p.repulsion        = round(logUniform(0.1, 8), 0.01);
  p.alignment        = chance(0.2) ? 0 : round(logUniform(0.02, 6), 0.01);
  p.coneAngle        = round(uniform(-1, 0.9), 0.01);
  p.friction         = round(logUniform(0.3, 8), 0.1);
  p.maxSpeed         = round(logUniform(0.05, 0.8), 0.01);
  p.noise            = chance(0.5) ? 0 : round(logUniform(0.001, 0.05), 0.001);
  p.memory           = chance(0.3) ? 0 : round(uniform(0.3, 0.97), 0.01);
  p.splatSize        = round(uniform(0.5, 3), 0.1);
}
