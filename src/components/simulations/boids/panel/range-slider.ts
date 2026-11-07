import type { UndoHistory } from '../../../../lib/presets/undo-history';
import type { ParamLockBinding } from '../../../../lib/presets/param-locks';

export interface RangeSliderOpts {
  label:   string;
  min:     number;
  max:     number;
  step:    number;
  get:     () => number;
  set:     (v: number) => void;
  scale?:  'linear' | 'log';
  onIndicatorCreate?: (wrap: HTMLElement, fill: HTMLElement) => void;
  /** When given, a drag records one undo entry and a typed edit records one. */
  history?: UndoHistory;
  /** When given, alt-click (desktop) or long-press (touch) on the row toggles
   *  the lock; a locked param keeps its value across preset loads. */
  lock?: ParamLockBinding;
}

const LONG_PRESS_MS = 450;
const PRESS_SLOP = 8;        // px of movement that cancels a long-press
const DRAG_INTENT_PX = 10;   // horizontal travel before a touch drag starts changing the value

const LOCK_SVG = '<svg width="9" height="11" viewBox="0 0 9 11" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="1" y="4.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5"/></svg>';

/** Coarse pointer = phone/tablet. Native range inputs jump to the touch point
 *  on touchstart, which is what makes scrolling a panel full of sliders
 *  change values by accident. On coarse pointers the input is display-only
 *  and the row drives it with a relative horizontal drag. */
const coarsePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** Appends a labelled range-slider row to `parent`. */
export function createRangeSlider(parent: HTMLElement, opts: RangeSliderOpts): void {
  const { label, min, max, step, get, set, scale = 'linear', history, lock } = opts;

  const row      = document.createElement('div');
  row.className  = 'param-row';
  const labelEl  = document.createElement('div');
  labelEl.className = 'param-label';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'param-name';
  const lockIcon = document.createElement('span');
  lockIcon.className = 'param-lock';
  lockIcon.innerHTML = LOCK_SVG;
  lockIcon.title = 'Locked: keeps its value when a preset loads';
  const nameText = document.createElement('span');
  nameText.textContent = label;
  nameSpan.append(lockIcon, nameText);
  const valueSpan = document.createElement('span');
  valueSpan.className = 'param-value';
  valueSpan.style.cursor = 'text';
  valueSpan.title = 'Click to edit';
  labelEl.appendChild(nameSpan);
  labelEl.appendChild(valueSpan);

  const input    = document.createElement('input');
  input.type     = 'range';

  const isLog    = scale === 'log';
  const sliderMin  = isLog ? Math.log(min)  : min;
  const sliderMax  = isLog ? Math.log(max)  : max;
  const sliderStep = isLog ? (sliderMax - sliderMin) / 1000 : step;
  const decimals   = step >= 1 ? 0 : (String(step).split('.')[1]?.length ?? 2);

  function sliderToValue(s: number): number {
    if (!isLog) return s;
    const v = Math.exp(s);
    return decimals === 0 ? Math.round(v) : parseFloat(v.toFixed(decimals));
  }
  function valueToSlider(v: number): number {
    return isLog ? Math.log(Math.max(v, min)) : v;
  }

  input.min   = String(sliderMin);
  input.max   = String(sliderMax);
  input.step  = String(sliderStep);
  input.value = String(valueToSlider(get()));
  valueSpan.textContent = get().toFixed(decimals);

  input.addEventListener('input', () => {
    const val = sliderToValue(parseFloat(input.value));
    set(val);
    valueSpan.textContent = val.toFixed(decimals);
    history?.touch();
  });

  // Undo coalescing: pointerdown opens a gesture, 'change' (fires on release,
  // and on keyboard steps) closes it. A keyboard step with no gesture open is
  // its own entry.
  if (history) {
    input.addEventListener('pointerdown', () => history.beginGesture(label));
    input.addEventListener('change', () => {
      if (history.isGestureOpen()) history.endGesture();
      else history.push(label);
    });
  }

  // ── Touch: relative drag on the row instead of the native jump-to-touch ──
  if (coarsePointer) {
    input.classList.add('touch-passive');
    let dragId = -1;
    let startX = 0, startY = 0, startS = 0, dragging = false, decided = false;
    const trackWidth = () => Math.max(40, input.getBoundingClientRect().width);

    row.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || dragId !== -1) return;
      if ((e.target as HTMLElement).closest('.param-value, .param-value-edit')) return;
      dragId = e.pointerId; startX = e.clientX; startY = e.clientY;
      startS = parseFloat(input.value); dragging = false; decided = false;
    });
    row.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragId) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!decided) {
        if (Math.abs(dx) < DRAG_INTENT_PX && Math.abs(dy) < DRAG_INTENT_PX) return;
        decided = true;
        if (Math.abs(dy) >= Math.abs(dx)) { dragId = -1; return; }   // vertical: let the sheet scroll
        dragging = true;
        row.setPointerCapture(e.pointerId);
        row.classList.add('dragging');
        history?.beginGesture(label);
      }
      if (!dragging) return;
      e.preventDefault();
      const s = Math.min(sliderMax, Math.max(sliderMin, startS + (dx / trackWidth()) * (sliderMax - sliderMin)));
      input.value = String(s);
      input.dispatchEvent(new Event('input'));
    });
    const endDrag = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return;
      dragId = -1;
      if (!dragging) return;
      dragging = false;
      row.classList.remove('dragging');
      input.dispatchEvent(new Event('change'));
    };
    row.addEventListener('pointerup', endDrag);
    row.addEventListener('pointercancel', endDrag);
  }

  // ── Lock: alt-click anywhere on the row, or long-press on touch ──
  if (lock) {
    const applyLockUi = () => row.classList.toggle('locked', lock.locks.isLocked(lock.key));
    applyLockUi();
    const unsub = lock.locks.subscribe(applyLockUi);
    row.addEventListener('click', (e) => {
      if (!e.altKey) return;
      e.preventDefault();
      lock.locks.toggle(lock.key);
    });
    // Alt-mousedown on the native input would also start a drag; block it.
    input.addEventListener('pointerdown', (e) => { if (e.altKey) e.preventDefault(); });

    let pressTimer = 0, pressX = 0, pressY = 0;
    const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; } };
    row.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      pressX = e.clientX; pressY = e.clientY;
      cancelPress();
      pressTimer = window.setTimeout(() => {
        pressTimer = 0;
        lock.locks.toggle(lock.key);
        if (navigator.vibrate) navigator.vibrate(12);
      }, LONG_PRESS_MS);
    });
    row.addEventListener('pointermove', (e) => {
      if (pressTimer && (Math.abs(e.clientX - pressX) > PRESS_SLOP || Math.abs(e.clientY - pressY) > PRESS_SLOP)) cancelPress();
    });
    row.addEventListener('pointerup', cancelPress);
    row.addEventListener('pointercancel', cancelPress);
    row.addEventListener('contextmenu', (e) => { if (coarsePointer) e.preventDefault(); });
    // The panel is rebuilt wholesale on preset load; drop the subscription then.
    const mo = new MutationObserver(() => { if (!row.isConnected) { unsub(); mo.disconnect(); } });
    queueMicrotask(() => { if (row.parentElement) mo.observe(row.parentElement, { childList: true }); });
  }

  valueSpan.addEventListener('click', () => {
    const lastVal = get();
    const editInput = document.createElement('input');
    editInput.type       = 'text';
    editInput.value      = lastVal.toFixed(decimals);
    editInput.className  = 'param-value-edit';
    valueSpan.replaceWith(editInput);
    editInput.select();

    let escaped = false;

    function commit(): void {
      if (escaped) { editInput.replaceWith(valueSpan); return; }
      const raw      = decimals === 0 ? parseInt(editInput.value, 10) : parseFloat(editInput.value);
      const isValid  = !isNaN(raw) && raw >= min && raw <= max;
      const finalVal = isValid ? raw : lastVal;
      if (isValid) { set(finalVal); input.value = String(valueToSlider(finalVal)); history?.push(label); }
      valueSpan.textContent = finalVal.toFixed(decimals);
      editInput.replaceWith(valueSpan);
    }

    editInput.addEventListener('blur', commit);
    editInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { editInput.blur(); }
      if (e.key === 'Escape') { escaped = true; editInput.blur(); }
    });
    editInput.focus();
  });

  row.appendChild(labelEl);
  row.appendChild(input);

  if (opts.onIndicatorCreate) {
    const indWrap = document.createElement('div');
    indWrap.style.cssText = 'height:2px;background:var(--bg-surface-border);border-radius:1px;overflow:hidden;margin-top:2px;display:none;';
    const indFill = document.createElement('div');
    indFill.style.cssText = 'height:100%;width:100%;transform:scaleX(0);transform-origin:left center;border-radius:1px;';
    indWrap.appendChild(indFill);
    row.appendChild(indWrap);
    opts.onIndicatorCreate(indWrap, indFill);
  }

  parent.appendChild(row);
}
