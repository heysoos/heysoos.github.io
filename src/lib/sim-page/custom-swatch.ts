// src/lib/sim-page/custom-swatch.ts
// The extra swatch at the end of a colour row: a rainbow ring that opens the
// native colour picker. The picked colour travels as one packed number
// (0xRRGGBB) through the spec's `custom` virtual key; -1 means "none, a
// named swatch is active". Picking it also selects the row's first entry
// (the tintable one), picking a named swatch clears it.

export const packRGB = (r: number, g: number, b: number): number =>
  (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
export const unpackRGB = (v: number): [number, number, number] =>
  [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
export const hexOf = (v: number): string => '#' + ((v >>> 0) & 0xffffff).toString(16).padStart(6, '0');
export const fromHex = (hex: string): number => parseInt(hex.slice(1), 16);

export interface CustomSwatch { el: HTMLButtonElement; refresh(): void }

/** `get` returns the packed colour or -1. `onInput` runs on every drag of the
 *  picker (apply live), `onCommit` once when it closes (one undo entry). */
export function makeCustomSwatch(
  get: () => number, set: (packed: number) => void, onInput: () => void, onCommit: () => void,
): CustomSwatch {
  const b = document.createElement('button');
  b.className = 'sw custom';
  b.title = 'Custom colour';
  b.type = 'button';
  const input = document.createElement('input');
  input.type = 'color';
  input.setAttribute('aria-label', 'Custom colour');
  b.appendChild(input);
  input.addEventListener('input', () => { set(fromHex(input.value)); refresh(); onInput(); });
  input.addEventListener('change', () => onCommit());
  // A long-press / alt-click on the row must not also open the picker.
  input.addEventListener('click', (e) => { if (e.altKey) e.preventDefault(); });
  const refresh = () => {
    const v = get();
    const on = v >= 0;
    b.classList.toggle('on', on);
    b.style.background = on ? hexOf(v) : '';
    if (on) input.value = hexOf(v);
  };
  refresh();
  return { el: b, refresh };
}
