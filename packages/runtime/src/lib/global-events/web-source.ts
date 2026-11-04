import type {
  GlobalEvents,
  GlobalEventsPage,
  ScreenSource,
  ViewportSize,
} from './global-events';

/**
 * Screen events on Lynx for Web (see global-events.ts): the browser's own,
 * as an element's pointer listeners get them there (see pointer-events.ts).
 *
 * The screen is the `<lynx-view>`. Its elements are DOM elements in its
 * shadow tree, so a listener on the shadow root hears all their events: its
 * capturing listener begins each one, before the page element's own
 * listeners, and its bubbling listener ends it, after them (see
 * GlobalEvents.early and late), as a browser's document's run around its
 * body's. web-core never stops a DOM event: it runs the Lynx listeners from
 * one capturing listener on its root, so only a DOM listener of the app's
 * own can keep one from bubbling up.
 *
 * The main thread runs in a hidden iframe web-core puts in that shadow root
 * (createIFrameRealm), whose own size is zero, so its `frameElement` leads to
 * the `<lynx-view>` even before the page element is laid out in it. The
 * `<lynx-view>`'s size is `innerWidth` and `innerHeight`, and its changes
 * fire `resize`. Key events go to the focused element, which is outside the
 * LynxView unless it's an input of the app's, so they're heard on the
 * page's document, as web-core hears them.
 */

const KEY_EVENTS = new Set(['keydown', 'keyup', 'keypress']);

/** Where the screen's events are heard, and the box that is the screen. */
type Scope = { readonly root: Node; readonly box: Element };

export class WebScreenSource implements ScreenSource {
  readonly #events: GlobalEvents;
  #page: GlobalEventsPage | null = null;
  /** The listeners on the screen, by the event type they're for. */
  readonly #listening = new Map<string, () => void>();

  constructor(events: GlobalEvents) {
    this.#events = events;
  }

  sync(page: GlobalEventsPage | null, types: ReadonlySet<string>): void {
    if (page !== this.#page) {
      this.#stop([...this.#listening.keys()]);
      this.#page = page;
    }
    const scope = this.#scope();
    if (!scope) return;
    this.#stop([...this.#listening.keys()].filter((t) => !types.has(t)));
    for (const type of types) {
      if (this.#listening.has(type)) continue;
      this.#listening.set(
        type,
        type === 'resize'
          ? this.#observeSize(scope.box)
          : this.#listen(scope, type),
      );
    }
  }

  viewport(): ViewportSize | null {
    const rect = this.#scope()?.box.getBoundingClientRect();
    return rect ? { width: rect.width, height: rect.height } : null;
  }

  /**
   * The `<lynx-view>`'s shadow root and the `<lynx-view>`, found from the
   * main thread's iframe or, where there's none (tests), the page element.
   */
  #scope(): Scope | null {
    const frame = (globalThis as { frameElement?: Element | null })
      .frameElement;
    const inside = frame ?? (this.#page?.element as Element | undefined);
    if (!inside) return null;
    const root = inside.getRootNode();
    return { root, box: (root as ShadowRoot).host ?? inside };
  }

  #listen({ root, box }: Scope, type: string): () => void {
    const target: EventTarget = KEY_EVENTS.has(type) ? box.ownerDocument : root;
    const begin = (event: Event) =>
      this.#events.early(event, [{ type, event, target: event.target! }]);
    const end = (event: Event) => this.#events.late(event);
    target.addEventListener(type, begin, true);
    target.addEventListener(type, end);
    return () => {
      target.removeEventListener(type, begin, true);
      target.removeEventListener(type, end);
    };
  }

  /**
   * Fires `resize` when the `<lynx-view>` changes size. Its window's
   * ResizeObserver, not the main thread's (see dom-globals.ts).
   */
  #observeSize(box: Element): () => void {
    const view = box.ownerDocument.defaultView as typeof globalThis;
    let last: ViewportSize | null = null;
    const observer = new view.ResizeObserver(() => {
      const size = this.viewport()!;
      if (last && last.width === size.width && last.height === size.height) {
        return;
      }
      // The first report is the size observing started at, not a change.
      const first = last === null;
      last = size;
      if (!first) this.#events.resized(size);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }

  #stop(types: string[]): void {
    for (const type of types) {
      this.#listening.get(type)!();
      this.#listening.delete(type);
    }
  }
}
