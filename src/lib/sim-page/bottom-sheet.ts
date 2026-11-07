// src/lib/sim-page/bottom-sheet.ts
// Phone-layout replacement for PanelManager: the params panel is a bottom
// sheet with two open states (peek / expanded) driven by taps and vertical
// swipes on the drag handle. Open/closed is still owned by the page script
// (panel.style.display); this only manages the peek/expanded class.

export const PHONE_LAYOUT_QUERY = '(max-width: 768px)';

export function isPhoneLayout(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PHONE_LAYOUT_QUERY).matches;
}

const TAP_SLOP = 8;      // px of movement still counted as a tap
const SWIPE_MIN = 30;    // px of vertical travel counted as a swipe

export class BottomSheetController {
  private expanded = false;
  private startY = 0;
  private tracking = false;
  private handle: HTMLElement | null;

  constructor(
    private panel: HTMLElement,
    private stateKey: string,
    /** Called on a swipe-down from peek; the page hides the panel. */
    private onClose: () => void,
  ) {
    this.handle = panel.querySelector('.panel-drag-handle');
  }

  init(): void {
    this.panel.classList.add('bottom-sheet');
    this.expanded = sessionStorage.getItem(this.stateKey) === 'expanded';
    this.apply();
    if (!this.handle) return;
    this.handle.addEventListener('pointerdown', this.onDown);
    this.handle.addEventListener('pointermove', this.onMove);
    this.handle.addEventListener('pointerup', this.onUp);
    this.handle.addEventListener('pointercancel', this.onCancel);
  }

  dispose(): void {
    this.panel.classList.remove('bottom-sheet', 'sheet-expanded');
    if (!this.handle) return;
    this.handle.removeEventListener('pointerdown', this.onDown);
    this.handle.removeEventListener('pointermove', this.onMove);
    this.handle.removeEventListener('pointerup', this.onUp);
    this.handle.removeEventListener('pointercancel', this.onCancel);
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    sessionStorage.setItem(this.stateKey, expanded ? 'expanded' : 'peek');
    this.apply();
  }

  private apply(): void {
    this.panel.classList.toggle('sheet-expanded', this.expanded);
  }

  private onDown = (e: PointerEvent): void => {
    this.tracking = true;
    this.startY = e.clientY;
    this.handle?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private onMove = (e: PointerEvent): void => {
    if (this.tracking) e.preventDefault();
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.tracking) return;
    this.tracking = false;
    const dy = e.clientY - this.startY;
    if (Math.abs(dy) <= TAP_SLOP) { this.setExpanded(!this.expanded); return; }
    if (dy <= -SWIPE_MIN) { this.setExpanded(true); return; }
    if (dy >= SWIPE_MIN) {
      if (this.expanded) this.setExpanded(false);
      else { this.onClose(); this.panel.dispatchEvent(new CustomEvent('sheetclose')); }
    }
  };

  private onCancel = (): void => { this.tracking = false; };
}
