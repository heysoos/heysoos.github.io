export class ResizeObserverPool {
  private observers: ResizeObserver[] = [];

  observe(el: Element, callback: ResizeObserverCallback): ResizeObserver {
    const ro = new ResizeObserver(callback);
    ro.observe(el);
    this.observers.push(ro);
    return ro;
  }

  disconnectAll(): void {
    for (const ro of this.observers) ro.disconnect();
    this.observers = [];
  }
}
