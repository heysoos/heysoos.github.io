export interface RangeSliderOpts {
  label:   string;
  min:     number;
  max:     number;
  step:    number;
  get:     () => number;
  set:     (v: number) => void;
  scale?:  'linear' | 'log';
  onIndicatorCreate?: (wrap: HTMLElement, fill: HTMLElement) => void;
}

/** Appends a labelled range-slider row to `parent`. */
export function createRangeSlider(parent: HTMLElement, opts: RangeSliderOpts): void {
  const { label, min, max, step, get, set, scale = 'linear' } = opts;

  const row      = document.createElement('div');
  row.className  = 'param-row';
  const labelEl  = document.createElement('div');
  labelEl.className = 'param-label';
  const nameSpan = document.createElement('span');
  nameSpan.textContent = label;
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
  });

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
      if (isValid) { set(finalVal); input.value = String(valueToSlider(finalVal)); }
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
