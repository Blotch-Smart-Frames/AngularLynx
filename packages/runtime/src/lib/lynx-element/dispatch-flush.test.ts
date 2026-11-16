import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  bindListItem,
  markFirstRenderComplete,
  setInsideChangeDetection,
} from '../lynx-render-lifecycle';
import type { ElementRef } from '../types/lynx';
import { setSafeAreaInsets } from './safe-area-insets';
import {
  listenForScrollsFromTheStart,
  LynxElement,
  scheduleSettleFlush,
} from './lynx-element';

/**
 * The flushes a native event asks for when it reaches an element's
 * listeners (LynxElement's #dispatch), counted with mocked Lynx globals.
 * Everything runs after the first render and outside change detection,
 * where a settle flush isn't a no-op. The first-render latch is
 * module-level, and Vitest gives each file its own modules.
 */

/**
 * Runs the microtasks queued so far, and the ones they queue: a dispatch
 * may check for writes in one (see #dispatch), which queues the flush.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const flush = vi.fn();
const addEvent = vi.fn();

/**
 * The native handler registered last for `name`, as Lynx would call it.
 */
const nativeHandler = (name: string): ((event: unknown) => unknown) => {
  const calls = addEvent.mock.calls.filter((call) => call[2] === name);
  return calls[calls.length - 1]![3].value;
};

beforeAll(() => {
  markFirstRenderComplete();
});

beforeEach(() => {
  flush.mockClear();
  addEvent.mockClear();
  vi.stubGlobal('__FlushElementTree', flush);
  vi.stubGlobal('__AddEvent', addEvent);
  // Each native element its own id, as the registry and the cycle check
  // expect.
  const ids = new WeakMap<object, number>();
  let lastId = 0;
  vi.stubGlobal('__GetElementUniqueID', (ref: object) => {
    if (!ids.has(ref)) ids.set(ref, ++lastId);
    return ids.get(ref);
  });
  vi.stubGlobal('__SetDataset', vi.fn());
  vi.stubGlobal('__AddInlineStyle', vi.fn());
  vi.stubGlobal('__SetInlineStyles', vi.fn());
  vi.stubGlobal('__SetClasses', vi.fn());
  vi.stubGlobal('__AddClass', vi.fn());
  vi.stubGlobal('__GetClasses', () => []);
  vi.stubGlobal('__SetID', vi.fn());
  vi.stubGlobal('__SetAttribute', vi.fn());
  vi.stubGlobal('__AppendElement', vi.fn());
  vi.stubGlobal('__InsertElementBefore', vi.fn());
  vi.stubGlobal('__RemoveElement', vi.fn());
  vi.stubGlobal('__GetParent', () => null);
  vi.stubGlobal('__InvokeUIMethod', vi.fn());
  vi.stubGlobal('__ElementAnimate', vi.fn());
  vi.stubGlobal('SystemInfo', { platform: 'iOS' });
  setInsideChangeDetection(false);
});

afterEach(async () => {
  // A settle flush still queued mustn't land in the next test.
  await settle();
  vi.unstubAllGlobals();
});

/**
 * A scroll-view as LynxDocument makes one on iOS, its handler flushed.
 */
const scrollView = async (): Promise<LynxElement> => {
  const element = new LynxElement({} as never);
  element.tagName = 'scroll-view';
  listenForScrollsFromTheStart(element);
  await settle();
  flush.mockClear();
  return element;
};

