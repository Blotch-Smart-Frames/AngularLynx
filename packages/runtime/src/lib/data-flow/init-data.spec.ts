import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxInitData } from './init-data';

describe('LynxInitData', () => {
  afterEach(() => {
    delete (globalThis as any).lynx;
  });

  describe('when lynx is not defined', () => {
    it('initializes initData to an empty object', () => {
      const service = new LynxInitData();

      expect(service.initData()).toEqual({});
    });

    it('does not throw when constructing without a lynx global', () => {
      expect(() => new LynxInitData()).not.toThrow();
    });
  });

  describe('when lynx exists but getJSModule is not available (web preview)', () => {
    beforeEach(() => {
      (globalThis as any).lynx = { __initData: { userId: 'web' } };
    });

    it('does not throw', () => {
      expect(() => new LynxInitData()).not.toThrow();
    });

    it('seeds initData from lynx.__initData', () => {
      const service = new LynxInitData();

      expect(service.initData()).toEqual({ userId: 'web' });
    });
  });

  describe('when lynx is defined', () => {
    let addListener: ReturnType<typeof vi.fn>;
    let getJSModule: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      addListener = vi.fn();
      getJSModule = vi.fn().mockReturnValue({ addListener });
      (globalThis as any).lynx = {
        __initData: { userId: 'abc' },
        getJSModule,
      };
    });

    it('seeds initData from lynx.__initData at construction', () => {
      const service = new LynxInitData();

      expect(service.initData()).toEqual({ userId: 'abc' });
    });

    it('calls getJSModule with "GlobalEventEmitter"', () => {
      new LynxInitData();

      expect(getJSModule).toHaveBeenCalledWith('GlobalEventEmitter');
    });

    it('registers a listener for the "onDataChanged" event', () => {
      new LynxInitData();

      expect(addListener).toHaveBeenCalledWith(
        'onDataChanged',
        expect.any(Function),
      );
    });

    it('updates initData to the first argument when the listener is called', () => {
      const service = new LynxInitData();
      const listener: (...args: unknown[]) => void =
        addListener.mock.calls[0][1];

      listener({ userId: 'xyz', role: 'admin' });

      expect(service.initData()).toEqual({ userId: 'xyz', role: 'admin' });
    });

    it('ignores extra arguments beyond the first when the listener fires', () => {
      const service = new LynxInitData();
      const listener: (...args: unknown[]) => void =
        addListener.mock.calls[0][1];

      listener({ userId: 'xyz' }, 'extra', 42);

      expect(service.initData()).toEqual({ userId: 'xyz' });
    });

    it('replaces initData entirely on each successive update', () => {
      const service = new LynxInitData();
      const listener: (...args: unknown[]) => void =
        addListener.mock.calls[0][1];

      listener({ a: 1 });
      listener({ b: 2 });

      expect(service.initData()).toEqual({ b: 2 });
    });

    it('seeds initData to an empty object when lynx.__initData is undefined', () => {
      (globalThis as any).lynx.__initData = undefined;

      const service = new LynxInitData();

      expect(service.initData()).toEqual(undefined);
    });
  });
});
