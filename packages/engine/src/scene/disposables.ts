export interface Disposable {
  dispose: () => void;
}

/**
 * A bag of GPU resources owned by one module. three.js never frees geometries, materials or
 * textures on its own, so every module tracks what it allocates here and frees it in one call.
 */
export class Disposables {
  private readonly items = new Set<Disposable>();

  /** Register a resource and hand it back, so creation and tracking stay one expression. */
  track<T extends Disposable>(item: T): T {
    this.items.add(item);
    return item;
  }

  /** Free a single resource early (e.g. a pooled sprite that is removed). */
  release(item: Disposable): void {
    if (this.items.delete(item)) {
      item.dispose();
    }
  }

  dispose(): void {
    for (const item of this.items) {
      item.dispose();
    }
    this.items.clear();
  }
}
