import { type EnvironmentInjector, DestroyRef } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxSessionStorage } from './session-storage';

const createMockInjector = () => {
  const destroyCallbacks: (() => void)[] = [];
  const mockDestroyRef: DestroyRef = {
    onDestroy: (cb: () => void) => {
      destroyCallbacks.push(cb);
      return () => {};
    },
  } as any;
  const injector = {
    get: (token: any) => {
      if (token === DestroyRef) return mockDestroyRef;
      throw new Error(`Unexpected token: ${token}`);
    },
  } as EnvironmentInjector;
  return { injector, destroyCallbacks };
};

describe('LynxSessionStorage', () => {
  afterEach(() => {
    delete (globalThis as any).lynx;
  });

  describe('when lynx is not defined', () => {
    it('does not throw when constructing', () => {
      expect(() => new LynxSessionStorage()).not.toThrow();
    });

    it('setItem stores in memory', () => {
      const service = new LynxSessionStorage();
      service.setItem('key', { value: 1 });

      return expect(service.getItem('key')).resolves.toEqual({ value: 1 });
    });

    it('getItem resolves with undefined for unset key', async () => {
      const service = new LynxSessionStorage();

      await expect(service.getItem('key')).resolves.toBeUndefined();
    });

    it('subscribe returns a subscription', () => {
      const service = new LynxSessionStorage();

      const sub = service.subscribe('key', vi.fn());

      expect(sub).toEqual({ key: 'key', listenerId: expect.any(Number) });
    });

    it('setItem notifies subscribers', () => {
      const service = new LynxSessionStorage();
      const callback = vi.fn();
      service.subscribe('key', callback);

      service.setItem('key', 42);

      expect(callback).toHaveBeenCalledWith(42);
    });

    it('unsubscribe stops notifications', () => {
      const service = new LynxSessionStorage();
      const callback = vi.fn();
      const sub = service.subscribe('key', callback);
      service.unsubscribe(sub);

      service.setItem('key', 99);

      expect(callback).not.toHaveBeenCalled();
    });

    it('watch returns a functional signal', async () => {
      const service = new LynxSessionStorage();
      const { injector } = createMockInjector();

      const value = service.watch<number>('counter', { injector });
      expect(value()).toBeUndefined();

      service.setItem('counter', 5);
      expect(value()).toBe(5);
    });
  });

  describe('when lynx is defined without session storage methods', () => {
    beforeEach(() => {
      (globalThis as any).lynx = {};
    });

    it('setItem stores in memory', () => {
      const service = new LynxSessionStorage();
      service.setItem('key', 'hello');

      return expect(service.getItem('key')).resolves.toBe('hello');
    });

    it('getItem resolves with undefined for unset key', async () => {
      const service = new LynxSessionStorage();

      await expect(service.getItem('missing')).resolves.toBeUndefined();
    });

    it('subscribe and setItem notify listeners', () => {
      const service = new LynxSessionStorage();
      const callback = vi.fn();
      service.subscribe('key', callback);

      service.setItem('key', { data: true });

      expect(callback).toHaveBeenCalledWith({ data: true });
    });

    it('watch produces a reactive signal', () => {
      const service = new LynxSessionStorage();
      const { injector } = createMockInjector();

      const counter = service.watch<number>('counter', { injector });
      expect(counter()).toBeUndefined();

      service.setItem('counter', 1);
      expect(counter()).toBe(1);

      service.setItem('counter', 2);
      expect(counter()).toBe(2);
    });

    it('watch cleans up on destroy', () => {
      const service = new LynxSessionStorage();
      const { injector, destroyCallbacks } = createMockInjector();

      const counter = service.watch<number>('counter', { injector });
      service.setItem('counter', 1);
      expect(counter()).toBe(1);

      destroyCallbacks.forEach((cb) => cb());

      service.setItem('counter', 99);
      // Signal should no longer update after destroy.
      expect(counter()).toBe(1);
    });
  });

  describe('when lynx is defined with session storage', () => {
    let setSessionStorageItemMock: ReturnType<typeof vi.fn>;
    let getSessionStorageItemMock: ReturnType<typeof vi.fn>;
    let subscribeSessionStorageMock: ReturnType<typeof vi.fn>;
    let unsubscribeSessionStorageMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      setSessionStorageItemMock = vi.fn();
      getSessionStorageItemMock = vi.fn();
      subscribeSessionStorageMock = vi.fn().mockReturnValue(42);
      unsubscribeSessionStorageMock = vi.fn();
      (globalThis as any).lynx = {
        setSessionStorageItem: setSessionStorageItemMock,
        getSessionStorageItem: getSessionStorageItemMock,
        subscribeSessionStorage: subscribeSessionStorageMock,
        unsubscribeSessionStorage: unsubscribeSessionStorageMock,
      };
    });

    it('setItem calls lynx.setSessionStorageItem', () => {
      const service = new LynxSessionStorage();

      service.setItem('theme', { mode: 'dark' });

      expect(setSessionStorageItemMock).toHaveBeenCalledWith('theme', {
        mode: 'dark',
      });
    });

    it('getItem resolves with the value from the callback', async () => {
      getSessionStorageItemMock.mockImplementation(
        (key: string, cb: (value: unknown) => void) => {
          cb({ mode: 'light' });
        },
      );
      const service = new LynxSessionStorage();

      const result = await service.getItem('theme');

      expect(result).toEqual({ mode: 'light' });
    });

    it('getItem passes the correct key', async () => {
      getSessionStorageItemMock.mockImplementation(
        (_key: string, cb: (value: unknown) => void) => cb(null),
      );
      const service = new LynxSessionStorage();

      await service.getItem('myKey');

      expect(getSessionStorageItemMock).toHaveBeenCalledWith(
        'myKey',
        expect.any(Function),
      );
    });

    it('subscribe calls lynx.subscribeSessionStorage', () => {
      const service = new LynxSessionStorage();
      const callback = vi.fn();

      service.subscribe('key', callback);

      expect(subscribeSessionStorageMock).toHaveBeenCalledWith('key', callback);
    });

    it('subscribe returns a subscription with the listener ID', () => {
      const service = new LynxSessionStorage();

      const sub = service.subscribe('key', vi.fn());

      expect(sub).toEqual({ key: 'key', listenerId: 42 });
    });

    it('unsubscribe calls lynx.unsubscribeSessionStorage', () => {
      const service = new LynxSessionStorage();

      service.unsubscribe({ key: 'theme', listenerId: 7 });

      expect(unsubscribeSessionStorageMock).toHaveBeenCalledWith('theme', 7);
    });

    describe('watch', () => {
      let injector: EnvironmentInjector;
      let destroyCallbacks: (() => void)[];

      beforeEach(() => {
        ({ injector, destroyCallbacks } = createMockInjector());
      });

      it('returns a signal seeded with undefined', () => {
        getSessionStorageItemMock.mockImplementation(() => {});
        const service = new LynxSessionStorage();

        const value = service.watch('key', { injector });

        expect(value()).toBeUndefined();
      });

      it('seeds the signal with the current value after async resolution', async () => {
        getSessionStorageItemMock.mockImplementation(
          (_key: string, cb: (value: unknown) => void) => cb({ count: 5 }),
        );
        const service = new LynxSessionStorage();

        const value = service.watch<{ count: number }>('counter', {
          injector,
        });
        await Promise.resolve();

        expect(value()).toEqual({ count: 5 });
      });

      it('subscribes to future changes for the key', () => {
        getSessionStorageItemMock.mockImplementation(() => {});
        const service = new LynxSessionStorage();

        service.watch('theme', { injector });

        expect(subscribeSessionStorageMock).toHaveBeenCalledWith(
          'theme',
          expect.any(Function),
        );
      });

      it('updates the signal when the subscription callback fires', () => {
        getSessionStorageItemMock.mockImplementation(() => {});
        const service = new LynxSessionStorage();

        const value = service.watch<string>('theme', { injector });
        const callback = subscribeSessionStorageMock.mock.calls[0][1] as (
          v: unknown,
        ) => void;
        callback('dark');

        expect(value()).toBe('dark');
      });

      it('unsubscribes when destroy is triggered', () => {
        getSessionStorageItemMock.mockImplementation(() => {});
        const service = new LynxSessionStorage();

        service.watch('key', { injector });
        destroyCallbacks.forEach((cb) => cb());

        expect(unsubscribeSessionStorageMock).toHaveBeenCalledWith('key', 42);
      });
    });
  });

  // The main thread's `lynx` global only exposes setSessionStorageItem/
  // getSessionStorageItem (synchronous, single-arg get) — no subscribe/
  // unsubscribe. See the class-level doc comment on LynxSessionStorage.
  describe('when lynx is defined with session storage on the main thread', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', true);
      (globalThis as any).lynx = {
        setSessionStorageItem: vi.fn(),
        getSessionStorageItem: vi.fn((key: string) =>
          key === 'theme' ? { mode: 'light' } : undefined,
        ),
      };
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('getItem calls the synchronous single-arg native API', async () => {
      const service = new LynxSessionStorage();

      const result = await service.getItem('theme');

      expect(result).toEqual({ mode: 'light' });
      expect(
        (globalThis as any).lynx.getSessionStorageItem,
      ).toHaveBeenCalledWith('theme');
    });

    it('getItem resolves undefined for an unset key without throwing', async () => {
      const service = new LynxSessionStorage();

      await expect(service.getItem('missing')).resolves.toBeUndefined();
    });

    it('subscribe does not call native subscribeSessionStorage (not present on this thread)', () => {
      const service = new LynxSessionStorage();

      // The mocked `lynx` has no subscribeSessionStorage/unsubscribeSessionStorage
      // at all, matching the real main thread — calling them would throw
      // "not a function". Falling back to the local map avoids that.
      const sub = service.subscribe('key', vi.fn());

      expect(sub).toEqual({ key: 'key', listenerId: expect.any(Number) });
    });

    it('unsubscribe does not call native unsubscribeSessionStorage (not present on this thread)', () => {
      const service = new LynxSessionStorage();
      const sub = service.subscribe('key', vi.fn());

      expect(() => service.unsubscribe(sub)).not.toThrow();
    });

    it('watch seeds from the synchronous native getItem without crashing', async () => {
      const service = new LynxSessionStorage();
      const { injector } = createMockInjector();

      const value = service.watch<{ mode: string }>('theme', { injector });
      await Promise.resolve();

      expect(value()).toEqual({ mode: 'light' });
    });

    it('watch cleans up via the local listener map on destroy', () => {
      const service = new LynxSessionStorage();
      const { injector, destroyCallbacks } = createMockInjector();

      expect(() => {
        service.watch('theme', { injector });
        destroyCallbacks.forEach((cb) => cb());
      }).not.toThrow();
    });

    it('setItem wraps primitives in an object before calling native API', () => {
      const setMock = vi.fn();
      (globalThis as any).lynx = {
        setSessionStorageItem: setMock,
        getSessionStorageItem: vi.fn(),
      };
      const service = new LynxSessionStorage();

      service.setItem('counter', 42);

      expect(setMock).toHaveBeenCalledWith('counter', { __data: 42 });
    });

    it('setItem does not double-wrap objects on main thread', () => {
      const setMock = vi.fn();
      (globalThis as any).lynx = {
        setSessionStorageItem: setMock,
        getSessionStorageItem: vi.fn(),
      };
      const service = new LynxSessionStorage();

      service.setItem('config', { mode: 'dark' });

      expect(setMock).toHaveBeenCalledWith('config', { mode: 'dark' });
    });

    it('getItem unwraps primitives stored via setItem', async () => {
      vi.unstubAllGlobals();
      vi.stubGlobal('__MAIN_THREAD__', true);
      (globalThis as any).lynx = {
        setSessionStorageItem: vi.fn(),
        getSessionStorageItem: vi.fn(() => ({ __data: 99 })),
      };
      const service = new LynxSessionStorage();

      const result = await service.getItem('counter');

      expect(result).toBe(99);
    });

    it('getItem does not unwrap actual object properties named __data', async () => {
      vi.unstubAllGlobals();
      vi.stubGlobal('__MAIN_THREAD__', true);
      (globalThis as any).lynx = {
        setSessionStorageItem: vi.fn(),
        getSessionStorageItem: vi.fn(() => ({ __data: 10, other: 20 })),
      };
      const service = new LynxSessionStorage();

      const result = await service.getItem('config');

      expect(result).toEqual({ __data: 10, other: 20 });
    });

    it('setItem notifies local subscribers on the main thread', () => {
      const service = new LynxSessionStorage();
      const callback = vi.fn();
      service.subscribe('counter', callback);

      service.setItem('counter', 5);

      // The main thread has no native pub/sub, so setItem must drive the
      // local listener map itself — this is the bridge watch() depends on.
      expect(callback).toHaveBeenCalledWith(5);
    });

    it('setItem drives a watch() signal on the main thread (regression)', () => {
      const service = new LynxSessionStorage();
      const { injector } = createMockInjector();

      const counter = service.watch<number>('counter', { injector });

      service.setItem('counter', 1);
      expect(counter()).toBe(1);

      service.setItem('counter', 2);
      expect(counter()).toBe(2);
    });
  });
});
