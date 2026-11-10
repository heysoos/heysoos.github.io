import { describe, it, expect } from 'vitest';
import { createUndoHistory } from '../src/lib/presets/undo-history';

describe('undo history notifications', () => {
  it('notifies on undo / redo before a slow (or stalled) apply finishes', () => {
    let state = 0;
    const h = createUndoHistory<number>({
      getSnapshot: () => state,
      applySnapshot: () => new Promise<void>(() => {}),   // never resolves (a superseded compile)
    });
    const seen: string[] = [];
    h.subscribe(() => seen.push(`${h.canUndo()}/${h.canRedo()}`));
    state = 1; h.push('change');
    h.undo();
    h.redo();
    expect(seen).toEqual(['true/false', 'false/true', 'true/false']);
  });
});
