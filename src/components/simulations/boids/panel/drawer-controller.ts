export class DrawerController {
  private openParam:                 string | null = null;
  private drawerRow:                 HTMLElement | null = null;
  private activeDrawerDisconnects:   Array<() => void> = [];

  /**
   * Opens a drawer row for the given param key.
   * @param key - param identifier (e.g. 'attraction')
   * @param row - the matrix row element to inject the drawer body into
   * @param buildContent - called to populate the drawer body element; returns disconnect fns
   */
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
    row.appendChild(body);
  }

  close(): void {
    if (!this.openParam) return;
    for (const fn of this.activeDrawerDisconnects) fn();
    this.activeDrawerDisconnects = [];
    // Remove the injected drawer body (last child of row)
    if (this.drawerRow) {
      const body = this.drawerRow.lastElementChild;
      if (body && body !== this.drawerRow.firstElementChild) {
        this.drawerRow.removeChild(body);
      }
    }
    this.openParam = null;
    this.drawerRow = null;
  }

  isOpen(key: string): boolean {
    return this.openParam === key;
  }

  dispose(): void {
    this.close();
  }
}
