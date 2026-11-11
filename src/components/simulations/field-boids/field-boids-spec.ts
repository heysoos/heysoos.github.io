// src/components/simulations/field-boids/field-boids-spec.ts
// One description of the tunable params: labels, ranges, enum names, groups,
// and how each enum is drawn. The desktop panel's Look section, the phone
// scrub list and Randomize are all built from it, so a param is added once.

import type { FieldBoidsParams } from './field-boids-types';

export type ParamKey = keyof FieldBoidsParams;

import type {
  NumSpec as GenericNumSpec, EnumSpec as GenericEnumSpec,
  ParamSpec as GenericParamSpec, ParamGroup as GenericParamGroup,
} from '../../../lib/sim-page/param-spec';

export type NumSpec = GenericNumSpec<ParamKey>;
export type EnumSpec = GenericEnumSpec<ParamKey>;
export type ParamSpec = GenericParamSpec<ParamKey>;
export type ParamGroup = GenericParamGroup<ParamKey>;

export const VIEW_MODES = ['Density', 'Flow', 'Points'] as const;
export const PALETTES = ['Accent', 'Ember', 'Ice', 'Spectral'] as const;
export const PALETTE_COLORS = ['var(--accent)', '#e8702a', '#4ab0e8', '#9ee05a'] as const;
export const CURVES = ['Linear', 'Sqrt', 'Log', 'Asinh', 'Gamma'] as const;
export const TONEMAPS = ['Clip', 'Reinhard', 'ACES'] as const;
export const POINT_SHAPES = ['Disc', 'Soft', 'Ring'] as const;

const num = (key: ParamKey, label: string, min: number, max: number, step: number, extra: Partial<NumSpec> = {}): NumSpec =>
  ({ kind: 'num', key, label, min, max, step, ...extra });
const en = (key: ParamKey, label: string, names: readonly string[], ui: EnumSpec['ui'], extra: Partial<EnumSpec> = {}): EnumSpec =>
  ({ kind: 'enum', key, label, names, ui, ...extra });

const inPoints = (p: FieldBoidsParams) => p.viewMode === 2;

/** Groups in panel order. The Look group is display-only. */
export const FIELD_BOIDS_GROUPS: ParamGroup[] = [
  { name: 'Simulation', items: [
    num('numParticles', 'Particles', 1000, 2_000_000, 1000, { scale: 'log', int: true }),
    num('stepsPerFrame', 'Steps per frame', 1, 30, 1, { int: true, def: 1 }),
    num('attractionRadius', 'Attraction radius', 0.01, 0.5, 0.005, { def: 0.15 }),
    num('repulsionRadius', 'Repulsion radius', 0.005, 0.2, 0.005, { def: 0.03 }),
    num('attraction', 'Attraction', 0, 5, 0.01, { def: 0.3 }),
    num('repulsion', 'Repulsion', 0, 10, 0.01, { def: 1.5 }),
    num('alignment', 'Alignment', 0, 10, 0.01, { def: 0.1 }),
    num('coneAngle', 'Cone angle', -1, 1, 0.01, { def: -0.5 }),
    num('friction', 'Friction', 0, 10, 0.1, { def: 2 }),
    num('maxSpeed', 'Max speed', 0.01, 1, 0.01, { def: 0.22 }),
    num('noise', 'Noise', 0, 0.1, 0.001, { def: 0 }),
  ] },
  { name: 'Field', items: [
    num('memory', 'Memory', 0, 0.99, 0.01, { def: 0 }),
    num('splatSize', 'Splat size', 0.5, 3, 0.1, { def: 1.5 }),
  ] },
  { name: 'Look', items: [
    en('viewMode', 'View', VIEW_MODES, 'segmented', { rebuilds: true }),
    en('palette', 'Palette', PALETTES, 'swatches', { colors: PALETTE_COLORS, custom: 'tint' }),
    en('curve', 'Curve', CURVES, 'select'),
    en('tonemap', 'Tonemap', TONEMAPS, 'select'),
    num('exposure', 'Exposure', 0.1, 20, 0.1, { scale: 'log', def: 2 }),
    num('bloom', 'Bloom', 0, 2, 0.05, { def: 0 }),
    num('longExposure', 'Long exposure', 0, 0.98, 0.01, { def: 0 }),
    en('pointShape', 'Point shape', POINT_SHAPES, 'segmented', { showIf: inPoints }),
    num('pointSize', 'Point size', 1, 12, 0.5, { showIf: inPoints, def: 2 }),
    num('pointAlpha', 'Point alpha', 0.01, 1, 0.01, { showIf: inPoints, def: 0.15 }),
  ] },
];

export const LOOK_GROUP = FIELD_BOIDS_GROUPS[2];
