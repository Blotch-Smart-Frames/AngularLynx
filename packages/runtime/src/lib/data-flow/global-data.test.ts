import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxGlobalData } from './global-data';

describe('LynxGlobalData', () => {
  afterEach(() => {
    delete (globalThis as any).lynx;
  });

  describe('when lynx is not defined', () => {
    it('initializes globalData to an empty object', () => {
      const service = new LynxGlobalData();

      expect(service.globalData()).toEqual({});
    });

    it('does not throw when constructing without a lynx global', () => {
      expect(() => new LynxGlobalData()).not.toThrow();
    });
  });

  describe('when lynx exists but getJSModule is not available (web preview)', () => {
    beforeEach(() => {
      (globalThis as any).lynx = { __globalProps: { theme: 'dark' } };
    });

    it('does not throw', () => {
      expect(() => new LynxGlobalData()).not.toThrow();
    });

    it('seeds globalData from lynx.__globalProps', () => {
      const service = new LynxGlobalData();

      expect(service.globalData()).toEqual({ theme: 'dark' });
    });
  });

  describe('when lynx is defined', () => {
    let addListener: ReturnType<typeof vi.fn>;
    let getJSModule: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      addListener = vi.fn();
      getJSModule = vi.fn().mockReturnValue({ addListener });
      (globalThis as any).lynx = {
        __globalProps: { theme: 'dark' },
        getJSModule,
      };
    });

    it('seeds globalData from lynx.__globalProps at construction', () => {
      const service = new LynxGlobalData();

      expect(service.globalData()).toEqual({ theme: 'dark' });
    });

    it('calls getJSModule with "GlobalEventEmitter"', () => {
      new LynxGlobalData();

      expect(getJSModule).toHaveBeenCalledWith('GlobalEventEmitter');
    });

    it('registers a listener for the "onGlobalPropsChanged" event', () => {
      new LynxGlobalData();

      expect(addListener).toHaveBeenCalledWith(
        'onGlobalPropsChanged',
        expect.any(Function),
      );
    });

    it('updates globalData to the first argument when the listener is called', () => {
      const service = new LynxGlobalData();
      const listener: (...args: unknown[]) => void =
        addListener.mock.calls[0][1];

      listener({ theme: 'light', locale: 'en' });

      expect(service.globalData()).toEqual({ theme: 'light', locale: 'en' });
    });

    it('ignores extra arguments beyond the first when the listener fires', () => {
      const service = new LynxGlobalData();
      const listener: (...args: unknown[]) => void =
        addListener.mock.calls[0][1];

      listener({ theme: 'light' }, 'extra', 42);

      expect(service.globalData()).toEqual({ theme: 'light' });
    });

    it('replaces globalData entirely on each successive update', () => {
      const service = new LynxGlobalData();
      const listener: (...args: unknown[]) => void =
        addListener.mock.calls[0][1];

      listener({ a: 1 });
      listener({ b: 2 });

      expect(service.globalData()).toEqual({ b: 2 });
    });
  });

  describe('when running on the main thread', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('does not subscribe to GlobalEventEmitter (Lepus context has no getJSModule)', () => {
      // __MAIN_THREAD__ is a compile-time define in the real build; stub it
      // as a global here to exercise the runtime guard directly.
      vi.stubGlobal('__MAIN_THREAD__', true);
      const getJSModule = vi.fn();
      (globalThis as any).lynx = {
        __globalProps: { theme: 'dark' },
        getJSModule,
      };

      const service = new LynxGlobalData();

      expect(service.globalData()).toEqual({ theme: 'dark' });
      expect(getJSModule).not.toHaveBeenCalled();
    });
  });

  describe('when the GlobalEventEmitter module has no addListener', () => {
    it('does not throw and leaves globalData seeded', () => {
      // A stub/partial host module (no addListener) must not crash construction.
      (globalThis as any).lynx = {
        __globalProps: { theme: 'dark' },
        getJSModule: vi.fn().mockReturnValue({}),
      };

      let service!: LynxGlobalData;
      expect(() => {
        service = new LynxGlobalData();
      }).not.toThrow();
      expect(service.globalData()).toEqual({ theme: 'dark' });
    });
  });
});
