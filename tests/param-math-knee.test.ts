import { describe, it, expect } from 'vitest';
import { toSlider, fromSlider, sliderFrac } from '../src/lib/sim-page/param-math';

describe('knee slider mapping', () => {
  const spec = { min: 0.1, max: 20, step: 0.01, knee: [1, 3] as const };
  it('gives the knee band the middle 60% of the travel', () => {
    expect(sliderFrac(spec, 0.1)).toBeCloseTo(0);
    expect(sliderFrac(spec, 1)).toBeCloseTo(0.2);
    expect(sliderFrac(spec, 3)).toBeCloseTo(0.8);
    expect(sliderFrac(spec, 20)).toBeCloseTo(1);
  });
  it('round-trips', () => {
    for (const v of [0.1, 0.5, 1, 1.7, 3, 7.25, 20]) expect(fromSlider(spec, toSlider(spec, v))).toBeCloseTo(v, 2);
  });
});
