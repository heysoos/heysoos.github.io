// src/lib/sim-page/help-popover.ts
// The ? reference card: sections of glyph · input · effect rows, no prose.
// Glyphs are symbol ids from the sprite in Controls.astro ('hp-point'), or a
// literal HTML snippet (a miniature of the control itself, e.g. the
// activation pill). Hover shows the card on fine pointers; a click or the ?
// key pins it; Escape, an outside tap or a second click closes it.

export interface HelpRow { glyph: string; label: string; effect: string }
export interface HelpSection { title: string; rows: HelpRow[] }
export interface HelpHandle { toggle(): void; hide(): void; dispose(): void }

const glyphHtml = (g: string): string =>
  g.startsWith('<') ? g : `<svg class="hg" aria-hidden="true"><use href="#${g}"/></svg>`;

export function attachHelp(btn: HTMLElement, host: HTMLElement, sections: HelpSection[]): HelpHandle {
  const card = document.createElement('div');
  card.className = 'sim-help';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Controls');
  card.innerHTML = sections.map(s =>
    `<section><h4>${s.title}</h4><dl>${s.rows.map(r =>
      `<dt>${glyphHtml(r.glyph)}<span class="lb">${r.label}</span></dt><dd>${r.effect}</dd>`).join('')}</dl></section>`).join('');
  host.appendChild(card);

  let pinned = false;
  const hide = () => { pinned = false; card.classList.remove('show'); btn.classList.remove('active'); };
  const toggle = () => { pinned = !pinned; btn.classList.toggle('active', pinned); card.classList.toggle('show', pinned); };

  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const onEnter = () => { if (fine && !pinned) card.classList.add('show'); };
  const onLeave = () => { if (fine && !pinned) card.classList.remove('show'); };
  const onClick = (e: Event) => { e.stopPropagation(); toggle(); };
  const onDoc = (e: Event) => { if (pinned && !card.contains(e.target as Node) && !btn.contains(e.target as Node)) hide(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && pinned) hide(); };
  btn.addEventListener('mouseenter', onEnter);
  btn.addEventListener('mouseleave', onLeave);
  btn.addEventListener('click', onClick);
  document.addEventListener('pointerdown', onDoc, true);
  document.addEventListener('keydown', onKey);

  return {
    toggle, hide,
    dispose() {
      btn.removeEventListener('mouseenter', onEnter);
      btn.removeEventListener('mouseleave', onLeave);
      btn.removeEventListener('click', onClick);
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey);
      card.remove();
    },
  };
}
