/**
 * `IntersectionObserver` on Lynx's main thread, which has none, so code
 * written for the browser that watches whether an element is on screen runs
 * there too (issue #226): angular-three stops drawing a scene scrolled out of
 * view, a feed loads images as they come into view.
 *
 * Lynx's own answer to "is this element on screen?" is exposure: an element
 * with a `uiappear` or `uidisappear` listener gets one when it comes into view
 * or leaves it (see the `[lynxExposure]` directive). Native checks it about 20
 * times a second, against every scroll container around the element, the
 * LynxView and the screen. So this observer listens for those two events, and
 * when one comes, measures the element and its scroll containers to fill in
 * the entry: `boundingClientRect`, `intersectionRect`, `intersectionRatio` and
 * `rootBounds`, as the browser's observer reports them.
 *
 * Exposure sends nothing for an element that starts off screen, but a
 * browser's observer reports each element once when observing starts,
 * whether it's in view or not: code waits for that entry to stop work on what
 * nobody can see. So once the element has been laid out, the observer
 * measures it, and works out the first entry from those boxes, unless Lynx
 * has said by then.
 *
 * It takes the browser's defaults: the viewport as the root, no root margin,
 * and a threshold of 0, so it reports when any part of the element comes into
 * view and when the last of it leaves. `root`, `rootMargin` and `threshold`
 * are read and kept as browsers keep them, but don't change what it reports
 * yet, and it warns once if they're given.
 *
 * The web preview's main thread, a browser frame, keeps the browser's own,
 * wrapped to take a Lynx element, as `ResizeObserver` is (canvas/dom-globals.ts).
 */
import {
  type LayoutRect,
  type LynxDOMRect,
  measureLayout,
  toDOMRect,
} from './layout';

/**
 * A template's element: a LynxElement, told apart by shape rather than class,
 * so this polyfill, which runs before everything else, doesn't load the
 * element module.
 */
type ObservedElement = {
  readonly element: unknown;
  readonly tagName: string;
  readonly layoutRect: LayoutRect | null;
  readonly isRootPageElement?: boolean;
  addEventListener(
    name: string,
    listener: (event: unknown) => void,
  ): () => void;
  observeLayout(observer: (rect: LayoutRect) => void): () => void;
  parentNode(): ObservedElement | null;
};

const isLynxElement = (value: unknown): value is ObservedElement =>
  typeof value === 'object' &&
  value !== null &&
  'element' in value &&
  typeof (value as ObservedElement).addEventListener === 'function' &&
  typeof (value as ObservedElement).observeLayout === 'function' &&
  typeof (value as ObservedElement).parentNode === 'function';

/**
 * The elements exposure checks an element against, besides the LynxView and
 * the screen: the UIs whose `isScrollContainer` is true on iOS and Android.
 * An element scrolled out of one of them is out of view, wherever it is on
 * the screen.
 */
const SCROLL_CONTAINERS = new Set([
  'scroll-view',
  'list',
  'viewpager',
  'scroll-coordinator',
]);

export type LynxIntersectionObserverEntry = {
  readonly target: unknown;
  readonly time: number;
  readonly rootBounds: LynxDOMRect | null;
  readonly boundingClientRect: LynxDOMRect;
  readonly intersectionRect: LynxDOMRect;
  readonly intersectionRatio: number;
  readonly isIntersecting: boolean;
};

type IntersectionCallback = (
  entries: LynxIntersectionObserverEntry[],
  observer: LynxIntersectionObserver,
) => void;

type IntersectionOptions = {
  root?: unknown;
  rootMargin?: string;
  threshold?: number | readonly number[];
};

/** One target's state in one observer. */
type Observation = {
  /** Removes the listeners observing it added. */
  stop: () => void;
  /** Whether the last entry said it was intersecting; null before the first. */
  intersecting: boolean | null;
  /**
   * How many exposure events have come: a measurement started for an older
   * one, or for the first entry, gives way to the newest.
   */
  events: number;
};

/** The boxes an entry is worked out from, each null if it couldn't be measured. */
type Geometry = {
  box: LayoutRect | null;
  /** The LynxView's: the page's box. Null if the element isn't on the page. */
  root: LayoutRect | null;
  scrollContainers: (LayoutRect | null)[];
};

