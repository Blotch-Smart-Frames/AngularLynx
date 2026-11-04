import { createEvent } from './event';
import {
  dispatchThrough,
  GlobalEventTarget,
  PathDispatch,
} from './event-target';

/**
 * `document` and `window` as event targets, for Lynx's main thread.
 *
 * Angular resolves a `document:` or `body:` host listener's target from the
 * host element's `ownerDocument`, and a `window:` one from its
 * `ownerDocument.defaultView`. Lynx elements had no `ownerDocument`, so a
 * component with a global listener threw "not a function" as it was created.
 * Now a LynxElement's `ownerDocument` is the LynxGlobalDocument below, which
 * is also the `DOCUMENT` token's value and, on iOS and Android, the
 * `document` global. Its `defaultView` is `globalThis`, the `window` global
 * on Lynx, whose listeners are this hub's `window` (see window.ts).
 *
 * Both hear what a browser's document and window do: the events of a touch
 * anywhere on screen (see native-source.ts, and web-source.ts for Lynx for
 * Web), and on the window, `resize` when the LynxView changes size.
 *
 * A browser runs a document's capturing listeners before the touched
 * element's, and its other listeners after them. Lynx runs a `global-bind`
 * listener, which hears a touch wherever it lands, before every other
 * (see "A popover that leaves the screen usable" in
 * investigations/lynx-vs-web-differences.md). So a screen event's dispatch
 * runs in two halves (see PathDispatch): `early()` runs the capturing
 * listeners when the event begins, and `late()` the others when it reaches
 * the page element, the last of the elements it goes through, after the
 * page's own listeners. An event an
 * element's `catch` listener stopped never reaches the page, so its second
 * half runs on the next timer, after every listener of that event.
 */

/** What the hub needs of the page element: its LynxElement. */
export type GlobalEventsPage = {
  /** The native element: a DOM element on Lynx for Web. */
  readonly element: unknown;
  addEventListener(name: string, listener: (event: any) => unknown): () => void;
  /** Adds a listener that runs after the page's others for the event. */
  addTrailingEventListener(
    name: string,
    listener: (event: any) => unknown,
  ): () => void;
};

/** The element wrapper with a unique id, for a screen event's target. */
export type ElementLookup = (uniqueId: number) => object | undefined;

export type ViewportSize = { readonly width: number; readonly height: number };

/** An event to dispatch through the document and window. */
export type Delivery = {
  /** The listeners' type: a Lynx `tap` reaches the ones for `click`. */
  readonly type: string;
  readonly event: any;
  /** The element the event happened on. */
  readonly target: object;
};

/** Where a platform's screen events come from. */
export type ScreenSource = {
  /**
   * Listens on `page` for the events of `types`, and stops listening for
   * the others, or on a page that's gone.
   */
  sync(page: GlobalEventsPage | null, types: ReadonlySet<string>): void;
  /**
   * The LynxView's size now, where it can be read at any time (the web
   * preview). Otherwise it's the last `resized()` one.
   */
  viewport?(): ViewportSize | null;
};

/**
 * The `document` stand-in. Only what code written for the browser reaches
 * for on a document it can't do without: listening, `defaultView`, `body`,
 * and the queries Angular makes of it, which find nothing, as Lynx's
 * elements come from templates.
 */
export class LynxGlobalDocument extends GlobalEventTarget {
  readonly #events: GlobalEvents;

  constructor(events: GlobalEvents) {
    super();
    this.#events = events;
  }

  /**
   * The window, as a document's is: `globalThis` on Lynx.
   */
  get defaultView(): any {
    return this.#events.window.owner;
  }

  /**
   * The page element, which every element is in, as a browser's body is, so
   * a `body:` listener hears the events that bubble up to it. Null until
   * the app's root element is made, as `document.body` is before a page's
   * body is parsed.
   */
  get body(): GlobalEventsPage | null {
    return this.#events.page;
  }

  /**
   * TransferState's root factory calls
   * `inject(DOCUMENT).getElementById(APP_ID + '-state')` to restore the
   * `<script>` Angular SSR inlines. `resource()` and `httpResource()` inject
   * TransferState on construction. Lynx never has that script (AngularLynx
   * SSR hydrates from its own element snapshot), so `null`, "no transferred
   * state", is the right answer, not just a stub.
   */
  getElementById(_id: string): null {
    return null;
  }

  /**
   * Angular's getBaseHrefFromDOM() calls `document.querySelector('base')`.
   * Null makes it fall back to APP_BASE_HREF (see provideRenderer).
   */
  querySelector(_selector: string): null {
    return null;
  }

  querySelectorAll(_selector: string): never[] {
    return [];
  }

