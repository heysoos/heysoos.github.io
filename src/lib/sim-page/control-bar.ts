// src/lib/sim-page/control-bar.ts
// Per-sim wiring for the shared control bar (components/Controls.astro):
// un-hides the dice and ? glyphs and attaches Randomize and the reference
// card. The copy follows the input device (touch vs mouse + keys), not the
// window width, and is rebuilt if that changes. Also the one place that
// flips ⚙ to × while a phone scrub list is open.

import { attachHelp, type HelpSection, type HelpRow } from './help-popover';

export interface ControlBarOpts {
  randomize?: () => void;
  /** Sections for the ? card; `touch` is true on coarse / no-hover devices. */
  help?: (touch: boolean) => HelpSection[];
}
export interface ControlBarHandle { dispose(): void }

export function wireControlBar(host: HTMLElement, opts: ControlBarOpts): ControlBarHandle {
  const dice = document.querySelector<HTMLElement>('[data-action="randomize"]');
  const helpBtn = document.querySelector<HTMLElement>('[data-action="help"]');
  const onDice = () => opts.randomize?.();
  if (dice && opts.randomize) { dice.hidden = false; dice.addEventListener('click', onDice); }

  const touchMq = window.matchMedia('(hover: none), (pointer: coarse)');
  let help: ReturnType<typeof attachHelp> | null = null;
  const buildHelp = () => {
    if (!helpBtn || !opts.help) return;
    help?.dispose();
    helpBtn.hidden = false;
    help = attachHelp(helpBtn, host, opts.help(touchMq.matches));
  };
  buildHelp();
  touchMq.addEventListener('change', buildHelp);

  return {
    dispose() {
      dice?.removeEventListener('click', onDice);
      touchMq.removeEventListener('change', buildHelp);
      help?.dispose();
    },
  };
}

/** ⚙ ↔ × on the settings glyph while a phone scrub list is open. */
export function setSettingsOpen(open: boolean): void {
  document.querySelector('[data-action="settings"]')?.classList.toggle('open', open);
}

// ── Rows shared by every sim ──
export const KEY_ROWS: HelpRow[] = [
  { glyph: 'hp-key', label: 'P · R · H', effect: 'pause · reset · hide UI' },
  { glyph: '<span></span>', label: 'ctrl Z · ctrl Y · ?', effect: 'undo · redo · this card' },
];
export const PARAM_ROWS_TOUCH: HelpRow[] = [
  { glyph: 'hp-lr', label: 'drag row', effect: 'scrub value' },
  { glyph: 'hp-lock', label: 'hold row', effect: 'lock' },
];
export const PARAM_ROWS_MOUSE: HelpRow[] = [
  { glyph: 'hp-lr', label: 'drag row', effect: 'scrub · shift fine' },
  { glyph: 'hp-cursor', label: 'click value', effect: 'type' },
  { glyph: 'hp-lock', label: 'alt + click', effect: 'lock' },
];