const measure = (element: ObservedElement): Promise<LayoutRect | null> =>
  new Promise((resolve) => measureLayout(element.element, resolve));

/**
 * Measures the element, the page it's on, and the scroll containers around
 * it. The parents are read when measuring starts, not when observing does:
 * a component observing its host in its constructor does so before Angular
 * has put the host on the page.
 */
const measureGeometry = async (target: ObservedElement): Promise<Geometry> => {
  const scrollContainers: ObservedElement[] = [];
  let top = target;
  // Up to the page and no further: nothing above it is in the LynxView. The
  // testing library's page sits in a jsdom body, whose nodes aren't Lynx
  // elements to walk.
  while (!top.isRootPageElement) {
    const parent = top.parentNode();
    if (!parent) break;
    if (SCROLL_CONTAINERS.has(parent.tagName)) scrollContainers.push(parent);
    top = parent;
  }
  const page = top.isRootPageElement ? top : null;
  const [box, root, ...scrollBoxes] = await Promise.all([
    measure(target),
    page ? measure(page) : null,
    ...scrollContainers.map(measure),
  ]);
  return {
    box: box ?? null,
    root: root ?? null,
    scrollContainers: scrollBoxes,
  };
};

/**
 * The part of `a` inside `b`, or null if they don't overlap. Boxes that only
 * touch don't, as exposure has it (CGRectIntersectsRect on iOS).
 */
const intersect = (a: LayoutRect, b: LayoutRect): LayoutRect | null => {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : null;
};

/**
 * The part of the element in view: inside the LynxView and every scroll
 * container.
 */
const visiblePart = ({
  box,
  root,
  scrollContainers,
}: Geometry): LayoutRect | null => {
  let visible = box;
  for (const clip of [root, ...scrollContainers]) {
    visible = visible && clip ? intersect(visible, clip) : null;
  }
  return visible;
};

const area = (rect: LayoutRect): number => rect.width * rect.height;

/**
 * The entry for `target`. Whether it's intersecting is exposure's answer
 * when an event brought it (`exposed`), and the boxes' otherwise.
 */
const entryFor = (
  target: ObservedElement,
  geometry: Geometry,
  exposed: boolean | null,
): LynxIntersectionObserverEntry => {
  const visible = visiblePart(geometry);
  const isIntersecting = exposed ?? visible !== null;
  const { box } = geometry;
  let intersectionRatio = 0;
  if (isIntersecting) {
    // As in browsers: an element with no area that's in view is all in view.
    intersectionRatio =
      !box || area(box) === 0 ? 1 : visible ? area(visible) / area(box) : 0;
  }
  return {
    target,
    time: performance.now(),
    rootBounds: geometry.root ? toDOMRect(geometry.root) : null,
    boundingClientRect: toDOMRect(box),
    // All zeros when it's not intersecting, as in browsers.
    intersectionRect: toDOMRect(isIntersecting ? visible : null),
    intersectionRatio,
    isIntersecting,
  };
};

/**
 * The thresholds as browsers keep them: sorted, and [0] when none are given.
 */
const thresholdsOf = (
  threshold: number | readonly number[] | undefined,
): readonly number[] => {
  const given =
    threshold === undefined
      ? []
      : Array.isArray(threshold)
        ? threshold.map(Number)
        : [Number(threshold)];
  for (const value of given) {
    if (!(value >= 0 && value <= 1)) {
      throw new RangeError(
        "Failed to construct 'IntersectionObserver': Threshold values must be numbers between 0 and 1",
      );
    }
  }
  return Object.freeze(given.length ? given.sort((a, b) => a - b) : [0]);
};

/**
 * The root margin as browsers keep it: four lengths, in px or %, as the
 * `margin` shorthand spells them.
 */
const rootMarginOf = (margin: string | undefined): string => {
  const tokens = String(margin ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length > 4) throw invalidRootMargin();
  const lengths = tokens.map((token) => {
    const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|%)?$/.exec(token);
    if (!match || (!match[2] && Number(match[1]) !== 0)) {
      throw invalidRootMargin();
    }
    return match[2] ? token : '0px';
  });
  const [top = '0px', right = top, bottom = top, left = right] = lengths;
  return `${top} ${right} ${bottom} ${left}`;
};

