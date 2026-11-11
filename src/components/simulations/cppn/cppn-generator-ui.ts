// Generator block shared by the desktop inputs page and the phone band:
// complexity row, the four taste presets on one line, the drawable
// probability histogram (four visually separated, colour-coded groups) and a
// legend. Weights snap to 0.05; below 0.04 a bar is 0 (never). Complexity
// never changes weights: the histogram alone decides what appears.
import { createMeterRow } from '../../../lib/sim-page/meter-row';
import { themeVar } from '../../../lib/sim-page/theme-color';
import { GROUP_COLORS } from './cppn-expr/optable';
import { GEN_ITEMS, GEN_GROUP, GEN_PRESETS, type GenItem, type GenGroup, type GenSettings, type Weights } from './cppn-expr/generator';

export const GEN_GROUP_ORDER: readonly GenGroup[] = ['spatial', 'dynamic', 'smooth', 'discrete'];
const ABBR: Partial<Record<GenItem, string>> = { smoothstep: 'sstep', length: 'len', const: 'const' };
const GROUP_ITEMS: Record<GenGroup, GenItem[]> = {
  spatial: GEN_ITEMS.filter(k => GEN_GROUP[k] === 'spatial'),
  dynamic: GEN_ITEMS.filter(k => GEN_GROUP[k] === 'dynamic'),
  smooth: GEN_ITEMS.filter(k => GEN_GROUP[k] === 'smooth'),
  discrete: GEN_ITEMS.filter(k => GEN_GROUP[k] === 'discrete'),
};
export const groupItems = (g: GenGroup): readonly GenItem[] => GROUP_ITEMS[g];
export const groupMean = (w: Weights, g: GenGroup): number => { const it = GROUP_ITEMS[g]; return it.reduce((s, k) => s + w[k], 0) / it.length; };
export const snapWeight = (w: number): number => { const c = Math.max(0, Math.min(1, w)); return c < 0.04 ? 0 : Math.round(c * 20) / 20; };

export interface HistogramOpts {
  weights: () => Weights;
  /** Set one item (full mode) or every member of a group (group mode). */
  onSet(item: GenItem | GenGroup, w: number): void;
  /** Pointer released after painting. */
  onEnd?(): void;
  /** Phone two-level mode: group bars at rest, `openGroup` drills in. */
  groups?: boolean;
  /** Tap on a group bar (group mode, no drag). */
  onOpenGroup?(g: GenGroup): void;
  /** Readout on touch: name and value. */
  onTouch?(name: string, w: number): void;
}

export interface HistogramHandle {
  redraw(): void;
  setOpenGroup(g: GenGroup | null): void;
  openGroup(): GenGroup | null;
  dispose(): void;
}

type Slot = { key: GenItem | GenGroup; x: number; w: number; group: GenGroup };

