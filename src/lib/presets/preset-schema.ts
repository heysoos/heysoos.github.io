// src/lib/presets/preset-schema.ts
// Shape of a preset as it lives in localStorage and in exported files, plus
// the normaliser that makes old files load on new builds and vice versa.
//
// Forward compatibility: params missing from a file are filled from the
// sim's defaults. Backward compatibility: unknown params and unknown
// top-level fields are kept verbatim and written back out on export.
// `FORMAT_VERSION` only bumps on a breaking change; add a MIGRATIONS entry
// keyed by the version being migrated *from* when that happens.

export const BUNDLE_FORMAT = 'sim-preset-bundle';
export const FORMAT_VERSION = 1;

export type ParamRecord = Record<string, unknown>;

/** Everything a preset carries besides identity: params plus sim-specific
 *  extras (boids: trailsEnabled, trailDecay, shader). */
export type PresetBody<P extends ParamRecord> = { params: P } & Record<string, unknown>;

export type BasePreset<P extends ParamRecord> = PresetBody<P> & {
  id: string;
  name: string;
};

export type CustomPreset<P extends ParamRecord> = BasePreset<P> & {
  createdAt: string;
  updatedAt: string;
};

export type TrashedPreset<P extends ParamRecord> = CustomPreset<P> & {
  deletedAt: string;
};

export interface PresetBundle<P extends ParamRecord> {
  format: typeof BUNDLE_FORMAT;
  version: number;
  sim: string;
  exportedAt: string;
  presets: CustomPreset<P>[];
}

/** Keys that are identity/bookkeeping, not part of the body. */
export const META_KEYS = new Set(['id', 'name', 'createdAt', 'updatedAt', 'deletedAt', 'isDefault', 'shaderFile']);

export const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export function newPresetId(): string {
  const secs = Math.floor(Date.now() / 1000);
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `custom-${secs}-${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Pull the body (params + extras) out of any preset-like object. */
export function bodyOf<P extends ParamRecord>(preset: PresetBody<P>): PresetBody<P> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(preset)) {
    if (!META_KEYS.has(k)) out[k] = v;
  }
  return out as PresetBody<P>;
}

/** Deep-ish clone good enough for params objects and strings. */
export function cloneBody<P extends ParamRecord>(body: PresetBody<P>): PresetBody<P> {
  return JSON.parse(JSON.stringify(body));
}

/** Stable serialisation for dirty checks: key order does not matter. */
export function bodyKey(body: PresetBody<ParamRecord>): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (isRecord(v)) {
      return Object.keys(v).sort().reduce<Record<string, unknown>>((o, k) => { o[k] = sort(v[k]); return o; }, {});
    }
    return v;
  };
  return JSON.stringify(sort(body));
}

/**
 * Coerce an arbitrary object into a CustomPreset. Returns null if it is not
 * preset-shaped at all (no params object). Missing params come from
 * `defaults`; unknown keys survive. Ids that are missing or not strings get
 * a fresh custom id.
 */
export function normalisePreset<P extends ParamRecord>(
  raw: unknown,
  defaults: P,
  fromVersion: number = FORMAT_VERSION,
): CustomPreset<P> | null {
  if (!isRecord(raw)) return null;
  let obj: Record<string, unknown> = { ...raw };
  for (let v = fromVersion; v < FORMAT_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (migrate) obj = migrate(obj);
  }
  if (!isRecord(obj.params)) return null;

  const params = { ...defaults, ...(obj.params as Partial<P>) } as P;
  const now = nowIso();
  const id = typeof obj.id === 'string' && obj.id.length > 0 ? obj.id : newPresetId();
  const name = typeof obj.name === 'string' && obj.name.trim().length > 0 ? obj.name.trim() : 'Untitled';
  const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : now;
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : createdAt;

  const out: Record<string, unknown> = { ...obj, id, name, params, createdAt, updatedAt };
  delete out.isDefault;
  delete out.deletedAt;
  return out as CustomPreset<P>;
}
