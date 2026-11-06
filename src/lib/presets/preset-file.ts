// src/lib/presets/preset-file.ts
// Export custom presets as a JSON bundle and parse one back. The same parser
// is the import path on the admin pages, so a file exported from a phone can
// be promoted to a built-in on the desktop.

import {
  type ParamRecord, type CustomPreset, type PresetBundle,
  BUNDLE_FORMAT, FORMAT_VERSION, nowIso, normalisePreset,
} from './preset-schema';

export interface ParseResult<P extends ParamRecord> {
  presets: CustomPreset<P>[];
  /** The sim the file says it belongs to (undefined for a bare preset). */
  sim?: string;
  /** Human-readable notes: version newer than this build, skipped entries. */
  warnings: string[];
}

export function buildBundle<P extends ParamRecord>(simId: string, presets: CustomPreset<P>[]): PresetBundle<P> {
  return {
    format: BUNDLE_FORMAT,
    version: FORMAT_VERSION,
    sim: simId,
    exportedAt: nowIso(),
    presets: presets.map(p => {
      // shaderFile is admin-only bookkeeping; never ship it from the gallery.
      const { shaderFile: _sf, ...rest } = p as CustomPreset<P> & { shaderFile?: unknown };
      return rest as CustomPreset<P>;
    }),
  };
}

export function exportFilename(simId: string, date: Date = new Date()): string {
  return `${simId}-presets-${date.toISOString().slice(0, 10)}.json`;
}

/** Trigger a browser download of the bundle. */
export function downloadBundle<P extends ParamRecord>(simId: string, presets: CustomPreset<P>[]): void {
  const json = JSON.stringify(buildBundle(simId, presets), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename(simId);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Parse bundle text (or a single preset object, or a bare array of presets).
 * Never throws on bad shape; returns zero presets with a warning instead.
 * A JSON syntax error does throw, so callers can show the message.
 */
export function parseBundle<P extends ParamRecord>(text: string, defaults: P): ParseResult<P> {
  const warnings: string[] = [];
  const data: unknown = JSON.parse(text);

  let rawPresets: unknown[] = [];
  let sim: string | undefined;
  let version = FORMAT_VERSION;

  if (Array.isArray(data)) {
    rawPresets = data;
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if (obj.format === BUNDLE_FORMAT || Array.isArray(obj.presets)) {
      rawPresets = Array.isArray(obj.presets) ? obj.presets : [];
      if (typeof obj.sim === 'string') sim = obj.sim;
      if (typeof obj.version === 'number') version = obj.version;
      if (version > FORMAT_VERSION) {
        warnings.push(`File is format v${version}; this build understands v${FORMAT_VERSION}. Loading anyway.`);
      }
    } else if (typeof obj.params === 'object' && obj.params !== null) {
      rawPresets = [obj];
      if (typeof obj.sim === 'string') sim = obj.sim;
    } else {
      warnings.push('File does not look like a preset or preset bundle.');
    }
  } else {
    warnings.push('File does not look like a preset or preset bundle.');
  }

  const presets: CustomPreset<P>[] = [];
  let skipped = 0;
  for (const raw of rawPresets) {
    const p = normalisePreset<P>(raw, defaults, Math.min(version, FORMAT_VERSION));
    if (p) presets.push(p); else skipped++;
  }
  if (skipped > 0) warnings.push(`Skipped ${skipped} malformed entr${skipped === 1 ? 'y' : 'ies'}.`);

  return { presets, sim, warnings };
}

/** Read a File chosen in an <input type="file"> as text. */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsText(file);
  });
}
