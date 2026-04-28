// src/lib/sim-page/admin-presets-tab.ts
// Builds the admin-only "Presets" tab body for buildBoidsPanel. Manages an
// editable preset list, a save form (name + optional shader filename), a
// dirty indicator, and the write-to-disk POST. The shader content + current
// shaderFile name are read via callbacks so this file stays decoupled from
// CodeMirror.

import type { BoidsPreset } from '../../data/boids-presets';
import type { BoidsController } from '../../components/simulations/boids/boids-controller';

export interface AdminPresetsTabOpts {
  controller: BoidsController;
  /** Returns the shader currently shown in the editor (or ctrl.shaderSource if no editor open). */
  getCurrentShader: () => string;
  /** Replaces the editor doc when a preset is loaded. */
  setEditorDoc: (code: string) => void;
  /** Called whenever the user edits a preset (load, save, delete, rename, default). */
  onPresetChange: (presets: BoidsPreset[], activeId: string | undefined) => void;
}

export interface AdminPresetsTabHandle {
  /** Render into a new body element. Call from extraTab.build on each panel
   *  rebuild — state (presets, activeId, dirty, pendingShaderFile) persists
   *  across mounts so the panel can be safely rebuilt after a preset load. */
  mount(body: HTMLElement): void;
  /** The current editable list. Same array reference across mounts. */
  getPresets(): BoidsPreset[];
  /** Currently active preset id, or undefined. */
  getActiveId(): string | undefined;
  /** Pre-fill the shader file input (e.g. when a preset with a shaderFile is loaded). */
  setPendingShaderFile(stem: string): void;
  /** Mark the in-memory list as diverging from disk. Triggers the dirty indicator. */
  markDirty(): void;
}

