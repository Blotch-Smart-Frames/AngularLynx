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
 * LynxView and the screen. That's all an observer with the browser's defaults
 * asks (the viewport as the root, no root margin, a threshold of 0), so such
 * an observer listens for those two events, and when one comes, measures the
 * element and its scroll containers to fill in the entry: `boundingClientRect`,
 * `intersectionRect`, `intersectionRatio` and `rootBounds`, as the browser's
 * observer reports them.
 *
 * Exposure can't answer for `root`, `rootMargin` or `threshold` (issue #236).
 * Its attributes (`exposure-area`, `exposure-screen-margin-*`) belong to the
 * element, not to one of its observers, and setting them changes when the
 * element's own exposure handlers run. They take one ratio rather than a list,
 * and move the screen's edges rather than a root's. Lynx's native
 * `intersection-observers` attribute takes margins in px only, sends every
 * observer's crossings as the same `intersection` event, and on iOS never sets
 * the root it's given (LynxUIIntersectionObserver.mm). So an observer given
 * any of the three works the crossings out itself, as a browser does. It
 * measures the element, its root and the scroll containers between them, and
 * reports each time the part of the element inside the root (grown by the root
 * margin) crosses a threshold. It measures when the element is laid out, when
 * exposure says the element came or went, and 20 times a second while a
 * scroll container between the element and its root scrolls.
 *
 * Exposure sends nothing for an element that starts off screen, but a
 * browser's observer reports each element once when observing starts,
 * whether it's in view or not: code waits for that entry to stop work on what
 * nobody can see. So once the element has been laid out, the observer
 * measures it, and works out the first entry from those boxes, unless Lynx
 * has said by then.
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
 * the screen. Each with the event it sends as it scrolls, which an observer
 * that measures for itself measures on.
 */
