// src/lib/sim-page/palette.ts
// Curated colours for Randomize: three dozen saturated-but-not-neon hues
// that read well as particles on a near-black canvas, spread around the
// wheel with a few pastels and a couple of near-whites. Packed 0xRRGGBB.

export const RANDOM_COLORS: readonly number[] = [
  0xe85a4f, 0xf07a3a, 0xf0a030, 0xe8c04a, 0xd8d85a, 0xa8d85a, 0x6cc85a, 0x40c878,
  0x3ad0a8, 0x40c8d8, 0x4ab0e8, 0x4a86e8, 0x6a6ae8, 0x9060e0, 0xb858d8, 0xd858b8,
  0xe85088, 0xf07090, 0xf7a08a, 0xf8c89a, 0xf8e0a0, 0xd0f0a0, 0xa0f0c8, 0x90e8f0,
  0xa0c0f8, 0xc0b0f8, 0xe8b0f0, 0xf8b8d8, 0xfff2d8, 0xe8f8ff, 0xf0f0f0, 0xc08030,
  0x80a060, 0x5080a0, 0x806090, 0xa05858,
];

export function randomColor(): number {
  return RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)];
}
