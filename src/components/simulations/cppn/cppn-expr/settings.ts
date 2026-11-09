// Generator taste — per-item weights and complexity — is a device setting
// (localStorage `cppn:generator`), not a preset param: it describes what the
// user likes rolling, not an image. `normalize` is a preset param and is
// never stored here; callers fill it in from the controller.
import { GEN_ITEMS, GEN_PRESETS, type GenSettings, type Weights } from './generator';

export const GEN_SETTINGS_KEY = 'cppn:generator';

export function loadGenSettings(): GenSettings {
  const weights = GEN_PRESETS.default();
  let complexity = 0.5;
  try {
    const raw = localStorage.getItem(GEN_SETTINGS_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as { weights?: Record<string, unknown>; complexity?: unknown };
      if (obj.weights && typeof obj.weights === 'object') {
        for (const k of GEN_ITEMS) {
          const v = obj.weights[k];
          if (typeof v === 'number' && Number.isFinite(v)) weights[k] = Math.min(1, Math.max(0, v));
        }
      }
      if (typeof obj.complexity === 'number' && Number.isFinite(obj.complexity)) complexity = Math.min(1, Math.max(0, obj.complexity));
    }
  } catch { /* storage blocked or corrupt: defaults */ }
  return { weights, complexity, normalize: true };
}

export function saveGenSettings(s: { weights: Weights; complexity: number }): void {
  try {
    localStorage.setItem(GEN_SETTINGS_KEY, JSON.stringify({ weights: s.weights, complexity: s.complexity }));
  } catch { /* session-only */ }
}
