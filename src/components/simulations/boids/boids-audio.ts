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
    try { this.loadMappings(); } catch { /* mappings stay empty until implemented */ }
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
