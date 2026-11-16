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

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(() => resolve()));

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
  vi.stubGlobal('__GetElementUniqueID', () => 1);
  vi.stubGlobal('__SetDataset', vi.fn());
  vi.stubGlobal('__AddInlineStyle', vi.fn());
  vi.stubGlobal('SystemInfo', { platform: 'iOS' });
  setInsideChangeDetection(false);
});

afterEach(async () => {
  // A settle flush still queued mustn't land in the next test.
  await flushMicrotasks();
  vi.unstubAllGlobals();
});

/**
 * A scroll-view as LynxDocument makes one on iOS, its handler flushed.
 */
const scrollView = async (): Promise<LynxElement> => {
  const element = new LynxElement({} as never);
  element.tagName = 'scroll-view';
  listenForScrollsFromTheStart(element);
  await flushMicrotasks();
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
    await flushMicrotasks();
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
    const listener = vi.fn();
    const stop = element.addEventListener('bindscroll', listener);
    // It shares the placeholder's handler: nothing new to register.
    expect(addEvent).toHaveBeenCalledOnce();

    const event: Record<string, unknown> = { type: 'scroll', detail: {} };
    scroll(event);
    expect(listener).toHaveBeenCalledExactlyOnceWith(event);
    expect(event['stopPropagation']).toBeTypeOf('function');
    await flushMicrotasks();
    expect(flush).toHaveBeenCalledOnce();

    stop();
    // Removing it schedules nothing: the placeholder keeps the handler.
    await flushMicrotasks();
    flush.mockClear();
    scroll({ type: 'scroll', detail: {} });
    await flushMicrotasks();
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
    await flushMicrotasks();
    expect(flush).not.toHaveBeenCalled();

    scroll({ type: 'scroll' });
    await flushMicrotasks();
    expect(flush).toHaveBeenCalledOnce();

    // Once.
    scroll({ type: 'scroll' });
    await flushMicrotasks();
    expect(flush).toHaveBeenCalledOnce();
  });

  it('leaves the flush to change detection when a cycle starts first', async () => {
    await scrollView();
    const scroll = nativeHandler('scroll');
    bindListItem(() => scheduleSettleFlush());
    scroll({ type: 'scroll' });
    // end() flushes it with the rest of the cycle.
    setInsideChangeDetection(true);
    await flushMicrotasks();
    expect(flush).not.toHaveBeenCalled();
    setInsideChangeDetection(false);

    // Not taken for done: the next event still flushes.
    scroll({ type: 'scroll' });
    await flushMicrotasks();
    expect(flush).toHaveBeenCalledOnce();
  });
});
