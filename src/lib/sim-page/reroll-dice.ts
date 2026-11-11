/**
 * Reroll glyph: two isometric line dice with rounded corners, drawn on the
 * control glyphs' 24-unit grid (30 × 24 for the pair). Outline only; the
 * stroke and pips take `currentColor`, which the capsule sets to the accent.
 *
 * Rolling turns each die by a multiple of 120° about its centre: an isometric
 * cube's outline maps onto itself every 120°, so it tumbles and lands in the
 * same pose. The visible faces change at the start of the turn.
 */

type Pt = [number, number];

/** Pip centres on a unit face, per value. */
const PIPS: Record<number, Pt[]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

/** Three faces that can be seen together on a real die: distinct, no opposite pair (sum 7). */
const TRIPLES: number[][] = [];
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
  if (a !== b && b !== c && a !== c && a + b !== 7 && b + c !== 7 && a + c !== 7) TRIPLES.push([a, b, c]);
}

/** The pair: back-right die a little smaller and higher. */
export const DICE = [{ cx: 9, cy: 13.5, r: 8 }, { cx: 21.5, cy: 9.5, r: 7 }];
/** Corner rounding as a fraction of each edge eased into the curve. */
const ROUND = 0.42;

export const randomFaces = (): number[] => TRIPLES[Math.floor(Math.random() * TRIPLES.length)];

const n = (v: number) => +v.toFixed(3);
const P = (p: Pt) => `${n(p[0])},${n(p[1])}`;
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];

function geom(i: number) {
  const { cx, cy, r } = DICE[i];
  const k = 0.866 * r;
  const T: Pt = [cx, cy - r], UR: Pt = [cx + k, cy - r / 2], LR: Pt = [cx + k, cy + r / 2];
  const B: Pt = [cx, cy + r], LL: Pt = [cx - k, cy + r / 2], UL: Pt = [cx - k, cy - r / 2], C: Pt = [cx, cy];
  return { T, UR, LR, B, LL, UL, C };
}

/** Outline path: rounded hexagon plus the three inner edges, which end on the rounded corners. */
function outline(i: number): string {
  const { T, UR, LR, B, LL, UL, C } = geom(i);
  const H = [T, UR, LR, B, LL, UL];
  const mid: Pt[] = [];
  let d = '';
  H.forEach((V, j) => {
    const a = lerp(V, H[(j + 5) % 6], ROUND), b = lerp(V, H[(j + 1) % 6], ROUND);
    d += `${j ? 'L' : 'M'}${P(a)}Q${P(V)} ${P(b)}`;
    mid[j] = [0.25 * a[0] + 0.5 * V[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * V[1] + 0.25 * b[1]];
  });
  return `${d}Z M${P(C)}L${P(mid[5])}M${P(C)}L${P(mid[1])}M${P(C)}L${P(mid[3])}`;
}

/** Pips for the top, left and right faces; circles drawn in face space so they read as isometric ellipses. */
export function pipsMarkup(i: number, faces: number[]): string {
  const { T, UR, B, LL, UL, C } = geom(i);
  const frames: [Pt, Pt, Pt][] = [[UL, sub(T, UL), sub(C, UL)], [UL, sub(C, UL), sub(LL, UL)], [C, sub(UR, C), sub(B, C)]];
  return frames.map(([o, e1, e2], f) =>
    `<g transform="matrix(${n(e1[0])} ${n(e1[1])} ${n(e2[0])} ${n(e2[1])} ${n(o[0])} ${n(o[1])})">` +
    PIPS[faces[f]].map(([u, v]) => `<circle cx="${u}" cy="${v}" r=".1"/>`).join('') + '</g>').join('');
}

/** The whole glyph. `faces` is one triple per die (random when omitted). */
export function rerollDiceSVG(faces: number[][] = DICE.map(randomFaces)): string {
  return `<svg class="reroll-dice" viewBox="0 0 30 24" aria-hidden="true">${diceGroups(faces)}</svg>`;
}

function diceGroups(faces: number[][], attrs = ''): string {
  return DICE.map((d, i) =>
    `<g class="die" style="transform-origin:${d.cx}px ${d.cy}px"><path d="${outline(i)}"${attrs}/><g class="pips"${attrs ? ' fill="currentColor"' : ''}>${pipsMarkup(i, faces[i])}</g></g>`).join('');
}

/** Small self-styled copy for panel buttons (Randomize): same dice, stroke set inline for its size. */
export function diceIconSVG(width = 18): string {
  const h = +(width * 0.8).toFixed(2), sw = +(1.25 * 30 / width).toFixed(2);
  return `<svg class="ico dice-ico" viewBox="0 0 30 24" width="${width}" height="${h}" overflow="visible" aria-hidden="true">` +
    diceGroups(DICE.map(randomFaces), ` fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`) + '</svg>';
}

/** Roll every die under `root`: new visible faces, each turned 120° or 240° (opposite ways), so it lands in the same pose. */
export function rollDice(root: ParentNode): void {
  root.querySelectorAll<SVGGElement>('.die').forEach((g) => {
    const i = [...(g.parentNode?.children ?? [])].indexOf(g);
    const pips = g.querySelector('.pips');
    if (pips) pips.innerHTML = pipsMarkup(i, randomFaces());
    const a = (parseFloat(g.dataset.turn ?? '0') || 0) + (i ? -120 : 120) * (1 + Math.floor(Math.random() * 2));
    g.dataset.turn = String(a);
    g.style.transform = `rotate(${a}deg)`;
  });
}
