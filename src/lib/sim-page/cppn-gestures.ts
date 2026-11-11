// src/lib/sim-page/cppn-gestures.ts
// Canvas gestures for the CPPN page.
//   touch · one finger      → latent scrub: the oscillation freezes while the
//                             finger is down and the drag moves z along two
//                             random orthonormal directions (x → u, y → v);
//                             on release the motion resumes around the new point
//   touch · two fingers     → pinch zooms the coordinate window about the
//                             midpoint, moving the midpoint pans
//   mouse · drag            → latent scrub
//   mouse · wheel           → zoom about the cursor
//   mouse · alt / middle / space + drag → pan
// A minimap in the corner shows the current window against the original
// frame; it fades when idle. Tap it to reset the view, double-tap to also
// reset the latent offset.

import { themeVar } from './theme-color';
import type { CPPNController } from '../../components/simulations/cppn/cppn-controller';

export interface CPPNGesturesHandle { dispose(): void }

const LATENT_PER_WIDTH = 1.2;   // latent units moved by a drag across the whole canvas width
const WHEEL_K = 0.0016;
const IDLE_MS = 1400;

type Pt = { x: number; y: number; type: string; pan: boolean };

export function attachCPPNGestures(canvas: HTMLCanvasElement, host: HTMLElement, ctrl: CPPNController): CPPNGesturesHandle {
  const pointers = new Map<number, Pt>();
  let gesture: { mx: number; my: number; d: number } | null = null;
  // Set once two fingers are down, cleared when the last one lifts: the finger
  // left behind after a pinch never scrubs the latent (its drift, a few px,
  // would move z, and deep in a zoom that reads as a sudden jump of the view).
  let pinched = false;
  let spaceDown = false;

  // Screen NDC: x right, y down, −1..1 over the canvas rect (matches fragPos).
  const ndc = (x: number, y: number): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((x - r.left) / r.width) * 2 - 1, ((y - r.top) / r.height) * 2 - 1];
  };
  const gestureFrom = (a: Pt, b: Pt) => {
    const [ax, ay] = ndc(a.x, a.y), [bx, by] = ndc(b.x, b.y);
    return { mx: (ax + bx) / 2, my: (ay + by) / 2, d: Math.max(1e-4, Math.hypot(bx - ax, by - ay)) };
  };
  const touches = () => [...pointers.values()].filter(p => !p.pan);

  // ── Minimap ──
  const mini = document.createElement('canvas');
  mini.className = 'cppn-minimap';
  mini.width = 144; mini.height = 144;
  host.appendChild(mini);
  const mctx = mini.getContext('2d')!;
  let idleTimer = 0;
  const wake = () => {
    mini.classList.add('show');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => mini.classList.remove('show'), IDLE_MS);
  };
  function drawMini(): void {
    const W = mini.width, H = mini.height;
    mctx.clearRect(0, 0, W, H);
    // The displayed shape, not the backing store (which can lag a resize or be capped).
    const aspect = canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : canvas.height > 0 ? canvas.width / canvas.height : 1;
    // Two rectangles in world units: the original frame (centre 0, zoom 1)
    // and the current view. The map is scaled and centred so that the union
    // of the two fills 60% of the box: zoomed in, the frame is the reference
    // and the view a box inside it; zoomed out, the view is the reference and
    // the frame shrinks inside it; panned away, both shrink to stay in shot.
    const s = ctrl.config.scale;
    const fx = aspect * s, fy = s;
    const vx = fx / ctrl.viewZoom, vy = fy / ctrl.viewZoom;
    const ux0 = Math.min(-fx, ctrl.viewCx - vx), ux1 = Math.max(fx, ctrl.viewCx + vx);
    const uy0 = Math.min(-fy, ctrl.viewCy - vy), uy1 = Math.max(fy, ctrl.viewCy + vy);
    const k = (0.6 * Math.min(W, H)) / Math.max(ux1 - ux0, uy1 - uy0);
    const cx = W / 2 - ((ux0 + ux1) / 2) * k, cy = H / 2 - ((uy0 + uy1) / 2) * k;
    // Never let a rectangle collapse below a few pixels.
    const rect = (x: number, y: number, hx: number, hy: number): [number, number, number, number] => {
      const w = Math.max(4, 2 * hx * k), h = Math.max(4, 2 * hy * k);
      return [cx + x * k - w / 2, cy + y * k - h / 2, w, h];
    };
    mctx.save();
    const [fX, fY, fW, fH] = rect(0, 0, fx, fy);
    mctx.strokeStyle = themeVar('--text-primary', '#fff', host);
    mctx.globalAlpha = 0.6;
    mctx.lineWidth = 1.5;
    mctx.strokeRect(fX, fY, fW, fH);
    mctx.globalAlpha = 1;
    const [vX, vY, vW, vH] = rect(ctrl.viewCx, ctrl.viewCy, vx, vy);
    const accent = themeVar('--accent', '#e8702a', host);
    mctx.strokeStyle = accent;
    mctx.fillStyle = accent;
    mctx.globalAlpha = 0.3;
    mctx.fillRect(vX, vY, vW, vH);
    mctx.globalAlpha = 1;
    mctx.lineWidth = 2;
    mctx.strokeRect(vX, vY, vW, vH);
    // zoom readout
    mctx.fillStyle = themeVar('--text-primary', '#fff', host);
    mctx.globalAlpha = 0.75;
    mctx.font = '600 15px ui-monospace, Menlo, monospace';
    mctx.textAlign = 'right'; mctx.textBaseline = 'bottom';
    const z = ctrl.viewZoom;
    mctx.fillText(z >= 100 ? `${Math.round(z)}×` : z >= 10 ? `${z.toFixed(1)}×` : `${z.toFixed(2)}×`, W - 8, H - 6);
    mctx.restore();
  }
  ctrl.onViewChange = () => { drawMini(); wake(); };
  drawMini();
  // The first draw can run before layout; redraw whenever the canvas changes shape.
  const miniRO = new ResizeObserver(() => drawMini());
  miniRO.observe(canvas);
  let lastTap = 0;
  mini.addEventListener('pointerdown', (e) => e.stopPropagation());
  mini.addEventListener('click', (e) => {
    e.stopPropagation();
    const now = performance.now();
    ctrl.resetView();
    if (now - lastTap < 350) ctrl.resetLatent();
    lastTap = now;
  });

  // ── Pointer handling ──
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const pan = e.pointerType === 'mouse' && (e.button === 1 || e.altKey || spaceDown);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType, pan });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    const t = touches();
    if (t.length >= 2) { gesture = gestureFrom(t[0], t[1]); pinched = true; }
    ctrl.holdMotion(true);
    if (pan || e.button === 1) e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    const t = touches();
    if (gesture && t.length >= 2) {                     // pinch zoom + two-finger pan
      const g = gestureFrom(t[0], t[1]);
      ctrl.zoomAt(g.d / gesture.d, g.mx, g.my);
      ctrl.panBy(g.mx - gesture.mx, g.my - gesture.my);
      gesture = g;
      return;
    }
    const r = canvas.getBoundingClientRect();
    const dsx = ((e.clientX - px) / r.width) * 2, dsy = ((e.clientY - py) / r.height) * 2;
    if (p.pan) { ctrl.panBy(dsx, dsy); return; }
    if (pointers.size === 1 && !pinched) {               // latent scrub
      ctrl.nudgeLatent((dsx / 2) * LATENT_PER_WIDTH, (-dsy / 2) * LATENT_PER_WIDTH);
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    const t = touches();
    gesture = t.length >= 2 ? gestureFrom(t[0], t[1]) : null;
    if (pointers.size === 0) { ctrl.holdMotion(false); pinched = false; }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [sx, sy] = ndc(e.clientX, e.clientY);
    ctrl.zoomAt(Math.exp(-e.deltaY * WHEEL_K), sx, sy);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return;
    spaceDown = e.type === 'keydown';
    e.preventDefault();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  return {
    dispose() {
      miniRO.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      ctrl.onViewChange = null;
      mini.remove();
    },
  };
}
