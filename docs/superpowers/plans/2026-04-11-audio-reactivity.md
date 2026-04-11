# Audio Reactivity for Boids — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-contained `AudioReactor` class and a tabbed panel UI that lets frequency band amplitudes modulate Boids simulation parameters in real time.

**Architecture:** `AudioReactor` owns the Web Audio pipeline and mapping table; it never touches the GPU controller directly. The panel is refactored to three tabs (Params / Audio / Image); the Audio tab builds the visualiser and mapping UI. A rAF loop in `[...slug].astro` applies mappings to `controller.params` every frame; a separate visualiser rAF inside the panel draws the spectrum canvas only when the Audio tab is visible.

**Tech Stack:** TypeScript, Web Audio API (`AnalyserNode`), Astro inline `<script>`, vanilla DOM (no framework), CSS custom properties from existing theme.

---

## File Map

| File | Action |
|------|--------|
| `src/components/simulations/boids/boids-audio.ts` | **Create** — `AudioReactor` class, types, `PARAM_META`, `drawAudioViz` helper |
| `src/components/simulations/boids/boids-panel.ts` | **Modify** — add tab bar, Audio tab UI; accept `reactor` in opts |
| `src/pages/gallery/[...slug].astro` | **Modify** — instantiate `AudioReactor`, pass to `buildBoidsPanel`, start mapping rAF loop |

`BoidsController` and all WGSL shaders are **not touched**.

---

## Task 1: AudioReactor — types, PARAM_META, class skeleton

**Files:**
- Create: `src/components/simulations/boids/boids-audio.ts`

- [ ] **Step 1.1 — Create the file with all types and the PARAM_META constant**

```typescript
// src/components/simulations/boids/boids-audio.ts

import type { BoidsParams } from './boids-controller';

// ── Types ────────────────────────────────────────────────────────────────────

export type BandKey = 'bass' | 'mid' | 'presence' | 'hi' | 'volume';

export interface BandSnapshot {
  bass: number;
  mid: number;
  presence: number;
  hi: number;
  volume: number;
}

export type AudioMode = 'add' | 'multiply';
export type AudioSourceKind = 'microphone' | 'system';
export type AudioStatus = 'idle' | 'active' | 'error';

export interface AudioMapping {
  param: keyof BoidsParams;
  band: BandKey;
  mode: AudioMode;
  depth: number;   // 0–1
  min: number;
  max: number;
  enabled: boolean;
}

// ── Per-param metadata (label + natural range, matching boids-panel.ts sliders) ──

export const PARAM_META: Record<string, { label: string; min: number; max: number }> = {
  attractionRadius: { label: 'Attraction Radius', min: 0.02,  max: 0.6  },
  repulsionRadius:  { label: 'Repulsion Radius',  min: 0.01,  max: 0.3  },
  attraction:       { label: 'Attraction',        min: 0,     max: 2.0  },
  repulsion:        { label: 'Repulsion',         min: 0,     max: 5.0  },
  alignment:        { label: 'Alignment',         min: 0,     max: 1.0  },
  friction:         { label: 'Friction',          min: 0,     max: 10.0 },
  maxSpeed:         { label: 'Max Speed',         min: 0.01,  max: 1.0  },
  coneAngle:        { label: 'Vision Cone',       min: -1.0,  max: 0.99 },
  dt:               { label: 'Time Step',         min: 0.001, max: 0.1  },
};

export const MAPPABLE_PARAMS = Object.keys(PARAM_META) as (keyof BoidsParams)[];

// ── Band colour tokens (matches CSS vars in the site theme) ──────────────────

export const BAND_COLORS: Record<BandKey, string> = {
  bass:     '#e05060',
  mid:      '#e09020',
  presence: '#80d060',
  hi:       '#40a0e0',
  volume:   '#b48cf0',
};

// ── Frequency bin ranges for each band (Hz → FFT bin index computed at runtime) ─

const BAND_HZ: Record<BandKey, [number, number]> = {
  bass:     [20,   250],
  mid:      [250,  2000],
  presence: [2000, 6000],
  hi:       [6000, 20000],
  volume:   [0, 0],  // special-cased: RMS of full spectrum
};

const STORAGE_KEY = 'boids-audio-mappings';
const FFT_SIZE    = 2048;

// ── AudioReactor ─────────────────────────────────────────────────────────────

export class AudioReactor {
  mappings: AudioMapping[] = [];
  status: AudioStatus = 'idle';
  lastError = '';

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private freqData: Uint8Array = new Uint8Array(FFT_SIZE / 2);
  activeSourceKind: AudioSourceKind | null = null;

  constructor() {
    this.loadMappings();
  }

  isActive(): boolean {
    return this.status === 'active';
  }

  // ── Implemented in later tasks ────────────────────────────────────────────
  async start(_sourceKind: AudioSourceKind): Promise<void> { throw new Error('Not implemented'); }
  stop(): void { throw new Error('Not implemented'); }
  analyze(): BandSnapshot { throw new Error('Not implemented'); }
  getFrequencyData(): Uint8Array { throw new Error('Not implemented'); }
  applyMappings(_params: BoidsParams, _snapshot: BandSnapshot): void { throw new Error('Not implemented'); }
  saveMappings(): void { throw new Error('Not implemented'); }
  loadMappings(): void { throw new Error('Not implemented'); }
}
```

- [ ] **Step 1.2 — Verify TypeScript compiles**

Run: `cd "C:/Users/Heysoos/Documents/Pycharm Projects/website" && npx tsc --noEmit --skipLibCheck 2>&1 | head -30`

Expected: no errors related to `boids-audio.ts` (there may be pre-existing errors in other files — ignore those).

- [ ] **Step 1.3 — Commit**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git add src/components/simulations/boids/boids-audio.ts
git commit -m "feat(audio): add AudioReactor skeleton, types, and PARAM_META"
```

---

## Task 2: AudioReactor — start() and stop()

**Files:**
- Modify: `src/components/simulations/boids/boids-audio.ts`

- [ ] **Step 2.1 — Replace the `start()` stub with the real implementation**

Replace the line:
```typescript
  async start(_sourceKind: AudioSourceKind): Promise<void> { throw new Error('Not implemented'); }
