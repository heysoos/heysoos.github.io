// Seeded PRNG (mulberry32). Used wherever a sim needs a reproducible start:
// CPPN weights, and seeded resets for the still-image renders on /admin/og.
export function makePRNG(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random function: seeded when a seed is given, Math.random otherwise. */
export function rng(seed?: number): () => number {
  return seed === undefined ? Math.random : makePRNG(seed);
}
