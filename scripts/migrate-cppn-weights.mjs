// One-off: re-lay the built-in CPPN weight files from the pre-expression
// layout (x, y, r input columns) into the 8-slot layout, and add
// `inputs: ['x','y','r']`, `normalizeInputs: false` to each preset entry.
// Mirrors migrateWeightsFromXYR in cppn-codegen.ts (a test asserts equality).
//
//   node scripts/migrate-cppn-weights.mjs
//
// Idempotent: a weights file whose length already matches the new layout is
// left alone, and the fields are only added when missing.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_INPUTS = 8;
const Z_DIM = 16;

/** Old layout (3 columns) → new layout (8 columns, zeros in 3..7). */
export function migrateWeights(old, w0) {
  const head = 3 * w0;
  const shift = (MAX_INPUTS - 3) * w0;
  const out = new Array(old.length + shift).fill(0);
  for (let i = 0; i < head; i++) out[i] = old[i];
  for (let i = head; i < old.length; i++) out[i + shift] = old[i];
  return out;
}

export function weightCount(layers, nInputs) {
  const w0 = layers[0].width;
  let n = (nInputs + Z_DIM) * w0;
  for (let i = 0; i < layers.length - 1; i++) n += layers[i].width * layers[i + 1].width + layers[i + 1].width;
  return n + 3 * layers[layers.length - 1].width;
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dataFile = join(root, 'src/data/cppn-presets.ts');
  const weightsDir = join(root, 'src/data/cppn-weights');
  const { generateWeightsPresetsFile } = await import('../src/lib/admin/presets.ts');

  // The data file is JSON with the weights replaced by import identifiers.
  const src = readFileSync(dataFile, 'utf-8');
  const arr = src.slice(src.indexOf('= [') + 2, src.lastIndexOf('];') + 1);
  const presets = JSON.parse(arr.replace(/"weights": (\w+)/g, '"weights": "$1"'));

  let migrated = 0;
  for (const p of presets) {
    const weights = JSON.parse(readFileSync(join(weightsDir, `${p.id}.json`), 'utf-8'));
    const layers = p.config.layers;
    if (weights.length === weightCount(layers, 3)) {
      p.weights = migrateWeights(weights, layers[0].width);
      migrated++;
    } else if (weights.length === weightCount(layers, MAX_INPUTS)) {
      p.weights = weights;
    } else {
      throw new Error(`${p.id}: weights length ${weights.length} matches neither layout`);
    }
    p.inputs ??= ['x', 'y', 'r'];
    p.normalizeInputs ??= false;
    p.config.inputs ??= p.inputs;
    p.config.normalizeInputs ??= p.normalizeInputs;
  }

  process.chdir(root);
  writeFileSync(dataFile, generateWeightsPresetsFile({
    simName: 'cppn',
    typeImportPath: '../components/simulations/cppn/cppn-types',
    typeName: 'CPPNPreset',
    constName: 'CPPN_PRESETS',
    weightsDir: 'src/data/cppn-weights',
    presets,
  }), 'utf-8');
  console.log(`${presets.length} presets written, ${migrated} weight files re-laid out`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