  /**
   * A document's event bubbles to its window, as in the DOM.
   */
  override dispatchEvent(event: any): boolean {
    return dispatchThrough(event, this, [this, this.#events.window]);
  }
}

type Pending = { readonly key: unknown; readonly dispatches: PathDispatch[] };

type SystemInfoLike = {
  pixelWidth?: number;
  pixelHeight?: number;
  pixelRatio?: number;
};

/**
 * The screen's size in CSS pixels, from SystemInfo's physical pixels: what
 * `innerWidth` and `innerHeight` are until the LynxView's first layout
 * reports its own.
 */
export const screenViewport = (): ViewportSize => {
  const info =
    (globalThis as { lynx?: { SystemInfo?: SystemInfoLike } }).lynx
      ?.SystemInfo ??
    (globalThis as { SystemInfo?: SystemInfoLike }).SystemInfo;
  const ratio = info?.pixelRatio ?? 1;
  return {
    width: (info?.pixelWidth ?? 0) / ratio,
    height: (info?.pixelHeight ?? 0) / ratio,
  };
};

export class GlobalEvents {
  readonly window: GlobalEventTarget;
  readonly document: LynxGlobalDocument;
  readonly #source: ScreenSource;
  #page: GlobalEventsPage | null = null;
  #lookup: ElementLookup = () => undefined;
  #size: ViewportSize | null = null;
  /** The second halves of screen events still going through elements. */
  #pending: Pending[] = [];

  /**
   * @param windowObject The window, which listeners see as currentTarget:
   *   `globalThis`.
   * @param createSource Makes the platform's ScreenSource.
   */
  constructor(
    windowObject: object,
    createSource: (events: GlobalEvents) => ScreenSource,
  ) {
    this.window = new GlobalEventTarget(windowObject);
    this.document = new LynxGlobalDocument(this);
    this.#source = createSource(this);
    this.window.onTypesChange = () => this.#sync();
    this.document.onTypesChange = () => this.#sync();
  }

  /**
   * Makes `page` the one screen events come from: the root element of the
   * app that was bootstrapped last (see LynxDocument.createRootElement).
   * `lookup` finds the element a touch landed on.
   */
  attach(page: GlobalEventsPage, lookup: ElementLookup): void {
    this.#page = page;
    this.#lookup = lookup;
    this.#sync();
  }

  get page(): GlobalEventsPage | null {
    return this.#page;
  }

  /**
   * The LynxView's size, for `innerWidth` and `innerHeight`.
   */
  get viewport(): ViewportSize | null {
    return this.#source.viewport?.() ?? this.#size;
  }

  /**
   * Whether the document or the window has a listener for `type`.
   */
  hasListeners(type: string): boolean {
    return this.document.hasListeners(type) || this.window.hasListeners(type);
  }

  /**
   * The wrapper of the element with this unique id: a screen event's
   * target. Every touch is on the page, so it's the page when the element
   * has no wrapper, and the document only before there's a page.
   */
  targetFor(uniqueId: number | undefined): object {
    return (
      (uniqueId === undefined ? undefined : this.#lookup(uniqueId)) ??
      this.#page ??
      this.document
    );
  }

  /**
   * A screen event begins: runs the capturing listeners of each delivery,
   * and keeps the others for late(), or the next timer. `key` names the
   * event for late(): its name natively, where each event has its own
   * objects per listener, and the DOM event on the web.
   */
  early(key: unknown, deliveries: Delivery[]): void {
    const dispatches = deliveries.map(
      ({ type, event, target }) =>
        new PathDispatch(event, target, [this.document, this.window], type),
    );
    for (const dispatch of dispatches) dispatch.capture();
    const pending = { key, dispatches };
    this.#pending.push(pending);
    setTimeout(() => this.#finish(pending), 0);
  }

  /**
   * The screen event `key` reached the page: runs its other listeners.
   */
  late(key: unknown): void {
    const pending = this.#pending.find((p) => p.key === key);
    if (pending) this.#finish(pending);
  }

  /**
   * Runs the second halves of the screen events still pending. Natively,
   * one event's listeners all run before the next event begins, so one still
   * pending when the next begins was stopped on its way to the page, and its
   * listeners run before the next one's, in the order the events happened.
   */
  finishPending(): void {
    // A copy: #finish takes each one out of the list.
    for (const pending of this.#pending.slice()) this.#finish(pending);
  }

  /**
   * The LynxView changed size: fires `resize` on the window. Lynx also
   * reports the size after the first layout, which a browser has no event
   * for, so the size `innerWidth` and `innerHeight` already said, the
   * screen's until then, fires nothing.
   */
  resized(size: ViewportSize): void {
    const before = this.#size ?? screenViewport();
    this.#size = size;
    if (before.width === size.width && before.height === size.height) return;
    if (!this.window.hasListeners('resize')) return;
    dispatchThrough(createEvent('resize'), this.window.owner, [this.window]);
  }

  #finish(pending: Pending): void {
    const index = this.#pending.indexOf(pending);
    if (index < 0) return;
    this.#pending.splice(index, 1);
    for (const dispatch of pending.dispatches) dispatch.bubble();
  }

  #sync(): void {
    const types = new Set([...this.document.types, ...this.window.types]);
    this.#source.sync(this.#page, types);
  }
}
