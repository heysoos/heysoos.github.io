export class DrawerController {
  private openParam:                 string | null = null;
  private drawerRow:                 HTMLElement | null = null;
  private drawerBody:                HTMLElement | null = null;
  private activeDrawerDisconnects:   Array<() => void> = [];

  open(
    key:          string,
    row:          HTMLElement,
    buildContent: (body: HTMLElement) => Array<() => void>,
  ): void {
    if (this.openParam === key) {
      this.close();
      return;
    }
    this.close();
    this.openParam = key;
    this.drawerRow = row;

    const body = document.createElement('div');
    body.style.cssText = 'padding:6px 8px 8px;display:flex;flex-direction:column;gap:6px;';
    this.activeDrawerDisconnects = buildContent(body);
    this.drawerBody = body;
    row.appendChild(body);
  }

  close(): void {
    if (!this.openParam) return;
    for (const fn of this.activeDrawerDisconnects) fn();
    this.activeDrawerDisconnects = [];
    if (this.drawerBody && this.drawerBody.parentElement) {
      this.drawerBody.parentElement.removeChild(this.drawerBody);
    }
    this.openParam = null;
    this.drawerRow = null;
    this.drawerBody = null;
  }

  isOpen(key: string): boolean {
    return this.openParam === key;
  }

  dispose(): void {
    this.close();
  }
}