```

With:
```typescript
  async start(sourceKind: AudioSourceKind): Promise<void> {
    this.stop(); // clean up any previous session
    try {
      let stream: MediaStream;
      if (sourceKind === 'microphone') {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } else {
        // getDisplayMedia captures system audio; video: false is ignored on some browsers
        // but required in the constraints object by the spec.
        const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        // Drop any video tracks — we only want audio
        display.getVideoTracks().forEach(t => t.stop());
        const audioTracks = display.getAudioTracks();
        if (audioTracks.length === 0) {
          display.getTracks().forEach(t => t.stop());
          throw new Error('No audio track in system capture. Select "Share system audio" in the dialog.');
        }
        stream = new MediaStream(audioTracks);
      }
      this.stream = stream;
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0.8;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.source = this.ctx.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      this.activeSourceKind = sourceKind;
      this.status = 'active';
      this.lastError = '';
    } catch (e) {
      this.status = 'error';
      this.lastError = e instanceof Error ? e.message : String(e);
      this.stop();
      throw e;
    }
  }
```

- [ ] **Step 2.2 — Replace the `stop()` stub with the real implementation**

Replace the line:
```typescript
  stop(): void { throw new Error('Not implemented'); }
```

With:
```typescript
  stop(): void {
    this.source?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close();
    }
    this.source  = null;
    this.stream  = null;
    this.ctx     = null;
    this.analyser = null;
    this.activeSourceKind = null;
    if (this.status === 'active') this.status = 'idle';
  }
```

- [ ] **Step 2.3 — Verify TypeScript compiles**

Run: `cd "C:/Users/Heysoos/Documents/Pycharm Projects/website" && npx tsc --noEmit --skipLibCheck 2>&1 | head -30`

Expected: no new errors.

- [ ] **Step 2.4 — Commit**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git add src/components/simulations/boids/boids-audio.ts
git commit -m "feat(audio): implement AudioReactor start() and stop()"
```

---

## Task 3: AudioReactor — analyze() and getFrequencyData()

**Files:**
- Modify: `src/components/simulations/boids/boids-audio.ts`

- [ ] **Step 3.1 — Add the `_hzToBin` private helper, then replace the `analyze()` and `getFrequencyData()` stubs**

Add this private helper method inside the class, after the `stop()` method:

```typescript
  private _hzToBin(hz: number): number {
    if (!this.ctx || !this.analyser) return 0;
    return Math.round(hz / (this.ctx.sampleRate / FFT_SIZE));
  }

  private _bandAverage(lo: number, hi: number): number {
    const loB = Math.max(0, this._hzToBin(lo));
    const hiB = Math.min(this.freqData.length - 1, this._hzToBin(hi));
    if (hiB <= loB) return 0;
    let sum = 0;
    for (let i = loB; i <= hiB; i++) sum += this.freqData[i];
    return sum / ((hiB - loB + 1) * 255);  // normalise to 0–1
  }
```

Then replace the stubs:
```typescript
  analyze(): BandSnapshot { throw new Error('Not implemented'); }
  getFrequencyData(): Uint8Array { throw new Error('Not implemented'); }
```

With:
```typescript
  analyze(): BandSnapshot {
    if (!this.analyser) {
      return { bass: 0, mid: 0, presence: 0, hi: 0, volume: 0 };
    }
    this.analyser.getByteFrequencyData(this.freqData);

    // Volume = RMS of full spectrum, normalised
    let rms = 0;
    for (let i = 0; i < this.freqData.length; i++) rms += (this.freqData[i] / 255) ** 2;
    const volume = Math.sqrt(rms / this.freqData.length);

    return {
      bass:     this._bandAverage(...BAND_HZ.bass),
      mid:      this._bandAverage(...BAND_HZ.mid),
      presence: this._bandAverage(...BAND_HZ.presence),
      hi:       this._bandAverage(...BAND_HZ.hi),
      volume,
    };
  }

  getFrequencyData(): Uint8Array {
    if (this.analyser) this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }
```

- [ ] **Step 3.2 — Verify TypeScript compiles**

Run: `cd "C:/Users/Heysoos/Documents/Pycharm Projects/website" && npx tsc --noEmit --skipLibCheck 2>&1 | head -30`

Expected: no new errors.

- [ ] **Step 3.3 — Commit**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git add src/components/simulations/boids/boids-audio.ts
git commit -m "feat(audio): implement analyze() and getFrequencyData()"
```

---

## Task 4: AudioReactor — applyMappings()

**Files:**
- Modify: `src/components/simulations/boids/boids-audio.ts`

- [ ] **Step 4.1 — Replace the `applyMappings()` stub**

Replace:
```typescript
  applyMappings(_params: BoidsParams, _snapshot: BandSnapshot): void { throw new Error('Not implemented'); }
```

With:
```typescript
  applyMappings(params: BoidsParams, snapshot: BandSnapshot): void {
    // Take a base snapshot BEFORE any mapping mutates params,
    // so all modulations are relative to the user's slider intent.
    const base = { ...params } as Record<string, number>;

    for (const m of this.mappings) {
      if (!m.enabled) continue;
      const meta = PARAM_META[m.param as string];
      if (!meta) continue;

      const bandVal = snapshot[m.band];
      const range   = m.max - m.min;
      const baseVal = base[m.param as string] as number;

      let next: number;
      if (m.mode === 'add') {
        next = baseVal + bandVal * m.depth * range;
      } else {
        // multiply: scale up from base, capped by depth
        next = baseVal * (1 + bandVal * m.depth);
      }

      // Clamp to user-defined range
      (params as Record<string, number>)[m.param as string] =
        Math.max(m.min, Math.min(m.max, next));
    }
  }
```

- [ ] **Step 4.2 — Verify TypeScript compiles**

Run: `cd "C:/Users/Heysoos/Documents/Pycharm Projects/website" && npx tsc --noEmit --skipLibCheck 2>&1 | head -30`

Expected: no new errors.

- [ ] **Step 4.3 — Commit**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git add src/components/simulations/boids/boids-audio.ts
git commit -m "feat(audio): implement applyMappings() with add and multiply modes"
```

---

## Task 5: AudioReactor — persistence + drawAudioViz helper

**Files:**
- Modify: `src/components/simulations/boids/boids-audio.ts`

- [ ] **Step 5.1 — Replace `saveMappings()` and `loadMappings()` stubs**

Replace:
```typescript
  saveMappings(): void { throw new Error('Not implemented'); }
  loadMappings(): void { throw new Error('Not implemented'); }
```

With:
```typescript
  saveMappings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.mappings));
    } catch {
      // localStorage unavailable (e.g. private browsing quota) — silently ignore
    }
  }

  loadMappings(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as AudioMapping[];
      // Validate each entry has required fields and param is still valid
      this.mappings = parsed.filter(
        m => typeof m.param === 'string'
          && m.param in PARAM_META
          && typeof m.band === 'string'
          && typeof m.depth === 'number'
          && typeof m.min === 'number'
          && typeof m.max === 'number'
          && typeof m.enabled === 'boolean'
      );
    } catch {
      this.mappings = [];
    }
  }
```

