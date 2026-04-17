// src/lib/sim-page/shader-editor.ts
import { EditorView, basicSetup } from 'codemirror';
import { StreamLanguage } from '@codemirror/language';
import { cpp } from '@codemirror/legacy-modes/mode/clike';

export interface ShaderEditorHandle {
  /** Replace the editor content (e.g. on preset load) */
  setDoc(code: string): void;
  dispose(): void;
}

export function createShaderEditor(
  editorWrap:   HTMLElement,
  errorsEl:     HTMLElement,
  applyBtn:     HTMLButtonElement,
  resetBtn:     HTMLButtonElement,
  closeBtn:     HTMLButtonElement,
  shaderPanel:  HTMLElement,
  opts: {
    initialCode: string;
    onApply: (code: string) => Promise<{ success: boolean; error?: string }>;
    onReset: () => string;
    onClose: () => void;
  },
): ShaderEditorHandle {
  const view = new EditorView({
    doc: opts.initialCode,
    extensions: [
      basicSetup,
      StreamLanguage.define(cpp),
      EditorView.theme({
        '&': { background: 'var(--bg-primary)' },
        '.cm-content': { color: 'var(--text-body)', caretColor: 'var(--accent)' },
        '.cm-gutters': {
          background: 'var(--bg-surface)',
          color: 'var(--text-muted)',
          borderRight: '1px solid var(--bg-surface-border)',
        },
        '.cm-activeLineGutter': { background: 'var(--bg-surface)' },
        '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
        '.cm-selectionBackground': { background: 'rgba(224,160,64,0.2) !important' },
      }),
    ],
    parent: editorWrap,
  });

  applyBtn.addEventListener('click', async () => {
    const code = view.state.doc.toString();
    const result = await opts.onApply(code);
    if (result.success) {
      errorsEl.style.display = 'none';
      errorsEl.textContent = '';
      applyBtn.textContent = 'Applied ✓';
      applyBtn.style.borderColor = 'var(--accent)';
      applyBtn.style.color = 'var(--accent)';
      setTimeout(() => {
        applyBtn.textContent = 'Apply';
        applyBtn.style.borderColor = '';
        applyBtn.style.color = '';
      }, 1500);
    } else {
      errorsEl.textContent = result.error || 'Unknown error';
      errorsEl.style.display = 'block';
    }
  });

  resetBtn.addEventListener('click', async () => {
    const src = opts.onReset();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } });
    const result = await opts.onApply(src);
    if (result.success) {
      errorsEl.style.display = 'none';
      errorsEl.textContent = '';
    } else {
      errorsEl.textContent = result.error || 'Unknown error';
      errorsEl.style.display = 'block';
    }
  });

  closeBtn.addEventListener('click', () => {
    shaderPanel.style.display = 'none';
    opts.onClose();
  });

  return {
    setDoc(code: string): void {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
    },
    dispose(): void {
      view.destroy();
    },
  };
}
