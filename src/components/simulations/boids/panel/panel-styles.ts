/** CSS string for a pill-style toggle button (presets, audio source, opacity mode). */
export function pillStyle(active: boolean): string {
  return [
    'padding:2px 8px',
    'border-radius:12px',
    'font-size:0.68rem',
    'cursor:pointer',
    'transition:background 0.15s,color 0.15s',
    active
      ? 'background:var(--accent);color:var(--bg-primary);border:1px solid transparent;'
      : 'background:transparent;color:var(--text-muted);border:1px solid var(--bg-surface-border);',
  ].join(';');
}

export const STYLES = {
  sectionLabel: 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:5px;',
  sourceSection: 'padding:8px 8px 6px;border-bottom:1px solid var(--bg-surface-border);',
  errorMsg:      'font-size:0.62rem;color:#e05060;margin-top:4px;display:none;word-break:break-word;',
  statusDot:     'width:7px;height:7px;border-radius:50%;display:inline-block;margin-left:auto;background:var(--text-muted);transition:background 0.2s;',
  drawerRow:     'border-bottom:1px solid var(--bg-surface-border);',
  drawerHeader:  'display:flex;align-items:center;cursor:pointer;padding:5px 8px;gap:6px;font-size:0.68rem;color:var(--text-body);user-select:none;',
  drawerBody:    'padding:6px 8px 8px;display:flex;flex-direction:column;gap:6px;',
  matrixCanvas:  'background:#06050a;border-radius:2px;display:block;',
  bgCanvas:      '#06050a',
} as const;
