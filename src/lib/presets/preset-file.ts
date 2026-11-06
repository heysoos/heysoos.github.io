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

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'preset';
}

/**
 * Turn an imported custom preset into a built-in shaped one for the admin
 * pages: readable slug id (deduped against `existingIds`), no timestamps.
 */
export function toBuiltInPreset<P extends ParamRecord>(
  p: CustomPreset<P>,
  existingIds: Set<string>,
): { id: string; name: string; params: P } & Record<string, unknown> {
  const { createdAt: _c, updatedAt: _u, id: _id, ...rest } = p;
  let id = slugify(p.name);
  let n = 2;
  while (existingIds.has(id)) id = `${slugify(p.name)}-${n++}`;
  existingIds.add(id);
  return { ...rest, id, name: p.name, params: p.params };
}

/**
 * Admin helper: an "Import" button plus hidden file input. On a successful
 * parse, `onImport` receives built-in shaped presets; `onError` gets a
 * message otherwise.
 */
export function buildAdminImportButton<P extends ParamRecord>(opts: {
  defaults: P;
  simId: string;
  existingIds: () => Set<string>;
  onImport: (presets: Array<{ id: string; name: string; params: P } & Record<string, unknown>>) => void;
  onError: (message: string) => void;
  style?: string;
}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  const btn = document.createElement('button');
  btn.textContent = '↑ Import JSON';
  btn.title = 'Import presets exported from a sim page';
  btn.style.cssText = opts.style ?? 'padding:0.35rem;border:1px solid var(--bg-surface-border);border-radius:4px;background:transparent;color:var(--text-body);font-size:0.72rem;cursor:pointer;flex:1;';
  btn.addEventListener('click', () => { input.value = ''; input.click(); });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const { presets, sim, warnings } = parseBundle<P>(await readFileText(file), opts.defaults);
      if (sim && sim !== opts.simId) warnings.unshift(`File is for "${sim}", this page is ${opts.simId}.`);
      if (presets.length === 0) { opts.onError(['Nothing to import.', ...warnings].join(' ')); return; }
      const ids = opts.existingIds();
      opts.onImport(presets.map(p => toBuiltInPreset(p, ids)));
      if (warnings.length) opts.onError(warnings.join(' '));
    } catch (err) {
      opts.onError(`Import failed: ${(err as Error).message}`);
    }
  });
  wrap.append(btn, input);
  return wrap;
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
