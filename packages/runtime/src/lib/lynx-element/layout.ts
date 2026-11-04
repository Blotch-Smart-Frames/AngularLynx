/**
 * An element's layout, kept from its `layoutchange` events, so code written
 * for the DOM can read it synchronously: `getBoundingClientRect()`,
 * `clientWidth` and friends, and `ResizeObserver`.
 *
 * Lynx lays elements out on its own and has no synchronous layout read on
 * the main thread: the `boundingClientRect` UI method answers later. What it
 * does have is `layoutchange`, which an element with a listener for it fires
 * after each layout that moved or resized it, with its box relative to the
 * LynxView. An element starts listening when something first needs its
 * layout; until the first event arrives (or the UI method answers), the box
 * is empty, as a DOM element's is before it's rendered.
 */

/** An element's box, relative to the LynxView, in px. */
export type LayoutRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** The DOMRect `getBoundingClientRect()` returns. */
export type LynxDOMRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  toJSON(): Omit<LynxDOMRect, 'toJSON'>;
};

export const toDOMRect = (rect: LayoutRect | null): LynxDOMRect => {
  const { left = 0, top = 0, width = 0, height = 0 } = rect ?? {};
  const box = {
    x: left,
    y: top,
    width,
    height,
    top,
    left,
    right: left + width,
    bottom: top + height,
  };
  return { ...box, toJSON: () => ({ ...box }) };
};

/** What the tracker needs from its element. */
export type LayoutHost = {
  /** Adds a listener for one of the element's Lynx events (`bindlayoutchange`). */
  listen(name: string, listener: (event: any) => void): () => void;
  /** Asks native for the element's box now (the `boundingClientRect` UI method). */
  measure(callback: (rect: LayoutRect | null) => void): void;
};

export class LayoutTracker {
  readonly #host: LayoutHost;
  readonly #observers = new Set<(rect: LayoutRect) => void>();
  #listening = false;
  rect: LayoutRect | null = null;

  constructor(host: LayoutHost) {
    this.#host = host;
  }

  /**
   * Listens for the element's layouts from now on. An element already laid
   * out before this won't fire `layoutchange` again until it changes, so the
   * box it has now is asked for too.
   */
  start(): void {
    if (this.#listening) return;
    this.#listening = true;
    this.#host.listen('bindlayoutchange', (event) => {
      const detail = event?.detail;
      if (detail && typeof detail.width === 'number') this.#update(detail);
    });
    this.#host.measure((rect) => {
      // A layoutchange that came first is newer.
      if (rect && !this.rect) this.#update(rect);
    });
  }

  /**
   * Calls `observer` with each new box, from the next layout on.
   */
  observe(observer: (rect: LayoutRect) => void): () => void {
    this.start();
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  #update(detail: LayoutRect): void {
    const rect = {
      left: detail.left,
      top: detail.top,
      width: detail.width,
      height: detail.height,
    };
    const old = this.rect;
    this.rect = rect;
    if (
      old &&
      old.left === rect.left &&
      old.top === rect.top &&
      old.width === rect.width &&
      old.height === rect.height
    ) {
      return;
    }
    // A copy: an observer may stop observing as it's told.
    for (const observer of Array.from(this.#observers)) observer(rect);
  }
}