const invalidRootMargin = (): SyntaxError =>
  new SyntaxError(
    "Failed to construct 'IntersectionObserver': rootMargin must be specified in pixels or percent.",
  );

const DEFAULT_ROOT_MARGIN = '0px 0px 0px 0px';

let warnedOfOptions = false;

/**
 * Says, once, which of an observer's options it can't honor yet. Once, as a
 * list of a hundred images each with its own observer would say it a hundred
 * times.
 */
const warnOfOptions = (observer: LynxIntersectionObserver): void => {
  if (warnedOfOptions) return;
  const ignored = [
    observer.root !== null && 'root',
    observer.rootMargin !== DEFAULT_ROOT_MARGIN && 'rootMargin',
    (observer.thresholds.length !== 1 || observer.thresholds[0] !== 0) &&
      'threshold',
  ].filter(Boolean);
  if (!ignored.length) return;
  warnedOfOptions = true;
  console.warn(
    `[angular-lynx] IntersectionObserver on Lynx reports when an element comes into view and when it leaves, inside its scroll containers and the screen. It ignores ${ignored.join(', ')} for now.`,
  );
};

/** For tests: lets the next observer with options warn again. */
export const resetIntersectionObserverWarning = (): void => {
  warnedOfOptions = false;
};

/**
 * `IntersectionObserver` for Lynx elements, from their exposure events (see
 * the top of this file).
 */
export class LynxIntersectionObserver {
  static readonly forLynxElements = true;
  readonly root: unknown;
  readonly rootMargin: string;
  readonly thresholds: readonly number[];
  readonly #callback: IntersectionCallback;
  readonly #observed = new Map<ObservedElement, Observation>();
  #records: LynxIntersectionObserverEntry[] = [];
  #delivering = false;

  constructor(
    callback: IntersectionCallback,
    options: IntersectionOptions = {},
  ) {
    if (typeof callback !== 'function') {
      throw new TypeError(
        "Failed to construct 'IntersectionObserver': parameter 1 is not of type 'Function'.",
      );
    }
    this.#callback = callback;
    // A document as the root is the viewport, as no root is.
    const root = options.root;
    this.root =
      root === undefined ||
      root === (globalThis as { document?: unknown }).document
        ? null
        : root;
    this.rootMargin = rootMarginOf(options.rootMargin);
    this.thresholds = thresholdsOf(options.threshold);
    warnOfOptions(this);
  }

