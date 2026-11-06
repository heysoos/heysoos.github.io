// src/lib/presets/preset-store.ts
// Per-sim custom preset storage in localStorage, with a recoverable trash.
// Every write rewrites the whole blob; a blocked or full storage degrades to
// an in-memory list for the session (storageOk === false) instead of throwing.

import {
  type ParamRecord, type PresetBody, type CustomPreset, type TrashedPreset,
  FORMAT_VERSION, newPresetId, nowIso, normalisePreset, bodyOf, cloneBody,
} from './preset-schema';

export const TRASH_LIMIT = 20;

export interface PresetStore<P extends ParamRecord> {
  readonly simId: string;
  readonly storageOk: boolean;
  list(): CustomPreset<P>[];
  get(id: string): CustomPreset<P> | undefined;
  /** Create a new custom preset from a body. */
  add(name: string, body: PresetBody<P>): CustomPreset<P>;
  /** Overwrite an existing preset's body (and optionally name). */
  update(id: string, body: PresetBody<P>, name?: string): CustomPreset<P> | undefined;
  rename(id: string, name: string): CustomPreset<P> | undefined;
  duplicate(id: string, name?: string): CustomPreset<P> | undefined;
  /** Move to trash. */
  remove(id: string): void;
  restore(id: string): CustomPreset<P> | undefined;
  listTrash(): TrashedPreset<P>[];
  emptyTrash(): void;
  /** Append presets (e.g. from a file) with fresh ids. Returns what was added. */
  importPresets(presets: CustomPreset<P>[]): CustomPreset<P>[];
  subscribe(fn: () => void): () => void;
}

interface Blob<T> { version: number; presets: T[] }

export function createPresetStore<P extends ParamRecord>(simId: string, defaults: P): PresetStore<P> {
  const KEY = `presets:${simId}`;
  const TRASH_KEY = `presets:${simId}:trash`;
  let storageOk = true;
  const listeners = new Set<() => void>();

  function read<T extends CustomPreset<P>>(key: string): T[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const blob = JSON.parse(raw) as Partial<Blob<unknown>>;
      const version = typeof blob.version === 'number' ? blob.version : FORMAT_VERSION;
      const items = Array.isArray(blob.presets) ? blob.presets : [];
      return items
        .map(p => {
          const n = normalisePreset<P>(p, defaults, version);
          if (!n) return null;
          const deletedAt = (p as Record<string, unknown>).deletedAt;
          return (typeof deletedAt === 'string' ? { ...n, deletedAt } : n) as T;
        })
        .filter((p): p is T => p !== null);
    } catch {
      storageOk = false;
      return [];
    }
  }

  let presets: CustomPreset<P>[] = read(KEY);
  let trash: TrashedPreset<P>[] = read(TRASH_KEY);

  function write(key: string, items: unknown[]): void {
    try {
      localStorage.setItem(key, JSON.stringify({ version: FORMAT_VERSION, presets: items }));
      storageOk = true;
    } catch {
      storageOk = false;
    }
  }

  function persist(): void {
    write(KEY, presets);
    write(TRASH_KEY, trash);
    for (const fn of listeners) fn();
  }

  function make(name: string, body: PresetBody<P>): CustomPreset<P> {
    const now = nowIso();
    return { ...cloneBody(bodyOf(body)), id: newPresetId(), name: name.trim() || 'Untitled', createdAt: now, updatedAt: now } as CustomPreset<P>;
  }

  return {
    simId,
    get storageOk() { return storageOk; },
    list: () => presets.slice(),
    get: (id) => presets.find(p => p.id === id),

    add(name, body) {
      const p = make(name, body);
      presets.push(p);
      persist();
      return p;
    },

    update(id, body, name) {
      const idx = presets.findIndex(p => p.id === id);
      if (idx < 0) return undefined;
      const prev = presets[idx];
      const next = {
        ...cloneBody(bodyOf(body)),
        id, name: (name ?? prev.name).trim() || prev.name,
        createdAt: prev.createdAt, updatedAt: nowIso(),
      } as CustomPreset<P>;
      presets[idx] = next;
      persist();
      return next;
    },

    rename(id, name) {
      const p = presets.find(x => x.id === id);
      if (!p || !name.trim()) return p;
      p.name = name.trim();
      p.updatedAt = nowIso();
      persist();
      return p;
    },

    duplicate(id, name) {
      const src = presets.find(p => p.id === id);
      if (!src) return undefined;
      const p = make(name ?? `${src.name} copy`, bodyOf(src));
      presets.push(p);
      persist();
      return p;
    },

    remove(id) {
      const idx = presets.findIndex(p => p.id === id);
      if (idx < 0) return;
      const [p] = presets.splice(idx, 1);
      trash.unshift({ ...p, deletedAt: nowIso() });
      if (trash.length > TRASH_LIMIT) trash.length = TRASH_LIMIT;
      persist();
    },

    restore(id) {
      const idx = trash.findIndex(p => p.id === id);
      if (idx < 0) return undefined;
      const [{ deletedAt: _d, ...p }] = trash.splice(idx, 1);
      const restored = p as CustomPreset<P>;
      presets.push(restored);
      persist();
      return restored;
    },

    listTrash: () => trash.slice(),

    emptyTrash() {
      trash = [];
      persist();
    },

    importPresets(incoming) {
      const added = incoming.map(p => make(p.name, bodyOf(p)));
      presets.push(...added);
      persist();
      return added;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}
