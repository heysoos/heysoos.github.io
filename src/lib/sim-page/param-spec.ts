// src/lib/sim-page/param-spec.ts
// Sim-agnostic description of a tunable param: label, range, enum names,
// grouping and how an enum is drawn. The phone scrub list and the desktop
// meter rows are built from these, so each sim declares its params once
// (see field-boids-spec.ts, cppn-spec.ts).

export interface NumSpec<K extends string = string> {
  kind: 'num';
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
  scale?: 'linear' | 'log';
  /** Integer-valued param: the setter rounds. */
  int?: boolean;
  /** Row is shown only when this holds (e.g. point rows in Points view). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  showIf?: (p: any) => boolean;
}

export interface EnumSpec<K extends string = string> {
  kind: 'enum';
  key: K;
  label: string;
  names: readonly string[];
  /** segmented: one bar of exclusive segments. swatches: colour dots.
   *  select: native dropdown (for lists that are read, not scanned).
   *  cycle: one-line row showing the current name; a tap advances to the next. */
  ui: 'segmented' | 'swatches' | 'select' | 'cycle';
  /** swatches: one CSS colour per name. */
  colors?: readonly string[];
  /** Changing this re-renders the panel (other rows depend on it). */
  rebuilds?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  showIf?: (p: any) => boolean;
}

export type ParamSpec<K extends string = string> = NumSpec<K> | EnumSpec<K>;

export interface ParamGroup<K extends string = string> {
  name: string;
  items: ParamSpec<K>[];
  /** Optional status line under the heading (e.g. a parameter budget), re-read on refresh. */
  note?: () => string;
}
