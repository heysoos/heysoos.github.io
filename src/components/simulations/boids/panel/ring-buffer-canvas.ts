export const TRACE_LEN = 256;

export interface RingBufferCanvasOpts {
  /** Called whenever a redraw is needed. Receives buffer data, write pointer, and canvas context. */
  render: (
    ctx:  CanvasRenderingContext2D,
    data: Float32Array,
    ptr:  number,
    cssW: number,
    cssH: number,
    dpr:  number,
  ) => void;
  /** Called on resize with (newCssWidth, newCssHeight). Return updated height or undefined to keep it. */
  onResize?: (cssW: number, cssH: number) => number | undefined;
  initialHeight?: number;
}

export class RingBufferCanvas {
  readonly canvas: HTMLCanvasElement;
  private data:    Float32Array;
  private ptr      = 0;
  private cssH:    number;
  private ro:      ResizeObserver;
  private render:  RingBufferCanvasOpts['render'];
  private onResize?: RingBufferCanvasOpts['onResize'];

  constructor(opts: RingBufferCanvasOpts) {
    const dpr = Math.round(window.devicePixelRatio ?? 1);
    this.render   = opts.render;
    this.onResize = opts.onResize;
    this.cssH     = opts.initialHeight ?? 40;
    this.data     = new Float32Array(TRACE_LEN);

    this.canvas         = document.createElement('canvas');
    this.canvas.height  = Math.round(this.cssH * dpr);
    this.canvas.style.height = `${this.cssH}px`;

    this.ro = new ResizeObserver(() => {
      const dpr = Math.round(window.devicePixelRatio ?? 1);
      const w = this.canvas.clientWidth;
      if (w > 0) this.canvas.width = Math.round(w * dpr);
      const newH = this.onResize?.(w, this.cssH);
      if (newH !== undefined && newH !== this.cssH) {
        this.cssH               = newH;
        this.canvas.height      = Math.round(newH * dpr);
        this.canvas.style.height = `${newH}px`;
      }
      this.draw();
    });
    this.ro.observe(this.canvas);
  }

  push(value: number): void {
    this.data[this.ptr] = value;
    this.ptr = (this.ptr + 1) % TRACE_LEN;
    this.draw();
  }

  pushMultiple(values: Float32Array): void {
    for (let i = 0; i < values.length; i++) {
      this.data[this.ptr] = values[i];
      this.ptr = (this.ptr + 1) % TRACE_LEN;
    }
    this.draw();
  }

  draw(): void {
    const dpr = Math.round(window.devicePixelRatio ?? 1);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    this.render(ctx, this.data, this.ptr, this.canvas.width / dpr, this.canvas.height / dpr, dpr);
  }

  clear(): void {
    this.data.fill(0);
    this.ptr = 0;
    this.draw();
  }

  disconnect(): void {
    this.ro.disconnect();
  }
}

/** Standard waveform trace renderer — used by makeTraceCanvas and makeBandTrace equivalents. */
export function makeTraceRenderer(bandColor: string): RingBufferCanvasOpts['render'] {
  return (ctx, data, ptr, W, H) => {
    const vLen    = Math.min(TRACE_LEN, Math.max(2, W));
    const startOff = TRACE_LEN - vLen;
    let trMin = Infinity, trMax = -Infinity;
    for (let i = 0; i < vLen; i++) {
      const v = data[(ptr + startOff + i) % TRACE_LEN];
      if (v < trMin) trMin = v;
      if (v > trMax) trMax = v;
    }
    if (!isFinite(trMin)) trMin = 0;
    if (!isFinite(trMax)) trMax = 0;
    const currentVal = data[(ptr - 1 + TRACE_LEN) % TRACE_LEN];

    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, 1); ctx.lineTo(W, 1);
    ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1);
    ctx.stroke();

    const innerH = H - 2;
    ctx.strokeStyle  = bandColor;
    ctx.lineWidth    = 1.5;
    ctx.lineCap      = 'round';
    ctx.lineJoin     = 'round';
    ctx.globalAlpha  = 0.9;
    ctx.beginPath();
    if (vLen <= W) {
      for (let x = 0; x < W; x++) {
        const t  = (x / Math.max(1, W - 1)) * (vLen - 1);
        const i0 = Math.floor(t);
        const i1 = Math.min(vLen - 1, i0 + 1);
        const v  = data[(ptr + startOff + i0) % TRACE_LEN] * (1 - (t - i0))
                 + data[(ptr + startOff + i1) % TRACE_LEN] * (t - i0);
        const y  = H - v * innerH - 1;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    } else {
      for (let i = 0; i < vLen; i++) {
        const x = (i / (vLen - 1)) * W;
        const y = H - data[(ptr + startOff + i) % TRACE_LEN] * innerH - 1;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(trMax.toFixed(2), 2, 10);
    ctx.fillText(trMin.toFixed(2), 2, H - 2);
    const tipY   = H - currentVal * innerH - 1;
    const labelY = Math.max(9, Math.min(H - 3, tipY - 5));
    ctx.fillStyle = bandColor;
    ctx.fillText(currentVal.toFixed(2), W - 26, labelY);
  };
}

/** Mini sparkline renderer — used by matrix column traces. */
export function makeMiniRenderer(lineColor: string): RingBufferCanvasOpts['render'] {
  return (ctx, data, ptr, W, H) => {
    const vLen     = Math.min(TRACE_LEN, Math.max(2, Math.round(W)));
    const startOff = TRACE_LEN - vLen;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    for (let i = 0; i < vLen; i++) {
      const x = (i / (vLen - 1)) * W;
      const y = H - data[(ptr + startOff + i) % TRACE_LEN] * H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
}