describe("iOS's scroll placeholder", () => {
  it('drops the scroll events only it hears, without a flush', async () => {
    await scrollView();
    const scroll = nativeHandler('scroll');
    const events = Array.from({ length: 10 }, () => ({
      type: 'scroll',
      detail: { scrollTop: 1 },
    }));
    for (const event of events) expect(scroll(event)).toBeUndefined();
    await settle();
    expect(flush).not.toHaveBeenCalled();
    // Returned before anything else: the events weren't even given the
    // DOM methods.
    for (const event of events) {
      expect(event).not.toHaveProperty('stopPropagation');
    }
  });

  it("runs another listener's dispatch in full, and only while it listens", async () => {
    const element = await scrollView();
    const scroll = nativeHandler('scroll');
    // One that changes the screen, so its dispatch flushes.
    const listener = vi.fn(() => element.setAttribute('class', 'scrolled'));
    const stop = element.addEventListener('bindscroll', listener);
    // It shares the placeholder's handler: nothing new to register.
    expect(addEvent).toHaveBeenCalledOnce();

    const event: Record<string, unknown> = { type: 'scroll', detail: {} };
    scroll(event);
    expect(listener).toHaveBeenCalledExactlyOnceWith(event);
    expect(event['stopPropagation']).toBeTypeOf('function');
    await settle();
    expect(flush).toHaveBeenCalledOnce();

    stop();
    // Removing it schedules nothing: the placeholder keeps the handler.
    await settle();
    flush.mockClear();
    scroll({ type: 'scroll', detail: {} });
    await settle();
    expect(listener).toHaveBeenCalledOnce();
    expect(flush).not.toHaveBeenCalled();
  });

  it('gives every event without them the same no-op DOM methods', async () => {
    const element = await scrollView();
    element.addEventListener('bindscroll', () => {});
    const scroll = nativeHandler('scroll');
    const first: Record<string, unknown> = { type: 'scroll' };
    const second: Record<string, unknown> = { type: 'scroll' };
    scroll(first);
    scroll(second);
    expect(first['stopPropagation']).toBe(second['stopPropagation']);
    expect(first['preventDefault']).toBe(first['stopPropagation']);
    expect(first['stopImmediatePropagation']).toBe(first['stopPropagation']);
    expect((first['stopPropagation'] as () => unknown)()).toBeUndefined();
  });

  it("still brings the flush a list item's build left for later", async () => {
    await scrollView();
    const scroll = nativeHandler('scroll');
    // A settle flush asked for while componentAtIndex builds an item is
    // skipped: the item's own flush covers only the item.
    bindListItem(() => scheduleSettleFlush());
    await settle();
    expect(flush).not.toHaveBeenCalled();

    scroll({ type: 'scroll' });
    await settle();
    expect(flush).toHaveBeenCalledOnce();

    // Once.
    scroll({ type: 'scroll' });
    await settle();
    expect(flush).toHaveBeenCalledOnce();
  });

  it('leaves the flush to change detection when a cycle starts first', async () => {
    await scrollView();
    const scroll = nativeHandler('scroll');
    bindListItem(() => scheduleSettleFlush());
    scroll({ type: 'scroll' });
    // end() flushes it with the rest of the cycle.
    setInsideChangeDetection(true);
    await settle();
    expect(flush).not.toHaveBeenCalled();
    setInsideChangeDetection(false);

    // Not taken for done: the next event still flushes.
    scroll({ type: 'scroll' });
    await settle();
    expect(flush).toHaveBeenCalledOnce();
  });
});

/**
 * A view with a `bindtap` listener running `listener`, and the native
 * handler Lynx would call for a tap. The flush its listener's registration
 * asked for has run.
 */
const tappable = async (
  listener: (element: LynxElement) => unknown,
): Promise<{ element: LynxElement; tap: () => unknown }> => {
  const element = new LynxElement({} as ElementRef);
  element.tagName = 'view';
  element.addEventListener('bindtap', () => listener(element));
  await settle();
  flush.mockClear();
  const handler = nativeHandler('tap');
  return { element, tap: () => handler({ type: 'tap' }) };
};

/**
 * A view of its own, for a listener to append, insert or remove.
 */
const view = (): LynxElement => {
  const element = new LynxElement({} as ElementRef);
  element.tagName = 'view';
  return element;
};

