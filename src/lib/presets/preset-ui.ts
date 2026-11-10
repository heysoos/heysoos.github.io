// src/lib/presets/preset-ui.ts
// The shared "Presets" section at the top of a sim panel: built-in and custom
// pills, undo/redo, Save / Save As / Rename / Duplicate / Delete / Export /
// Import, a small confirm pop-up (so three-way choices work, nothing uses
// window.confirm, and on a phone it is never buried under a long preset list), and a Recently-deleted list.

import type { ParamRecord, BasePreset, CustomPreset } from './preset-schema';
import type { PresetManager } from './preset-manager';
import { downloadBundle, parseBundle, readFileText } from './preset-file';
import { pillStyle } from '../../components/simulations/boids/panel/panel-styles';

const BTN = 'padding:3px 8px;border-radius:4px;border:1px solid var(--bg-surface-border);background:transparent;color:var(--text-body);font-size:0.66rem;cursor:pointer;white-space:nowrap;line-height:1.3;';
const BTN_ACCENT = BTN + 'border-color:var(--accent);color:var(--accent);';
const BTN_DANGER = BTN + 'border-color:#e05060;color:#e05060;';
const BTN_ICON = 'background:none;border:1px solid var(--bg-surface-border);border-radius:4px;color:var(--text-body);cursor:pointer;font-size:0.8rem;line-height:1;padding:2px 7px;';
const INPUT = 'flex:1;min-width:0;background:var(--bg-primary);border:1px solid var(--accent);border-radius:4px;padding:3px 6px;color:var(--text-body);font-size:0.72rem;';
const MUTED = 'font-size:0.62rem;color:var(--text-muted);';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, css: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = el('button', css, label);
  if (title) b.title = title;
  b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  return b;
}

interface Choice { label: string; style?: 'accent' | 'danger' | 'plain'; onPick: () => void }

export interface PresetSectionHandle {
  refresh(): void;
  dispose(): void;
}

export interface PresetSectionOpts {
  /** Show the "Presets" label in the header. Off when the host panel already has one. */
  showTitle?: boolean;
}

