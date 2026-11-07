// src/components/simulations/field-boids/field-boids-spec.ts
// One description of the tunable params: labels, ranges, enum names, groups,
// and how each enum is drawn. The desktop panel's Look section, the phone
// scrub list and Randomize are all built from it, so a param is added once.

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
  /** Row is shown only when this holds (e.g. point rows in Points view). */
  showIf?: (p: FieldBoidsParams) => boolean;
}

export interface EnumSpec {
  kind: 'enum';
  key: ParamKey;
  label: string;
  names: readonly string[];
  /** segmented: one bar of exclusive segments. swatches: colour dots.
   *  select: native dropdown (for lists that are read, not scanned). */
  ui: 'segmented' | 'swatches' | 'select';
  /** swatches: one CSS colour per name. */
  colors?: readonly string[];
  /** Changing this re-renders the panel (other rows depend on it). */
  rebuilds?: boolean;
  showIf?: (p: FieldBoidsParams) => boolean;
}

export type ParamSpec = NumSpec | EnumSpec;

export interface ParamGroup {
  name: string;
  items: ParamSpec[];
}

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
    en('viewMode', 'View', VIEW_MODES, 'segmented', { rebuilds: true }),
    en('palette', 'Palette', PALETTES, 'swatches', { colors: PALETTE_COLORS }),
    en('curve', 'Curve', CURVES, 'select'),
    en('tonemap', 'Tonemap', TONEMAPS, 'select'),
    num('exposure', 'Exposure', 0.1, 20, 0.1, { scale: 'log' }),
    num('bloom', 'Bloom', 0, 2, 0.05),
    num('longExposure', 'Long exposure', 0, 0.98, 0.01),
    en('pointShape', 'Point shape', POINT_SHAPES, 'segmented', { showIf: inPoints }),
    num('pointSize', 'Point size', 1, 12, 0.5, { showIf: inPoints }),
    num('pointAlpha', 'Point intensity', 0.01, 1, 0.01, { showIf: inPoints }),
  ] },
];

export const LOOK_GROUP = FIELD_BOIDS_GROUPS[2];
