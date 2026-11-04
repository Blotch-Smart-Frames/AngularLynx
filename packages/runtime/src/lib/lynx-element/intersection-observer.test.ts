import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installIntersectionObserver,
  LynxIntersectionObserver,
} from './intersection-observer';
import type { LayoutRect } from './layout';

/** Each native element's box, as the boundingClientRect UI method answers. */
const boxes = new Map<object, LayoutRect | null>();

type FakeElement = ReturnType<typeof element>;

/**
 * A Lynx element, as the observer tells one apart: by shape. Its exposure
 * events and layouts are fired by hand.
 */
const element = (
  tagName = 'view',
  box: LayoutRect | null = null,
  parent: FakeElement | null = null,
) => {
  const native = { tagName };
  boxes.set(native, box);
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const layoutObservers = new Set<(rect: LayoutRect) => void>();
  const fake = {
    element: native,
    tagName,
    layoutRect: null as LayoutRect | null,
    isRootPageElement: tagName === 'page',
    parent,
    addEventListener: vi.fn(
      (name: string, listener: (event: unknown) => void) => {
        const set = listeners.get(name) ?? new Set();
        listeners.set(name, set);
        set.add(listener);
        return () => set.delete(listener);
      },
    ),
    observeLayout: vi.fn((observer: (rect: LayoutRect) => void) => {
      layoutObservers.add(observer);
      return () => layoutObservers.delete(observer);
    }),
    parentNode(): FakeElement | null {
      return fake.parent;
    },
    /** Fires one of the element's Lynx events. */
    fire(name: string) {
      for (const listener of Array.from(listeners.get(name) ?? [])) {
        expect(listener({ detail: {} })).toBeUndefined();
      }
    },
    /**
     * Lays the element out at `rect`, where native then measures it, unless
     * it measures `measured` (null: it can't).
     */
    layout(rect: LayoutRect, measured: LayoutRect | null = rect) {
      boxes.set(native, measured);
      fake.layoutRect = rect;
      for (const observer of Array.from(layoutObservers)) observer(rect);
    },
    move(rect: LayoutRect | null) {
      boxes.set(native, rect);
    },
    listening: (name: string) => listeners.get(name)?.size ?? 0,
    layoutObservers,
  };
  return fake;
};

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
});

/**
 * A page the size of the LynxView: 400 × 800.
 */
const page = () => element('page', rect(0, 0, 400, 800));

/**
 * Lets the measurements answer and the observer call back.
 */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/**
 * How many times native has been asked for `fake`'s box.
 */
const measurements = (fake: FakeElement) =>
  vi
    .mocked(
      (globalThis as unknown as { __InvokeUIMethod: (n: object) => void })
        .__InvokeUIMethod,
    )
    .mock.calls.filter(([native]) => native === fake.element).length;

