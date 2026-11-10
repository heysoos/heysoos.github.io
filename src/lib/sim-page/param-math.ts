// src/lib/sim-page/param-math.ts
// Value <-> slider-space helpers shared by the phone scrub list and the
// desktop meter rows, so both show the same fraction and format.

export interface NumRange {
  min: number;
  max: number;
  step: number;
  scale?: 'linear' | 'log';
  /** Piecewise-linear slider: [lo, hi] gets the middle 60% of the travel,
   *  min..lo and hi..max 20% each (wide range, fine control where it matters). */
  knee?: readonly [number, number];
  int?: boolean;
}

const KNEE_A = 0.2, KNEE_B = 0.8;

/** Fixed decimals from the step; integers get a thin-space thousands separator. */
export function fmtParam(spec: NumRange, v: number): string {
  if (spec.int || spec.step >= 1) return String(Math.round(v)).replace(/\B(?=(\d{3})+$)/g, ' ');
  const dec = String(spec.step).split('.')[1]?.length ?? 2;
  return v.toFixed(dec);
}

export function toSlider(spec: NumRange, v: number): number {
  if (spec.knee) {
    const [a, b] = spec.knee, { min, max } = spec;
    if (v <= a) return KNEE_A * (v - min) / (a - min);
    if (v <= b) return KNEE_A + (KNEE_B - KNEE_A) * (v - a) / (b - a);
    return KNEE_B + (1 - KNEE_B) * (v - b) / (max - b);
  }
  return spec.scale === 'log' ? Math.log(Math.max(v, spec.min)) : v;
}

function kneeInverse(spec: NumRange, s: number): number {
  const [a, b] = spec.knee!, { min, max } = spec;
  if (s <= KNEE_A) return min + (a - min) * s / KNEE_A;
  if (s <= KNEE_B) return a + (b - a) * (s - KNEE_A) / (KNEE_B - KNEE_A);
  return b + (max - b) * (s - KNEE_B) / (1 - KNEE_B);
}

export function fromSlider(spec: NumRange, s: number): number {
  let v = spec.knee ? kneeInverse(spec, s) : spec.scale === 'log' ? Math.exp(s) : s;
  v = Math.round(v / spec.step) * spec.step;
  if (spec.int) v = Math.round(v);
  return Math.min(spec.max, Math.max(spec.min, v));
}

/** Position of v in its range, 0..1, in slider space. */
export function sliderFrac(spec: NumRange, v: number): number {
  const lo = toSlider(spec, spec.min), hi = toSlider(spec, spec.max);
  return Math.max(0, Math.min(1, (toSlider(spec, v) - lo) / (hi - lo)));
}
