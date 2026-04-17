export class DrawerController {
  private openParam:               string | null = null;
  private activeDrawerDisconnects: Array<() => void> = [];

  open(
    key:          string,
    buildContent: () => Array<() => void>,
  ): void {
    if (this.openParam === key) {
      this.close();
      return;
    }
    this.close();
    this.openParam = key;
    this.activeDrawerDisconnects = buildContent();
  }

  close(): void {
    if (!this.openParam) return;
    for (const fn of this.activeDrawerDisconnects) fn();
    this.activeDrawerDisconnects = [];
    this.openParam = null;
  }

  isOpen(key: string): boolean {
    return this.openParam === key;
  }

  dispose(): void {
    this.close();
  }
}