/** Draw and wire the histogram onto `canvas` (DPR-aware; call redraw on resize or weight change). */
export function drawHistogram(canvas: HTMLCanvasElement, opts: HistogramOpts): HistogramHandle {
  const ctx = canvas.getContext('2d')!;
  let slots: Slot[] = [];
  let open: GenGroup | null = null;
  const PAD = 4, GAP = 8;
  const ro = new ResizeObserver(() => redraw());
  ro.observe(canvas);

  function layout(): { W: number; H: number; top: number; bot: number; labelH: number; stagger: boolean } {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth || 300, ch = canvas.clientHeight || 150;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const groupMode = !!opts.groups && open === null;
    const items: Array<{ key: GenItem | GenGroup; group: GenGroup }> = groupMode
      ? GEN_GROUP_ORDER.map(g => ({ key: g, group: g }))
      : open ? GROUP_ITEMS[open].map(k => ({ key: k, group: open! })) : GEN_ITEMS.map(k => ({ key: k, group: GEN_GROUP[k] }));
    const stagger = !groupMode && items.length > 9 && cw / items.length < 34;
    const labelH = groupMode ? 18 : stagger ? 30 : 16;
    const top = PAD + (groupMode || open ? 4 : 14), bot = ch - labelH - 4;
    // group bands only in full mode
    const bands = groupMode || open ? 1 : GEN_GROUP_ORDER.length;
    const n = items.length;
    const bw = (cw - 2 * PAD - GAP * (bands - 1)) / n;
    slots = [];
    let x = PAD, lastGroup = items[0]?.group;
    for (const it of items) {
      if (!groupMode && !open && it.group !== lastGroup) { x += GAP; lastGroup = it.group; }
      slots.push({ key: it.key, x, w: bw, group: it.group });
      x += bw;
    }
    return { W: cw, H: ch, top, bot, labelH, stagger };
  }

  function redraw(): void {
    const { W, H, top, bot, stagger } = layout();
    const w = opts.weights();
    ctx.clearRect(0, 0, W, H);
    const groupMode = !!opts.groups && open === null;
    const mono = '10px ui-monospace, Menlo, Consolas, monospace';
    const ink = themeVar('--text-primary', '#e8e0d0', canvas), paper = themeVar('--bg-primary', '#0a0806', canvas);
    // Group bands with names (full mode)
    if (!groupMode && !open) {
      for (const g of GEN_GROUP_ORDER) {
        const ss = slots.filter(s => s.group === g);
        const x0 = ss[0].x, x1 = ss[ss.length - 1].x + ss[ss.length - 1].w;
        ctx.fillStyle = GROUP_COLORS[g]; ctx.globalAlpha = 0.09; ctx.fillRect(x0, top - 4, x1 - x0, bot - top + 4); ctx.globalAlpha = 1;
        ctx.font = '9.5px ui-sans-serif, system-ui'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
        ctx.fillStyle = GROUP_COLORS[g];
        const lb = ctx.measureText(g).width > x1 - x0 - 2 ? g.slice(0, 3) : g;
        ctx.fillText(lb, x0 + 1, 1);
      }
    }
    // Bars
    slots.forEach((s, i) => {
      const v = groupMode ? groupMean(w, s.key as GenGroup) : w[s.key as GenItem];
      const h = (bot - top) * v;
      ctx.fillStyle = GROUP_COLORS[s.group];
      ctx.globalAlpha = v === 0 ? 0.18 : 1;
      ctx.fillRect(s.x + 1.5, bot - h, s.w - 3, h);
      ctx.globalAlpha = 1;
      // label
      ctx.font = groupMode ? '11px ui-sans-serif, system-ui' : mono;
      ctx.fillStyle = ink; ctx.globalAlpha = v === 0 ? 0.4 : 0.85;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const name = groupMode ? (s.key as string) : (ABBR[s.key as GenItem] ?? (s.key as string));
      const ly = bot + 4 + (stagger && i % 2 === 1 ? 13 : 0);
      ctx.fillText(name, s.x + s.w / 2, ly);
      ctx.globalAlpha = 1;
      if (groupMode) {
        // value inside the bar when there is room, else above it
        ctx.font = mono; ctx.textBaseline = 'bottom';
        const txt = v.toFixed(2);
        if (h > 16) { ctx.fillStyle = paper; ctx.globalAlpha = 0.85; ctx.fillText(txt, s.x + s.w / 2, bot - 3); }
        else { ctx.fillStyle = ink; ctx.globalAlpha = 0.85; ctx.fillText(txt, s.x + s.w / 2, bot - h - 2); }
        ctx.globalAlpha = 1;
      }
    });
    ctx.fillStyle = ink; ctx.globalAlpha = 0.12; ctx.fillRect(PAD, bot, W - 2 * PAD, 1); ctx.globalAlpha = 1;
    if (stagger) {
      // tick from the staggered labels up to their bars so the pairing is unambiguous
      ctx.strokeStyle = ink; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
      slots.forEach((s, i) => { if (i % 2 === 1) { ctx.beginPath(); ctx.moveTo(s.x + s.w / 2, bot + 2); ctx.lineTo(s.x + s.w / 2, bot + 15); ctx.stroke(); } });
      ctx.globalAlpha = 1;
    }
  }

  // Painting
  let painting = false, moved = false, downSlot: Slot | null = null, pid = -1;
  const slotAt = (cx: number): Slot | null => slots.find(s => cx >= s.x && cx < s.x + s.w) ?? null;
  const valueAt = (cy: number): number => {
    const { top, bot } = layout();
    return snapWeight(1 - (cy - top) / (bot - top));
  };
  const paint = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const s = slotAt(e.clientX - r.left);
    if (!s) return;
    const v = valueAt(e.clientY - r.top);
    opts.onSet(s.key, v);
    opts.onTouch?.(s.key as string, v);
    redraw();
  };
  const onDown = (e: PointerEvent) => {
    painting = true; moved = false; pid = e.pointerId;
    const r = canvas.getBoundingClientRect();
    downSlot = slotAt(e.clientX - r.left);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    const groupMode = !!opts.groups && open === null;
    // In group mode a plain tap opens the group; painting starts on move.
    if (!groupMode) paint(e);
    else if (downSlot) opts.onTouch?.(downSlot.key as string, groupMean(opts.weights(), downSlot.key as GenGroup));
  };
  const onMove = (e: PointerEvent) => {
    if (!painting || e.pointerId !== pid) return;
    moved = true;
    e.preventDefault();
    paint(e);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    painting = false;
    const groupMode = !!opts.groups && open === null;
    if (groupMode && !moved && downSlot && opts.onOpenGroup) opts.onOpenGroup(downSlot.key as GenGroup);
    else opts.onEnd?.();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  redraw();
  return {
    redraw,
    setOpenGroup(g) { open = g; redraw(); },
    openGroup: () => open,
    dispose() {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    },
  };
}

