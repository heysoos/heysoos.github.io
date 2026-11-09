import { test, expect, beforeEach } from 'vitest';
import { randomizeInputs } from '../../src/components/simulations/cppn/cppn-randomize';
import { GEN_PRESETS, canonical, type GenSettings } from '../../src/components/simulations/cppn/cppn-expr/generator';
import { loadGenSettings, saveGenSettings, GEN_SETTINGS_KEY } from '../../src/components/simulations/cppn/cppn-expr/settings';
import { expandGroupLocks, GROUP_LOCK_PREFIX } from '../../src/components/simulations/cppn/cppn-spec';

function makePRNG(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s += 0x6d2b79f5; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rng = makePRNG(7);
const S = (over: Partial<GenSettings> = {}): GenSettings => ({ weights: GEN_PRESETS.default(), complexity: 0.5, normalize: true, ...over });

// Map-backed localStorage shim
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(), key: () => null, length: 0,
  } as Storage;
});

test('randomizeInputs keeps locked slots and never duplicates them', () => {
  const out = randomizeInputs(['x', 'y', 'sin(2*x)', 'r', 'a'], new Set([2]), S(), rng);
  expect(out[2]).toBe('sin(2*x)');
  expect(out.length).toBe(5);
  const c = out.map(canonical);
  expect(new Set(c).size).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < 50; i++) {
    const o = randomizeInputs(['x', 'y', 'sin(2*x)'], new Set([2]), S({ complexity: 0 }), rng);
    expect(o[2]).toBe('sin(2*x)');
    expect(o[0] === 'sin(2*x)' || o[1] === 'sin(2*x)').toBe(false);
  }
});

test('settings round trip, with unknown keys dropped and missing ones defaulted', () => {
  saveGenSettings({ ...S(), complexity: 0.7 });
  expect(loadGenSettings().complexity).toBe(0.7);
  expect(loadGenSettings().weights.sin).toBe(1);
  store.set(GEN_SETTINGS_KEY, JSON.stringify({ weights: { sin: 0.2, bogus: 9 }, complexity: 3 }));
  const s = loadGenSettings();
  expect(s.weights.sin).toBe(0.2);
  expect(s.weights.cos).toBe(1);                       // filled from default
  expect('bogus' in s.weights).toBe(false);
  expect(s.complexity).toBe(1);                        // clamped
  store.set(GEN_SETTINGS_KEY, 'not json');
  expect(loadGenSettings().complexity).toBe(0.5);
});

test('group locks expand to their member keys', () => {
  const keys = expandGroupLocks([`${GROUP_LOCK_PREFIX}Motion`, 'seed', `${GROUP_LOCK_PREFIX}Inputs`]);
  expect(keys).toContain('speed'); expect(keys).toContain('bands'); expect(keys).toContain('seed');
  expect(keys).toContain('input0'); expect(keys).toContain('input7');
  expect(keys).not.toContain('sigma');
  const net = expandGroupLocks([`${GROUP_LOCK_PREFIX}Network`]);
  expect(net).toContain('layers'); expect(net).toContain('layer7Act'); expect(net).toContain('input3');
  expect(expandGroupLocks([`${GROUP_LOCK_PREFIX}Weights`])).toContain('distType');
  expect(expandGroupLocks([`${GROUP_LOCK_PREFIX}View`])).toContain('scale');
});
