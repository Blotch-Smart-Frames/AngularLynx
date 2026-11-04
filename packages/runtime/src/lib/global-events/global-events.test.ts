import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxEvent } from './event';
import {
  GlobalEvents,
  type GlobalEventsPage,
  type ScreenSource,
} from './global-events';

const page = (): GlobalEventsPage => ({
  element: {},
  addEventListener: vi.fn(() => () => {}),
  addTrailingEventListener: vi.fn(() => () => {}),
});

/**
 * A hub with a source that records what it was asked to listen for.
 */
const hub = (viewport?: ScreenSource['viewport']) => {
  const windowObject = {};
  const source = { sync: vi.fn(), viewport };
  const events = new GlobalEvents(windowObject, () => source);
  return { events, source, windowObject };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GlobalEvents', () => {
  it('asks its source for the types the document and window listen for', () => {
    const { events, source } = hub();
    const first = page();
    events.attach(first, () => undefined);
    expect(events.page).toBe(first);
    expect(source.sync).toHaveBeenLastCalledWith(first, new Set());

    events.document.addEventListener('pointermove', vi.fn());
    events.window.addEventListener('resize', vi.fn());

    expect(source.sync).toHaveBeenLastCalledWith(
      first,
      new Set(['pointermove', 'resize']),
    );
    expect(events.hasListeners('resize')).toBe(true);
    expect(events.hasListeners('pointermove')).toBe(true);
    expect(events.hasListeners('click')).toBe(false);
  });

  it('finds the element a touch landed on, or names the page', () => {
    const { events } = hub();
    expect(events.targetFor(3)).toBe(events.document);
    const element = {};
    const root = page();
    events.attach(root, (id) => (id === 3 ? element : undefined));

    expect(events.targetFor(3)).toBe(element);
    expect(events.targetFor(4)).toBe(root);
    expect(events.targetFor(undefined)).toBe(root);
  });

  describe('a screen event', () => {
    const listen = (events: GlobalEvents, log: string[]) => {
      events.window.addEventListener('ping', () => log.push('window capture'), {
        capture: true,
      });
      events.document.addEventListener(
        'ping',
        () => log.push('document capture'),
        true,
      );
      events.document.addEventListener('ping', () => log.push('document'));
      events.window.addEventListener('ping', () => log.push('window'));
    };

    it('captures when it begins, and bubbles when it reaches the page', () => {
      const { events } = hub();
      const log: string[] = [];
      listen(events, log);
      const event = new LynxEvent('ping', { bubbles: true });

      events.early('ping', [{ type: 'ping', event, target: {} }]);
      expect(log).toEqual(['window capture', 'document capture']);

      events.late('ping');
      expect(log).toEqual([
        'window capture',
        'document capture',
        'document',
        'window',
      ]);
      // The timer finds it done.
      vi.runAllTimers();
      expect(log).toHaveLength(4);
    });

    it('bubbles on the next timer when something stopped it on its way', () => {
      const { events } = hub();
      const log: string[] = [];
      listen(events, log);

      events.early('ping', [
        {
          type: 'ping',
          event: new LynxEvent('ping', { bubbles: true }),
          target: {},
        },
      ]);
      events.late('pong');
      expect(log).toHaveLength(2);

      vi.runAllTimers();
      expect(log.slice(2)).toEqual(['document', 'window']);
    });

    it('bubbles the ones still pending before the next begins', () => {
      const { events } = hub();
      const order: string[] = [];
      events.document.addEventListener('a', () => order.push('a'));
      events.document.addEventListener('b', () => order.push('b'));

      const bubbling = (type: string) => new LynxEvent(type, { bubbles: true });
      events.early('a', [{ type: 'a', event: bubbling('a'), target: {} }]);
      events.finishPending();
      events.early('b', [{ type: 'b', event: bubbling('b'), target: {} }]);
      events.late('b');

      expect(order).toEqual(['a', 'b']);
    });
  });

  describe('resize', () => {
    it('fires on the window, with the new size', () => {
      const { events, windowObject } = hub();
      const resize = vi.fn((event) => [
        event.type,
        event.target,
        events.viewport,
      ]);
      events.window.addEventListener('resize', resize);

      events.resized({ width: 400, height: 800 });

      expect(resize).toHaveReturnedWith([
        'resize',
        windowObject,
        { width: 400, height: 800 },
      ]);
    });

    // Lynx's report after the first layout, of the size innerWidth and
    // innerHeight already gave, from the screen's.
    it("doesn't fire for the size they already said", () => {
      vi.stubGlobal('SystemInfo', {
        pixelWidth: 1206,
        pixelHeight: 2622,
        pixelRatio: 3,
      });
      const { events } = hub();
      const resize = vi.fn();
      events.window.addEventListener('resize', resize);

      events.resized({ width: 402, height: 874 });
      events.resized({ width: 402, height: 874 });
      expect(resize).not.toHaveBeenCalled();
      events.resized({ width: 874, height: 402 });
      expect(resize).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    it('keeps the size when nothing listens', () => {
      const { events } = hub();
      events.resized({ width: 400, height: 800 });
      expect(events.viewport).toEqual({ width: 400, height: 800 });
    });

    it("prefers the source's own reading", () => {
      const { events } = hub(() => ({ width: 1, height: 2 }));
      events.resized({ width: 400, height: 800 });
      expect(events.viewport).toEqual({ width: 1, height: 2 });
    });

    it('has none before the first', () => {
      expect(hub().events.viewport).toBeNull();
    });
  });
});

describe('LynxGlobalDocument', () => {
  it("is a document's to code that reaches for one", () => {
    const { events, windowObject } = hub();
    const document = events.document;

    expect(document.defaultView).toBe(windowObject);
    expect(document.body).toBeNull();
    expect(document.getElementById('ng-state')).toBeNull();
    expect(document.querySelector('base')).toBeNull();
    expect(document.querySelectorAll('*')).toEqual([]);

    const root = page();
    events.attach(root, () => undefined);
    expect(document.body).toBe(root);
  });

  it('bubbles its own events to the window', () => {
    const { events } = hub();
    const log: string[] = [];
    events.document.addEventListener('ping', (event) =>
      log.push(`document ${event.eventPhase}`),
    );
    events.window.addEventListener('ping', (event) =>
      log.push(`window ${event.eventPhase}`),
    );

    events.document.dispatchEvent(new LynxEvent('ping', { bubbles: true }));

    expect(log).toEqual(['document 2', 'window 3']);
  });
});
