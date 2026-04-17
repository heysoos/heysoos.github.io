// src/lib/sim-page/panel-manager.ts

const EDGE = 8; // px proximity to border counted as resize zone

interface PanelState {
  left: number;
  top: number;
  width?: number;
  height?: number;
  hasSize?: boolean;
}

export class PanelManager {
  private dragging = false;
  private dragOX = 0; private dragOY = 0;
  private startL = 0; private startT = 0;

  private resizeZone: string | null = null;
  private rsStartX = 0; private rsStartY = 0;
  private rsStartW = 0; private rsStartH = 0;
  private rsStartLeft = 0; private rsStartTop = 0;
  private rsFixedRight = 0; private rsFixedBottom = 0;

  private onDocMouseMove: (e: MouseEvent) => void;
  private onDocMouseUp: () => void;

  constructor(
    private panel: HTMLElement,
    private viewport: HTMLElement,
    private stateKey: string,
  ) {
    this.onDocMouseMove = (e) => this._onMouseMove(e);
    this.onDocMouseUp   = ()  => this._onMouseUp();
  }

  init(): void {
    this._restoreState();
    this._attachListeners();
  }

  dispose(): void {
    document.removeEventListener('mousemove', this.onDocMouseMove);
    document.removeEventListener('mouseup', this.onDocMouseUp);
  }

  private _saveState(includeSize = false): void {
    const vRect = this.viewport.getBoundingClientRect();
    const pRect = this.panel.getBoundingClientRect();
    if (pRect.width < 50 || pRect.height < 30) return;
    const prev: PanelState = JSON.parse(sessionStorage.getItem(this.stateKey) ?? '{}');
    const state: PanelState = { left: pRect.left - vRect.left, top: pRect.top - vRect.top };
    if (includeSize || prev.hasSize) {
      state.width = pRect.width; state.height = pRect.height; state.hasSize = true;
    }
    sessionStorage.setItem(this.stateKey, JSON.stringify(state));
  }

  private _restoreState(): void {
    const raw = sessionStorage.getItem(this.stateKey);
    if (!raw) return;
    const state: PanelState = JSON.parse(raw);
    const vRect = this.viewport.getBoundingClientRect();
    const panelW = state.width ?? 320;
    const left = Math.max(0, Math.min(state.left, vRect.width  - panelW));
    const top  = Math.max(0, Math.min(state.top,  vRect.height - 80));
    this.panel.style.right = 'auto';
    this.panel.style.left  = `${left}px`;
    this.panel.style.top   = `${top}px`;
    if (state.hasSize && state.width && state.height) {
      this.panel.style.maxHeight = 'none';
      this.panel.style.width     = `${state.width}px`;
      this.panel.style.height    = `${state.height}px`;
    }
  }

  /** Returns 'n','ne','e','se','s','sw','w','nw' if mouse is within EDGE px of that
   *  panel border, or null if inside the content area. */
  private _getResizeZone(e: MouseEvent): string | null {
    const r = this.panel.getBoundingClientRect();
    const x = e.clientX, y = e.clientY;
    const nearTop = y - r.top    < EDGE;
    const nearBot = r.bottom - y < EDGE;
    const nearLft = x - r.left   < EDGE;
    const nearRgt = r.right  - x < EDGE;
    if (nearTop && nearLft) return 'nw';
    if (nearTop && nearRgt) return 'ne';
    if (nearBot && nearLft) return 'sw';
    if (nearBot && nearRgt) return 'se';
    if (nearTop) return 'n';
    if (nearBot) return 's';
    if (nearLft) return 'w';
    if (nearRgt) return 'e';
    return null;
  }