export interface GeneratorBlockOpts {
  settings: () => GenSettings;
  onChange(s: GenSettings): void;
  /** Phone: two-level histogram, presets as one segmented control. */
  compact: boolean;
}

export interface GeneratorBlockHandle { refresh(): void; dispose(): void }

/** Complexity · presets · histogram · legend. */
export function buildGeneratorBlock(container: HTMLElement, opts: GeneratorBlockOpts): GeneratorBlockHandle {
  const root = document.createElement('div');
  root.className = 'gen-block' + (opts.compact ? ' compact' : '');
  container.appendChild(root);

  // complexity (meter row: drag, type, shift fine)
  const cxHost = document.createElement('div');
  cxHost.className = 'gen-complexity';
  root.appendChild(cxHost);
  const cx = createMeterRow(cxHost, {
    label: 'complexity', min: 0, max: 1, step: 0.01,
    get: () => opts.settings().complexity,
    set: (v) => opts.onChange({ ...opts.settings(), complexity: Math.max(0, Math.min(1, v)) }),
  });

  // presets, one line
  const line = document.createElement('div');
  line.className = 'gen-presets';
  line.innerHTML = `<span class="gen-lbl">probabilities</span>`;
  const seg = document.createElement('div');
  seg.className = 'look-segmented';
  const presetBtns = (['default', 'uniform', 'smooth', 'static'] as const).map(p => {
    const b = document.createElement('button');
    b.textContent = p;
    b.title = { default: 'smooth + rare discrete + rare dynamics', uniform: 'everything equally likely', smooth: 'no discrete functions', static: 'no time or pointer' }[p];
    b.addEventListener('click', () => { opts.onChange({ ...opts.settings(), weights: GEN_PRESETS[p]() }); refresh(); });
    seg.appendChild(b);
    return { p, b };
  });
  line.appendChild(seg);
  root.appendChild(line);

  // histogram
  const canvas = document.createElement('canvas');
  canvas.className = 'gen-hist';
  root.appendChild(canvas);
  const readout = document.createElement('div');
  readout.className = 'gen-readout';
  let pending: Weights | null = null;
  const hist = drawHistogram(canvas, {
    weights: () => pending ?? opts.settings().weights,
    groups: opts.compact,
    onSet: (key, w) => {
      pending ??= { ...opts.settings().weights };
      if ((GEN_GROUP_ORDER as readonly string[]).includes(key)) for (const k of GROUP_ITEMS[key as GenGroup]) pending[k] = w;
      else pending[key as GenItem] = w;
    },
    onEnd: () => { if (pending) { opts.onChange({ ...opts.settings(), weights: pending }); pending = null; } refresh(); },
    onOpenGroup: (g) => { hist.setOpenGroup(g); backBtn.hidden = false; readout.textContent = ''; },
    onTouch: (name, w) => { readout.textContent = `${name} · ${w.toFixed(2)}`; },
  });

  const legend = document.createElement('div');
  legend.className = 'gen-legend';
  legend.innerHTML = GEN_GROUP_ORDER.map(g => `<i style="background:${GROUP_COLORS[g]}"></i>${g}`).join(' ') + `<span class="gen-hint">${opts.compact ? 'tap a group · drag to set' : 'draw on the bars'}</span>`;
  const backBtn = document.createElement('button');
  backBtn.className = 'gen-back';
  backBtn.textContent = '‹ all groups';
  backBtn.hidden = true;
  backBtn.addEventListener('click', () => { hist.setOpenGroup(null); backBtn.hidden = true; readout.textContent = ''; });
  if (opts.compact) root.append(readout, backBtn);
  root.appendChild(legend);

  function refresh(): void {
    cx.refresh();
    const w = opts.settings().weights;
    for (const { p, b } of presetBtns) {
      const pw = GEN_PRESETS[p]();
      b.classList.toggle('on', GEN_ITEMS.every(k => Math.abs(pw[k] - w[k]) < 1e-6));
    }
    hist.redraw();
  }
  refresh();
  return {
    refresh,
    dispose() { cx.dispose(); hist.dispose(); root.remove(); },
  };
}

export { GROUP_COLORS, GROUP_ITEMS };
