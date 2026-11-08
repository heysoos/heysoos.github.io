// src/lib/presets/preset-manager.ts
// Ties a sim's controller to the preset store and undo history. Each sim
// supplies a tiny binding (what a snapshot is, how to apply one); everything
// else — active preset, dirty check, load-with-history, panel rebuild — is
// shared.

import { type ParamRecord, type PresetBody, type BasePreset, bodyOf, bodyKey, cloneBody } from './preset-schema';
import { createPresetStore, type PresetStore } from './preset-store';
import { createUndoHistory, type UndoHistory } from './undo-history';
import { createParamLocks, type ParamLocks } from './param-locks';

export interface PresetBinding<P extends ParamRecord> {
  simId: string;
  defaults: P;
  builtIn: BasePreset<P>[];
  /** Current controller state as a preset body (params + extras). */
  capture(): PresetBody<P>;
  /** Push a body into the controller. */
  apply(body: PresetBody<P>): void | Promise<void>;
  /** Optional device-specific adjustment (e.g. a phone particle cap) applied
   *  to a preset body before it is loaded *and* before it is compared for
   *  the dirty check, so the adjustment itself never reads as "unsaved". */
  prepare?(body: PresetBody<P>): PresetBody<P>;
  /** Share a lock set with the panel; the manager creates one if omitted. */
  locks?: ParamLocks;
}

// Undo snapshots are the param body only. The active preset id is not part of
// history: undoing past a load leaves that preset active but dirty, which is
// what the user sees anyway, and keeps Save As from being undone by accident.
type Snapshot<P extends ParamRecord> = PresetBody<P>;

export interface PresetManager<P extends ParamRecord> {
  readonly simId: string;
  readonly defaults: P;
  readonly builtIn: BasePreset<P>[];
  readonly store: PresetStore<P>;
  readonly history: UndoHistory;
  /** Params that keep their current value across preset loads. */
  readonly locks: ParamLocks;
  getActiveId(): string | undefined;
  setActiveId(id: string | undefined): void;
  activePreset(): BasePreset<P> | undefined;
  isBuiltIn(id: string): boolean;
  isDirty(): boolean;
  capture(): PresetBody<P>;
  /** Apply a preset, make it active, record one undo entry. */
  load(preset: BasePreset<P>): Promise<void>;
  /** The setup script registers how to rebuild its panel. */
  onRebuild(fn: () => void): void;
  rebuild(): void;
  dispose(): void;
}

export function createPresetManager<P extends ParamRecord>(binding: PresetBinding<P>): PresetManager<P> {
  const store = createPresetStore<P>(binding.simId, binding.defaults);
  const locks = binding.locks ?? createParamLocks(binding.simId);
  let activeId: string | undefined;
  let rebuildFn: () => void = () => {};

  const history = createUndoHistory<Snapshot<P>>({
    getSnapshot: () => cloneBody(binding.capture()),
    applySnapshot: async (s) => {
      await binding.apply(cloneBody(s));
      rebuildFn();
    },
    isEqual: (a, b) => bodyKey(a) === bodyKey(b),
  });

  // Fill missing params from defaults (built-ins written before a param
  // existed) and drop keys the sim no longer has (a custom preset saved
  // before a param was removed), then let the sim adjust (phone cap). Used
  // for both loading and the dirty check so neither step reads as an
  // unsaved change.
  // Locked params are pinned to the controller's current value here, so a
  // load keeps them and the dirty check never counts them.
  const prepare = (body: PresetBody<P>): PresetBody<P> => {
    const merged = { ...binding.defaults, ...body.params } as ParamRecord;
    const known = Object.fromEntries(Object.keys(binding.defaults).map(k => [k, merged[k]])) as P;
    const filled = { ...body, params: known } as PresetBody<P>;
    const lockedKeys = locks.keys();
    if (lockedKeys.length > 0) {
      const current = binding.capture().params;
      for (const k of lockedKeys) if (k in current) (filled.params as ParamRecord)[k] = current[k];
    }
    return binding.prepare ? binding.prepare(filled) : filled;
  };

  function findPreset(id: string | undefined): BasePreset<P> | undefined {
    if (!id) return undefined;
    return binding.builtIn.find(p => p.id === id) ?? store.get(id);
  }

  return {
    simId: binding.simId,
    defaults: binding.defaults,
    builtIn: binding.builtIn,
    store,
    history,
    locks,
    getActiveId: () => activeId,
    setActiveId: (id) => { activeId = id; },
    activePreset: () => findPreset(activeId),
    isBuiltIn: (id) => binding.builtIn.some(p => p.id === id),

    isDirty() {
      const active = findPreset(activeId);
      if (!active) return false;
      return bodyKey(prepare(cloneBody(bodyOf(active)))) !== bodyKey(binding.capture());
    },

    capture: () => cloneBody(binding.capture()),

    async load(preset) {
      history.endGesture();
      activeId = preset.id;
      await binding.apply(prepare(cloneBody(bodyOf(preset))));
      history.push(`Load ${preset.name}`);
      rebuildFn();
    },

    onRebuild(fn) { rebuildFn = fn; },
    rebuild() { rebuildFn(); },
    dispose() { history.dispose(); },
  };
}