const SCROLL_EVENTS = new Map([
  ['scroll-view', 'bindscroll'],
  ['list', 'bindscroll'],
  ['viewpager', 'bindoffsetchange'],
  ['scroll-coordinator', 'bindoffset'],
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
  /**
   * The last entry's threshold index: how many of the thresholds its ratio
   * reached, and 0 when it wasn't intersecting. Null before the first entry.
   */
  index: number | null;
  /** What the last exposure event said; null before one comes. */
  exposed: boolean | null;
  /**
   * How many exposure events have come: a measurement started for an older
   * one, or for the first entry, gives way to the newest. For an observer
   * that goes by exposure.
   */
  events: number;
  /**
   * For an observer that measures for itself: whether a measurement is under
   * way, and whether to measure again once it answers, as something moved
   * meanwhile.
   */
  measuring: boolean;
  again: boolean;
  /**
   * For an observer that measures for itself: whether the element has had a
   * box. One that can't be measured after that has gone, rather than never
   * had a layout (as the testing library's elements haven't).
   */
  measured: boolean;
  /**
   * For an observer that measures for itself: the scroll containers it
   * listens to, each with what stops it listening.
   */
  scrollListeners: Map<ObservedElement, () => void>;
  /** For an observer that measures for itself: measures the target again. */
  sample: () => void;
};

/** The boxes an entry is worked out from, each null if it couldn't be measured. */
type Geometry = {
  box: LayoutRect | null;
  /**
   * The root's box: the page's (the LynxView's) for an observer with no root.
   * Null if it couldn't be measured, or the element isn't on the page.
   */
  root: LayoutRect | null;
  /** Whether the element is inside the root: on the page, for no root. */
  inRoot: boolean;
  /** The scroll containers between the element and the root. */
  scrollContainers: (LayoutRect | null)[];
  /**
   * The elements whose scrolling moves the element in its root: the scroll
   * containers between them, and the root if it scrolls. A scroll container
   * around the root moves both together.
   */
  scrolledBy: ObservedElement[];
};

/**
 * The measurements under way, by native element, until native answers.
 * Observers that measure together then ask once for the page and each scroll
 * container they share. Native measures when it gets to a request, so an
 * answer shared with a later request is at most a round trip older than its
 * own would have been.
 *
 * On iOS and Android, native answers `boundingClientRect` before the call
 * returns, so nothing is under way for long; and the microtasks queued before
 * the call run before it returns, too, so nothing here is cleared in a
 * microtask (see investigations/lynx-vs-web-differences.md).
 */
const measurements = new Map<unknown, Promise<LayoutRect | null>>();

/**
 * The boxes measured while measuring everything that's scrolling (see
 * sampleScrolling), by native element. Native would measure the page and a
 * shared scroll container the same for each observation, so they're asked for
 * once.
 */
let sampleMeasurements: Map<unknown, Promise<LayoutRect | null>> | null = null;

const measure = (element: ObservedElement): Promise<LayoutRect | null> => {
  const native = element.element;
  const shared = sampleMeasurements?.get(native) ?? measurements.get(native);
  if (shared) return shared;
  let answered = false;
  const rect = new Promise<LayoutRect | null>((resolve) =>
    measureLayout(native, (box) => {
      answered = true;
      measurements.delete(native);
      resolve(box);
    }),
  );
  sampleMeasurements?.set(native, rect);
  // Answered already, as on a device: nothing under way to share.
  if (!answered) measurements.set(native, rect);
  return rect;
};

/**
 * Measures the element, its root (the page it's on, for no root), and the
 * scroll containers between them. The parents are read when measuring
 * starts, not when observing does: a component observing its host in its
 * constructor does so before Angular has put the host on the page.
 */
const measureGeometry = async (
  target: ObservedElement,
  root: ObservedElement | null,
): Promise<Geometry> => {
  const scrollContainers: ObservedElement[] = [];
  let top = target;
  let inRoot = false;
  // Up to the root, or the page and no further: nothing above it is in the
  // LynxView. The testing library's page sits in a jsdom body, whose nodes
  // aren't Lynx elements to walk. An element is never inside itself, as in
  // browsers: observed against itself, it's not intersecting.
  while (!top.isRootPageElement) {
    const parent = top.parentNode();
    if (!parent) break;
    if (parent === root) {
      inRoot = true;
      break;
    }
    if (SCROLL_EVENTS.has(parent.tagName)) scrollContainers.push(parent);
    top = parent;
  }
  if (!root) inRoot = top.isRootPageElement === true;
  const rootElement = root ?? (inRoot ? top : null);
  // Outside its root, nothing between them clips it, or moves it in the root.
  const clips = inRoot ? scrollContainers : [];
  const [box, rootBox, ...scrollBoxes] = await Promise.all([
    measure(target),
    rootElement ? measure(rootElement) : null,
    ...clips.map(measure),
  ]);
  return {
    box: box ?? null,
    root: rootBox ?? null,
    inRoot,
    scrollContainers: scrollBoxes,
    scrolledBy:
      root && inRoot && SCROLL_EVENTS.has(root.tagName)
        ? [...clips, root]
        : clips,
  };
};

/**
 * The part of `a` inside `b`, or null if they don't overlap. Boxes that only
 * touch overlap only if `touching` says so: exposure has it that they don't
 * (CGRectIntersectsRect on iOS), and browsers that they do, with an empty
 * intersection, so an element with no size inside the root is intersecting.
 */
const intersect = (
  a: LayoutRect,
  b: LayoutRect,
  touching: boolean,
): LayoutRect | null => {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  const overlaps = touching
    ? right >= left && bottom >= top
    : right > left && bottom > top;
  return overlaps
    ? { left, top, width: right - left, height: bottom - top }
    : null;
};

/**
 * The part of the element in view, as exposure sees it: inside the LynxView
 * and every scroll container.
 */
const visiblePart = ({
  box,
  root,
  scrollContainers,
}: Geometry): LayoutRect | null => {
  let visible = box;
  for (const clip of [root, ...scrollContainers]) {
    visible = visible && clip ? intersect(visible, clip, false) : null;
  }
  return visible;
};

const area = (rect: LayoutRect): number => rect.width * rect.height;

/**
 * The entry for `target`, for an observer that goes by exposure. Whether
 * it's intersecting is exposure's answer when an event brought it
 * (`exposed`), and the boxes' otherwise.
 */
const exposureEntryFor = (
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

/** One side of a root margin, as given: a length in px, or a percentage. */
type MarginSide = {
  readonly text: string;
  readonly value: number;
  readonly percent: boolean;
};

/** A root margin's four sides: top, right, bottom and left. */
type Margin = readonly MarginSide[];

/**
 * The root's box grown by the root margin; shrunk, for a negative one, but
 * never past nothing. Percentages are of the root's height for the top and
 * bottom, and its width for the sides, as Chromium and WebKit take them.
 */
const grow = (rect: LayoutRect, margin: Margin): LayoutRect => {
  const [top, right, bottom, left] = margin.map((side, index) =>
    side.percent
      ? (side.value * (index % 2 ? rect.width : rect.height)) / 100
      : side.value,
  );
  return {
    left: rect.left - left,
    top: rect.top - top,
    width: Math.max(rect.width + left + right, 0),
    height: Math.max(rect.height + top + bottom, 0),
  };
};

/**
 * How many of the (sorted) thresholds `ratio` has reached. Within a
 * millionth, as WebKit compares them: an intersection's edges, worked out from
 * the boxes' sums, can come out a hair short of the whole element.
 */
const thresholdIndexOf = (
  ratio: number,
  thresholds: readonly number[],
): number => {
  let index = 0;
  while (index < thresholds.length && thresholds[index] <= ratio + 1e-6) {
    index++;
  }
  return index;
};

/**
 * The entry for `target`, for an observer that measures for itself, with its
 * threshold index: what Chromium and WebKit compare to decide whether to
 * report it. Not intersecting is 0, and an element is intersecting only once
 * it has reached a threshold, so one half in view isn't intersecting an
 * observer whose threshold is 1. `exposed` is exposure's answer, for an
 * element that has never had a box to measure.
 */
const measuredEntryFor = (
  target: ObservedElement,
  geometry: Geometry,
  margin: Margin,
  thresholds: readonly number[],
  exposed: boolean | null,
): { entry: LynxIntersectionObserverEntry; index: number } => {
  const { box } = geometry;
  const rootBounds = geometry.root && grow(geometry.root, margin);
  let visible: LayoutRect | null = null;
  let overlaps = false;
  let ratio = 0;
  if (!box) {
    // Never anything to measure: in the testing library, whose elements have
    // no layout (on a device, an element with no UI, which exposure says
    // nothing of either). Exposure's answer, all of it or none of it, so a
    // test's uiappear brings the whole element into view. Gone, after it had
    // a box: none of it.
    overlaps = exposed === true;
    ratio = overlaps ? 1 : 0;
  } else if (geometry.inRoot && rootBounds) {
    visible = box;
    for (const clip of [...geometry.scrollContainers, rootBounds]) {
      visible = visible && clip ? intersect(visible, clip, true) : null;
    }
    if (visible) {
      overlaps = true;
      // As in browsers: an element with no area that's in view is all in view.
      ratio = area(box) === 0 ? 1 : Math.min(area(visible) / area(box), 1);
    }
  }
  const index = overlaps ? thresholdIndexOf(ratio, thresholds) : 0;
  return {
    index,
    entry: {
      target,
      time: performance.now(),
      // The root margin included, as in browsers.
      rootBounds: rootBounds ? toDOMRect(rootBounds) : null,
      boundingClientRect: toDOMRect(box),
      intersectionRect: toDOMRect(visible),
      intersectionRatio: ratio,
      isIntersecting: index > 0,
    },
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
 * The root margin's four sides, in px or %, as the `margin` shorthand spells
 * them.
 */
const rootMarginOf = (margin: string | undefined): Margin => {
  const tokens = String(margin ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length > 4) throw invalidRootMargin();
  const sides = tokens.map((token): MarginSide => {
    const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|%)?$/.exec(token);
    if (!match || (!match[2] && Number(match[1]) !== 0)) {
      throw invalidRootMargin();
    }
    return match[2]
      ? { text: token, value: Number(match[1]), percent: match[2] === '%' }
      : NO_MARGIN;
  });
  const [top = NO_MARGIN, right = top, bottom = top, left = right] = sides;
  return [top, right, bottom, left];
};

const NO_MARGIN: MarginSide = { text: '0px', value: 0, percent: false };

const invalidRootMargin = (): SyntaxError =>
  new SyntaxError(
    "Failed to construct 'IntersectionObserver': rootMargin must be specified in pixels or percent.",
  );

/** How often an observer that measures for itself measures while its element scrolls, in ms: as often as exposure checks. */
const SAMPLE_INTERVAL = 50;

/**
 * How many more times it measures after a scroll event: for 300 ms, longer
 * than the 200 ms a list leaves between its scroll events by default
 * (`scroll-event-throttle`). So it measures right through a list's scroll,
 * and once more where the scroll stops.
 */
const SAMPLES_AFTER_SCROLL = 6;

/**
 * The measurements to redo while something scrolls, each with how many times
 * it's left. All of them on one timer, so the observations measured in a turn
 * share the measurements of their page and scroll containers.
 */
const scrolling = new Map<() => void, number>();
let samplingTimer: ReturnType<typeof setTimeout> | null = null;

const sampleWhileScrolling = (sample: () => void): void => {
  scrolling.set(sample, SAMPLES_AFTER_SCROLL);
  if (samplingTimer === null) {
    samplingTimer = setTimeout(sampleScrolling, SAMPLE_INTERVAL);
  }
};

const sampleScrolling = (): void => {
  samplingTimer = null;
  // Every sample starts measuring before this returns, so they share boxes.
  sampleMeasurements = new Map();
  // A copy, as each sample's count changes as it's taken.
  for (const [sample, left] of Array.from(scrolling)) {
    if (left > 1) scrolling.set(sample, left - 1);
    else scrolling.delete(sample);
    sample();
  }
  sampleMeasurements = null;
  if (scrolling.size && samplingTimer === null) {
    samplingTimer = setTimeout(sampleScrolling, SAMPLE_INTERVAL);
  }
};

const stopSampling = (sample: () => void): void => {
  scrolling.delete(sample);
  if (!scrolling.size && samplingTimer !== null) {
    clearTimeout(samplingTimer);
    samplingTimer = null;
  }
};

/**
 * `IntersectionObserver` for Lynx elements, from their exposure events, or
 * its own measurements when it's given options exposure can't answer for
 * (see the top of this file).
 */
export class LynxIntersectionObserver {
  static readonly forLynxElements = true;
  readonly root: unknown;
  readonly rootMargin: string;
  readonly thresholds: readonly number[];
  readonly #callback: IntersectionCallback;
  readonly #root: ObservedElement | null;
  readonly #margin: Margin;
  /**
   * Whether it's been given a root, a root margin or thresholds, which
   * exposure can't answer for, so it measures for itself.
   */
  readonly #measures: boolean;
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
    if (
      root === undefined ||
      root === null ||
      root === (globalThis as { document?: unknown }).document
    ) {
      this.#root = null;
    } else if (isLynxElement(root)) {
      this.#root = root;
    } else {
      // As browsers say of what's neither: an ElementRef, say, rather than
      // its nativeElement.
      throw new TypeError(
        "Failed to construct 'IntersectionObserver': Failed to read the 'root' property from 'IntersectionObserverInit': The provided value is not of type '(Document or Element)'.",
      );
    }
    this.root = this.#root;
    this.#margin = rootMarginOf(options.rootMargin);
    this.rootMargin = this.#margin.map((side) => side.text).join(' ');
    this.thresholds = thresholdsOf(options.threshold);
    this.#measures =
      this.#root !== null ||
      this.#margin.some((side) => side.value !== 0) ||
      this.thresholds.length !== 1 ||
      this.thresholds[0] !== 0;
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
      this.#exposure(target, observation, true);
    });
    const stopDisappear = target.addEventListener('binduidisappear', () => {
      this.#exposure(target, observation, false);
    });
    // The first entry, once the element has been laid out: before that, it
    // has no box to measure. From an element already laid out and one laid
    // out right after, the one entry. An observer that goes by exposure
    // leaves the later layouts to exposure; one that measures for itself
    // measures each, as a layout that moves or resizes the element can take
    // it across a threshold.
    let laidOut = false;
    const layout = (): void => {
      if (this.#measures) {
        observation.sample();
        return;
      }
      if (laidOut) return;
      laidOut = true;
      stopLayout();
      void this.#report(target, observation, null);
    };
    const stopLayout = target.observeLayout(layout);
    const observation: Observation = {
      stop: () => {
        stopAppear();
        stopDisappear();
        stopLayout();
        for (const stopScroll of observation.scrollListeners.values())
          stopScroll();
        observation.scrollListeners.clear();
        stopSampling(observation.sample);
      },
      index: null,
      exposed: null,
      events: 0,
      measuring: false,
      again: false,
      measured: false,
      scrollListeners: new Map(),
      sample: () => this.#sample(target, observation),
    };
    this.#observed.set(target, observation);
    if (target.layoutRect) queueMicrotask(layout);
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

  #exposure(
    target: ObservedElement,
    observation: Observation,
    exposed: boolean,
  ): void {
    observation.exposed = exposed;
    if (this.#measures) observation.sample();
    else void this.#report(target, observation, exposed);
  }

  /**
   * For an observer that goes by exposure: measures the element and queues
   * its entry, if it says something new. `exposed` is what an exposure event
   * said, or null for the first entry.
   */
  async #report(
    target: ObservedElement,
    observation: Observation,
    exposed: boolean | null,
  ): Promise<void> {
    const event = exposed === null ? 0 : ++observation.events;
    const geometry = await measureGeometry(target, null);
    // Unobserved in the meantime, or a newer event's measurement will report.
    if (this.#observed.get(target) !== observation) return;
    if (observation.events !== event) return;
    const entry = exposureEntryFor(target, geometry, exposed);
    // Browsers report a change, not the same answer twice: exposure's first
    // `uiappear` usually agrees with the first entry.
    const index = entry.isIntersecting ? 1 : 0;
    if (index === observation.index) return;
    observation.index = index;
    this.#queue(entry);
  }

  /**
   * For an observer that measures for itself: measures the element, its
   * root and the scroll containers between them, and queues its entry if
   * it's crossed a threshold. One measurement at a time, and one more if
   * something moved while it was under way, so it never falls behind.
   */
  #sample(target: ObservedElement, observation: Observation): void {
    if (this.#observed.get(target) !== observation) return;
    if (observation.measuring) {
      observation.again = true;
      return;
    }
    observation.measuring = true;
    void measureGeometry(target, this.#root).then((geometry) => {
      observation.measuring = false;
      // Unobserved in the meantime.
      if (this.#observed.get(target) !== observation) return;
      this.#listenForScrolls(observation, geometry.scrolledBy);
      if (geometry.box) observation.measured = true;
      const { entry, index } = measuredEntryFor(
        target,
        geometry,
        this.#margin,
        this.thresholds,
        observation.measured ? null : observation.exposed,
      );
      if (index !== observation.index) {
        observation.index = index;
        this.#queue(entry);
      }
      if (observation.again) {
        observation.again = false;
        observation.sample();
      }
    });
  }

  /**
   * Listens to the scroll containers whose scrolling moves the element in
   * its root, to measure it while they scroll, and stops listening to any
   * it's left.
   */
  #listenForScrolls(
    observation: Observation,
    scrolledBy: readonly ObservedElement[],
  ): void {
    const current = new Set(scrolledBy);
    for (const [scroller, stopScroll] of observation.scrollListeners) {
      if (current.has(scroller)) continue;
      stopScroll();
      observation.scrollListeners.delete(scroller);
    }
    for (const scroller of scrolledBy) {
      if (observation.scrollListeners.has(scroller)) continue;
      const event = SCROLL_EVENTS.get(scroller.tagName) as string;
      observation.scrollListeners.set(
        scroller,
        scroller.addEventListener(event, () => {
          sampleWhileScrolling(observation.sample);
        }),
      );
    }
  }

  #queue(entry: LynxIntersectionObserverEntry): void {
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
