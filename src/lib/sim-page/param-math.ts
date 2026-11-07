// src/lib/sim-page/param-math.ts
// Value <-> slider-space helpers shared by the phone scrub list and the
// desktop meter rows, so both show the same fraction and format.

export interface NumRange {
  min: number;
  max: number;
  step: number;
  scale?: 'linear' | 'log';
  int?: boolean;
}

/** Fixed decimals from the step; integers get a thin-space thousands separator. */
export function fmtParam(spec: NumRange, v: number): string {
  if (spec.int || spec.step >= 1) return String(Math.round(v)).replace(/\B(?=(\d{3})+$)/g, ' ');
  const dec = String(spec.step).split('.')[1]?.length ?? 2;
  return v.toFixed(dec);
}

export function toSlider(spec: NumRange, v: number): number {
  return spec.scale === 'log' ? Math.log(Math.max(v, spec.min)) : v;
}

export function fromSlider(spec: NumRange, s: number): number {
  let v = spec.scale === 'log' ? Math.exp(s) : s;
  v = Math.round(v / spec.step) * spec.step;
  if (spec.int) v = Math.round(v);
  return Math.min(spec.max, Math.max(spec.min, v));
}

/** Position of v in its range, 0..1, in slider space. */
export function sliderFrac(spec: NumRange, v: number): number {
  const lo = toSlider(spec, spec.min), hi = toSlider(spec, spec.max);
  return Math.max(0, Math.min(1, (toSlider(spec, v) - lo) / (hi - lo)));
}
