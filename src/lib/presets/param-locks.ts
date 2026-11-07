// src/lib/presets/param-locks.ts
// Per-sim set of parameter keys that survive preset loads. A locked param
// keeps its current value when a preset is applied and is excluded from the
// dirty check. Persisted in localStorage (`presets:<sim>:locks`) so a lock
// set on the phone is still there after a reload.

export interface ParamLocks {
  isLocked(key: string): boolean;
  toggle(key: string): void;
  set(key: string, locked: boolean): void;
  clear(): void;
  keys(): string[];
  subscribe(fn: () => void): () => void;
}

export function createParamLocks(simId: string): ParamLocks {
  const storageKey = `presets:${simId}:locks`;
  const locked = new Set<string>();
  const listeners = new Set<() => void>();

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) for (const k of JSON.parse(raw) as unknown[]) if (typeof k === 'string') locked.add(k);
  } catch { /* storage blocked or corrupt: start empty */ }

  function persist(): void {
    try { localStorage.setItem(storageKey, JSON.stringify([...locked])); } catch { /* session-only */ }
    for (const fn of listeners) fn();
  }

  return {
    isLocked: (key) => locked.has(key),
    toggle(key) { if (locked.has(key)) locked.delete(key); else locked.add(key); persist(); },
    set(key, on) { if (on === locked.has(key)) return; if (on) locked.add(key); else locked.delete(key); persist(); },
    clear() { if (locked.size === 0) return; locked.clear(); persist(); },
    keys: () => [...locked],
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

/** Handle a slider hands to the lock toggle: what key, and the shared set. */
export interface ParamLockBinding {
  key: string;
  locks: ParamLocks;
}