  observe(target: unknown): void {
    if (!isLynxElement(target)) {
      throw new TypeError(
        "Failed to execute 'observe' on 'IntersectionObserver': parameter 1 is not of type 'Element'.",
      );
    }
    if (this.#observed.has(target)) return;
    // The listeners also tell Lynx to check the element's exposure: it only
    // checks elements listening for these events (or with an exposure-id).
    // Nothing returned: a handler's result goes back to Lynx's event code.
    // The callbacks below all run later, once `observation` and `stopLayout`
    // are set: an element never calls back as a listener is added.
    const stopAppear = target.addEventListener('binduiappear', () => {
      void this.#report(target, observation, true);
    });
    const stopDisappear = target.addEventListener('binduidisappear', () => {
      void this.#report(target, observation, false);
    });
    // The first entry, once the element has been laid out: before that, it
    // has no box to measure. From an element already laid out and one laid
    // out right after, the one entry.
    let laidOut = false;
    const first = (): void => {
      if (laidOut) return;
      laidOut = true;
      stopLayout();
      void this.#report(target, observation, null);
    };
    const stopLayout = target.observeLayout(first);
    const observation: Observation = {
      stop: () => {
        stopAppear();
        stopDisappear();
        stopLayout();
      },
      intersecting: null,
      events: 0,
    };
    this.#observed.set(target, observation);
    if (target.layoutRect) queueMicrotask(first);
  }

  unobserve(target: unknown): void {
    const observation = this.#observed.get(target as ObservedElement);
    if (!observation) return;
    observation.stop();
    this.#observed.delete(target as ObservedElement);
    // What it would have been told about an element it stopped watching.
    this.#records = this.#records.filter((entry) => entry.target !== target);
  }

  disconnect(): void {
    for (const observation of this.#observed.values()) observation.stop();
    this.#observed.clear();
    this.#records = [];
  }

  /**
   * The entries not yet delivered, which then won't be.
   */
  takeRecords(): LynxIntersectionObserverEntry[] {
    return this.#records.splice(0);
  }

  /**
   * Measures the element and queues its entry, if it says something new.
   * `exposed` is what an exposure event said, or null for the first entry.
   */
  async #report(
    target: ObservedElement,
    observation: Observation,
    exposed: boolean | null,
  ): Promise<void> {
    const event = exposed === null ? 0 : ++observation.events;
    const geometry = await measureGeometry(target);
    // Unobserved in the meantime, or a newer event's measurement will report.
    if (this.#observed.get(target) !== observation) return;
    if (observation.events !== event) return;
    const entry = entryFor(target, geometry, exposed);
    // Browsers report a change, not the same answer twice: exposure's first
    // `uiappear` usually agrees with the first entry.
    if (entry.isIntersecting === observation.intersecting) return;
    observation.intersecting = entry.isIntersecting;
    this.#records.push(entry);
    this.#deliverSoon();
  }

  /**
   * Calls back once with every entry queued by then, as browsers deliver
   * an observer's entries together.
   */
  #deliverSoon(): void {
    if (this.#delivering) return;
    this.#delivering = true;
    queueMicrotask(() => {
      this.#delivering = false;
      const records = this.takeRecords();
      if (records.length) this.#callback.call(this, records, this);
    });
  }
}

/**
 * The browser's `IntersectionObserver` (the web preview's), taking a Lynx
 * element, as a target or the root, for the DOM element it wraps, and
 * reporting it as the entry's target.
 */
const wrapIntersectionObserver = (NativeIntersectionObserver: any) => {
  const toNode = (value: unknown): unknown =>
    isLynxElement(value) ? value.element : value;

  return class LynxWebIntersectionObserver {
    static readonly forLynxElements = true;
    readonly root: unknown;
    readonly #observer: any;
    readonly #targets = new Map<unknown, unknown>();

    constructor(
      callback: (entries: unknown[], observer: unknown) => void,
      options?: IntersectionOptions,
    ) {
      this.root = options?.root ?? null;
      this.#observer = new NativeIntersectionObserver(
        (entries: any[]) =>
          callback(
            entries.map((entry) => this.#entry(entry)),
            this,
          ),
        options && { ...options, root: toNode(options.root) },
      );
    }

    get rootMargin(): string {
      return this.#observer.rootMargin;
    }

    get thresholds(): readonly number[] {
      return this.#observer.thresholds;
    }

    observe(target: unknown): void {
      const node = toNode(target);
      if (node !== target) this.#targets.set(node, target);
      this.#observer.observe(node);
    }

    unobserve(target: unknown): void {
      const node = toNode(target);
      this.#targets.delete(node);
      this.#observer.unobserve(node);
    }

    disconnect(): void {
      this.#targets.clear();
      this.#observer.disconnect();
    }

    takeRecords(): unknown[] {
      return this.#observer
        .takeRecords()
        .map((entry: any) => this.#entry(entry));
    }

    #entry(entry: any): unknown {
      const target = this.#targets.get(entry.target);
      if (!target) return entry;
      return {
        target,
        time: entry.time,
        rootBounds: entry.rootBounds,
        boundingClientRect: entry.boundingClientRect,
        intersectionRect: entry.intersectionRect,
        intersectionRatio: entry.intersectionRatio,
        isIntersecting: entry.isIntersecting,
      };
    }
  };
};

/**
 * Installs `IntersectionObserver` on Lynx's main thread where it's missing,
 * and wraps the web preview's to take Lynx elements.
 */
export const installIntersectionObserver = (
  target: Record<string, any>,
): void => {
  const native = target['IntersectionObserver'];
  if (typeof native === 'undefined') {
    target['IntersectionObserver'] = LynxIntersectionObserver;
  } else if (!native.forLynxElements) {
    target['IntersectionObserver'] = wrapIntersectionObserver(native);
  }
};
