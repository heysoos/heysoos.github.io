// src/components/simulations/boids/boids-spec.ts
// One description of the boids params for the phone scrub list and Randomize:
// labels, ranges, enum names. The desktop panel keeps its own richer widgets
// (XY pads, colour picker, audio), so this only has to agree with it on ranges.
// `color` and `trails` are virtual keys: the setup routes them to the three
// colour params and to ctrl.trailsEnabled; `trailDecay` is a controller field.

import type { BoidsParams } from './boids-controller';
import type { EnumSpec, NumSpec, ParamGroup, ParamKey } from '../field-boids/field-boids-spec';
import { PARAM_META, MAPPABLE_PARAMS, type BandKey } from './boids-audio';

const K = (k: string) => k as unknown as ParamKey;
const num = (key: string, label: string, min: number, max: number, step: number, extra: Partial<NumSpec> = {}): NumSpec =>
  ({ kind: 'num', key: K(key), label, min, max, step, ...extra });
const en = (key: string, label: string, names: readonly string[], ui: EnumSpec['ui'], extra: Partial<EnumSpec> = {}): EnumSpec =>
  ({ kind: 'enum', key: K(key), label, names, ui, ...extra });

/** Glyphs, as on the desktop shape row: a 180px card has no room for the words. */
export const BOIDS_SHAPES = ['▲', '●', '◆', '✦'] as const;
export const BOIDS_OPACITY_MODES = ['Speed', 'Uniform'] as const;
/** Same swatches as the desktop colour row. */
export const BOIDS_COLORS = [
  { name: 'Amber', hex: '#e0a040', r: 0.88, g: 0.63, b: 0.25 },
  { name: 'Blue',  hex: '#4090e0', r: 0.25, g: 0.56, b: 0.88 },
  { name: 'Green', hex: '#50c878', r: 0.31, g: 0.78, b: 0.47 },
  { name: 'Rose',  hex: '#e05080', r: 0.88, g: 0.31, b: 0.50 },
  { name: 'White', hex: '#ffffff', r: 1.00, g: 1.00, b: 1.00 },
] as const;

type View = { trails: number; camera: number; audioSource: number };
const trailsOn = ((p: View) => p.trails === 1) as unknown as NumSpec['showIf'];
const cameraOn = ((p: View) => p.camera === 1) as unknown as NumSpec['showIf'];

/** Audio bands, in the order the phone card lists them; `audio:<band>` keys. */
export const AUDIO_BANDS: readonly BandKey[] = ['bass', 'mid', 'presence', 'hi', 'volume'];
export const AUDIO_BAND_LABELS: Record<BandKey, string> = { bass: 'Bass', mid: 'Mid', presence: 'Presence', hi: 'Highs', volume: 'Volume' };
/** Mapping targets per band: index 0 is "none", then MAPPABLE_PARAMS in order. */
export const AUDIO_TARGETS = ['None', ...MAPPABLE_PARAMS.map(k => PARAM_META[k as string].label)] as const;
/** Image force modes, same order as ProcessingMode (0–5). */
export const IMAGE_MODES = ['Light attracts', 'Light repels', 'Gradient flow', 'Gradient attract', 'Threshold', 'Distance field'] as const;

export const BOIDS_GROUPS: ParamGroup[] = [
  { name: 'Simulation', items: [
    num('numParticles', 'Particles', 10, 10000, 10, { scale: 'log', int: true }),
    num('dt', 'Time step', 0.001, 0.1, 0.001),
    num('attractionRadius', 'Attraction radius', 0.02, 0.6, 0.005, { scale: 'log' }),
    num('repulsionRadius', 'Repulsion radius', 0.01, 0.3, 0.005, { scale: 'log' }),
    num('attraction', 'Attraction', 0, 2, 0.01),
    num('repulsion', 'Repulsion', 0, 5, 0.01),
    num('alignment', 'Alignment', 0, 1, 0.005),
    num('coneAngle', 'Vision cone', -1, 0.99, 0.01),
    num('friction', 'Friction', 0, 10, 0.1),
    num('maxSpeed', 'Max speed', 0.01, 1, 0.01),
    num('noise', 'Noise', 0, 0.5, 0.005),
    num('mouseRadius', 'Touch radius', 0.05, 0.5, 0.01),
  ] },
  { name: 'Look', items: [
    en('shapeId', 'Shape', BOIDS_SHAPES, 'segmented'),
    num('size', 'Size', 0.001, 0.08, 0.001),
    en('color', 'Colour', BOIDS_COLORS.map(c => c.name), 'swatches', { colors: BOIDS_COLORS.map(c => c.hex) }),
    en('opacityMode', 'Opacity by', BOIDS_OPACITY_MODES, 'segmented'),
    num('opacity', 'Opacity', 0.01, 1, 0.01),
    en('trails', 'Trails', ['Off', 'On'], 'segmented', { rebuilds: true }),
    num('trailDecay', 'Trail decay', 0.8, 0.99, 0.005, { showIf: trailsOn }),
  ] },
  // Audio reactivity: the microphone drives one param per band (add mode,
  // half depth). The desktop Audio tab has the full per-mapping controls;
  // mappings made on either are the same list.
  { name: 'Audio', items: [
    en('audioSource', 'Microphone', ['Off', 'On'], 'segmented'),
    num('audioStrength', 'Strength', 0, 2, 0.01),
    ...AUDIO_BANDS.map(b => en(`audio:${b}`, `${AUDIO_BAND_LABELS[b]} →`, AUDIO_TARGETS, 'select')),
  ] },
  // Camera as an image force field (the desktop Image tab's webcam source).
  { name: 'Camera', items: [
    en('camera', 'Camera', ['Off', 'On'], 'segmented', { rebuilds: true }),
    en('cameraMirror', 'Mirror', ['Off', 'On'], 'segmented', { showIf: cameraOn }),
    en('imageMode', 'Force', IMAGE_MODES, 'select', { showIf: cameraOn }),
    num('imageStrength', 'Strength', 0, 2, 0.01, { showIf: cameraOn }),
    en('imageInvert', 'Invert', ['Off', 'On'], 'segmented', { showIf: cameraOn }),
  ] },
];

/** Index of the swatch nearest the current colour. */
export function colorIndex(p: BoidsParams): number {
  let best = 0, bd = Infinity;
  BOIDS_COLORS.forEach((c, i) => {
    const d = (c.r - p.colorR) ** 2 + (c.g - p.colorG) ** 2 + (c.b - p.colorB) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

// Randomize: every dynamics param drawn uniformly over its slider range (log
// sliders uniform in log space). Count, dt, touch radius and Look stay put.
const SKIP = new Set<string>(['numParticles', 'dt', 'mouseRadius']);

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
export function randomizeBoidsParams(p: BoidsParams): void {
  const pr = p as unknown as Record<string, number>;
  for (const group of BOIDS_GROUPS) {
    if (group.name !== 'Simulation') continue;
    for (const item of group.items) {
      if (item.kind !== 'num' || SKIP.has(item.key as string)) continue;
      pr[item.key as string] = roll(item);
    }
  }
}