export function buildAdminPresetsTab(
  initialPresets: BoidsPreset[],
  initialActiveId: string | undefined,
  opts: AdminPresetsTabOpts,
): AdminPresetsTabHandle {
  let presets: BoidsPreset[] = JSON.parse(JSON.stringify(initialPresets));
  let activeId: string | undefined = initialActiveId;
  let pendingShaderFile = presets.find(p => p.id === activeId)?.shaderFile ?? '';
  let isDirty = false;
  let body: HTMLElement | null = null;

  function notifyChange(): void {
    opts.onPresetChange(presets, activeId);
  }

  function markDirty(): void {
    isDirty = true;
    const wb = body?.querySelector<HTMLButtonElement>('#admin-write-to-disk');
    if (wb) styleWriteBtn(wb, true);
  }

  function styleWriteBtn(btn: HTMLButtonElement, dirty: boolean): void {
    btn.style.borderColor = dirty ? 'var(--accent)' : 'var(--bg-surface-border)';
    btn.style.color = dirty ? 'var(--accent)' : 'var(--text-muted)';
    btn.textContent = dirty ? '↓ Write to disk *' : '↓ Write to disk';
    btn.title = dirty ? 'Unsaved changes — click to persist to boids-presets.ts' : 'No pending changes';
  }

  async function writeToDisk(): Promise<void> {
    const writeBtn = body?.querySelector<HTMLButtonElement>('#admin-write-to-disk') ?? null;
    try {
      const res = await fetch('/api/admin/save-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(presets),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      isDirty = false;
      if (writeBtn) {
        writeBtn.textContent = '✓ Written';
        writeBtn.style.borderColor = 'var(--accent)';
        writeBtn.style.color = 'var(--accent)';
        setTimeout(() => {
          const cur = body?.querySelector<HTMLButtonElement>('#admin-write-to-disk') ?? null;
          if (cur) styleWriteBtn(cur, isDirty);
        }, 1500);
      }
    } catch (err) {
      if (writeBtn) {
        writeBtn.textContent = '✗ Error';
        writeBtn.style.borderColor = '#e05060';
        writeBtn.style.color = '#e05060';
        setTimeout(() => {
          const cur = body?.querySelector<HTMLButtonElement>('#admin-write-to-disk') ?? null;
          if (cur) styleWriteBtn(cur, isDirty);
        }, 2000);
      }
      console.error('Write to disk failed:', err);
    }
  }

  function loadPreset(preset: BoidsPreset): void {
    activeId = preset.id;
    Object.assign(opts.controller.params, preset.params);
    opts.controller.trailsEnabled = preset.trailsEnabled;
    opts.controller.trailDecay = preset.trailDecay;
    const nextShader = preset.shader ?? opts.controller.defaultShaderSource;
    opts.controller.reloadShader(nextShader);
    opts.setEditorDoc(nextShader);
    pendingShaderFile = preset.shaderFile ?? '';
    notifyChange();
  }

  function render(): void {
    if (!body) return;
    body.innerHTML = '';
    // Don't touch body.style.display — buildBoidsPanel manages tab visibility
    // (block/none), and overwriting it here made the Presets tab show
    // through the Params tab on first render and after every panel rebuild.
    // All flex-column layout lives on this inner wrapper instead.
    const inner = document.createElement('div');
    inner.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    body.appendChild(inner);

    // ── Preset list ──────────────────────────────────────────────────
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:3px;';

    for (const preset of presets) {
      const isActiveRow = preset.id === activeId;
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:4px;cursor:pointer;border:1px solid ${isActiveRow ? 'var(--accent)' : 'var(--bg-surface-border)'};`;

      const name = document.createElement('span');
      name.style.cssText = `flex:1;font-size:0.75rem;color:${isActiveRow ? 'var(--accent)' : 'var(--text-body)'};`;
      name.textContent = preset.name + (preset.isDefault ? ' ★' : '');
      name.title = 'Double-click to rename';

      let clickTimer: ReturnType<typeof setTimeout> | null = null;

      name.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (clickTimer !== null) { clearTimeout(clickTimer); clickTimer = null; }
        const input = document.createElement('input');
        input.type = 'text';
        input.value = preset.name;
        input.style.cssText = 'flex:1;background:var(--bg-primary);border:1px solid var(--accent);border-radius:3px;padding:1px 4px;color:var(--text-body);font-size:0.75rem;min-width:0;';
        input.addEventListener('click', (ev) => ev.stopPropagation());
        row.replaceChild(input, name);
        input.focus();
        input.select();
        function commit() {
          const newName = input.value.trim();
          if (newName && newName !== preset.name) {
            preset.name = newName;
            markDirty();
          }
          render();
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') input.blur();
          if (ev.key === 'Escape') render();
        });
      });

      const starBtn = document.createElement('button');
      starBtn.textContent = '★';
      starBtn.title = 'Set as default';
      starBtn.style.cssText = `background:none;border:none;cursor:pointer;font-size:0.7rem;color:${preset.isDefault ? 'var(--accent)' : 'var(--text-muted)'};padding:0;`;
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        presets.forEach(p => { p.isDefault = p.id === preset.id; });
        markDirty();
        notifyChange();
        render();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Delete';
      deleteBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:0.7rem;color:var(--text-muted);padding:0;';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        presets = presets.filter(p => p.id !== preset.id);
        if (activeId === preset.id) activeId = undefined;
        markDirty();
        notifyChange();
        render();
      });

      row.addEventListener('click', () => {
        if (clickTimer !== null) return;
        clickTimer = setTimeout(() => {
          clickTimer = null;
          loadPreset(preset);
          render();
        }, 220);
      });

      row.appendChild(name);
      row.appendChild(starBtn);
      row.appendChild(deleteBtn);
      list.appendChild(row);
    }

    inner.appendChild(list);

    // ── Divider ──────────────────────────────────────────────────────
    const divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:var(--bg-surface-border);margin:0.25rem 0;flex-shrink:0;';
    inner.appendChild(divider);

    // ── Save row ─────────────────────────────────────────────────────
    const saveRow = document.createElement('div');
    saveRow.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'preset name...';
    nameInput.style.cssText = 'flex:1;background:var(--bg-primary);border:1px solid var(--bg-surface-border);border-radius:4px;padding:0.25rem 0.5rem;color:var(--text-body);font-size:0.72rem;';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'padding:0.25rem 0.6rem;border:1px solid var(--bg-surface-border);border-radius:4px;background:transparent;color:var(--text-body);font-size:0.72rem;cursor:pointer;white-space:nowrap;';
    saveRow.appendChild(nameInput);
    saveRow.appendChild(saveBtn);
    inner.appendChild(saveRow);

    // ── Optional shader-file override ────────────────────────────────
    const shaderFileRow = document.createElement('div');
    shaderFileRow.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const shaderFileLabel = document.createElement('span');
    shaderFileLabel.textContent = 'Shader file:';
    shaderFileLabel.style.cssText = 'font-size:0.65rem;color:var(--text-muted);white-space:nowrap;';
    const shaderFileInput = document.createElement('input');
    shaderFileInput.type = 'text';
    shaderFileInput.placeholder = 'optional — auto-detected from content';
    shaderFileInput.style.cssText = 'flex:1;background:var(--bg-primary);border:1px solid var(--bg-surface-border);border-radius:4px;padding:0.25rem 0.5rem;color:var(--text-body);font-size:0.65rem;';
    shaderFileInput.title = 'Optional override for the .wgsl filename in boids-shaders/. Leave empty to auto-detect (content match → existing file, else preset id).';
    shaderFileInput.value = pendingShaderFile;
    shaderFileInput.addEventListener('input', () => { pendingShaderFile = shaderFileInput.value; });
    shaderFileRow.appendChild(shaderFileLabel);
    shaderFileRow.appendChild(shaderFileInput);
    inner.appendChild(shaderFileRow);

    saveBtn.addEventListener('click', () => {
      const rawName = nameInput.value.trim();
      if (!rawName) return;
      // Sanitize: anything not [a-z0-9] becomes a hyphen; collapse + trim
      // runs so 'test_changed' → 'test-changed' (not 'testchanged').
      const id = rawName.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const currentShader = opts.getCurrentShader();
      // Normalize line endings before comparing — CodeMirror returns LF, but
      // ctrl.defaultShaderSource is whatever the on-disk boids.wgsl contains
      // (CRLF on Windows). Without this, "save unchanged on default shader"
      // gets treated as custom and writes a redundant preset shader file.
      const norm = (s: string) => s.replace(/\r\n?/g, '\n');
      const isCustomShader = norm(currentShader) !== norm(opts.controller.defaultShaderSource);
      const shaderFileStem = shaderFileInput.value.trim().replace(/\.wgsl$/, '').replace(/[^a-z0-9-]/gi, '-') || undefined;
      const newPreset: BoidsPreset = {
        id: presets.some(p => p.id === id) ? `${id}-${Date.now()}` : id,
        name: rawName,
        params: { ...opts.controller.params },
        trailsEnabled: opts.controller.trailsEnabled,
        trailDecay: opts.controller.trailDecay,
        ...(isCustomShader ? { shader: currentShader, ...(shaderFileStem ? { shaderFile: shaderFileStem } : {}) } : {}),
      };
      presets.push(newPreset);
      activeId = newPreset.id;
      // Clear the form. Keeping pendingShaderFile across saves let an edited
      // shader silently overwrite an existing shared file (e.g. boids-linear).
      // Force the user to re-confirm a filename if they want the override.
      nameInput.value = '';
      shaderFileInput.value = '';
      pendingShaderFile = '';
      markDirty();
      notifyChange();
      render();
    });

    // ── Write to disk ────────────────────────────────────────────────
    const writeBtn = document.createElement('button');
    writeBtn.id = 'admin-write-to-disk';
    writeBtn.style.cssText = 'margin-top:0.25rem;padding:0.35rem;border-radius:4px;background:transparent;font-size:0.72rem;cursor:pointer;flex-shrink:0;border:1px solid;transition:border-color 0.15s,color 0.15s;';
    styleWriteBtn(writeBtn, isDirty);
    writeBtn.addEventListener('click', writeToDisk);
    inner.appendChild(writeBtn);
  }

  return {
    mount(newBody: HTMLElement): void {
      body = newBody;
      render();
    },
    getPresets: () => presets,
    getActiveId: () => activeId,
    setPendingShaderFile: (stem: string) => {
      pendingShaderFile = stem;
      const input = body?.querySelector<HTMLInputElement>('input[placeholder*="auto-detected"]');
      if (input) input.value = stem;
    },
    markDirty,
  };
}