beforeEach(() => {
  boxes.clear();
  // Answers asynchronously, as native does.
  vi.stubGlobal(
    '__InvokeUIMethod',
    vi.fn(
      (
        native: object,
        method: string,
        _params: unknown,
        callback: (result: { code: number; data?: unknown }) => void,
      ) => {
        expect(method).toBe('boundingClientRect');
        const box = boxes.get(native);
        queueMicrotask(() =>
          callback(box ? { code: 0, data: box } : { code: 2 }),
        );
      },
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('IntersectionObserver on Lynx', () => {
  it('reports an element coming into view and leaving it, from its exposure events', async () => {
    const target = element('view', rect(0, 900, 400, 200), page());
    const callback = vi.fn();
    const observer = new LynxIntersectionObserver(callback);
    observer.observe(target);
    observer.observe(target);
    expect(target.listening('binduiappear')).toBe(1);
    expect(target.listening('binduidisappear')).toBe(1);

    // Scrolled half into view.
    target.move(rect(0, 700, 400, 200));
    target.fire('binduiappear');
    await settle();
    expect(callback).toHaveBeenCalledOnce();
    const [[entries, which]] = callback.mock.calls;
    expect(which).toBe(observer);
    expect(callback.mock.contexts[0]).toBe(observer);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      target,
      isIntersecting: true,
      intersectionRatio: 0.5,
      boundingClientRect: { x: 0, y: 700, width: 400, height: 200 },
      intersectionRect: { x: 0, y: 700, width: 400, height: 100 },
      rootBounds: { x: 0, y: 0, width: 400, height: 800 },
    });
    expect(typeof entries[0].time).toBe('number');

    target.move(rect(0, 1000, 400, 200));
    target.fire('binduidisappear');
    await settle();
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[1][0][0]).toMatchObject({
      isIntersecting: false,
      intersectionRatio: 0,
      intersectionRect: { x: 0, y: 0, width: 0, height: 0 },
    });
  });

  it('reports each element once when observing starts, once it has been laid out', async () => {
    const root = page();
    const above = element('view', null, root);
    const below = element('view', null, root);
    const callback = vi.fn();
    const observer = new LynxIntersectionObserver(callback);
    observer.observe(above);
    observer.observe(below);
    await settle();
    // Nothing to measure before a layout.
    expect(callback).not.toHaveBeenCalled();

    above.layout(rect(0, 0, 400, 100));
    below.layout(rect(0, 900, 400, 100));
    await settle();
    expect(callback).toHaveBeenCalledOnce();
    const [[entries]] = callback.mock.calls;
    expect(
      entries.map((entry: any) => [entry.target, entry.isIntersecting]),
    ).toEqual([
      [above, true],
      [below, false],
    ]);
    expect(entries[0].intersectionRatio).toBe(1);
    // Later layouts are exposure's to report.
    expect(above.layoutObservers.size).toBe(0);
    above.layout(rect(0, 50, 400, 100));
    // Lynx agrees the element is in view: nothing new.
    above.fire('binduiappear');
    await settle();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('reports an element already laid out when observing starts', async () => {
    const target = element('view', null, page());
    target.layout(rect(0, 0, 10, 10));
    const callback = vi.fn();
    new LynxIntersectionObserver(callback).observe(target);
    // And laid out again straight away: still the one first entry.
    target.layout(rect(0, 0, 10, 20));
    expect(callback).not.toHaveBeenCalled();
    await settle();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0][0].isIntersecting).toBe(true);
  });

  it('takes Lynx’s answer over the boxes when an exposure event comes first', async () => {
    const target = element('view', null, page());
    const callback = vi.fn();
    new LynxIntersectionObserver(callback).observe(target);
    // Laid out off the page, as far as the boxes go, but Lynx says it's in
    // view, and its event comes before the first measurement answers.
    target.layout(rect(0, 900, 400, 100));
    target.fire('binduiappear');
    await settle();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0][0]).toMatchObject({
      isIntersecting: true,
      intersectionRatio: 0,
    });
  });

  it('reports the newest of events that come close together', async () => {
    const target = element('view', rect(0, 0, 10, 10), page());
    const callback = vi.fn();
    new LynxIntersectionObserver(callback).observe(target);
    target.fire('binduiappear');
    target.fire('binduidisappear');
    await settle();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0][0].isIntersecting).toBe(false);
  });

  it('measures against the scroll containers around the element', async () => {
    const root = page();
    // A scroll-view in the top half of the page, inside a plain view.
    const scroller = element('scroll-view', rect(0, 0, 400, 400), root);
    const wrapper = element('view', rect(0, 0, 400, 2000), scroller);
    // A quarter of it shows at the bottom of the scroll-view.
    const target = element('view', rect(0, 300, 400, 400), wrapper);
    const callback = vi.fn();
    new LynxIntersectionObserver(callback).observe(target);
    target.layout(rect(0, 300, 400, 400));
    await settle();
    expect(callback.mock.calls[0][0][0]).toMatchObject({
      isIntersecting: true,
      intersectionRatio: 0.25,
      intersectionRect: { x: 0, y: 300, width: 400, height: 100 },
    });

    // Below the scroll-view's bottom, though on the page.
    const hidden = element('view', null, wrapper);
    const second = vi.fn();
    new LynxIntersectionObserver(second).observe(hidden);
    hidden.layout(rect(0, 500, 400, 100));
    await settle();
    expect(second.mock.calls[0][0][0].isIntersecting).toBe(false);
  });

  it('counts an element that only touches the view, or has no size, as out of it', async () => {
    const touching = element('view', null, page());
    const empty = element('view', null, page());
    const callback = vi.fn();
    const observer = new LynxIntersectionObserver(callback);
    observer.observe(touching);
    observer.observe(empty);
    touching.layout(rect(0, 800, 400, 100));
    empty.layout(rect(0, 0, 0, 0));
    await settle();
    expect(
      callback.mock.calls[0][0].map((entry: any) => entry.isIntersecting),
    ).toEqual([false, false]);

    // Lynx reporting one with no size in view: all of it is, as browsers say.
    empty.fire('binduiappear');
    await settle();
    expect(callback.mock.calls[1][0][0].intersectionRatio).toBe(1);
  });

  it('reports an element off the page, or that can’t be measured, as out of view', async () => {
    const detached = element(
      'view',
      null,
      element('view', rect(0, 0, 400, 800)),
    );
    const unmeasured = element('view', null, page());
    const callback = vi.fn();
    const observer = new LynxIntersectionObserver(callback);
    observer.observe(detached);
    observer.observe(unmeasured);
    detached.layout(rect(0, 0, 10, 10));
    unmeasured.layout(rect(0, 0, 10, 10), null);
    await settle();
    const [[entries]] = callback.mock.calls;
    expect(entries[0]).toMatchObject({
      isIntersecting: false,
      rootBounds: null,
    });
    expect(entries[1]).toMatchObject({
      isIntersecting: false,
      boundingClientRect: { width: 0, height: 0 },
    });

    // Lynx saying it's in view, with nothing to measure: all of it is.
    unmeasured.fire('binduiappear');
    await settle();
    expect(callback.mock.calls[1][0][0]).toMatchObject({
      isIntersecting: true,
      intersectionRatio: 1,
    });
  });

  it('observes the page itself', async () => {
    const root = page();
    // Whatever holds the page (the testing library's jsdom body) isn't
    // walked: its parent would never be asked for.
    root.parent = {
      ...element('view', rect(0, 0, 1, 1)),
      parentNode: () => {
        throw new Error('walked past the page');
      },
    };
    const callback = vi.fn();
    new LynxIntersectionObserver(callback).observe(root);
    root.layout(rect(0, 0, 400, 800));
    await settle();
    expect(callback.mock.calls[0][0][0].isIntersecting).toBe(true);
  });

  it('stops reporting an element it no longer observes', async () => {
    const root = page();
    const first = element('view', rect(0, 0, 10, 10), root);
    const second = element('view', rect(0, 0, 10, 10), root);
    const callback = vi.fn();
    // Another observer of `second`, called back first, which stops
    // `observer` watching it with the entry for it queued (see the
    // takeRecords() test).
    const before = new LynxIntersectionObserver(() => {
      observer.unobserve(second);
      observer.unobserve(second);
      observer.unobserve({});
    });
    before.observe(second);
    const observer = new LynxIntersectionObserver(callback);
    observer.observe(first);
    observer.observe(second);

    // Unobserved while measuring.
    first.fire('binduiappear');
    observer.unobserve(first);
    second.fire('binduiappear');
    await settle();
    expect(callback).not.toHaveBeenCalled();
    expect(first.listening('binduiappear')).toBe(0);
    expect(first.listening('binduidisappear')).toBe(0);
    expect(first.layoutObservers.size).toBe(0);

    // Observed again, it's reported afresh.
    observer.observe(first);
    first.fire('binduiappear');
    await settle();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('stops reporting anything once disconnected', async () => {
    const target = element('view', rect(0, 0, 10, 10), page());
    const callback = vi.fn();
    // Disconnected with an entry queued (see the takeRecords() test).
    const before = new LynxIntersectionObserver(() => observer.disconnect());
    before.observe(target);
    const observer = new LynxIntersectionObserver(callback);
    observer.observe(target);
    target.fire('binduiappear');
    await settle();
    expect(callback).not.toHaveBeenCalled();
    // Only the other observer's listeners are left.
    expect(target.listening('binduiappear')).toBe(1);
    expect(target.listening('binduidisappear')).toBe(1);
  });

  it('hands over queued entries with takeRecords()', async () => {
    const target = element('view', rect(0, 0, 10, 10), page());
    const later = vi.fn();
    const second = new LynxIntersectionObserver(later);
    expect(second.takeRecords()).toEqual([]);
    // Two observers of one element, the first taking the second's entries
    // from its callback: queued by then, as both measured together.
    let taken: unknown[] = [];
    const first = new LynxIntersectionObserver(() => {
      taken = second.takeRecords();
    });
    first.observe(target);
    second.observe(target);
    target.fire('binduiappear');
    await settle();
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ target, isIntersecting: true });
    // Taken, so never delivered.
    expect(later).not.toHaveBeenCalled();
  });

  it('takes only elements, and a function to call back', () => {
    const observer = new LynxIntersectionObserver(() => {});
    expect(() => observer.observe({})).toThrow(TypeError);
    expect(() => observer.observe(null)).toThrow(TypeError);
    expect(() => new LynxIntersectionObserver(undefined as never)).toThrow(
      TypeError,
    );
  });

  it('keeps its options as browsers do', () => {
    const plain = new LynxIntersectionObserver(() => {});
    expect(plain.root).toBeNull();
    expect(plain.rootMargin).toBe('0px 0px 0px 0px');
    expect(plain.thresholds).toEqual([0]);
    expect(Object.isFrozen(plain.thresholds)).toBe(true);

    const root = element();
    const given = new LynxIntersectionObserver(() => {}, {
      root,
      rootMargin: '10px 5%',
      threshold: [1, 0.5, 0],
    });
    expect(given.root).toBe(root);
    expect(given.rootMargin).toBe('10px 5% 10px 5%');
    expect(given.thresholds).toEqual([0, 0.5, 1]);

    const margins = (rootMargin: string) =>
      new LynxIntersectionObserver(() => {}, { rootMargin }).rootMargin;
    expect(margins('')).toBe('0px 0px 0px 0px');
    expect(margins('1px')).toBe('1px 1px 1px 1px');
    expect(margins('1px 2px 3px')).toBe('1px 2px 3px 2px');
    expect(margins(' -1px 2px 3px .5px ')).toBe('-1px 2px 3px .5px');
    expect(margins('0')).toBe('0px 0px 0px 0px');
    expect(() => margins('1em')).toThrow(SyntaxError);
    expect(() => margins('1')).toThrow(SyntaxError);
    expect(() => margins('1px 1px 1px 1px 1px')).toThrow(SyntaxError);

    expect(
      new LynxIntersectionObserver(() => {}, { threshold: 0.25 }).thresholds,
    ).toEqual([0.25]);
    expect(
      new LynxIntersectionObserver(() => {}, { threshold: [] }).thresholds,
    ).toEqual([0]);
    expect(
      () => new LynxIntersectionObserver(() => {}, { threshold: 2 }),
    ).toThrow(RangeError);
    expect(
      () => new LynxIntersectionObserver(() => {}, { threshold: [Number.NaN] }),
    ).toThrow(RangeError);
  });

  it('takes the document as the root, as no root', () => {
    const document = {};
    vi.stubGlobal('document', document);
    expect(
      new LynxIntersectionObserver(() => {}, { root: document }).root,
    ).toBeNull();
  });

  it('takes only an element or the document as the root, as browsers do', () => {
    expect(new LynxIntersectionObserver(() => {}, { root: null }).root).toBe(
      null,
    );
    // An ElementRef, say, rather than its nativeElement.
    expect(
      () =>
        new LynxIntersectionObserver(() => {}, { root: { nativeElement: 1 } }),
    ).toThrow(TypeError);
  });

  it('honors its options without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new LynxIntersectionObserver(() => {}, {
      root: element(),
      rootMargin: '100px',
      threshold: [0, 1],
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('IntersectionObserver on Lynx, given options', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    // Lets any measuring still going stop, so the next test starts afresh.
    vi.runAllTimers();
    vi.useRealTimers();
  });

  /**
   * The latest entry the observer's callback was given.
   */
  const last = (callback: ReturnType<typeof vi.fn>) =>
    callback.mock.lastCall?.[0].at(-1);

  /**
   * A scroll-view in the top half of the page, with a long column in it.
   */
  const scrolling = () => {
    const root = page();
    const scroller = element('scroll-view', rect(0, 0, 400, 400), root);
    const content = element('view', rect(0, 0, 400, 2000), scroller);
    return { root, scroller, content };
  };

  it('reports each threshold the element crosses as its scroll-view scrolls', async () => {
    const { root, scroller, content } = scrolling();
    const target = element('view', null, content);
    const callback = vi.fn();
    new LynxIntersectionObserver(callback, {
      threshold: [0.5, 0, 1],
    }).observe(target);
    // Below the scroll-view's bottom.
    target.layout(rect(0, 500, 400, 100));
    await settle();
    expect(callback).toHaveBeenCalledOnce();
    expect(last(callback)).toMatchObject({
      target,
      isIntersecting: false,
      intersectionRatio: 0,
      intersectionRect: { width: 0, height: 0 },
      rootBounds: { x: 0, y: 0, width: 400, height: 800 },
    });
    // It listens to the scroll-view, and to nothing that doesn't scroll.
    expect(scroller.listening('bindscroll')).toBe(1);
    expect(content.listening('bindscroll')).toBe(0);
    expect(root.listening('bindscroll')).toBe(0);

    // Scrolled until 30% of it shows: measured on the next sample.
    target.move(rect(0, 370, 400, 100));
    scroller.fire('bindscroll');
    await settle();
    expect(callback).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(50);
    await settle();
    expect(callback).toHaveBeenCalledTimes(2);
    expect(last(callback)).toMatchObject({
      isIntersecting: true,
      intersectionRatio: 0.3,
      intersectionRect: { x: 0, y: 370, width: 400, height: 30 },
    });

    // 60%: past the next threshold.
    target.move(rect(0, 340, 400, 100));
    scroller.fire('bindscroll');
    vi.advanceTimersByTime(50);
    await settle();
    expect(last(callback).intersectionRatio).toBeCloseTo(0.6);

    // Still moving after the last scroll event, as a list between its
    // throttled ones: measured anyway, and found all in view.
    target.move(rect(0, 200, 400, 100));
    vi.advanceTimersByTime(50);
    await settle();
    expect(callback).toHaveBeenCalledTimes(4);
    expect(last(callback).intersectionRatio).toBe(1);

    // Moving within the band between two thresholds says nothing new.
    target.move(rect(0, 150, 400, 100));
    vi.advanceTimersByTime(50);
    await settle();
    expect(callback).toHaveBeenCalledTimes(4);

    // A while after the last scroll event, it stops measuring.
    vi.advanceTimersByTime(500);
    await settle();
    const count = measurements(target);
    vi.advanceTimersByTime(500);
    await settle();
    expect(measurements(target)).toBe(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is intersecting only once a threshold is reached, as in Chromium and WebKit', async () => {
    const target = element('view', null, page());
    const callback = vi.fn();
    new LynxIntersectionObserver(callback, { threshold: 1 }).observe(target);
    // Half off the bottom of the page.
    target.layout(rect(0, 750, 400, 100));
    await settle();
    expect(last(callback)).toMatchObject({
      isIntersecting: false,
      intersectionRatio: 0.5,
      intersectionRect: { y: 750, height: 50 },
    });

    target.layout(rect(0, 600, 400, 100));
    await settle();
    expect(last(callback)).toMatchObject({
      isIntersecting: true,
      intersectionRatio: 1,
    });
  });

  it('measures each layout, which can take the element across a threshold', async () => {
    const target = element('view', null, page());
    const callback = vi.fn();
    new LynxIntersectionObserver(callback, { threshold: 0.5 }).observe(target);
    target.layout(rect(0, 700, 400, 100));
    await settle();
    expect(last(callback).isIntersecting).toBe(true);

    // Grown taller, with only a quarter of it on the page.
    target.layout(rect(0, 700, 400, 400));
    await settle();
    expect(callback).toHaveBeenCalledTimes(2);
    expect(last(callback)).toMatchObject({
      isIntersecting: false,
      intersectionRatio: 0.25,
    });
  });

  it('grows the root by the root margin, in px', async () => {
    const near = element('view', null, page());
    const far = element('view', null, page());
    const callback = vi.fn();
    const observer = new LynxIntersectionObserver(callback, {
      rootMargin: '0px 0px 400px 0px',
    });
    observer.observe(near);
    observer.observe(far);
    // 200px below the page's bottom, and 500px.
    near.layout(rect(0, 1000, 400, 100));
    far.layout(rect(0, 1300, 400, 100));
    await settle();
    const [[entries]] = callback.mock.calls;
    expect(entries[0]).toMatchObject({
      target: near,
      isIntersecting: true,
      intersectionRatio: 1,
      rootBounds: { x: 0, y: 0, width: 400, height: 1200 },
    });
    expect(entries[1]).toMatchObject({ target: far, isIntersecting: false });
  });

  it('takes a root margin’s percentages of the root’s height and width, and shrinks it with a negative one', async () => {
    const root = page();
    const across = element('view', null, root);
    const above = element('view', null, root);
    const callback = vi.fn();
    // A line across the middle of the page, 40px in from each side.
    const observer = new LynxIntersectionObserver(callback, {
      rootMargin: '-50% -10%',
    });
    observer.observe(across);
    observer.observe(above);
    across.layout(rect(0, 350, 400, 100));
    above.layout(rect(0, 0, 400, 100));
    await settle();
    const [[entries]] = callback.mock.calls;
    expect(entries[0]).toMatchObject({
      isIntersecting: true,
      intersectionRatio: 0,
      intersectionRect: { x: 40, y: 400, width: 320, height: 0 },
      rootBounds: { x: 40, y: 400, width: 320, height: 0 },
    });
    expect(entries[1].isIntersecting).toBe(false);
  });

  it('counts an element touching the root’s edge, or with no size, as intersecting, as browsers do', async () => {
    const root = page();
    const touching = element('view', null, root);
    const empty = element('view', null, root);
    const callback = vi.fn();
    // The page as the root: the browser's rules, rather than exposure's.
    const observer = new LynxIntersectionObserver(callback, { root });
    observer.observe(touching);
    observer.observe(empty);
    touching.layout(rect(0, 800, 400, 100));
    // A sentinel at the end of a feed.
    empty.layout(rect(0, 500, 0, 0));
    await settle();
    const [[entries]] = callback.mock.calls;
    expect(entries[0]).toMatchObject({
      isIntersecting: true,
      intersectionRatio: 0,
    });
    expect(entries[1]).toMatchObject({
      isIntersecting: true,
      intersectionRatio: 1,
    });
  });

  it('checks the element against its root, clipped by the scroll containers between them, and not the screen', async () => {
    const root = page();
    const outer = element('scroll-view', rect(0, 0, 400, 800), root);
    // A scroll-view scrolled below the page, with another in it.
    const list = element('scroll-view', rect(0, 1000, 400, 400), outer);
    const inner = element('scroll-view', rect(0, 1000, 400, 100), list);
    const shown = element('view', null, list);
    const clipped = element('view', null, inner);
    const callback = vi.fn();
    const observer = new LynxIntersectionObserver(callback, {
      root: list,
      threshold: [0, 1],
    });
    observer.observe(shown);
    observer.observe(clipped);
    shown.layout(rect(0, 1200, 400, 100));
    // Half below the inner scroll-view's bottom.
    clipped.layout(rect(0, 1050, 400, 100));
    await settle();
    const [[entries]] = callback.mock.calls;
    expect(entries[0]).toMatchObject({
      isIntersecting: true,
      intersectionRatio: 1,
      rootBounds: { x: 0, y: 1000, width: 400, height: 400 },
    });
    expect(entries[1]).toMatchObject({
      isIntersecting: true,
      intersectionRatio: 0.5,
    });
    // The root's scrolling and the inner scroll-view's move them in the
    // root; the outer one's moves the root along with them.
    expect(list.listening('bindscroll')).toBe(2);
    expect(inner.listening('bindscroll')).toBe(1);
    expect(outer.listening('bindscroll')).toBe(0);
  });

  it('reports an element outside its root, or the root itself, as not intersecting', async () => {
    const root = page();
    const box = element('view', rect(0, 0, 400, 400), root);
    const outside = element('view', null, root);
    const callback = vi.fn();
    const observer = new LynxIntersectionObserver(callback, { root: box });
    observer.observe(outside);
    observer.observe(box);
    outside.layout(rect(0, 100, 10, 10));
    box.layout(rect(0, 0, 400, 400));
    await settle();
    const [[entries]] = callback.mock.calls;
    expect(entries[0]).toMatchObject({
      isIntersecting: false,
      rootBounds: { width: 400, height: 400 },
    });
    expect(entries[1].isIntersecting).toBe(false);
  });

  it('reports an element off the page, or whose root or scroll container can’t be measured, as not intersecting', async () => {
    const detached = element(
      'view',
      null,
      element('view', rect(0, 0, 400, 800)),
    );
    const unmeasured = element('view', null);
    const inside = element('view', null, unmeasured);
    const scrolled = element(
      'view',
      null,
      element('scroll-view', null, page()),
    );
    const callback = vi.fn();
    new LynxIntersectionObserver(callback, { threshold: 0.5 }).observe(
      detached,
    );
    new LynxIntersectionObserver(callback, { root: unmeasured }).observe(
      inside,
    );
    new LynxIntersectionObserver(callback, { threshold: 0.5 }).observe(
      scrolled,
    );
    detached.layout(rect(0, 0, 10, 10));
    inside.layout(rect(0, 0, 10, 10));
    scrolled.layout(rect(0, 0, 10, 10));
    await settle();
    expect(
      callback.mock.calls.map(([[entry]]) => [
        entry.isIntersecting,
        entry.rootBounds?.height ?? null,
      ]),
    ).toEqual([
      [false, null],
      [false, null],
      [false, 800],
    ]);
  });

  it('listens for the scroll events of each kind of scroll container', async () => {
    const root = page();
    const coordinator = element(
      'scroll-coordinator',
      rect(0, 0, 400, 800),
      root,
    );
    const pager = element('viewpager', rect(0, 0, 400, 800), coordinator);
    const list = element('list', rect(0, 0, 400, 800), pager);
    const target = element('view', null, list);
    new LynxIntersectionObserver(() => {}, { threshold: 1 }).observe(target);
    target.layout(rect(0, 0, 10, 10));
    await settle();
    expect(list.listening('bindscroll')).toBe(1);
    expect(pager.listening('bindoffsetchange')).toBe(1);
    expect(coordinator.listening('bindoffset')).toBe(1);

    // A page turned: measured as it moves.
    const count = measurements(target);
    pager.fire('bindoffsetchange');
    vi.advanceTimersByTime(50);
    expect(measurements(target)).toBe(count + 1);
  });

  it('stops listening to a scroll container it has left, and to every one once unobserved', async () => {
    const { root, scroller } = scrolling();
    const other = element('scroll-view', rect(0, 400, 400, 400), root);
    const target = element('view', null, scroller);
    const observer = new LynxIntersectionObserver(() => {}, {
      threshold: 1,
    });
    observer.observe(target);
    target.layout(rect(0, 0, 10, 10));
    await settle();
    expect(scroller.listening('bindscroll')).toBe(1);

    // Moved into the other scroll-view, and laid out there.
    target.parent = other;
    target.layout(rect(0, 400, 10, 10));
    await settle();
    expect(scroller.listening('bindscroll')).toBe(0);
    expect(other.listening('bindscroll')).toBe(1);

    other.fire('bindscroll');
    expect(vi.getTimerCount()).toBe(1);
    observer.unobserve(target);
    expect(other.listening('bindscroll')).toBe(0);
    expect(target.listening('binduiappear')).toBe(0);
    expect(target.layoutObservers.size).toBe(0);
    // Nothing left to measure while it scrolls.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asks once for the boxes of a scroll container its observers share, as they measure together', async () => {
    const { root, scroller, content } = scrolling();
    const first = element('view', null, content);
    const second = element('view', null, content);
    new LynxIntersectionObserver(() => {}, { threshold: 1 }).observe(first);
    new LynxIntersectionObserver(() => {}, { threshold: 1 }).observe(second);
    first.layout(rect(0, 0, 10, 10));
    second.layout(rect(0, 10, 10, 10));
    await settle();

    const [pageCount, scrollerCount] = [
      measurements(root),
      measurements(scroller),
    ];
    scroller.fire('bindscroll');
    vi.advanceTimersByTime(50);
    expect(measurements(first)).toBe(2);
    expect(measurements(second)).toBe(2);
    expect(measurements(root)).toBe(pageCount + 1);
    expect(measurements(scroller)).toBe(scrollerCount + 1);
  });

  it('shares a box still being measured, and measures afresh once native has answered', async () => {
    // Native holds its answers until the test lets them go.
    const answers: (() => void)[] = [];
    vi.stubGlobal(
      '__InvokeUIMethod',
      vi.fn(
        (
          native: object,
          _method: string,
          _params: unknown,
          callback: (result: { code: number; data?: unknown }) => void,
        ) => {
          const box = boxes.get(native);
          answers.push(() =>
            callback(box ? { code: 0, data: box } : { code: 2 }),
          );
        },
      ),
    );
    const answer = async () => {
      for (const send of answers.splice(0)) send();
      await settle();
    };
    const root = page();
    const first = element('view', rect(0, 0, 10, 10), root);
    const second = element('view', rect(0, 10, 10, 10), root);
    new LynxIntersectionObserver(() => {}, { threshold: 1 }).observe(first);
    new LynxIntersectionObserver(() => {}, { threshold: 1 }).observe(second);
    first.fire('binduiappear');
    await settle();
    // Asked for later, with the page's box still coming.
    second.fire('binduiappear');
    expect(measurements(root)).toBe(1);
    await answer();
    first.fire('binduidisappear');
    expect(measurements(root)).toBe(2);
    await answer();
  });

  it('measures afresh each time when native answers at once, as the testing library’s does', async () => {
    vi.stubGlobal(
      '__InvokeUIMethod',
      vi.fn(
        (
          _native: object,
          _method: string,
          _params: unknown,
          callback: (result: { code: number }) => void,
        ) => callback({ code: 0 }),
      ),
    );
    const root = page();
    const target = element('view', null, root);
    const callback = vi.fn();
    new LynxIntersectionObserver(callback, { threshold: 1 }).observe(target);
    target.fire('binduiappear');
    await settle();
    target.fire('binduidisappear');
    await settle();
    expect(measurements(root)).toBe(2);
    expect(
      callback.mock.calls.map(([[entry]]) => entry.intersectionRatio),
    ).toEqual([1, 0]);
  });

  it('asks once per sample for a box its observers share, when native answers at once', async () => {
    vi.stubGlobal(
      '__InvokeUIMethod',
      vi.fn(
        (
          native: object,
          _method: string,
          _params: unknown,
          callback: (result: { code: number; data?: unknown }) => void,
        ) => {
          const box = boxes.get(native);
          callback(box ? { code: 0, data: box } : { code: 2 });
        },
      ),
    );
    const { root, scroller, content } = scrolling();
    const first = element('view', null, content);
    const second = element('view', null, content);
    new LynxIntersectionObserver(() => {}, { threshold: 1 }).observe(first);
    new LynxIntersectionObserver(() => {}, { threshold: 1 }).observe(second);
    first.layout(rect(0, 0, 10, 10));
    second.layout(rect(0, 10, 10, 10));
    await settle();

    const [pageCount, scrollerCount] = [
      measurements(root),
      measurements(scroller),
    ];
    scroller.fire('bindscroll');
    vi.advanceTimersByTime(50);
    expect(measurements(root)).toBe(pageCount + 1);
    expect(measurements(scroller)).toBe(scrollerCount + 1);
    await settle();
    // Outside a sample, each measures afresh.
    first.layout(rect(0, 20, 10, 10));
    second.layout(rect(0, 30, 10, 10));
    expect(measurements(root)).toBe(pageCount + 3);
    await settle();
  });

  it('measures once more when the element moves while it’s being measured', async () => {
    const target = element('view', null, page());
    const callback = vi.fn();
    new LynxIntersectionObserver(callback, { threshold: 1 }).observe(target);
    // Laid out off the page, then on it, before the first measurement
    // answers.
    target.layout(rect(0, 900, 400, 100));
    target.layout(rect(0, 0, 400, 100));
    target.layout(rect(0, 10, 400, 100));
    await settle();
    expect(measurements(target)).toBe(2);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(last(callback).isIntersecting).toBe(true);
  });

  it('takes exposure’s answer for an element that has never had a box, as in the testing library', async () => {
    const target = element('view', null, page());
    const callback = vi.fn();
    new LynxIntersectionObserver(callback, { threshold: [0.5, 1] }).observe(
      target,
    );
    target.fire('binduiappear');
    await settle();
    expect(last(callback)).toMatchObject({
      isIntersecting: true,
      intersectionRatio: 1,
    });

    target.fire('binduidisappear');
    await settle();
    expect(last(callback)).toMatchObject({
      isIntersecting: false,
      intersectionRatio: 0,
    });
  });

  it('reports an element that has gone as not intersecting, whatever exposure last said', async () => {
    const target = element('view', null, page());
    const callback = vi.fn();
    new LynxIntersectionObserver(callback, { threshold: 1 }).observe(target);
    target.layout(rect(0, 0, 400, 100));
    target.fire('binduiappear');
    await settle();
    expect(last(callback).isIntersecting).toBe(true);

    // Its UI gone, as a list's recycled cell's.
    target.move(null);
    target.fire('binduiappear');
    await settle();
    expect(last(callback)).toMatchObject({
      isIntersecting: false,
      boundingClientRect: { width: 0, height: 0 },
    });
  });

  it('stops reporting an element unobserved while it’s being measured', async () => {
    const target = element('view', null, page());
    target.layout(rect(0, 0, 10, 10));
    const callback = vi.fn();
    const observer = new LynxIntersectionObserver(callback, { threshold: 1 });
    // Unobserved before its first measurement starts, and again while one
    // is under way.
    observer.observe(target);
    observer.unobserve(target);
    observer.observe(target);
    target.fire('binduiappear');
    observer.unobserve(target);
    await settle();
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('installIntersectionObserver', () => {
  it('installs the Lynx one where there’s none, once', () => {
    const target: Record<string, any> = {};
    installIntersectionObserver(target);
    expect(target['IntersectionObserver']).toBe(LynxIntersectionObserver);
    installIntersectionObserver(target);
    expect(target['IntersectionObserver']).toBe(LynxIntersectionObserver);
  });
});

describe('IntersectionObserver on the web', () => {
  const browser = () => {
    let fire: (entries: unknown[]) => void = () => {};
    const options: unknown[] = [];
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    const takeRecords = vi.fn((): unknown[] => []);
    class BrowserIntersectionObserver {
      rootMargin = '1px 1px 1px 1px';
      thresholds = [0.5];
      constructor(callback: (entries: unknown[]) => void, init?: unknown) {
        fire = callback;
        options.push(init);
      }
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
      takeRecords = takeRecords;
    }
    const target: Record<string, any> = {
      IntersectionObserver: BrowserIntersectionObserver,
    };
    installIntersectionObserver(target);
    return {
      IntersectionObserver: target['IntersectionObserver'],
      fire: (entries: unknown[]) => fire(entries),
      options,
      observe,
      unobserve,
      disconnect,
      takeRecords,
      reinstall: () => {
        const wrapped = target['IntersectionObserver'];
        installIntersectionObserver(target);
        return target['IntersectionObserver'] === wrapped;
      },
    };
  };

  const entry = (of: object) => ({
    target: of,
    time: 1,
    rootBounds: { width: 2 },
    boundingClientRect: { width: 3 },
    intersectionRect: { width: 4 },
    intersectionRatio: 0.5,
    isIntersecting: true,
  });

  it('wraps the browser’s, reporting Lynx elements as the targets', () => {
    const web = browser();
    expect(web.reinstall()).toBe(true);
    const callback = vi.fn();
    const observer = new web.IntersectionObserver(callback);
    expect(web.options[0]).toBeUndefined();
    expect(observer.root).toBeNull();
    expect(observer.rootMargin).toBe('1px 1px 1px 1px');
    expect(observer.thresholds).toEqual([0.5]);

    const lynxElement = element();
    const plain = { plain: true };
    observer.observe(lynxElement);
    observer.observe(plain);
    expect(web.observe).toHaveBeenCalledWith(lynxElement.element);
    expect(web.observe).toHaveBeenCalledWith(plain);

    web.fire([entry(lynxElement.element), entry(plain)]);
    const [[entries, which]] = callback.mock.calls;
    expect(which).toBe(observer);
    expect(entries[0]).toEqual({
      ...entry(lynxElement.element),
      target: lynxElement,
    });
    expect(entries[1].target).toBe(plain);

    web.takeRecords.mockReturnValueOnce([entry(lynxElement.element)]);
    expect(observer.takeRecords()[0].target).toBe(lynxElement);

    observer.unobserve(lynxElement);
    observer.unobserve(plain);
    expect(web.unobserve).toHaveBeenCalledWith(lynxElement.element);
    expect(web.unobserve).toHaveBeenCalledWith(plain);
    observer.disconnect();
    expect(web.disconnect).toHaveBeenCalled();
  });

  it('takes a Lynx element as the root', () => {
    const web = browser();
    const root = element();
    const observer = new web.IntersectionObserver(() => {}, {
      root,
      rootMargin: '10px',
      threshold: [0, 1],
    });
    expect(observer.root).toBe(root);
    expect(web.options[0]).toEqual({
      root: root.element,
      rootMargin: '10px',
      threshold: [0, 1],
    });
  });
});
