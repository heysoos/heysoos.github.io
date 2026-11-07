// src/components/simulations/field-boids/field-boids-spec.ts
// One description of the tunable params: labels, ranges, enum names, groups.
// The desktop panel's Look section and the phone scrub list are both built
// from it, so a new param is added here once.

import type { FieldBoidsParams } from './field-boids-types';

export type ParamKey = keyof FieldBoidsParams;

export interface NumSpec {
  kind: 'num';
  key: ParamKey;
  label: string;
  min: number;
  max: number;
  step: number;
  scale?: 'linear' | 'log';
  /** Integer-valued param: the setter rounds. */
  int?: boolean;
}

export interface EnumSpec {
  kind: 'enum';
  key: ParamKey;
  label: string;
  names: readonly string[];
}

export type ParamSpec = NumSpec | EnumSpec;

export interface ParamGroup {
  name: string;
  items: ParamSpec[];
}

export const VIEW_MODES = ['Density', 'Flow', 'Points'] as const;
export const PALETTES = ['Accent', 'Ember', 'Ice', 'Spectral'] as const;
export const CURVES = ['Linear', 'Sqrt', 'Log', 'Asinh', 'Gamma'] as const;
export const TONEMAPS = ['Clip', 'Reinhard', 'ACES'] as const;

const num = (key: ParamKey, label: string, min: number, max: number, step: number, extra: Partial<NumSpec> = {}): NumSpec =>
  ({ kind: 'num', key, label, min, max, step, ...extra });
const en = (key: ParamKey, label: string, names: readonly string[]): EnumSpec => ({ kind: 'enum', key, label, names });

/** Groups in panel order. The Look group is display-only. */
export const FIELD_BOIDS_GROUPS: ParamGroup[] = [
  { name: 'Simulation', items: [
    num('numParticles', 'Particles', 1000, 2_000_000, 1000, { scale: 'log', int: true }),
    num('stepsPerFrame', 'Steps per frame', 1, 30, 1, { int: true }),
    num('attractionRadius', 'Attraction radius', 0.01, 0.5, 0.005),
    num('repulsionRadius', 'Repulsion radius', 0.005, 0.2, 0.005),
    num('attraction', 'Attraction', 0, 5, 0.01),
    num('repulsion', 'Repulsion', 0, 10, 0.01),
    num('alignment', 'Alignment', 0, 10, 0.01),
    num('coneAngle', 'Cone angle', -1, 1, 0.01),
    num('friction', 'Friction', 0, 10, 0.1),
    num('maxSpeed', 'Max speed', 0.01, 1, 0.01),
    num('noise', 'Noise', 0, 0.1, 0.001),
  ] },
  { name: 'Field', items: [
    num('memory', 'Memory', 0, 0.99, 0.01),
    num('splatSize', 'Splat size', 0.5, 3, 0.1),
  ] },
  { name: 'Look', items: [
    en('viewMode', 'View', VIEW_MODES),
    en('palette', 'Palette', PALETTES),
    en('curve', 'Curve', CURVES),
    en('tonemap', 'Tonemap', TONEMAPS),
    num('exposure', 'Exposure', 0.1, 20, 0.1, { scale: 'log' }),
    num('bloom', 'Bloom', 0, 2, 0.05),
    num('longExposure', 'Long exposure', 0, 0.98, 0.01),
    num('pointAlpha', 'Point alpha', 0.01, 1, 0.01),
  ] },
];

export const LOOK_GROUP = FIELD_BOIDS_GROUPS[2];