export function buildPresetSection<P extends ParamRecord>(
  container: HTMLElement,
  mgr: PresetManager<P>,
  sectionOpts: PresetSectionOpts = {},
): PresetSectionHandle {
  const root = el('div', 'display:flex;flex-direction:column;gap:5px;margin-bottom:0.4rem;');
  container.appendChild(root);

  // Sub-elements re-rendered by render()
  const header = el('div', 'display:flex;align-items:center;gap:6px;');
  header.className = 'preset-header';
  const pills = el('div', 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;');
  const toolbar = el('div', 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;padding-top:7px;border-top:1px solid var(--bg-surface-border);');
  const trashWrap = el('div', 'display:none;flex-direction:column;gap:3px;');
  root.append(header, pills, toolbar, trashWrap);
  // The confirm / prompt pop-up floats over the page (or the fullscreen sim),
  // outside the panel's scroller; a tap on the scrim cancels.
  const popup = el('div', 'position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:28vh 16px 0;');
  popup.className = 'preset-popup';
  const scrim = el('div', 'position:absolute;inset:0;background:rgba(0,0,0,0.45);');
  const bar = el('div', 'position:relative;display:flex;flex-direction:column;gap:10px;width:min(320px,100%);padding:12px 14px;'
    + 'background:var(--bg-primary);border:1px solid var(--accent);border-radius:8px;box-shadow:0 10px 32px rgba(0,0,0,0.6);');
  bar.setAttribute('role', 'dialog');
  popup.append(scrim, bar);
  scrim.addEventListener('click', () => hideBar());
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); hideBar(); } };

  const fileInput = el('input', 'display:none;');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  root.appendChild(fileInput);

  // ── Confirm / prompt bar ────────────────────────────────────────────
  function hideBar(): void { popup.remove(); bar.innerHTML = ''; document.removeEventListener('keydown', onKey, true); }
  function openBar(message: string): void {
    bar.innerHTML = '';
    bar.appendChild(el('div', 'font-size:0.78rem;line-height:1.35;color:var(--text-primary);', message));
    (document.fullscreenElement ?? document.body).appendChild(popup);
    document.addEventListener('keydown', onKey, true);
  }

  function showChoices(message: string, choices: Choice[]): void {
    openBar(message);
    const row = el('div', 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;');
    for (const c of choices) {
      const css = c.style === 'accent' ? BTN_ACCENT : c.style === 'danger' ? BTN_DANGER : BTN;
      row.appendChild(button(c.label, css, () => { hideBar(); c.onPick(); }));
    }
    bar.appendChild(row);
  }

  function showPrompt(message: string, initial: string, okLabel: string, onOk: (name: string) => void): void {
    openBar(message);
    const row = el('div', 'display:flex;gap:6px;');
    const input = el('input', INPUT);
    input.type = 'text';
    input.value = initial;
    input.placeholder = 'preset name';
    const commit = () => {
      const name = input.value.trim();
      if (!name) { input.style.borderColor = '#e05060'; return; }
      hideBar();
      onOk(name);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') hideBar();
    });
    row.append(input, button(okLabel, BTN_ACCENT, commit), button('Cancel', BTN, hideBar));
    bar.appendChild(row);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  // ── Actions ─────────────────────────────────────────────────────────
  function saveAs(afterSave?: () => void): void {
    const active = mgr.activePreset();
    const initial = active ? (mgr.isBuiltIn(active.id) ? `${active.name} copy` : active.name) : 'Untitled';
    showPrompt('Save current settings as', initial, 'Save', (name) => {
      const p = mgr.store.add(name, mgr.capture());
      mgr.setActiveId(p.id);
      mgr.history.resetBaseline();
      render();
      afterSave?.();
    });
  }

  function save(afterSave?: () => void): void {
    const active = mgr.activePreset();
    if (!active || mgr.isBuiltIn(active.id)) { saveAs(afterSave); return; }
    showChoices(`Overwrite "${active.name}" with the current settings?`, [
      { label: 'Overwrite', style: 'accent', onPick: () => { mgr.store.update(active.id, mgr.capture()); mgr.history.resetBaseline(); render(); afterSave?.(); } },
      { label: 'Cancel', onPick: () => {} },
    ]);
  }

  function guardDirty(then: () => void): void {
    const active = mgr.activePreset();
    if (!active || !mgr.isDirty()) { then(); return; }
    const builtIn = mgr.isBuiltIn(active.id);
    showChoices(`Unsaved changes in "${active.name}".`, [
      { label: builtIn ? 'Save as…' : 'Save', style: 'accent', onPick: () => (builtIn ? saveAs(then) : save(then)) },
      { label: 'Discard', style: 'danger', onPick: then },
      { label: 'Cancel', onPick: () => {} },
    ]);
  }

  function loadPreset(p: BasePreset<P>): void {
    guardDirty(() => { void mgr.load(p); });
  }

  function rename(): void {
    const active = mgr.activePreset();
    if (!active || mgr.isBuiltIn(active.id)) return;
    showPrompt(`Rename "${active.name}"`, active.name, 'Rename', (name) => {
      mgr.store.rename(active.id, name);
      render();
    });
  }

  function duplicate(): void {
    const active = mgr.activePreset();
    if (!active) return;
    const copy = mgr.isBuiltIn(active.id)
      ? mgr.store.add(`${active.name} copy`, { ...active })
      : mgr.store.duplicate(active.id);
    if (copy) { mgr.setActiveId(copy.id); mgr.history.resetBaseline(); }
    render();
  }

  function remove(): void {
    const active = mgr.activePreset();
    if (!active || mgr.isBuiltIn(active.id)) return;
    showChoices(`Delete "${active.name}"? It can be restored from Recently deleted.`, [
      { label: 'Delete', style: 'danger', onPick: () => { mgr.store.remove(active.id); mgr.setActiveId(undefined); mgr.history.resetBaseline(); render(); } },
      { label: 'Cancel', onPick: () => {} },
    ]);
  }

  function exportAll(): void {
    const list = mgr.store.list();
    if (list.length === 0) { showChoices('No custom presets to export yet.', [{ label: 'OK', onPick: () => {} }]); return; }
    downloadBundle(mgr.simId, list);
  }

  function importFile(): void { fileInput.value = ''; fileInput.click(); }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    let parsed: ReturnType<typeof parseBundle<P>>;
    try {
      parsed = parseBundle<P>(await readFileText(file), mgr.defaults);
    } catch (err) {
      showChoices(`Could not read file: ${(err as Error).message}`, [{ label: 'OK', onPick: () => {} }]);
      return;
    }
    const { presets, sim, warnings } = parsed;
    if (presets.length === 0) {
      showChoices(['Nothing to import.', ...warnings].join(' '), [{ label: 'OK', onPick: () => {} }]);
      return;
    }
    const mismatch = sim !== undefined && sim !== mgr.simId;
    const msg = [
      `${presets.length} preset${presets.length === 1 ? '' : 's'} from "${sim ?? 'unknown sim'}".`,
      mismatch ? `This is ${mgr.simId}; params may not match.` : '',
      ...warnings,
    ].filter(Boolean).join(' ');
    const doImport = () => { mgr.store.importPresets(presets); render(); };
    showChoices(msg, mismatch
      ? [{ label: 'Cancel', style: 'accent', onPick: () => {} }, { label: 'Import anyway', style: 'danger', onPick: doImport }]
      : [{ label: 'Import', style: 'accent', onPick: doImport }, { label: 'Cancel', onPick: () => {} }]);
  });

  // ── Render ──────────────────────────────────────────────────────────
  function render(): void {
    const activeId = mgr.getActiveId();
    const active = mgr.activePreset();
    const dirty = mgr.isDirty();
    const activeIsCustom = !!active && !mgr.isBuiltIn(active.id);

    header.innerHTML = '';
    if (sectionOpts.showTitle !== false) {
      header.appendChild(el('p', 'font-size:0.6rem;letter-spacing:1.5px;color:var(--text-muted);text-transform:uppercase;margin:0;', 'Presets'));
    }
    if (dirty) header.appendChild(el('span', MUTED, 'unsaved changes'));
    const lockedKeys = mgr.locks.keys();
    if (lockedKeys.length > 0) {
      const chip = button(`${lockedKeys.length} locked ×`, BTN_ICON + 'font-size:0.62rem;color:var(--accent);border-color:var(--accent);',
        () => mgr.locks.clear(), `Locked: ${lockedKeys.join(', ')}. Click to unlock all.`);
      header.appendChild(chip);
    }
    if (!mgr.store.storageOk) header.appendChild(el('span', MUTED + 'color:#e05060;', 'storage blocked — custom presets are session-only'));
    const spacer = el('span', 'flex:1;');
    header.appendChild(spacer);
    const undoBtn = button('↶', BTN_ICON, () => mgr.history.undo(), mgr.history.undoLabel() ? `Undo ${mgr.history.undoLabel()}` : 'Nothing to undo');
    const redoBtn = button('↷', BTN_ICON, () => mgr.history.redo(), mgr.history.redoLabel() ? `Redo ${mgr.history.redoLabel()}` : 'Nothing to redo');
    undoBtn.disabled = !mgr.history.canUndo();
    redoBtn.disabled = !mgr.history.canRedo();
    for (const b of [undoBtn, redoBtn]) if (b.disabled) b.style.opacity = '0.35';
    header.append(undoBtn, redoBtn);

    pills.innerHTML = '';
    const addPill = (p: BasePreset<P>) => {
      const isActive = p.id === activeId;
      const pill = el('button', pillStyle(isActive), p.name + (isActive && dirty ? ' •' : ''));
      pill.addEventListener('click', () => loadPreset(p));
      pills.appendChild(pill);
    };
    mgr.builtIn.forEach(addPill);
    const custom = mgr.store.list();
    if (custom.length > 0) {
      pills.appendChild(el('span', 'width:1px;height:14px;background:var(--bg-surface-border);margin:0 2px;'));
      custom.forEach(addPill);
    }

    toolbar.innerHTML = '';
    const mk = (label: string, fn: () => void, enabled = true, title?: string) => {
      const b = button(label, BTN, fn, title);
      b.disabled = !enabled;
      if (!enabled) b.style.opacity = '0.35';
      toolbar.appendChild(b);
    };
    mk('Save', () => save(), true, activeIsCustom ? 'Overwrite the active custom preset' : 'Save as a new custom preset');
    mk('Save as', () => saveAs());
    mk('Rename', rename, activeIsCustom);
    mk('Duplicate', duplicate, !!active);
    mk('Delete', remove, activeIsCustom);
    mk('Export', exportAll, true, 'Download all custom presets as JSON');
    mk('Import', importFile, true, 'Load presets from a JSON file');

    renderTrash();
  }

  let trashOpen = false;
  function renderTrash(): void {
    const trash = mgr.store.listTrash();
    trashWrap.innerHTML = '';
    if (trash.length === 0) { trashWrap.style.display = 'none'; return; }
    trashWrap.style.display = 'flex';
    const head = el('div', 'display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;' + MUTED);
    head.textContent = `${trashOpen ? '▾' : '▸'} Recently deleted (${trash.length})`;
    head.addEventListener('click', () => { trashOpen = !trashOpen; renderTrash(); });
    trashWrap.appendChild(head);
    if (!trashOpen) return;
    for (const t of trash) {
      const row = el('div', 'display:flex;align-items:center;gap:6px;padding:3px 6px;border:1px solid var(--bg-surface-border);border-radius:4px;');
      row.appendChild(el('span', 'flex:1;font-size:0.7rem;color:var(--text-body);', t.name));
      row.appendChild(el('span', MUTED, new Date(t.deletedAt).toLocaleString()));
      row.appendChild(button('Restore', BTN_ACCENT, () => { const r = mgr.store.restore(t.id); if (r) mgr.setActiveId(r.id); render(); }));
      trashWrap.appendChild(row);
    }
    trashWrap.appendChild(button('Empty recently deleted', BTN_DANGER, () => {
      showChoices('Permanently delete everything in Recently deleted?', [
        { label: 'Empty', style: 'danger', onPick: () => { mgr.store.emptyTrash(); render(); } },
        { label: 'Cancel', onPick: () => {} },
      ]);
    }));
  }

  const unsubStore = mgr.store.subscribe(render);
  const unsubHistory = mgr.history.subscribe(render);
  const unsubLocks = mgr.locks.subscribe(render);
  render();

  return {
    refresh: render,
    dispose() { unsubStore(); unsubHistory(); unsubLocks(); },
  };
}

export type { CustomPreset };
