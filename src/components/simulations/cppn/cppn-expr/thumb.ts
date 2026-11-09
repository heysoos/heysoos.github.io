// Greyscale thumbnail of one input expression, painted by the JS evaluator
// from the same bytecode the GPU runs. Fixed window: mid-grey = 0, black = −1,
// white = +1 (values outside clip), so with normalization off a narrow
// channel reads flat and a wide one burns out — which is what the toggle shows.
import { tryParse } from './parser';
import { compile, type Program } from './compile';
import { evalProgram, makeVars } from './eval-js';
import { measureRange, type Range } from './range';

export interface ThumbOpts {
  /** Apply (v − mid) / half before painting. */
  normalize: boolean;
  t?: number;
  px?: number;
  py?: number;
}

const cache = new Map<string, { prog: Program; range: Range } | null>();

/** Compile (cached by source) — null when the expression does not parse. */
export function compiledFor(src: string): { prog: Program; range: Range } | null {
  let hit = cache.get(src);
  if (hit !== undefined) return hit;
  const parsed = tryParse(src);
  if ('error' in parsed) hit = null;
  else {
    try { const prog = compile(parsed.ast); hit = { prog, range: measureRange(prog, parsed.ast) }; }
    catch { hit = null; }
  }
  if (cache.size > 256) cache.clear();
  cache.set(src, hit);
  return hit;
}

/** Paint `canvas` (its own width/height) with the expression; a parse error paints a dark red field. */
export function paintThumb(canvas: HTMLCanvasElement, src: string, opts: ThumbOpts): void {
  const W = canvas.width, H = canvas.height;
  const g = canvas.getContext('2d');
  if (!g || W === 0 || H === 0) return;
  const c = compiledFor(src);
  if (!c) { g.fillStyle = '#2a0c0c'; g.fillRect(0, 0, W, H); return; }
  const img = g.createImageData(W, H);
  const d = img.data;
  const { mid, half } = c.range;
  const t = opts.t ?? 0, px = opts.px ?? 0, py = opts.py ?? 0;
  for (let j = 0; j < H; j++) {
    const y = ((j + 0.5) / H) * 2 - 1;        // y down, like the shader's cy
    for (let i = 0; i < W; i++) {
      const x = ((i + 0.5) / W) * 2 - 1;
      let v = evalProgram(c.prog, makeVars(x, y, t, px, py));
      if (opts.normalize) v = (v - mid) / half;
      const g8 = Math.round(Math.max(0, Math.min(1, v * 0.5 + 0.5)) * 255);
      const k = (j * W + i) * 4;
      d[k] = d[k + 1] = d[k + 2] = g8; d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** A square canvas of `size` device pixels painted with the expression. */
export function makeThumb(src: string, size: number, opts: ThumbOpts): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  paintThumb(c, src, opts);
  return c;
}
