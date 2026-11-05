import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxEvent } from './event';
import { GlobalEvents } from './global-events';
import {
  installGlobalDocument,
  installGlobalWindow,
  SCREEN_EVENTS,
} from './window';

const hubFor = (target: object) =>
  new GlobalEvents(target, () => ({ sync: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installGlobalWindow', () => {
  describe('on iOS and Android', () => {
    /**
     * Lynx's main-thread global, with the polyfills' no-op listeners.
     */
    const lynxGlobal = (): Record<string | symbol, any> => ({
      addEventListener: () => {},
      removeEventListener: () => {},
      document: { defaultView: null },
    });

    it("makes every listener the hub's", () => {
      const target = lynxGlobal();
      const events = hubFor(target);
      installGlobalWindow(target, events);
      const listener = vi.fn();

      target['addEventListener']('popstate', listener);
      expect(events.window.hasListeners('popstate')).toBe(true);
      const event = new LynxEvent('popstate');
      expect(target['dispatchEvent'](event)).toBe(true);
      expect(listener).toHaveBeenCalledWith(event);
      expect(event.target).toBe(target);

      target['removeEventListener']('popstate', listener);
      expect(events.window.hasListeners('popstate')).toBe(false);
    });

    it('installs Event and CustomEvent', () => {
      const target = lynxGlobal();
      installGlobalWindow(target, hubFor(target));
      expect(target['Event']).toBe(LynxEvent);
      expect(target['CustomEvent']).toBeTypeOf('function');
    });

    it("has the LynxView's size, or the screen's before the first layout", () => {
      const target = lynxGlobal();
      const events = hubFor(target);
      vi.stubGlobal('SystemInfo', {
        pixelWidth: 1170,
        pixelHeight: 2532,
        pixelRatio: 3,
      });
      installGlobalWindow(target, events);

      expect(target['innerWidth']).toBe(390);
      expect(target['innerHeight']).toBe(844);

      events.resized({ width: 402, height: 800 });
      expect(target['innerWidth']).toBe(402);
      expect(target['innerHeight']).toBe(800);
    });

    it('reads SystemInfo from lynx, and has no size without it', () => {
      const target = lynxGlobal();
      installGlobalWindow(target, hubFor(target));

      expect(target['innerWidth']).toBe(0);
      vi.stubGlobal('lynx', { SystemInfo: { pixelWidth: 800 } });
      expect(target['innerWidth']).toBe(800);
    });

    it('installs once', () => {
      const target = lynxGlobal();
      installGlobalWindow(target, hubFor(target));
      const add = target['addEventListener'];
      installGlobalWindow(target, hubFor(target));
      expect(target['addEventListener']).toBe(add);
    });
  });

  describe("in a browser's window", () => {
    /**
     * The web preview's iframe window, or jsdom's.
     */
    const browserGlobal = () => {
      const original = {
        add: vi.fn(),
        remove: vi.fn(),
        dispatch: vi.fn(() => true),
      };
      const target: Record<string | symbol, any> = {
        addEventListener: original.add,
        removeEventListener: original.remove,
        dispatchEvent: original.dispatch,
        document: { nodeType: 9 },
        innerWidth: 1024,
      };
      return { target, original };
    };

    it("takes the screen's events, and leaves it the others", () => {
      const { target, original } = browserGlobal();
      const events = hubFor(target);
      installGlobalWindow(target, events);
      const listener = vi.fn();

      for (const type of ['resize', 'message']) {
        target['addEventListener'](type, listener, true);
        target['dispatchEvent'](new LynxEvent(type));
        target['removeEventListener'](type, listener, true);
      }

      expect(listener).toHaveBeenCalledTimes(1);
      expect(original.add).toHaveBeenCalledWith('message', listener, true);
      expect(original.add).not.toHaveBeenCalledWith(
        'resize',
        expect.anything(),
        expect.anything(),
      );
      expect(original.dispatch).toHaveBeenCalledTimes(1);
      expect(original.remove).toHaveBeenCalledWith('message', listener, true);
      expect(SCREEN_EVENTS.has('pointermove')).toBe(true);
    });

    it('leaves jsdom the listeners its selector engine adds as it starts', () => {
      const { target, original } = browserGlobal();
      // jsdom starts the engine, which listens for clicks on the window, on
      // its document's first selector, and only then.
      const engine = vi.fn();
      let started = false;
      target['document'].querySelector = () => {
        if (started) return;
        started = true;
        target['addEventListener']('click', engine);
      };
      const events = hubFor(target);

      installGlobalWindow(target, events);
      target['document'].querySelector(':root');

      expect(original.add).toHaveBeenCalledWith('click', engine);
      expect(events.window.hasListeners('click')).toBe(false);
    });

    it("keeps jsdom's size", () => {
      const { target } = browserGlobal();
      installGlobalWindow(target, hubFor(target));
      expect(target['innerWidth']).toBe(1024);
    });

    it("has the LynxView's size in the web preview, whose own is a hidden iframe's", () => {
      vi.stubGlobal('__WEB__', true);
      const { target } = browserGlobal();
      const events = hubFor(target);
      installGlobalWindow(target, events);

      events.resized({ width: 402, height: 874 });

      expect(target['innerWidth']).toBe(402);
      expect(target['innerHeight']).toBe(874);
    });
  });
});

describe('installGlobalDocument', () => {
  it("replaces the polyfills' placeholder", () => {
    const target: Record<string, any> = { document: { defaultView: {} } };
    const events = hubFor(target);
    installGlobalDocument(target, events);
    expect(target['document']).toBe(events.document);
  });

  it('keeps a DOM document', () => {
    const document = { nodeType: 9 };
    const target: Record<string, any> = { document };
    installGlobalDocument(target, hubFor(target));
    expect(target['document']).toBe(document);
  });
});
