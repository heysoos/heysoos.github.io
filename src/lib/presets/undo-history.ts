// src/lib/presets/undo-history.ts
// Snapshot-based undo/redo over a sim's param state. Slider drags are
// coalesced into one entry via beginGesture()/touch()/endGesture(); an open
// gesture that goes quiet for `gestureTimeoutMs` is closed automatically so a
// held-but-idle slider never blocks undo.

export const UNDO_LIMIT = 100;
export const GESTURE_TIMEOUT_MS = 800;

export interface UndoHistory {
  /** Record the current state as one entry (no-op if nothing changed). */
  push(label: string): void;
  /** Start coalescing changes until endGesture(). */
  beginGesture(label: string): void;
  /** Signal activity inside an open gesture (resets the idle timer). */
  touch(): void;
  /** Close an open gesture, recording one entry if the state changed. */
  endGesture(): void;
  isGestureOpen(): boolean;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  undoLabel(): string | undefined;
  redoLabel(): string | undefined;
  /** Re-baseline without recording (e.g. after an external, non-undoable change). */
  resetBaseline(): void;
  /** Drop all entries and re-baseline (e.g. after the initial preset load). */
  clear(): void;
  subscribe(fn: () => void): () => void;
  dispose(): void;
}

export interface UndoHistoryOpts<S> {
  getSnapshot: () => S;
  applySnapshot: (s: S) => void | Promise<void>;
  limit?: number;
  gestureTimeoutMs?: number;
  /** Defaults to JSON equality. */
  isEqual?: (a: S, b: S) => boolean;
}

interface Entry<S> { label: string; before: S; after: S }

export function createUndoHistory<S>(opts: UndoHistoryOpts<S>): UndoHistory {
  const limit = opts.limit ?? UNDO_LIMIT;
  const timeoutMs = opts.gestureTimeoutMs ?? GESTURE_TIMEOUT_MS;
  const isEqual = opts.isEqual ?? ((a: S, b: S) => JSON.stringify(a) === JSON.stringify(b));

  let current: S = opts.getSnapshot();
  let undoStack: Entry<S>[] = [];
  let redoStack: Entry<S>[] = [];
  let gestureLabel: string | null = null;
  let gestureTimer = 0;
  const listeners = new Set<() => void>();

  const notify = () => { for (const fn of listeners) fn(); };

  function record(label: string): void {
    const after = opts.getSnapshot();
    if (isEqual(current, after)) return;
    undoStack.push({ label, before: current, after });
    if (undoStack.length > limit) undoStack.shift();
    redoStack = [];
    current = after;
    notify();
  }

  function clearTimer(): void {
    if (gestureTimer) { clearTimeout(gestureTimer); gestureTimer = 0; }
  }

  function armTimer(): void {
    clearTimer();
    gestureTimer = window.setTimeout(() => { gestureTimer = 0; endGesture(); }, timeoutMs);
  }

  function endGesture(): void {
    if (gestureLabel === null) return;
    const label = gestureLabel;
    gestureLabel = null;
    clearTimer();
    record(label);
  }

  async function applyEntry(entry: Entry<S>, target: S): Promise<void> {
    current = target;
    // the stacks already moved: tell listeners now (button states), not only
    // after an async apply that may stall behind a compile or be superseded
    notify();
    try { await opts.applySnapshot(target); } finally { notify(); }
    void entry;
  }

  return {
    push(label) { endGesture(); record(label); },

    beginGesture(label) {
      if (gestureLabel !== null) endGesture();
      gestureLabel = label;
      armTimer();
    },

    touch() { if (gestureLabel !== null) armTimer(); },

    endGesture,

    isGestureOpen: () => gestureLabel !== null,

    undo() {
      endGesture();
      const entry = undoStack.pop();
      if (!entry) return false;
      redoStack.push(entry);
      void applyEntry(entry, entry.before);
      return true;
    },

    redo() {
      endGesture();
      const entry = redoStack.pop();
      if (!entry) return false;
      undoStack.push(entry);
      void applyEntry(entry, entry.after);
      return true;
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => undoStack[undoStack.length - 1]?.label,
    redoLabel: () => redoStack[redoStack.length - 1]?.label,

    resetBaseline() { endGesture(); current = opts.getSnapshot(); },

    clear() { endGesture(); undoStack = []; redoStack = []; current = opts.getSnapshot(); notify(); },

    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },

    dispose() { clearTimer(); listeners.clear(); },
  };
}

const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'password', 'tel']);

/** Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo, ignored while
 *  typing. A focused slider, checkbox or button is not typing: a drag leaves
 *  focus on the range input and undo must still work from there. */
export function attachUndoKeys(history: UndoHistory): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (t && t.tagName === 'INPUT' && TEXT_INPUTS.has((t as HTMLInputElement).type)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); history.redo(); }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
