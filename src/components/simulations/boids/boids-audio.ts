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

export type AudioMode = 'add' | 'subtract' | 'multiply';
export type AudioSourceKind = 'microphone' | 'system';
export type AudioStatus = 'idle' | 'active' | 'error';

export interface AudioMapping {
  param: keyof BoidsParams;
  band: BandKey;
  mode: AudioMode;
  depth: number;   // 0–1  modulation depth relative to range
  gain: number;    // 0–4  pre-amplifier on the band signal (>1 = boost)
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

const STORAGE_KEY        = 'boids-audio-mappings';
const GLOBAL_STORAGE_KEY = 'boids-audio-global';
const FFT_SIZE           = 2048;

// ── AudioReactor ─────────────────────────────────────────────────────────────

export class AudioReactor {
  mappings: AudioMapping[] = [];
  status: AudioStatus = 'idle';
  lastError = '';
  globalStrength: number = 1.0;
  paramStrengths: Record<string, number> = {};

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private freqData: Uint8Array = new Uint8Array(FFT_SIZE / 2);
  activeSourceKind: AudioSourceKind | null = null;

  constructor() {
    this.loadMappings();
    this.loadGlobal();
  }

  isActive(): boolean {
    return this.status === 'active';
  }

  getSampleRate(): number {
    return this.ctx?.sampleRate ?? 44100;
  }

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
      this.lastError = e instanceof Error ? e.message : String(e);
      this.stop();           // clears resources, resets status to 'idle'
      this.status = 'error'; // override to 'error' so caller sees the problem
      throw e;
    }
  }

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
    this.freqData = new Uint8Array(FFT_SIZE / 2);
    this.status = 'idle';
  }

  private _hzToBin(hz: number): number {
    if (!this.ctx || !this.analyser) return 0;
    return Math.round(hz / (this.ctx.sampleRate / FFT_SIZE));
  }

  private _bandAverage(lo: number, hi: number): number {
    const loB = Math.max(0, this._hzToBin(lo));
    const hiB = Math.min(this.freqData.length - 1, this._hzToBin(hi));
    if (hiB < loB) return 0;
    let sum = 0;
    for (let i = loB; i <= hiB; i++) sum += this.freqData[i];
    return sum / ((hiB - loB + 1) * 255);  // normalise to 0–1
  }

  analyze(): BandSnapshot {
    if (!this.analyser) {
      return { bass: 0, mid: 0, presence: 0, hi: 0, volume: 0 };
    }
    // @ts-ignore: Uint8Array buffer type compat
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
    return this.freqData;
  }

  applyMappings(params: BoidsParams, snapshot: BandSnapshot): void {
    // Take a base snapshot BEFORE any mapping mutates params,
    // so all modulations are relative to the user's slider intent.
    const base = { ...params } as Record<string, number>;

    // Group enabled mappings by param, separated by mode.
    // Multiple mappings may target the same param with different bands.
    const addsByParam = new Map<string, AudioMapping[]>();
    const mulsByParam = new Map<string, AudioMapping[]>();

    for (const m of this.mappings) {
      if (!m.enabled) continue;
      const key = m.param as string;
      if (!PARAM_META[key]) continue;
      if (m.mode === 'add' || m.mode === 'subtract') {
        if (!addsByParam.has(key)) addsByParam.set(key, []);
        addsByParam.get(key)!.push(m);
      } else {
        if (!mulsByParam.has(key)) mulsByParam.set(key, []);
        mulsByParam.get(key)!.push(m);
      }
    }

    const allParams = new Set([...addsByParam.keys(), ...mulsByParam.keys()]);

    for (const param of allParams) {
      const meta = PARAM_META[param];
      if (!meta) continue;
      let val = base[param] as number;

      // Apply all additive/subtractive mappings first
      for (const m of (addsByParam.get(param) ?? [])) {
        const signal = snapshot[m.band] * (m.gain ?? 1);
        const sign   = m.mode === 'subtract' ? -1 : 1;
        val += sign * signal * m.depth * (m.max - m.min);
      }

      // Then apply all multiplicative mappings
      for (const m of (mulsByParam.get(param) ?? [])) {
        const signal = snapshot[m.band] * (m.gain ?? 1);
        val *= (1 + signal * m.depth);
      }

      // Apply per-param and global strength — scale the total modulation delta uniformly
      const pStr = this.paramStrengths[param] ?? 1.0;
      val = (base[param] as number) + (val - (base[param] as number)) * pStr * this.globalStrength;

      // Clamp to param's natural range
      (params as unknown as Record<string, number>)[param] =
        Math.max(meta.min, Math.min(meta.max, val));
    }
  }

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
      const VALID_BANDS = new Set<string>(['bass', 'mid', 'presence', 'hi', 'volume']);
      const VALID_MODES = new Set<string>(['add', 'subtract', 'multiply']);
      this.mappings = parsed.filter(
        m => typeof m.param === 'string'
          && m.param in PARAM_META
          && typeof m.band === 'string'
          && VALID_BANDS.has(m.band)
          && typeof m.mode === 'string'
          && VALID_MODES.has(m.mode)
          && typeof m.depth === 'number'
          && typeof m.min === 'number'
          && typeof m.max === 'number'
          && typeof m.enabled === 'boolean'
      // gain is optional for backward compat with saved mappings that predate this field
      ).map(m => ({ ...m, gain: typeof m.gain === 'number' ? m.gain : 1.0 }));
    } catch {
      this.mappings = [];
    }
  }

  saveGlobal(): void {
    try {
      localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify({
        globalStrength: this.globalStrength,
        paramStrengths: this.paramStrengths,
      }));
    } catch { /* ignore */ }
  }

  loadGlobal(): void {
    try {
      const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { globalStrength?: unknown; paramStrengths?: unknown };
      if (typeof parsed.globalStrength === 'number') {
        this.globalStrength = Math.max(0, Math.min(2, parsed.globalStrength));
      }
      if (parsed.paramStrengths && typeof parsed.paramStrengths === 'object') {
        for (const [k, v] of Object.entries(parsed.paramStrengths as Record<string, unknown>)) {
          if (typeof v === 'number') this.paramStrengths[k] = Math.max(0, Math.min(2, v));
        }
      }
    } catch { /* ignore */ }
  }
}

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
    gain:    1.0,
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
  const sampleRate = reactor.getSampleRate();
  const hzPerBin   = sampleRate / (data.length * 2);

  // Mel-scale spectrum: 64 equal-width bars distributed on the mel scale across
  // 20 Hz–16 kHz.  The mel scale compresses low frequencies more than log2,
  // matching human pitch discrimination and naturally giving fewer bars to the
  // bass region where FFT resolution is sparse (fewer distinct bins).
  // mel(f) = 2595 × log10(1 + f/700)   →   f(mel) = 700 × (10^(mel/2595) − 1)
  const numBars = 64;
  const minHz   = 20;
  const maxHz   = 16000;
  const melMin  = 2595 * Math.log10(1 + minHz / 700);
  const melMax  = 2595 * Math.log10(1 + maxHz / 700);
  const barW    = width / numBars;
  const gap     = Math.max(0, Math.floor(barW * 0.15));

  ctx.globalAlpha = 0.85;
  for (let i = 0; i < numBars; i++) {
    // Each bar spans one equal mel slice; convert back to Hz for bin lookup
    const fLo  = 700 * (Math.pow(10, (melMin + (i       / numBars) * (melMax - melMin)) / 2595) - 1);
    const fHi  = 700 * (Math.pow(10, (melMin + ((i + 1) / numBars) * (melMax - melMin)) / 2595) - 1);
    const binLo = Math.max(0, Math.round(fLo / hzPerBin));
    const binHi = Math.min(data.length - 1, Math.round(fHi / hzPerBin));

    // Average all FFT bins in this bar's range (at least 1 bin always)
    let sum = 0;
    const count = Math.max(1, binHi - binLo + 1);
    for (let b = binLo; b <= binHi; b++) sum += data[b];
    const val = (sum / count) / 255;

    // Band colour determined by the bar's centre frequency
    const hz = (fLo + fHi) / 2;
    let color: string;
    if      (hz < 250)  color = BAND_COLORS.bass;
    else if (hz < 2000) color = BAND_COLORS.mid;
    else if (hz < 6000) color = BAND_COLORS.presence;
    else                color = BAND_COLORS.hi;

    const barH = val * height;
    ctx.fillStyle = color;
    ctx.fillRect(i * barW, height - barH, barW - gap, barH);
  }
  ctx.globalAlpha = 1;
}