- [ ] **Step 5.2 — Add the `defaultMapping` factory and `drawAudioViz` helper at the bottom of the file (outside the class)**

Append after the closing `}` of the class:

```typescript
// ── Factory: create a new mapping with sensible defaults ─────────────────────

export function defaultMapping(usedParams: (keyof BoidsParams)[] = []): AudioMapping {
  // Pick the first param not already in use; fall back to the first param
  const param = MAPPABLE_PARAMS.find(p => !usedParams.includes(p)) ?? MAPPABLE_PARAMS[0];
  const meta  = PARAM_META[param as string];
  return {
    param,
    band:    'bass',
    mode:    'add',
    depth:   0.5,
    min:     meta.min,
    max:     meta.max,
    enabled: true,
  };
}

// ── Spectrum visualiser helper ───────────────────────────────────────────────
// Call from a rAF loop when the Audio tab is visible.

export function drawAudioViz(canvas: HTMLCanvasElement, reactor: AudioReactor): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const data = reactor.getFrequencyData();
  const numBars = 64; // display 64 bars across the full spectrum
  const binStep = Math.floor(data.length / numBars);
  const barW    = width / numBars;

  // Determine band colour for each bar by Hz range
  const sampleRate  = 44100; // fallback; real rate used during active analysis
  const hzPerBin    = sampleRate / (data.length * 2);

  for (let i = 0; i < numBars; i++) {
    const binIdx = i * binStep;
    const hz     = binIdx * hzPerBin;
    const val    = data[binIdx] / 255;

    let color: string;
    if      (hz < 250)  color = BAND_COLORS.bass;
    else if (hz < 2000) color = BAND_COLORS.mid;
    else if (hz < 6000) color = BAND_COLORS.presence;
    else                color = BAND_COLORS.hi;

    const barH = val * height;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(i * barW, height - barH, barW - 1, barH);
  }
  ctx.globalAlpha = 1;
}
```

- [ ] **Step 5.3 — Verify TypeScript compiles**

Run: `cd "C:/Users/Heysoos/Documents/Pycharm Projects/website" && npx tsc --noEmit --skipLibCheck 2>&1 | head -30`

Expected: no new errors.

- [ ] **Step 5.4 — Commit**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git add src/components/simulations/boids/boids-audio.ts
git commit -m "feat(audio): add persistence, defaultMapping factory, drawAudioViz helper"
```

---

## Task 6: Refactor boids-panel.ts — add tab bar

**Files:**
- Modify: `src/components/simulations/boids/boids-panel.ts`

The goal of this task is to: (a) add `reactor?: AudioReactor` to `BoidsPanelOpts`, (b) replace the plain header with a three-tab bar, (c) route existing params content + image section into their own tab body divs. The Audio tab body is created but left empty — filled in Tasks 7–9.

- [ ] **Step 6.1 — Add the AudioReactor import and update BoidsPanelOpts**

At the top of `boids-panel.ts`, after the existing imports, add:

```typescript
import type { AudioReactor } from './boids-audio';
```

Then update `BoidsPanelOpts` to add the optional reactor:

```typescript
export interface BoidsPanelOpts {
  onShaderEdit?: () => void;
  onClose?: () => void;
  presets?: BoidsPreset[];
  activePresetId?: string;
  onPresetLoad?: (preset: BoidsPreset) => void;
  reactor?: AudioReactor;  // ← new
}
```

- [ ] **Step 6.2 — Replace the header block with a tab bar**

Find and replace this entire header block (lines 20–45 of the original file):

```typescript
  // ── Header ───────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'panel-header';
  const title = document.createElement('p');
  title.className = 'panel-title';
  title.textContent = 'Parameters';
  const headerRight = document.createElement('div');
  headerRight.style.cssText = 'display:flex;align-items:center;gap:0.35rem;';
  if (opts.onShaderEdit) {
    const shaderBtn = document.createElement('button');
    shaderBtn.className = 'panel-close';
    shaderBtn.title = 'Edit Shader';
    shaderBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    shaderBtn.addEventListener('click', opts.onShaderEdit);
    headerRight.appendChild(shaderBtn);
  }
  if (opts.onClose) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', opts.onClose);
    headerRight.appendChild(closeBtn);
  }
  header.appendChild(title);
  header.appendChild(headerRight);
  container.appendChild(header);
```

With this new tab bar block:

```typescript
  // ── Tab bar (replaces old plain header) ──────────────────────────
  const tabBar = document.createElement('div');
  tabBar.style.cssText = [
    'display:flex',
    'border-bottom:1px solid var(--bg-surface-border)',
    'position:relative',
  ].join(';');

  // Close + shader buttons in top-right corner of the bar
  const tabRight = document.createElement('div');
  tabRight.style.cssText = 'display:flex;align-items:center;gap:0.35rem;padding:0 0.35rem;margin-left:auto;';
  if (opts.onShaderEdit) {
    const shaderBtn = document.createElement('button');
    shaderBtn.className = 'panel-close';
    shaderBtn.title = 'Edit Shader';
    shaderBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    shaderBtn.addEventListener('click', opts.onShaderEdit);
    tabRight.appendChild(shaderBtn);
  }
  if (opts.onClose) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', opts.onClose);
    tabRight.appendChild(closeBtn);
  }

  const tabNames = ['Params', 'Audio', 'Image'] as const;
  const tabBodies: Record<string, HTMLDivElement> = {};
  const tabBtns:  Record<string, HTMLButtonElement> = {};

  let activeTab = 'Params';

  function switchTab(name: string): void {
    activeTab = name;
    for (const t of tabNames) {
      const isActive = t === name;
      tabBtns[t].style.cssText = buildTabStyle(isActive);
      tabBodies[t].style.display = isActive ? 'block' : 'none';
    }
  }

  function buildTabStyle(active: boolean): string {
    return [
      'padding:5px 10px',
      'font-size:0.62rem',
      'text-transform:uppercase',
      'letter-spacing:0.07em',
      'background:none',
      'border:none',
      'border-bottom:2px solid ' + (active ? 'var(--accent)' : 'transparent'),
      'color:' + (active ? 'var(--accent)' : 'var(--text-muted)'),
      'cursor:pointer',
      'transition:color 0.15s,border-color 0.15s',
    ].join(';');
  }

  for (const name of tabNames) {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.style.cssText = buildTabStyle(name === 'Params');
    btn.addEventListener('click', () => switchTab(name));
    tabBar.appendChild(btn);
    tabBtns[name] = btn;

    const body = document.createElement('div');
    body.style.display = name === 'Params' ? 'block' : 'none';
    tabBodies[name] = body;
  }

  tabBar.appendChild(tabRight);
  container.appendChild(tabBar);

  // Append all three bodies to container
  for (const name of tabNames) container.appendChild(tabBodies[name]);

  // Shorthand references used in the sections below
  const paramsBody = tabBodies['Params'];
  const audioBody  = tabBodies['Audio'];
  const imageBody  = tabBodies['Image'];
