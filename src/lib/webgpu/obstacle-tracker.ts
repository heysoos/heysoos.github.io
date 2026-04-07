// src/lib/webgpu/obstacle-tracker.ts
//
// Tracks DOM elements as obstacle zones and converts their viewport rects
// to NDC coordinates for GPU consumption.
//
// NDC conversion (x: -1 left → +1 right, y: -1 bottom → +1 top):
//   cx = (rect.left + rect.right)  / innerWidth  - 1
//   cy = 1 - (rect.top + rect.bottom) / innerHeight
//   hw = rect.width  / innerWidth
//   hh = rect.height / innerHeight

const MAX_OBSTACLES = 16;

export class ObstacleTracker {
  private selectors: string[];
  private onUpdate: (rects: Float32Array, count: number) => void;
  private elements: Element[] = [];
  private visibleSet = new Set<Element>();
  private intersectionObserver: IntersectionObserver | null = null;
  private dirty = false;
  private rafId = 0;
  private running = false;
  private boundScroll: () => void;
  private boundResize: () => void;

  constructor(
    selectors: string[],
    onUpdate: (rects: Float32Array, count: number) => void,
  ) {
    this.selectors = selectors;
    this.onUpdate = onUpdate;
    this.boundScroll = () => { this.dirty = true; };
    this.boundResize = () => { this.dirty = true; };
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Collect all matching elements
    this.elements = this.selectors.flatMap((sel) =>
      Array.from(document.querySelectorAll(sel))
    );

    // IntersectionObserver to track which elements are in the viewport
    this.intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          this.visibleSet.add(entry.target);
        } else {
          this.visibleSet.delete(entry.target);
        }
      }
      this.dirty = true;
    });

    for (const el of this.elements) {
      this.intersectionObserver.observe(el);
    }

    window.addEventListener('scroll', this.boundScroll, { passive: true });
    window.addEventListener('resize', this.boundResize, { passive: true });

    // Initial update
    this.dirty = true;
    this._loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    window.removeEventListener('scroll', this.boundScroll);
    window.removeEventListener('resize', this.boundResize);
    this.elements = [];
    this.visibleSet.clear();
  }

  private _loop = (): void => {
    if (!this.running) return;
    if (this.dirty) {
      this.dirty = false;
      this._flush();
    }
    this.rafId = requestAnimationFrame(this._loop);
  };

  private _flush(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w <= 0 || h <= 0) return;  // viewport not ready
    const rects = new Float32Array(MAX_OBSTACLES * 4);
    let count = 0;

    for (const el of this.visibleSet) {
      if (count >= MAX_OBSTACLES) break;
      const r = el.getBoundingClientRect();
      const cx = (r.left + r.right)  / w - 1.0;
      const cy = 1.0 - (r.top + r.bottom) / h;
      const hw = r.width  / w;
      const hh = r.height / h;
      rects[count * 4 + 0] = cx;
      rects[count * 4 + 1] = cy;
      rects[count * 4 + 2] = hw;
      rects[count * 4 + 3] = hh;
      count++;
    }

    this.onUpdate(rects, count);
  }
}
