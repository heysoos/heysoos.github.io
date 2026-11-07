// src/lib/sim-page/tilt-sensor.ts
// Phone tilt → in-plane gravity direction, from DeviceOrientationEvent.
//
// Availability is decided in two stages. `tiltMaybeAvailable()` is a cheap
// synchronous guess (the event type exists and the device has a coarse
// pointer) used to decide whether to render a toggle at all; desktops never
// show it. `enable()` then proves it: iOS asks permission (must run inside a
// tap handler), and if no orientation event with real angles arrives within
// a short window the sensor reports 'no-sensor' and disables itself.

export type TiltEnableResult = 'enabled' | 'denied' | 'no-sensor' | 'unsupported';

export interface TiltSensor {
  /** True while events are being delivered to `onDirection`. */
  isEnabled(): boolean;
  enable(): Promise<TiltEnableResult>;
  disable(): void;
  dispose(): void;
}

export interface TiltSensorOpts {
  /** Unit (or shorter, when the phone is near flat) gravity direction in
   *  screen space, y up. Called on every smoothed sample. */
  onDirection: (x: number, y: number) => void;
  /** Called when the sensor turns off, whether by disable() or a failed
   *  enable(), so the owner can restore its default direction. */
  onDisabled?: () => void;
  /** EMA weight of each new sample, 0–1. */
  smoothing?: number;
  /** How long enable() waits for a first real sample. */
  probeMs?: number;
}

interface OrientationEventCtor {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export function tiltMaybeAvailable(): boolean {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return false;
  if (!window.isSecureContext) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

/** Current screen rotation in degrees, 0 when unknown. */
function screenAngle(): number {
  const o = screen.orientation;
  if (o && typeof o.angle === 'number') return o.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

/**
 * Gravity in the device frame, from the W3C alpha/beta/gamma (Z-X'-Y'')
 * convention: g_device = (sin γ cos β, −sin β, −cos β cos γ). The screen is
 * the device x/y plane, so the in-plane part is the first two components.
 * Upright portrait (β = 90°) gives (0, −1); flat on a table gives ~(0, 0).
 */
export function orientationToGravity(betaDeg: number, gammaDeg: number, rotationDeg: number): [number, number] {
  const b = betaDeg * Math.PI / 180;
  const g = gammaDeg * Math.PI / 180;
  let x = Math.sin(g) * Math.cos(b);
  let y = -Math.sin(b);
  // The sensor frame is the device's natural portrait frame; undo the
  // screen rotation so the vector is in the current screen's frame.
  if (rotationDeg) {
    const r = -rotationDeg * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  return [x, y];
}

export function createTiltSensor(opts: TiltSensorOpts): TiltSensor {
  const smoothing = opts.smoothing ?? 0.25;
  const probeMs = opts.probeMs ?? 1500;
  let enabled = false;
  let sx = 0, sy = 0, primed = false;
  let gotSample: (() => void) | null = null;

  const onEvent = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null) return;
    const [x, y] = orientationToGravity(e.beta, e.gamma, screenAngle());
    if (!primed) { sx = x; sy = y; primed = true; }
    else { sx += (x - sx) * smoothing; sy += (y - sy) * smoothing; }
    opts.onDirection(sx, sy);
    gotSample?.();
  };

  function stopListening(): void {
    window.removeEventListener('deviceorientation', onEvent);
    enabled = false;
    primed = false;
    gotSample = null;
  }

  async function enable(): Promise<TiltEnableResult> {
    if (enabled) return 'enabled';
    if (!('DeviceOrientationEvent' in window)) return 'unsupported';
    const ctor = DeviceOrientationEvent as unknown as OrientationEventCtor;
    if (typeof ctor.requestPermission === 'function') {
      let state: 'granted' | 'denied';
      try { state = await ctor.requestPermission(); }
      catch { state = 'denied'; }
      if (state !== 'granted') { opts.onDisabled?.(); return 'denied'; }
    }
    enabled = true;
    const probe = new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), probeMs);
      gotSample = () => { window.clearTimeout(timer); resolve(true); };
    });
    window.addEventListener('deviceorientation', onEvent);
    const ok = await probe;
    gotSample = null;
    if (!ok) { stopListening(); opts.onDisabled?.(); return 'no-sensor'; }
    return 'enabled';
  }

  function disable(): void {
    if (!enabled) return;
    stopListening();
    opts.onDisabled?.();
  }

  return {
    isEnabled: () => enabled,
    enable,
    disable,
    dispose: () => { if (enabled) stopListening(); },
  };
}