  private _attachListeners(): void {
    const dragHandle = this.panel.querySelector('.panel-drag-handle');
    if (!dragHandle) {
      console.warn('PanelManager: .panel-drag-handle not found — drag disabled');
    } else {
      dragHandle.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        const vRect = this.viewport.getBoundingClientRect();
        const pRect = this.panel.getBoundingClientRect();
        this.panel.style.right = 'auto';
        this.panel.style.left  = `${pRect.left - vRect.left}px`;
        this.panel.style.top   = `${pRect.top  - vRect.top}px`;
        this.dragging = true;
        this.dragOX = e.clientX; this.dragOY = e.clientY;
        this.startL = pRect.left - vRect.left;
        this.startT = pRect.top  - vRect.top;
        document.body.style.userSelect = 'none';
      });
    }

    this.panel.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.dragging || this.resizeZone) return;
      const zone = this._getResizeZone(e);
      this.panel.style.cursor = zone ? `${zone}-resize` : '';
    });
    this.panel.addEventListener('mouseleave', () => {
      if (!this.dragging && !this.resizeZone) this.panel.style.cursor = '';
    });

    this.panel.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.panel-drag-handle')) return;
      const zone = this._getResizeZone(e);
      if (!zone) return;
      e.preventDefault();
      e.stopPropagation();
      const vRect = this.viewport.getBoundingClientRect();
      const pRect = this.panel.getBoundingClientRect();
      this.resizeZone   = zone;
      this.rsStartX     = e.clientX;
      this.rsStartY     = e.clientY;
      this.rsStartW     = pRect.width;
      this.rsStartH     = pRect.height;
      this.rsStartLeft  = pRect.left - vRect.left;
      this.rsStartTop   = pRect.top  - vRect.top;
      this.rsFixedRight  = pRect.right  - vRect.left;
      this.rsFixedBottom = pRect.bottom - vRect.top;
      this.panel.style.right     = 'auto';
      this.panel.style.left      = `${this.rsStartLeft}px`;
      this.panel.style.top       = `${this.rsStartTop}px`;
      this.panel.style.maxHeight = 'none';
      this.panel.style.height    = `${this.rsStartH}px`;
      this.panel.style.cursor    = `${zone}-resize`;
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', this.onDocMouseMove);
    document.addEventListener('mouseup', this.onDocMouseUp);
  }

  private _onMouseMove(e: MouseEvent): void {
    if (this.dragging) {
      const vRect = this.viewport.getBoundingClientRect();
      const pRect = this.panel.getBoundingClientRect();
      const newL = Math.max(0, Math.min(this.startL + e.clientX - this.dragOX, vRect.width  - pRect.width));
      const newT = Math.max(0, Math.min(this.startT + e.clientY - this.dragOY, vRect.height - pRect.height));
      this.panel.style.left = `${newL}px`;
      this.panel.style.top  = `${newT}px`;
      return;
    }
    if (this.resizeZone) {
      const dx = e.clientX - this.rsStartX;
      const dy = e.clientY - this.rsStartY;
      let newW = this.rsStartW, newH = this.rsStartH;
      let newL = this.rsStartLeft, newT = this.rsStartTop;
      if (this.resizeZone.includes('e')) newW = Math.max(200, this.rsStartW + dx);
      if (this.resizeZone.includes('w')) { newW = Math.max(200, this.rsStartW - dx); newL = Math.max(0, this.rsFixedRight - newW); }
      if (this.resizeZone.includes('s')) newH = Math.max(80, this.rsStartH + dy);
      if (this.resizeZone.includes('n')) { newH = Math.max(80, this.rsStartH - dy); newT = Math.max(0, this.rsFixedBottom - newH); }
      this.panel.style.width  = `${newW}px`;
      this.panel.style.height = `${newH}px`;
      this.panel.style.left   = `${newL}px`;
      this.panel.style.top    = `${newT}px`;
    }
  }

  private _onMouseUp(): void {
    if (this.dragging) {
      this.dragging = false;
      document.body.style.userSelect = '';
      this.panel.style.cursor = '';
      this._saveState(false);
      return;
    }
    if (this.resizeZone) {
      this.resizeZone = null;
      document.body.style.userSelect = '';
      this.panel.style.cursor = '';
      this._saveState(true);
    }
  }
}