```

- [ ] **Step 6.3 — Route all existing addSection / addSlider calls to `paramsBody`**

All existing calls to `addSection(container, ...)` must become `addSection(paramsBody, ...)`.
All existing calls to `addSlider(container, ...)` must become `addSlider(paramsBody, ...)`.

There are also several inline DOM-creation blocks (preset pill row, opacity mode toggle, shape selector, color, trails) that append directly to `container`. Change every `container.appendChild(...)` after the tab bar block to `paramsBody.appendChild(...)`.

Specifically:
- The preset pill row block: change `container.appendChild(pillRow)` → `paramsBody.appendChild(pillRow)`
- The opacity mode row: `container.appendChild(modeRow)` → `paramsBody.appendChild(modeRow)`
- The shape label + row: `container.appendChild(labelEl)` / `container.appendChild(shapeRow)` → `paramsBody.appendChild(...)`
- The color label + row: same pattern
- The trail row + decayWrapper: same pattern

Do a find-and-replace: after the `tabBodies` setup block, change all remaining `container.appendChild` calls to `paramsBody.appendChild`. The `addSection` and `addSlider` helpers already take a `parent` argument — update all their calls to pass `paramsBody` instead of `container`.

- [ ] **Step 6.4 — Route the image section to `imageBody`**

Find the existing image section call at the bottom of `buildBoidsPanel`:

```typescript
  // ── Image Force Field ─────────────────────────────────────────────
  buildImagePanelSection(container, controller.imageProcessor, {
```

Change `container` to `imageBody`:

```typescript
  // ── Image Force Field ─────────────────────────────────────────────
  buildImagePanelSection(imageBody, controller.imageProcessor, {
```

- [ ] **Step 6.5 — Add a placeholder to audioBody (will be replaced in Task 7)**

After the tab bodies are set up (before the params content), add:

```typescript
  // Audio tab content built in buildAudioTab() below — called at end of this function
  // (placeholder — Tasks 7–9 will fill this)
  audioBody.style.cssText = 'padding:8px;color:var(--text-muted);font-size:0.7rem;';
  audioBody.textContent = 'Audio — coming soon';
```

- [ ] **Step 6.6 — Verify build succeeds**

Run: `cd "C:/Users/Heysoos/Documents/Pycharm Projects/website" && npm run build 2>&1 | tail -20`

Expected: build succeeds with no TypeScript errors. Warnings about unused variables are acceptable.

- [ ] **Step 6.7 — Smoke test in browser**

Run `npm run dev`, open `http://localhost:4321/gallery/boids`, click the settings button. Verify:
- Three tabs appear: Params / Audio / Image
- Params tab shows all existing sliders and controls
- Image tab shows the image force field section
- Audio tab shows "Audio — coming soon"
- Preset pills, close button, shader edit button all still work

- [ ] **Step 6.8 — Commit**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git add src/components/simulations/boids/boids-panel.ts
git commit -m "feat(audio): add tab bar to boids panel (Params / Audio / Image)"
```

---

## Task 7: Audio tab — source row + status dot

**Files:**
- Modify: `src/components/simulations/boids/boids-panel.ts`

Replace the placeholder `audioBody.textContent = 'Audio — coming soon'` with a proper `buildAudioTab` function call. This task adds the source selection UI and status indicator.

- [ ] **Step 7.1 — Remove the placeholder and add `buildAudioTab` function**

Remove these two lines added in Task 6.5:
```typescript
  audioBody.style.cssText = 'padding:8px;color:var(--text-muted);font-size:0.7rem;';
  audioBody.textContent = 'Audio — coming soon';
```

Then, immediately after the closing brace of `buildBoidsPanel`, add a new standalone function:

```typescript
// ── Audio tab builder ─────────────────────────────────────────────────────────

import {
  type AudioReactor,
  type BandKey,
  type AudioMapping,
  BAND_COLORS,
  PARAM_META,
  MAPPABLE_PARAMS,
  defaultMapping,
  drawAudioViz,
} from './boids-audio';

function buildAudioTab(
  container: HTMLElement,
  reactor: AudioReactor,
  onTabSwitch: (name: string) => void,
): () => void {
  // Returns a cleanup function that stops the visualiser rAF.
  // Called by the tab switcher when leaving the Audio tab.

  container.style.cssText = 'display:flex;flex-direction:column;gap:0;';

  // ── Source row ────────────────────────────────────────────────────
  const sourceSection = document.createElement('div');
  sourceSection.style.cssText = 'padding:8px 8px 6px;border-bottom:1px solid var(--bg-surface-border);';

  const sourceLabel = document.createElement('div');
  sourceLabel.style.cssText = 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:5px;';
  sourceLabel.textContent = 'Audio Source';

  const sourceBtnRow = document.createElement('div');
  sourceBtnRow.style.cssText = 'display:flex;align-items:center;gap:5px;';

  function pillStyle(active: boolean): string {
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

  const micBtn = document.createElement('button');
  micBtn.textContent = 'Microphone';
  micBtn.style.cssText = pillStyle(false);

  const sysBtn = document.createElement('button');
  sysBtn.textContent = 'System Audio';
  sysBtn.style.cssText = pillStyle(false);

  // Status dot
  const statusDot = document.createElement('span');
  statusDot.style.cssText = [
    'width:7px;height:7px;border-radius:50%;',
    'display:inline-block;margin-left:auto;',
    'background:var(--text-muted);transition:background 0.2s;',
  ].join('');

  const errorMsg = document.createElement('div');
  errorMsg.style.cssText = 'font-size:0.62rem;color:#e05060;margin-top:4px;display:none;word-break:break-word;';

  function updateStatus(): void {
    if (reactor.status === 'active') {
      statusDot.style.background = '#e05060';
      statusDot.style.boxShadow  = '0 0 4px #e05060';
      micBtn.style.cssText = pillStyle(reactor.activeSourceKind === 'microphone');
      sysBtn.style.cssText = pillStyle(reactor.activeSourceKind === 'system');
      errorMsg.style.display = 'none';
    } else if (reactor.status === 'error') {
      statusDot.style.background = '#e09020';
      statusDot.style.boxShadow  = 'none';
      errorMsg.textContent = reactor.lastError;
      errorMsg.style.display = 'block';
      micBtn.style.cssText = pillStyle(false);
      sysBtn.style.cssText = pillStyle(false);
    } else {
      statusDot.style.background = 'var(--text-muted)';
      statusDot.style.boxShadow  = 'none';
      micBtn.style.cssText = pillStyle(false);
      sysBtn.style.cssText = pillStyle(false);
      errorMsg.style.display = 'none';
    }
  }

  async function startSource(kind: 'microphone' | 'system'): Promise<void> {
    if (reactor.isActive()) {
      reactor.stop();
      updateStatus();
      return; // toggle off
    }
    try {
      await reactor.start(kind);
    } catch { /* error already stored in reactor.lastError */ }
    updateStatus();
  }

  micBtn.addEventListener('click', () => void startSource('microphone'));
  sysBtn.addEventListener('click', () => void startSource('system'));

  sourceBtnRow.appendChild(micBtn);
  sourceBtnRow.appendChild(sysBtn);
  sourceBtnRow.appendChild(statusDot);

  sourceSection.appendChild(sourceLabel);
  sourceSection.appendChild(sourceBtnRow);
  sourceSection.appendChild(errorMsg);
  container.appendChild(sourceSection);

  // ── Spectrum canvas + band meters (Task 8) ── placeholder ─────────
  // ── Mapping rows (Task 9) ── placeholder ──────────────────────────

  // Return cleanup (no rAF yet — added in Task 8)
  return () => {};
}
```

Also, inside `buildBoidsPanel`, replace the placeholder lines from Step 6.5 with the actual call to `buildAudioTab`:

```typescript
  // Audio tab — built by dedicated function
  let audioTabCleanup = buildAudioTab(audioBody, opts.reactor!, () => switchTab);
```

Note: `opts.reactor!` will be `undefined` if no reactor is passed. Guard the call:
```typescript
  if (opts.reactor) {
    audioTabCleanup = buildAudioTab(audioBody, opts.reactor, switchTab);
  } else {
    audioBody.style.cssText = 'padding:8px;color:var(--text-muted);font-size:0.7rem;';
    audioBody.textContent = 'No audio reactor provided.';
  }
  let audioTabCleanup: (() => void) | null = null;
```

Move the `let audioTabCleanup` declaration before the `if` block.

- [ ] **Step 7.2 — Verify build succeeds**

Run: `cd "C:/Users/Heysoos/Documents/Pycharm Projects/website" && npm run build 2>&1 | tail -20`

Expected: build succeeds.

- [ ] **Step 7.3 — Commit**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git add src/components/simulations/boids/boids-panel.ts
git commit -m "feat(audio): add source selection UI and status indicator to Audio tab"
```

---

## Task 8: Audio tab — spectrum canvas + band meters

**Files:**
- Modify: `src/components/simulations/boids/boids-panel.ts`

Replace the placeholder comment `// ── Spectrum canvas + band meters (Task 8) ── placeholder ─────────` in `buildAudioTab` with the real implementation.

- [ ] **Step 8.1 — Add spectrum canvas and band meters after the source section**

Replace:
```typescript
  // ── Spectrum canvas + band meters (Task 8) ── placeholder ─────────
```

With:

```typescript
  // ── Spectrum canvas ───────────────────────────────────────────────
  const canvasSection = document.createElement('div');
  canvasSection.style.cssText = 'padding:6px 8px 4px;border-bottom:1px solid var(--bg-surface-border);';

  const vizCanvas = document.createElement('canvas');
  vizCanvas.width  = 184;
  vizCanvas.height = 40;
  vizCanvas.style.cssText = 'width:100%;height:40px;display:block;border-radius:2px;background:#06050a;';
  canvasSection.appendChild(vizCanvas);

  // Band meters
  const metersRow = document.createElement('div');
  metersRow.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:3px;margin-top:5px;';

  const BAND_KEYS: BandKey[] = ['bass', 'mid', 'presence', 'hi', 'volume'];
  const BAND_LABELS: Record<BandKey, string> = {
    bass: 'bass', mid: 'mid', presence: 'pres', hi: 'hi', volume: 'vol',
  };

  const meterBars: Partial<Record<BandKey, HTMLDivElement>> = {};

  for (const band of BAND_KEYS) {
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';

    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'width:100%;height:16px;background:var(--bg-surface-border);border-radius:1px;overflow:hidden;display:flex;align-items:flex-end;';

    const bar = document.createElement('div');
    bar.style.cssText = `width:100%;height:0%;background:${BAND_COLORS[band]};transition:height 0.05s;`;
    barWrap.appendChild(bar);
    meterBars[band] = bar;

    const label = document.createElement('div');
    label.style.cssText = `font-size:0.55rem;color:${BAND_COLORS[band]};letter-spacing:0.04em;`;
    label.textContent = BAND_LABELS[band];

    col.appendChild(barWrap);
    col.appendChild(label);
    metersRow.appendChild(col);
  }

  canvasSection.appendChild(metersRow);
  container.appendChild(canvasSection);
```

- [ ] **Step 8.2 — Update the returned cleanup function to start and stop the visualiser rAF**

Replace the cleanup return at the bottom of `buildAudioTab`:
```typescript
  // Return cleanup (no rAF yet — added in Task 8)
  return () => {};
```

With:
```typescript
  // ── Visualiser rAF loop (runs only when Audio tab is visible) ─────
  let vizRafId = 0;

  function vizLoop(): void {
    if (reactor.isActive()) {
      drawAudioViz(vizCanvas, reactor);
      const snapshot = reactor.analyze();
      for (const band of BAND_KEYS) {
        const bar = meterBars[band];
        if (bar) bar.style.height = `${Math.round(snapshot[band] * 100)}%`;
      }
    } else {
      // Clear canvas when not active
      const ctx = vizCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
      for (const bar of Object.values(meterBars)) {
        if (bar) bar.style.height = '0%';
      }
    }
    vizRafId = requestAnimationFrame(vizLoop);
  }

  vizRafId = requestAnimationFrame(vizLoop);

  return () => {
    cancelAnimationFrame(vizRafId);
  };
```

- [ ] **Step 8.3 — Wire cleanup to tab switching**

Back in `buildBoidsPanel`, the `switchTab` function needs to stop/restart the visualiser when the Audio tab is entered/left. Update the `switchTab` function created in Task 6:

```typescript
  function switchTab(name: string): void {
    // Stop visualiser if leaving Audio tab
    if (activeTab === 'Audio' && audioTabCleanup) audioTabCleanup();

    activeTab = name;
    for (const t of tabNames) {
      const isActive = t === name;
      tabBtns[t].style.cssText = buildTabStyle(isActive);
      tabBodies[t].style.display = isActive ? 'block' : 'none';
    }

    // Restart visualiser when entering Audio tab
    if (name === 'Audio' && opts.reactor) {
      audioTabCleanup = buildAudioTab(audioBody, opts.reactor, switchTab);
    }
  }
```

Wait — rebuilding the entire audio tab on each switch is wasteful and would reset UI state. Instead, keep the tab body DOM persistent and only pause/resume the rAF. Revise: `buildAudioTab` is called **once** during `buildBoidsPanel`. The returned cleanup is called when leaving the tab; a separate `resume` function re-starts the rAF when entering the tab.

Change the return type of `buildAudioTab` to return `{ stop: () => void; start: () => void }`:

```typescript
  // At the bottom of buildAudioTab, replace the vizLoop + return block with:
  let vizRafId = 0;

  function startViz(): void {
    cancelAnimationFrame(vizRafId);
    function loop(): void {
      if (reactor.isActive()) {
        drawAudioViz(vizCanvas, reactor);
        const snapshot = reactor.analyze();
        for (const band of BAND_KEYS) {
          const bar = meterBars[band];
          if (bar) bar.style.height = `${Math.round(snapshot[band] * 100)}%`;
        }
      } else {
        const ctx2d = vizCanvas.getContext('2d');
        if (ctx2d) ctx2d.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
        for (const bar of Object.values(meterBars)) {
          if (bar) bar.style.height = '0%';
        }
      }
      vizRafId = requestAnimationFrame(loop);
    }
    vizRafId = requestAnimationFrame(loop);
  }

  function stopViz(): void {
    cancelAnimationFrame(vizRafId);
  }

  startViz(); // start immediately since Audio tab may be active

  return { start: startViz, stop: stopViz };
```

Update `switchTab` in `buildBoidsPanel`:

```typescript
  let audioVizControls: { start: () => void; stop: () => void } | null = null;

  function switchTab(name: string): void {
    if (activeTab === 'Audio') audioVizControls?.stop();
    activeTab = name;
    for (const t of tabNames) {
      const isActive = t === name;
      tabBtns[t].style.cssText = buildTabStyle(isActive);
      tabBodies[t].style.display = isActive ? 'block' : 'none';
    }
    if (name === 'Audio') audioVizControls?.start();
  }
```

And when calling `buildAudioTab`:
```typescript
  if (opts.reactor) {
    audioVizControls = buildAudioTab(audioBody, opts.reactor, switchTab);
    // Immediately stop viz since Params tab is shown first
    audioVizControls.stop();
  } else {
    audioBody.style.cssText = 'padding:8px;color:var(--text-muted);font-size:0.7rem;';
    audioBody.textContent = 'No audio reactor provided.';
  }
```

- [ ] **Step 8.4 — Verify build succeeds**

Run: `cd "C:/Users/Heysoos/Documents/Pycharm Projects/website" && npm run build 2>&1 | tail -20`

Expected: build succeeds.

- [ ] **Step 8.5 — Commit**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git add src/components/simulations/boids/boids-panel.ts
git commit -m "feat(audio): add spectrum canvas and band meters to Audio tab"
```

---

## Task 9: Audio tab — mapping rows + Add button

**Files:**
- Modify: `src/components/simulations/boids/boids-panel.ts`

Replace the placeholder comment `// ── Mapping rows (Task 9) ── placeholder ──────────────────────────` in `buildAudioTab` with the full mappings UI.

- [ ] **Step 9.1 — Add the mappings section**

Replace:
```typescript
  // ── Mapping rows (Task 9) ── placeholder ──────────────────────────
```

With:

```typescript
  // ── Mappings section ──────────────────────────────────────────────
  const mappingsSection = document.createElement('div');
  mappingsSection.style.cssText = 'padding:0 0 4px;';

  const mappingsLabel = document.createElement('div');
  mappingsLabel.style.cssText = 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);padding:6px 8px 3px;';
  mappingsLabel.textContent = 'Mappings';
  mappingsSection.appendChild(mappingsLabel);

  const mappingsList = document.createElement('div');
  mappingsSection.appendChild(mappingsList);

  function buildMappingRow(mapping: AudioMapping, index: number): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'padding:5px 8px;border-top:1px solid var(--bg-surface-border);display:flex;flex-direction:column;gap:4px;';

    // Row 1: param dropdown + remove button
    const row1 = document.createElement('div');
    row1.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const paramSel = document.createElement('select');
    paramSel.style.cssText = [
      'flex:1;background:var(--bg-surface);color:var(--text-body);',
      'border:1px solid var(--bg-surface-border);border-radius:3px;',
      'font-size:0.65rem;padding:2px 4px;cursor:pointer;',
    ].join('');
    for (const p of MAPPABLE_PARAMS) {
      const opt = document.createElement('option');
      opt.value = String(p);
      opt.textContent = PARAM_META[String(p)].label;
      opt.selected = p === mapping.param;
      paramSel.appendChild(opt);
    }
    paramSel.addEventListener('change', () => {
      mapping.param = paramSel.value as typeof mapping.param;
      const meta = PARAM_META[paramSel.value];
      // Update min/max inputs to new param's natural range
      minInput.value = String(meta.min);
      maxInput.value = String(meta.max);
      mapping.min = meta.min;
      mapping.max = meta.max;
      reactor.saveMappings();
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.style.cssText = [
      'background:none;border:none;color:var(--text-muted);',
      'cursor:pointer;font-size:0.9rem;padding:0 2px;line-height:1;',
    ].join('');
    removeBtn.addEventListener('click', () => {
      reactor.mappings.splice(index, 1);
      reactor.saveMappings();
      rebuildMappingsList();
    });

    row1.appendChild(paramSel);
    row1.appendChild(removeBtn);
    row.appendChild(row1);

    // Row 2: band selector + mode toggle
    const row2 = document.createElement('div');
    row2.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const BAND_ABBR: Record<BandKey, string> = {
      bass: 'B', mid: 'M', presence: 'P', hi: 'H', volume: 'V',
    };

    const bandBtns: HTMLButtonElement[] = [];
    for (const band of ['bass', 'mid', 'presence', 'hi', 'volume'] as BandKey[]) {
      const b = document.createElement('button');
      b.textContent = BAND_ABBR[band];
      b.title = band;
      const isActive = mapping.band === band;
      b.style.cssText = [
        'width:18px;height:18px;border-radius:3px;font-size:0.6rem;cursor:pointer;',
        'border:1px solid ' + (isActive ? BAND_COLORS[band] : 'var(--bg-surface-border)') + ';',
        'background:' + (isActive ? BAND_COLORS[band] + '33' : 'transparent') + ';',
        'color:' + (isActive ? BAND_COLORS[band] : 'var(--text-muted)') + ';',
      ].join('');
      b.addEventListener('click', () => {
        mapping.band = band;
        for (const bb of bandBtns) bb.style.cssText = buildBandBtnStyle(
          (bb as HTMLButtonElement & { _band?: BandKey })._band ?? 'bass',
          mapping.band,
        );
        reactor.saveMappings();
      });
      (b as HTMLButtonElement & { _band: BandKey })._band = band;
      bandBtns.push(b);
      row2.appendChild(b);
    }

    // Mode toggle
    const modeBtn = document.createElement('button');
    modeBtn.style.cssText = [
      'margin-left:auto;padding:1px 6px;border-radius:3px;font-size:0.65rem;cursor:pointer;',
      'border:1px solid var(--bg-surface-border);background:transparent;color:var(--text-muted);',
    ].join('');
    modeBtn.textContent = mapping.mode === 'add' ? '+ add' : '× mul';
    modeBtn.addEventListener('click', () => {
      mapping.mode = mapping.mode === 'add' ? 'multiply' : 'add';
      modeBtn.textContent = mapping.mode === 'add' ? '+ add' : '× mul';
      reactor.saveMappings();
    });
    row2.appendChild(modeBtn);
    row.appendChild(row2);

    // Row 3: depth slider
    const row3 = document.createElement('div');
    row3.style.cssText = 'display:flex;align-items:center;gap:6px;';

    const depthLabel = document.createElement('span');
    depthLabel.style.cssText = 'font-size:0.6rem;color:var(--text-muted);min-width:30px;';
    depthLabel.textContent = 'Depth';

    const depthSlider = document.createElement('input');
    depthSlider.type = 'range';
    depthSlider.min  = '0';
    depthSlider.max  = '1';
    depthSlider.step = '0.01';
    depthSlider.value = String(mapping.depth);
    depthSlider.style.cssText = 'flex:1;accent-color:var(--accent);';

    const depthVal = document.createElement('span');
    depthVal.style.cssText = 'font-size:0.6rem;color:var(--accent);min-width:28px;text-align:right;font-variant-numeric:tabular-nums;';
    depthVal.textContent = mapping.depth.toFixed(2);

    depthSlider.addEventListener('input', () => {
      mapping.depth = parseFloat(depthSlider.value);
      depthVal.textContent = mapping.depth.toFixed(2);
      reactor.saveMappings();
    });

    row3.appendChild(depthLabel);
    row3.appendChild(depthSlider);
    row3.appendChild(depthVal);
    row.appendChild(row3);

    // Row 4: min / max clamp inputs
    const row4 = document.createElement('div');
    row4.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const inputStyle = [
      'width:48px;background:var(--bg-surface);color:var(--text-body);',
      'border:1px solid var(--bg-surface-border);border-radius:3px;',
      'font-size:0.62rem;padding:1px 3px;text-align:right;',
    ].join('');

    const minLabel = document.createElement('span');
    minLabel.style.cssText = 'font-size:0.6rem;color:var(--text-muted);';
    minLabel.textContent = 'Min';

    const minInput = document.createElement('input');
    minInput.type  = 'text';
    minInput.value = String(mapping.min);
    minInput.style.cssText = inputStyle;
    minInput.addEventListener('blur', () => {
      const v = parseFloat(minInput.value);
      if (!isNaN(v) && v < mapping.max) { mapping.min = v; reactor.saveMappings(); }
      else minInput.value = String(mapping.min);
    });

    const maxLabel = document.createElement('span');
    maxLabel.style.cssText = 'font-size:0.6rem;color:var(--text-muted);margin-left:4px;';
    maxLabel.textContent = 'Max';

    const maxInput = document.createElement('input');
    maxInput.type  = 'text';
    maxInput.value = String(mapping.max);
    maxInput.style.cssText = inputStyle;
    maxInput.addEventListener('blur', () => {
      const v = parseFloat(maxInput.value);
      if (!isNaN(v) && v > mapping.min) { mapping.max = v; reactor.saveMappings(); }
      else maxInput.value = String(mapping.max);
    });

    row4.appendChild(minLabel);
    row4.appendChild(minInput);
    row4.appendChild(maxLabel);
    row4.appendChild(maxInput);
    row.appendChild(row4);

    return row;
  }

  function buildBandBtnStyle(band: BandKey, activeBand: BandKey): string {
    const isActive = band === activeBand;
    return [
      'width:18px;height:18px;border-radius:3px;font-size:0.6rem;cursor:pointer;',
      'border:1px solid ' + (isActive ? BAND_COLORS[band] : 'var(--bg-surface-border)') + ';',
      'background:' + (isActive ? BAND_COLORS[band] + '33' : 'transparent') + ';',
      'color:' + (isActive ? BAND_COLORS[band] : 'var(--text-muted)') + ';',
    ].join('');
  }

  function rebuildMappingsList(): void {
    mappingsList.innerHTML = '';
    reactor.mappings.forEach((m, i) => {
      mappingsList.appendChild(buildMappingRow(m, i));
    });
  }

  rebuildMappingsList();

  // "+ Add Mapping" button
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add Mapping';
  addBtn.style.cssText = [
    'display:block;width:calc(100% - 16px);margin:6px 8px 4px;',
    'padding:4px 0;border-radius:4px;font-size:0.68rem;cursor:pointer;',
    'border:1px solid var(--bg-surface-border);background:transparent;',
    'color:var(--text-muted);transition:border-color 0.15s,color 0.15s;',
  ].join('');
  addBtn.addEventListener('mouseenter', () => { addBtn.style.borderColor = 'var(--accent)'; addBtn.style.color = 'var(--accent)'; });
  addBtn.addEventListener('mouseleave', () => { addBtn.style.borderColor = 'var(--bg-surface-border)'; addBtn.style.color = 'var(--text-muted)'; });
  addBtn.addEventListener('click', () => {
    const used = reactor.mappings.map(m => m.param);
    reactor.mappings.push(defaultMapping(used));
    reactor.saveMappings();
    rebuildMappingsList();
  });
  mappingsSection.appendChild(addBtn);
  container.appendChild(mappingsSection);
```

- [ ] **Step 9.2 — Verify build succeeds**

Run: `cd "C:/Users/Heysoos/Documents/Pycharm Projects/website" && npm run build 2>&1 | tail -20`

Expected: build succeeds.

- [ ] **Step 9.3 — Commit**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git add src/components/simulations/boids/boids-panel.ts
git commit -m "feat(audio): add mapping rows and Add Mapping button to Audio tab"
```

---

## Task 10: Wire AudioReactor in gallery/[...slug].astro

**Files:**
- Modify: `src/pages/gallery/[...slug].astro`

- [ ] **Step 10.1 — Import AudioReactor at the top of the `<script>` block**

In `src/pages/gallery/[...slug].astro`, inside the `<script>` block, add the import alongside the other boids imports:

```typescript
  import { AudioReactor } from '../../components/simulations/boids/boids-audio';
```

- [ ] **Step 10.2 — Instantiate the reactor and start the mapping rAF loop**

Inside the `if (sim === 'boids')` block, immediately after `const boidsCtrl = controller as BoidsController;`, add:

```typescript
          const reactor = new AudioReactor();

          // Mapping application loop — runs every frame when reactor is active,
          // regardless of which panel tab is visible.
          (function mappingLoop() {
            if (reactor.isActive()) {
              const snapshot = reactor.analyze();
              reactor.applyMappings(boidsCtrl.params, snapshot);
            }
            requestAnimationFrame(mappingLoop);
          })();
```

- [ ] **Step 10.3 — Pass the reactor to buildBoidsPanel**

The `buildPanel` local function inside the `if (sim === 'boids')` block builds the panel. Update it to include `reactor`:

Find:
```typescript
          function buildPanel(activeId?: string): void {
            panel.innerHTML = '';
            buildBoidsPanel(panel, boidsCtrl, {
              presets: BOIDS_PRESETS,
              activePresetId: activeId,
              onClose: () => { panel.style.display = 'none'; panelOpen = false; },
              onShaderEdit: () => {
                shaderEditorOpen = !shaderEditorOpen;
                shaderPanelEl.style.display = shaderEditorOpen ? 'flex' : 'none';
              },
              onPresetLoad: async (preset) => {
                Object.assign(boidsCtrl.params, preset.params);
                boidsCtrl.trailsEnabled = preset.trailsEnabled;
                boidsCtrl.trailDecay = preset.trailDecay;
                await boidsCtrl.reloadShader(preset.shader ?? boidsCtrl.shaderSource);
                buildPanel(preset.id);
              },
            });
          }
```

Add `reactor` to the opts:
```typescript
          function buildPanel(activeId?: string): void {
            panel.innerHTML = '';
            buildBoidsPanel(panel, boidsCtrl, {
              presets: BOIDS_PRESETS,
              activePresetId: activeId,
              reactor,
              onClose: () => { panel.style.display = 'none'; panelOpen = false; },
              onShaderEdit: () => {
                shaderEditorOpen = !shaderEditorOpen;
                shaderPanelEl.style.display = shaderEditorOpen ? 'flex' : 'none';
              },
              onPresetLoad: async (preset) => {
                Object.assign(boidsCtrl.params, preset.params);
                boidsCtrl.trailsEnabled = preset.trailsEnabled;
                boidsCtrl.trailDecay = preset.trailDecay;
                await boidsCtrl.reloadShader(preset.shader ?? boidsCtrl.shaderSource);
                buildPanel(preset.id);
              },
            });
          }
```

- [ ] **Step 10.4 — Verify full build succeeds**

Run: `cd "C:/Users/Heysoos/Documents/Pycharm Projects/website" && npm run build 2>&1 | tail -30`

Expected: build completes with no TypeScript errors. Note the output path — it builds to `dist/`.

- [ ] **Step 10.5 — Commit**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git add src/pages/gallery/[...slug].astro
git commit -m "feat(audio): wire AudioReactor into gallery boids page"
```

---

## Task 11: Browser verification

**Files:** none — browser testing only

- [ ] **Step 11.1 — Start dev server**

Run: `cd "C:/Users/Heysoos/Documents/Pycharm Projects/website" && npm run dev`

Open `http://localhost:4321/gallery/boids` in Chrome or Edge (WebGPU required).

- [ ] **Step 11.2 — Verify tab bar**

Click the settings gear icon. Confirm:
- Three tabs appear: Params / Audio / Image
- Params tab shows all original sliders (Size, Opacity, Shape, Color, Trails, Simulation, Forces, Perception sections)
- Image tab shows image force field controls
- Switching tabs works cleanly with no flicker

- [ ] **Step 11.3 — Verify Audio tab — source UI**

Switch to the Audio tab. Confirm:
- "Microphone" and "System Audio" pills are shown
- Status dot is dim (idle)
- Click Microphone — browser asks for mic permission. Grant it.
- Status dot turns red and pulses; mic pill becomes highlighted
- Click Microphone again — stream stops, status dot returns to dim (toggle off)

- [ ] **Step 11.4 — Verify spectrum visualiser**

With microphone active: make noise near mic. Confirm:
- Spectrum canvas shows animated bars with colour gradient (red bass → blue hi)
- Band meters below the canvas respond live (bass bar rises on low sounds, hi bar rises on high sounds)

- [ ] **Step 11.5 — Verify mapping rows**

Click "+ Add Mapping". Confirm:
- A new row appears with param dropdown, band selector, mode toggle, depth slider, min/max inputs, × remove button
- Changing the param dropdown updates min/max inputs to the new param's natural range
- Clicking band pills changes the highlighted band
- The mode toggle cycles between "+ add" and "× mul"
- Depth slider updates its numeric readout
- × button removes the row

- [ ] **Step 11.6 — Verify live modulation**

With microphone active and a mapping (e.g. bass → Attraction Radius, add, depth 0.8):
- Switch to Params tab — boids attraction radius slider should visibly nudge in sync with bass input
- Make a low sound — boids should cluster more (attraction radius increased)
- Stop mic — sliders return to their base positions

- [ ] **Step 11.7 — Verify persistence**

Add 2–3 mappings. Reload the page. Open the Audio tab. Confirm the mappings are restored.

- [ ] **Step 11.8 — Final commit**

```bash
cd "C:/Users/Heysoos/Documents/Pycharm Projects/website"
git add -A
git commit -m "feat(audio): audio reactivity for boids — complete implementation"
```
