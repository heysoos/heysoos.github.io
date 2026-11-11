// src/lib/sim-page/control-bar.ts
// Per-sim wiring for the shared control bar (components/Controls.astro):
// un-hides the dice and ? glyphs and attaches Randomize and the reference
// card. The copy follows the input device (touch vs mouse + keys), not the
// window width, and is rebuilt if that changes. Also the one place that
// flips ⚙ to × while a phone scrub list is open.

import { attachHelp, type HelpSection, type HelpRow } from './help-popover';
import type { UndoHistory } from '../presets/undo-history';
import { pipsMarkup, randomFaces } from './reroll-dice';

export interface ControlBarOpts {
  randomize?: () => void;
  /** Sections for the ? card; `touch` is true on coarse / no-hover devices. */
  help?: (touch: boolean) => HelpSection[];
  /** Undo / redo glyphs next to ? (phone widths; the desktop panel header has its own). */
  history?: UndoHistory;
}
export interface ControlBarHandle { dispose(): void }

/** Counts toward the page's `sim-leave` interactions (set by the gallery page). */
const interact = (kind: string): void => (window as unknown as { __simTrack?: (k: string) => void }).__simTrack?.(kind);

export function wireControlBar(host: HTMLElement, opts: ControlBarOpts): ControlBarHandle {
  const dice = document.querySelector<HTMLElement>('[data-action="randomize"]');
  const helpBtn = document.querySelector<HTMLElement>('[data-action="help"]');
  // Each roll swaps the visible faces and turns each die 120° or 240° (opposite ways): same pose, new faces.
  const roll = () => dice?.querySelectorAll<SVGGElement>('.die').forEach((g, i) => {
    const pips = g.querySelector('.pips');
    if (pips) pips.innerHTML = pipsMarkup(i, randomFaces());
    const a = (parseFloat(g.dataset.turn ?? '0') || 0) + (i ? -120 : 120) * (1 + Math.floor(Math.random() * 2));
    g.dataset.turn = String(a);
    g.style.transform = `rotate(${a}deg)`;
  });
  const onDice = () => { interact('randomize'); roll(); opts.randomize?.(); };
  if (dice && opts.randomize) { dice.hidden = false; dice.closest<HTMLElement>('.ctrl-group')?.removeAttribute('hidden'); dice.addEventListener('click', onDice); }

  const touchMq = window.matchMedia('(hover: none), (pointer: coarse)');
  let help: ReturnType<typeof attachHelp> | null = null;
  const buildHelp = () => {
    if (!helpBtn || !opts.help) return;
    help?.dispose();
    helpBtn.hidden = false;
    (helpBtn.parentElement as HTMLElement | null)?.removeAttribute('hidden');
    help = attachHelp(helpBtn, host, opts.help(touchMq.matches));
  };
  buildHelp();
  touchMq.addEventListener('change', buildHelp);

  const undoBtn = document.querySelector<HTMLButtonElement>('[data-action="undo"]');
  const redoBtn = document.querySelector<HTMLButtonElement>('[data-action="redo"]');
  const { history } = opts;
  const onUndo = () => history?.undo();
  const onRedo = () => history?.redo();
  const syncHistory = () => {
    if (undoBtn) undoBtn.disabled = !history?.canUndo();
    if (redoBtn) redoBtn.disabled = !history?.canRedo();
  };
  let unsubHistory: (() => void) | undefined;
  if (history && undoBtn && redoBtn) {
    undoBtn.hidden = redoBtn.hidden = false;
    (undoBtn.parentElement as HTMLElement | null)?.removeAttribute('hidden');
    undoBtn.addEventListener('click', onUndo);
    redoBtn.addEventListener('click', onRedo);
    unsubHistory = history.subscribe(syncHistory);
    syncHistory();
  }

  return {
    dispose() {
      dice?.removeEventListener('click', onDice);
      touchMq.removeEventListener('change', buildHelp);
      help?.dispose();
      undoBtn?.removeEventListener('click', onUndo);
      redoBtn?.removeEventListener('click', onRedo);
      unsubHistory?.();
    },
  };
}

/** ⚙ ↔ × on the settings glyph while a phone scrub list is open. */
export function setSettingsOpen(open: boolean): void {
  document.querySelector('[data-action="settings"]')?.classList.toggle('open', open);
}

// ── Rows shared by every sim ──
export const KEY_ROWS: HelpRow[] = [
  { glyph: 'hp-key', label: 'P / R / H', effect: 'pause / reset / hide UI' },
  { glyph: 'hp-key', label: 'ctrl Z / ctrl Y / ?', effect: 'undo / redo / this card' },
];
export const PARAM_ROWS_TOUCH: HelpRow[] = [
  { glyph: 'hp-lr', label: 'drag row', effect: 'scrub value' },
  { glyph: 'hp-lock', label: 'hold row', effect: 'lock' },
];
export const PARAM_ROWS_MOUSE: HelpRow[] = [
  { glyph: 'hp-lr', label: 'drag row', effect: 'scrub · shift fine' },
  { glyph: 'hp-cursor', label: 'click value / ctrl + click', effect: 'type a value' },
  { glyph: 'hp-lock', label: 'alt + click', effect: 'lock' },
];
