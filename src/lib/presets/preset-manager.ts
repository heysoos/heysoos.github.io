// src/lib/presets/preset-manager.ts
// Ties a sim's controller to the preset store and undo history. Each sim
// supplies a tiny binding (what a snapshot is, how to apply one); everything
// else — active preset, dirty check, load-with-history, panel rebuild — is
// shared.

import { type ParamRecord, type PresetBody, type BasePreset, bodyOf, bodyKey, cloneBody } from './preset-schema';
import { createPresetStore, type PresetStore } from './preset-store';
import { createUndoHistory, type UndoHistory } from './undo-history';

export interface PresetBinding<P extends ParamRecord> {
  simId: string;
  defaults: P;
  builtIn: BasePreset<P>[];
  /** Current controller state as a preset body (params + extras). */
  capture(): PresetBody<P>;
  /** Push a body into the controller. */
  apply(body: PresetBody<P>): void | Promise<void>;
}

interface Snapshot<P extends ParamRecord> { body: PresetBody<P>; activeId: string | undefined }

export interface PresetManager<P extends ParamRecord> {
  readonly simId: string;
  readonly defaults: P;
  readonly builtIn: BasePreset<P>[];
  readonly store: PresetStore<P>;
  readonly history: UndoHistory;
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
  let activeId: string | undefined;
  let rebuildFn: () => void = () => {};

  const history = createUndoHistory<Snapshot<P>>({
    getSnapshot: () => ({ body: cloneBody(binding.capture()), activeId }),
    applySnapshot: async (s) => {
      activeId = s.activeId;
      await binding.apply(cloneBody(s.body));
      rebuildFn();
    },
    isEqual: (a, b) => a.activeId === b.activeId && bodyKey(a.body) === bodyKey(b.body),
  });

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
    getActiveId: () => activeId,
    setActiveId: (id) => { activeId = id; },
    activePreset: () => findPreset(activeId),
    isBuiltIn: (id) => binding.builtIn.some(p => p.id === id),

    isDirty() {
      const active = findPreset(activeId);
      if (!active) return false;
      return bodyKey(bodyOf(active)) !== bodyKey(binding.capture());
    },

    capture: () => cloneBody(binding.capture()),

    async load(preset) {
      history.endGesture();
      activeId = preset.id;
      await binding.apply(cloneBody(bodyOf(preset)));
      history.push(`Load ${preset.name}`);
      rebuildFn();
    },

    onRebuild(fn) { rebuildFn = fn; },
    rebuild() { rebuildFn(); },
    dispose() { history.dispose(); },
  };
}
