// src/lib/og/og-tool.ts
// UI for /admin/og: one section per slot (favicon, home, each gallery page),
// a few candidate recipes each, rendered with OgRenderer. Edit seed / preset /
// steps inline or the whole recipe as JSON, ★ one per slot, Save picks.
import recipesFile from '../../data/og-recipes.json';
import { OgRenderer, PRESET_IDS, downscale, drawTitle, encodeIco, themeColor, type Layer, type Recipe, type Sim } from './og-render';

interface SlotDef {
  id: string;
  kind: 'icon' | 'card';
  url: string;
  title: string;
  description: string;
  file: string;
  overlay?: { site: string; title: string };
}
interface SlotState { pick: string | null; candidates: Recipe[] }
interface RecipesDoc { version: number; slots: Record<string, SlotState> }

const LS_KEY = 'og:recipes';
const ICON_PX = 512;
const CARD_W = 1200, CARD_H = 630;
const SIMS: Sim[] = ['cppn', 'field-boids', 'boids', 'nca'];

export function mountOgTool(root: HTMLElement): void {
  // The images are made for the default dark theme, whatever this browser chose.
  document.documentElement.setAttribute('data-theme', 'dark');

  const slots: SlotDef[] = JSON.parse(root.dataset.slots!);
  const site = root.dataset.site!;
  const renderer = new OgRenderer();
  const status = document.getElementById('og-status')!;
  const results = new Map<string, HTMLCanvasElement>();      // candidate id → final image
  const views = new Map<string, () => void>();               // candidate id → refresh its visuals

  let doc: RecipesDoc = loadDoc();
  for (const s of slots) doc.slots[s.id] ??= { pick: null, candidates: [] };

  function loadDoc(): RecipesDoc {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* storage blocked */ }
    return structuredClone(recipesFile) as RecipesDoc;
  }
  function persist(): void {
    try { localStorage.setItem(LS_KEY, JSON.stringify(doc)); } catch { /* ignore */ }
  }
  const setStatus = (t: string) => { status.textContent = t; };

  // ── Rendering ────────────────────────────────────────────────────
  let pending = 0;
  /** Same recipe → same picture, so finished images are cached by recipe (IndexedDB). `force` skips the cache. */
  async function renderCandidate(slot: SlotDef, r: Recipe, card: HTMLElement, force = false): Promise<void> {
    const err = card.querySelector('.og-err')!;
    const prog = card.querySelector('.og-prog')!;
    err.textContent = '';
    // The cache holds the bare render; the title overlay depends on the page, so it goes on after.
    const finish = (raw: HTMLCanvasElement) =>
      slot.kind === 'card' && r.title && slot.overlay ? drawTitle(raw, slot.overlay.site, slot.overlay.title) : raw;
    const key = cacheKey(slot, r);
    if (!force) {
      const hit = await cacheGet(key);
      if (hit) { results.set(r.id, finish(hit)); views.get(r.id)?.(); prog.textContent = 'cached'; return; }
    }
    card.classList.add('busy');
    pending++; setStatus(`rendering… (${pending} queued)`);
    prog.textContent = 'queued';
    try {
      const t0 = performance.now();
      const onProgress = (m: string) => { prog.textContent = m; };
      const raw = slot.kind === 'icon'
        ? await renderer.render(r, ICON_PX, ICON_PX, onProgress)
        : await renderer.render(r, CARD_W, CARD_H, onProgress);
      if (key === cacheKey(slot, r)) {          // recipe unchanged while rendering
        results.set(r.id, finish(raw));
        views.get(r.id)?.();
        void cachePut(key, raw);
      }
      prog.textContent = `rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    } catch (e) {
      err.textContent = String(e instanceof Error ? e.message : e);
      prog.textContent = '';
    } finally {
      card.classList.remove('busy');
      pending--; setStatus(pending ? `rendering… (${pending} queued)` : 'done');
    }
  }

  // Lazy: a card renders (or loads from cache) the first time it scrolls near the viewport.
  const autoRender = !new URLSearchParams(location.search).has('norender');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      (e.target as HTMLElement & { _go?: () => void })._go?.();
    }
  }, { rootMargin: '400px 0px' });

  // ── Build ────────────────────────────────────────────────────────
  const renderAllFns: Array<() => Promise<void>> = [];

  function build(): void {
    root.innerHTML = '';
    renderAllFns.length = 0;
    views.clear();
    for (const slot of slots) buildSlot(slot);
  }

  function buildSlot(slot: SlotDef): void {
    const st = doc.slots[slot.id];
    const sec = el('section', 'og-slot');
    sec.append(el('h2', '', slot.kind === 'icon' ? 'Favicon' : slot.url === '/' ? 'Home page' : slot.title.split(' — ')[0]));
    sec.append(el('p', 'og-slot-sub', slot.kind === 'icon'
      ? 'Shown at real size in a tab strip (dark and light browser chrome); 16/32/48 px downsampled, 16 px also magnified.'
      : `${slot.url}  →  public/${slot.file}  (1200×630)`));

    let tabs: HTMLElement[] = [];
    if (slot.kind === 'icon') {
      for (const light of [false, true]) {
        const strip = el('div', 'og-tabs' + (light ? ' light' : ''));
        for (const r of st.candidates) {
          const tab = el('div', 'og-tab' + (light ? ' light' : ''));
          tab.dataset.cid = r.id;
          const img = document.createElement('img');
          tab.append(img, document.createTextNode(site));
          tab.title = r.id;
          tab.addEventListener('click', () => togglePick(slot, r.id));
          strip.append(tab);
          tabs.push(tab);
        }
        sec.append(strip);
      }
    }

    const grid = el('div', 'og-grid ' + (slot.kind === 'icon' ? 'icons' : 'cards'));
    st.candidates.forEach((r, idx) => grid.append(buildCandidate(slot, st, r, idx, tabs)));
    sec.append(grid);
    root.append(sec);
  }

  function buildCandidate(slot: SlotDef, st: SlotState, r: Recipe, idx: number, tabs: HTMLElement[]): HTMLElement {
    const card = el('div', 'og-cand' + (st.pick === r.id ? ' picked' : ''));
    card.dataset.cid = r.id;
    const visual = el('div', 'og-visual');

    if (slot.kind === 'icon') {
      const view = el('div', 'og-icon-view');
      const big = document.createElement('img'); big.className = 'og-icon-big';
      const sizes = el('div', 'og-icon-sizes');
      const mk = (label: string, cls = '') => {
        const f = document.createElement('figure');
        const i = document.createElement('img'); i.className = cls;
        f.append(i, document.createTextNode(label));
        sizes.append(f);
        return i;
      };
      const i48 = mk('48'), i32 = mk('32'), i16 = mk('16'), i16x = mk('16 ×4', 'og-pix');
      view.append(big, sizes);
      visual.append(view);
      views.set(r.id, () => {
        const c = results.get(r.id); if (!c) return;
        big.src = c.toDataURL();
        const s16 = downscale(c, 16).toDataURL();
        i48.src = downscale(c, 48).toDataURL(); i48.width = 48;
        i32.src = downscale(c, 32).toDataURL(); i32.width = 32;
        i16.src = s16; i16.width = 16;
        i16x.src = s16; i16x.width = 64;
        for (const t of tabs) if (t.dataset.cid === r.id) (t.querySelector('img') as HTMLImageElement).src = s16;
      });
    } else {
      const embed = el('div', 'og-embed');
      let host = 'heysoos.github.io';
      embed.append(el('div', 'e-site', host), el('div', 'e-title', slot.title), el('div', 'e-desc', slot.description));
      const img = document.createElement('img');
      const ph = el('div', 'og-ph');
      embed.append(ph);
      const small = el('div', 'og-small');
      const simg = document.createElement('img');
      const stext = el('div');
      stext.append(el('b', '', slot.title), document.createElement('br'), document.createTextNode(host + slot.url));
      small.append(simg, stext);
      visual.append(embed);
      const smallWrap = document.createElement('details');
      smallWrap.append(el('summary', '', 'small-thumbnail layout'), small);
      visual.append(smallWrap);
      views.set(r.id, () => {
        const c = results.get(r.id); if (!c) return;
        const url = c.toDataURL('image/png');
        img.src = url; simg.src = url;
        if (ph.parentElement) ph.replaceWith(img);
      });
    }
    card.append(visual);

    // ── Controls ──
    const ctrl = el('div', 'og-ctrl');
    const rerender = () => { persist(); void renderCandidate(slot, r, card); };
    let started = false;
    const go = () => { if (started) return; started = true; void renderCandidate(slot, r, card); };
    (card as HTMLElement & { _go?: () => void })._go = go;
    r.layers.forEach((L, li) => ctrl.append(layerRow(L, li, rerender)));

    const row = el('div', 'og-row');
    const pick = btn(st.pick === r.id ? '★ Picked' : '☆ Pick', () => togglePick(slot, r.id));
    if (st.pick === r.id) pick.classList.add('on');
    row.append(
      pick,
      btn('↻ Render', () => { persist(); void renderCandidate(slot, r, card, true); }),
      btn('⚄ Seeds', () => { for (const L of r.layers) L.seed = (Math.random() * 1e6) | 0; refreshInputs(); rerender(); }),
      btn('⧉ Copy', () => {
        const copy: Recipe = structuredClone(r);
        copy.id = `${r.id.replace(/-v\d+$/, '')}-v${Date.now() % 10000}`;
        st.candidates.splice(idx + 1, 0, copy);
        persist(); build();
      }),
      btn('⬇ PNG', () => download(r.id)),
    );
    if (st.candidates.length > 1) row.append(btn('✕', () => {
      st.candidates.splice(idx, 1);
      if (st.pick === r.id) st.pick = null;
      persist(); build();
    }));
    if (slot.kind === 'icon') {
      const shape = select(['circle', 'squircle', 'square'], r.shape ?? 'square', v => { r.shape = v as Recipe['shape']; rerender(); });
      const bg = select(['theme', 'transparent'], r.bg ?? 'theme', v => { r.bg = v as Recipe['bg']; rerender(); });
      row.append(labelled('shape', shape), labelled('bg', bg));
    } else {
      const t = document.createElement('input'); t.type = 'checkbox'; t.checked = !!r.title;
      t.addEventListener('change', () => { r.title = t.checked; rerender(); });
      row.append(labelled('title', t));
    }
    ctrl.append(row);

    const det = document.createElement('details');
    det.append(el('summary', '', 'recipe JSON'));
    const ta = document.createElement('textarea'); ta.className = 'og-json';
    const apply = btn('Apply JSON', () => {
      try {
        const next = JSON.parse(ta.value) as Recipe;
        if (!Array.isArray(next.layers) || !next.layers.length) throw new Error('needs layers[]');
        next.id = r.id;
        st.candidates[idx] = next;
        persist(); build();
      } catch (e) { alert('Bad recipe JSON: ' + e); }
    });
    det.addEventListener('toggle', () => { if (det.open) ta.value = JSON.stringify(r, null, 2); });
    det.append(ta, apply);
    ctrl.append(det);
    ctrl.append(el('div', 'og-prog'), el('div', 'og-err'));
    card.append(ctrl);

    const refreshInputs = () => {
      ctrl.querySelectorAll<HTMLInputElement>('input[data-seed]').forEach(inp => { inp.value = String(r.layers[+inp.dataset.seed!].seed); });
    };

    renderAllFns.push(async () => go());
    if (results.has(r.id)) { views.get(r.id)?.(); started = true; }
    else if (autoRender) io.observe(card);
    return card;
  }

  function layerRow(L: Layer, li: number, rerender: () => void): HTMLElement {
    const row = el('div', 'og-layer');
    row.append(el('span', 'og-li', String(li + 1)));
    const sim = select(SIMS, L.sim, v => {
      L.sim = v as Sim;
      L.preset = PRESET_IDS[L.sim][0]?.id ?? '';
      if (L.sim === 'cppn') { delete L.steps; L.time ??= 0; } else { delete L.time; L.steps ??= 600; }
      presetSel.replaceWith(presetSel = presetSelect());
      rerender();
    });
    const presetSelect = () => select(PRESET_IDS[L.sim].map(p => p.id), L.preset, v => { L.preset = v; rerender(); }, PRESET_IDS[L.sim].map(p => p.name));
    let presetSel = presetSelect();
    const seed = num(L.seed, 1, v => { L.seed = v; rerender(); });
    seed.dataset.seed = String(li);
    const dice = btn('⚄', () => { L.seed = (Math.random() * 1e6) | 0; seed.value = String(L.seed); rerender(); });
    dice.className = 'og-btn'; dice.title = 'new seed';
    row.append(sim, presetSel, labelled('seed', seed), dice);
    if (L.sim === 'cppn') {
      row.append(labelled('t', num(L.time ?? 0, 0.5, v => { L.time = v; rerender(); })));
    } else {
      row.append(labelled('steps', num(L.steps ?? 600, 100, v => { L.steps = Math.max(1, v); rerender(); })));
    }
    row.append(labelled('zoom', num(L.zoom ?? 1, 0.25, v => { L.zoom = v; rerender(); })));
    if (L.sim === 'nca') row.append(labelled('px/cell', num(L.cell ?? 3, 1, v => { L.cell = Math.max(1, v); rerender(); })));
    if (li > 0) {
      row.append(select(['normal', 'mask', 'multiply', 'screen', 'lighter'], L.blend ?? 'normal', v => { L.blend = v as Layer['blend']; rerender(); }));
      if (L.blend === 'mask') row.append(labelled('gain', num(L.gain ?? 1.5, 0.25, v => { L.gain = v; rerender(); })));
    }
    return row;
  }

  function togglePick(slot: SlotDef, id: string): void {
    const st = doc.slots[slot.id];
    st.pick = st.pick === id ? null : id;
    persist();
    // Update classes in place (no rebuild, keeps renders on screen)
    root.querySelectorAll<HTMLElement>('.og-cand, .og-tab').forEach(n => {
      if (!st.candidates.some(c => c.id === n.dataset.cid)) return;
      const on = n.dataset.cid === st.pick;
      n.classList.toggle('picked', on);
      const b = n.querySelector('.og-row .og-btn');
      if (b && n.classList.contains('og-cand')) { b.textContent = on ? '★ Picked' : '☆ Pick'; b.classList.toggle('on', on); }
    });
  }

  /** Starts every card that hasn't started (cached ones load instantly; the rest queue). */
  async function renderAll(): Promise<void> {
    await Promise.all([...renderAllFns].map(f => f()));
  }

  function download(id: string): void {
    const c = results.get(id); if (!c) return;
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png'); a.download = `${id}.png`; a.click();
  }

  // ── Save picks ────────────────────────────────────────────────────
  async function savePicks(): Promise<void> {
    const files: Array<{ path: string; base64: string }> = [];
    const b64 = (c: HTMLCanvasElement) => c.toDataURL('image/png').split(',')[1];
    const missing: string[] = [];
    for (const slot of slots) {
      const st = doc.slots[slot.id];
      if (!st.pick) continue;
      const img = results.get(st.pick);
      if (!img) { missing.push(slot.id); continue; }
      if (slot.kind === 'icon') {
        const bg = themeColor('--bg-primary', '#0a0804');
        const ico = await encodeIco([downscale(img, 16), downscale(img, 32), downscale(img, 48)]);
        files.push({ path: 'favicon.ico', base64: bytesToB64(ico) });
        files.push({ path: 'favicon-32.png', base64: b64(downscale(img, 32)) });
        files.push({ path: 'icon-192.png', base64: b64(downscale(img, 192)) });
        files.push({ path: 'icon-512.png', base64: b64(downscale(img, 512)) });
        files.push({ path: 'apple-touch-icon.png', base64: b64(downscale(img, 180, bg)) });   // iOS wants opaque
      } else {
        files.push({ path: slot.file, base64: b64(img) });
      }
    }
    if (missing.length) { setStatus(`render first: ${missing.join(', ')}`); return; }
    setStatus('saving…');
    try {
      const res = await fetch('/api/admin/save-og', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipes: doc, files }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      setStatus(`✓ wrote ${files.length} file${files.length === 1 ? '' : 's'} + recipes`);
    } catch (e) {
      setStatus('save failed (dev server only): ' + e);
    }
  }

  document.getElementById('og-render-all')!.addEventListener('click', () => void renderAll());
  document.getElementById('og-save')!.addEventListener('click', () => void savePicks());
  document.getElementById('og-revert')!.addEventListener('click', () => {
    if (!confirm('Discard browser edits and reload recipes from src/data/og-recipes.json?')) return;
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    doc = structuredClone(recipesFile) as RecipesDoc;
    for (const s of slots) doc.slots[s.id] ??= { pick: null, candidates: [] };
    results.clear(); build();
  });

  build();
}

// ── Cache (IndexedDB, per browser) ──────────────────────────────────
const CACHE_VERSION = 2;   // bump when a renderer change alters the pictures
function cacheKey(slot: { kind: string }, r: Recipe): string {
  const { id: _id, title: _t, ...rest } = r;   // the title overlay is applied after the cache
  const nca = r.layers.some(l => l.sim === 'nca') ? ':nca-grid2' : '';   // NCA moved to an image-sized grid
  return `v${CACHE_VERSION}${nca}:${slot.kind}:${JSON.stringify(rest)}`;
}
let dbP: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbP ??= new Promise((res, rej) => {
    const q = indexedDB.open('og-cache', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('img');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  return dbP;
}
async function cacheGet(key: string): Promise<HTMLCanvasElement | null> {
  try {
    const d = await db();
    const blob = await new Promise<Blob | undefined>((res, rej) => {
      const q = d.transaction('img').objectStore('img').get(key);
      q.onsuccess = () => res(q.result as Blob | undefined);
      q.onerror = () => rej(q.error);
    });
    if (!blob) return null;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    return c;
  } catch { return null; }
}
async function cachePut(key: string, c: HTMLCanvasElement): Promise<void> {
  try {
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'));
    if (!blob) return;
    const d = await db();
    d.transaction('img', 'readwrite').objectStore('img').put(blob, key);
  } catch { /* cache is best-effort */ }
}

// ── DOM helpers ─────────────────────────────────────────────────────
function el(tag: string, cls = '', text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function btn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'og-btn'; b.textContent = label; b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
function select(values: string[], value: string, onChange: (v: string) => void, labels?: string[]): HTMLSelectElement {
  const s = document.createElement('select');
  values.forEach((v, i) => { const o = document.createElement('option'); o.value = v; o.textContent = labels?.[i] ?? v; s.append(o); });
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function num(value: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number'; i.step = String(step); i.value = String(value);
  i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) onChange(v); });
  return i;
}
function labelled(text: string, input: HTMLElement): HTMLElement {
  const l = document.createElement('label');
  l.append(document.createTextNode(text), input);
  return l;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