describe("a native event's flush", () => {
  it('is skipped when the listeners change nothing native', async () => {
    // A template listener that only sets signals: its change detection
    // flushes. A scroll listener whose signals already hold their values.
    const listener = vi.fn();
    const { tap } = await tappable(listener);
    for (let i = 0; i < 10; i++) tap();
    await settle();
    expect(listener).toHaveBeenCalledTimes(10);
    expect(flush).not.toHaveBeenCalled();
  });

  /**
   * Each write a listener can make through LynxElement, given the element
   * and a child of it.
   */
  type Write = (element: LynxElement, child: LynxElement) => unknown;

  it.each<[string, Write]>([
    ['a class', (el) => el.setAttribute('class', 'pressed')],
    ['an id', (el) => el.setAttribute('id', 'card')],
    ['a data attribute', (el) => el.setAttribute('data-k', 'v')],
    ['hidden', (el) => el.setAttribute('hidden', '')],
    ['an attribute', (el) => el.setAttribute('aria-label', 'x')],
    ['an attribute removal', (el) => el.removeAttribute('src')],
    ['a style', (el) => el.setStyle('opacity', '0.5')],
    ['a custom property', (el) => el.setStyle('--x', '1px')],
    ['a style removal', (el) => el.removeStyle('opacity')],
    ['a custom property removal', (el) => el.removeStyle('--y')],
    ['an inline style', (el) => el.setInlineStyles('top: 0')],
    ['a class added', (el) => el.addClass('on')],
    ['a class removed', (el) => el.removeClass('on')],
    ['an appended child', (el) => el.appendChild(view())],
    ['an inserted child', (el, child) => el.insertBefore(view(), child)],
    ['a removal', (_, child) => child.remove()],
    ['a runtime style', (el) => el.updateSafeAreaInsets()],
    ['a UI method', (el) => el.invoke('focus')],
    ['an animation', (el) => el.animate([{ opacity: 0 }], 100)],
  ])('commits %s a listener makes, in one flush', async (_, write) => {
    const child = view();
    const { element, tap } = await tappable((el) => write(el, child));
    // What the listener changes: a custom property to remove, insets for
    // the runtime style, and a child to insert before or remove.
    element.setStyle('--y', '1px');
    setSafeAreaInsets({ edgeToEdge: true, safeAreaTop: 62 });
    element.appendChild(child);
    await settle();
    flush.mockClear();

    tap();
    await settle();
    expect(flush).toHaveBeenCalledOnce();
    setSafeAreaInsets(undefined);
  });

  it('commits a removal after the element leaves its parent', async () => {
    // A removal waits for the flush, which sends it first.
    const child = view();
    const { tap } = await tappable(() => child.remove());
    const order: string[] = [];
    const parent = {};
    vi.stubGlobal('__GetParent', () => parent);
    vi.stubGlobal(
      '__RemoveElement',
      vi.fn(() => order.push('remove')),
    );
    flush.mockImplementation(() => order.push('flush'));
    tap();
    await settle();
    expect(order).toEqual(['remove', 'flush']);
    flush.mockReset();
  });

  it("commits what an async listener writes after it's returned", async () => {
    // Code after an `await` runs in a microtask the listener queued, which
    // the flush a dispatch used to schedule at once ran after.
    const { tap } = await tappable(async (element) => {
      await Promise.resolve();
      element.setAttribute('class', 'loaded');
    });
    tap();
    expect(flush).not.toHaveBeenCalled();
    await settle();
    expect(flush).toHaveBeenCalledOnce();
  });

  it('commits what a nested dispatch writes, once', async () => {
    // The document's listeners run inside the page's dispatch (see
    // global-events): the inner one's write counts for the outer one too.
    const inner = await tappable((element) =>
      element.setAttribute('class', 'x'),
    );
    const outer = await tappable(() => inner.tap());
    outer.tap();
    await settle();
    expect(flush).toHaveBeenCalledOnce();
  });

  it('commits an outer dispatch writing after an inner one that writes nothing', async () => {
    const inner = await tappable(() => {});
    const outer = await tappable((element) => {
      inner.tap();
      element.setAttribute('class', 'x');
    });
    outer.tap();
    await settle();
    expect(flush).toHaveBeenCalledOnce();
  });

  it('leaves the flush to change detection inside a cycle', async () => {
    const { tap } = await tappable((element) =>
      element.setAttribute('class', 'x'),
    );
    setInsideChangeDetection(true);
    tap();
    await settle();
    expect(flush).not.toHaveBeenCalled();
  });

  it("still brings the flush a list item's build left for later", async () => {
    const { tap } = await tappable(() => {});
    bindListItem(() => scheduleSettleFlush());
    tap();
    await settle();
    expect(flush).toHaveBeenCalledOnce();
    tap();
    await settle();
    expect(flush).toHaveBeenCalledOnce();
  });
});
