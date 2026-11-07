// src/lib/sim-page/handle-actions.ts
// Wires the undo/redo buttons that live in the panel's drag handle (always
// visible on the phone sheet, unlike the in-content preset header) to a
// sim's undo history.

import type { UndoHistory } from '../presets/undo-history';

export function wireHandleHistory(panel: HTMLElement, history: UndoHistory): () => void {
  const undoBtn = panel.querySelector<HTMLButtonElement>('.panel-handle-undo');
  const redoBtn = panel.querySelector<HTMLButtonElement>('.panel-handle-redo');
  if (!undoBtn || !redoBtn) return () => {};
  const stop = (e: Event) => e.stopPropagation();   // keep the sheet's tap/swipe handler out of it
  undoBtn.addEventListener('pointerdown', stop);
  redoBtn.addEventListener('pointerdown', stop);
  undoBtn.addEventListener('click', () => history.undo());
  redoBtn.addEventListener('click', () => history.redo());
  const refresh = () => {
    undoBtn.disabled = !history.canUndo();
    redoBtn.disabled = !history.canRedo();
    undoBtn.title = history.undoLabel() ? `Undo ${history.undoLabel()}` : 'Nothing to undo';
    redoBtn.title = history.redoLabel() ? `Redo ${history.redoLabel()}` : 'Nothing to redo';
  };
  refresh();
  return history.subscribe(refresh);
}
