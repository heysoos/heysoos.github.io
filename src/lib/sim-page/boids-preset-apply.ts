// src/lib/sim-page/boids-preset-apply.ts
// The one definition of "load a boids preset" and "read the current boids
// state as a preset body". Used by the gallery page, the home-page hero, the
// admin editor and the custom-preset manager, so params, trail settings and
// the shader always travel together.

import type { BoidsController, BoidsParams } from '../../components/simulations/boids/boids-controller';

/** What a boids preset must carry; BoidsPreset (built-in) satisfies this. */
export interface BoidsPresetLike {
  params: BoidsParams;
  trailsEnabled: boolean;
  trailDecay: number;
  /** Full WGSL. Absent means the default shader. */
  shader?: string;
}

/** Same thing as a custom-preset body (open to unknown extra keys). */
export type BoidsPresetBody = BoidsPresetLike & { params: BoidsParams & Record<string, unknown> } & Record<string, unknown>;

const normNl = (s: string) => s.replace(/\r\n?/g, '\n');

export async function applyBoidsPreset(
  ctrl: BoidsController,
  body: BoidsPresetLike,
  setEditorDoc?: (code: string) => void,
): Promise<void> {
  Object.assign(ctrl.params, body.params);
  ctrl.trailsEnabled = body.trailsEnabled;
  ctrl.trailDecay = body.trailDecay;
  const next = body.shader ?? ctrl.defaultShaderSource;
  if (normNl(next) !== normNl(ctrl.shaderSource)) {
    await ctrl.reloadShader(next);
  }
  setEditorDoc?.(next);
}

/**
 * Current state as a body. `baseParams` (from the audio binding) is used
 * when given so audio modulation never reads as a param change.
 * `shader` is included only when it differs from the default, matching how
 * built-in presets are stored.
 */
export function captureBoidsPreset(
  ctrl: BoidsController,
  baseParams?: Record<string, number>,
): BoidsPresetBody {
  const params = { ...(baseParams ?? (ctrl.params as unknown as Record<string, number>)) } as BoidsParams & Record<string, unknown>;
  const body: BoidsPresetBody = {
    params,
    trailsEnabled: ctrl.trailsEnabled,
    trailDecay: ctrl.trailDecay,
  };
  if (normNl(ctrl.shaderSource) !== normNl(ctrl.defaultShaderSource)) body.shader = ctrl.shaderSource;
  return body;
}
