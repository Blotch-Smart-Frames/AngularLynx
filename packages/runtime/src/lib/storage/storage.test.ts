import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxLocalStorage, LynxSecureStorage } from './storage';

type Result = { value?: string; error?: string };
type Done = (result: Result) => void;

const create = <T>(service: new () => T): T =>
  Injector.create({ providers: [service] }).get(service);

/**
 * Stands in for one of the shells' storage modules, as the background thread
 * sees it: strings in a map, answered through a callback. Unit tests run as
 * the background thread, so the services call it directly.
 */
const stubModule = (name: string) => {
  const values = new Map<string, string>();
  const module = {
    getItem: vi.fn((key: string, done: Done) =>
      done(values.has(key) ? { value: values.get(key)! } : {}),
    ),
    setItem: vi.fn((key: string, value: string, done: Done) => {
      values.set(key, value);
      done({});
    }),
    removeItem: vi.fn((key: string, done: Done) => {
      values.delete(key);
      done({});
    }),
    clear: vi.fn((done: Done) => {
      values.clear();
      done({});
    }),
  };
  vi.stubGlobal('NativeModules', { [name]: module });
  return { module, values };
};

/**
 * A browser's localStorage, for Lynx for Web.
 */
const stubLocalStorage = (entries: Record<string, string> = {}) => {
  const values = new Map(Object.entries(entries));
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  vi.stubGlobal('SystemInfo', { platform: 'web' });
  vi.stubGlobal('localStorage', storage);
  return values;
};

describe('LynxLocalStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('with the native module', () => {
    it('stores values as JSON and reads them back', async () => {
      const { module, values } = stubModule('AngularLynxLocalStorage');
      const storage = create(LynxLocalStorage);

      await storage.setItem('settings', { units: 'metric', zoom: 2 });
      await storage.setItem('name', 'Ada');

      expect(module.setItem).toHaveBeenCalledWith(
        'settings',
        '{"units":"metric","zoom":2}',
        expect.any(Function),
      );
      expect(values.get('name')).toBe('"Ada"');
      await expect(storage.getItem('settings')).resolves.toEqual({
        units: 'metric',
        zoom: 2,
      });
      await expect(storage.getItem('name')).resolves.toBe('Ada');
    });

    it('resolves null for a key that was never set', async () => {
      stubModule('AngularLynxLocalStorage');

      await expect(
        create(LynxLocalStorage).getItem('missing'),
      ).resolves.toBeNull();
    });

    it('removes one value, and clears them all', async () => {
      const { module, values } = stubModule('AngularLynxLocalStorage');
      const storage = create(LynxLocalStorage);
      await storage.setItem('a', 1);
      await storage.setItem('b', 2);

      await storage.removeItem('a');
      expect([...values.keys()]).toEqual(['b']);

      await storage.clear();
      expect(module.clear).toHaveBeenCalledWith(expect.any(Function));
      expect(values.size).toBe(0);
    });

    it('returns a value that is not JSON as the string it is', async () => {
      const { values } = stubModule('AngularLynxLocalStorage');
      values.set('legacy', 'plain text');

      await expect(create(LynxLocalStorage).getItem('legacy')).resolves.toBe(
        'plain text',
      );
    });

    it('rejects with the error the module reports', async () => {
      const { module } = stubModule('AngularLynxLocalStorage');
      module.setItem.mockImplementation((_key, _value, done) =>
        done({ error: 'Disk full' }),
      );

      await expect(
        create(LynxLocalStorage).setItem('a', 1),
      ).rejects.toThrowError('Disk full');
    });

    it('rejects a value JSON has no text for, without calling the module', async () => {
      const { module } = stubModule('AngularLynxLocalStorage');
      const storage = create(LynxLocalStorage);

      await expect(storage.setItem('a', undefined)).rejects.toThrowError(
        new TypeError(
          'Can\'t store a undefined under "a": values are stored as JSON.',
        ),
      );
      await expect(storage.setItem('f', () => 1)).rejects.toThrowError(
        TypeError,
      );
      expect(module.setItem).not.toHaveBeenCalled();
    });
  });

  describe('without the native module', () => {
    it('keeps values in memory, and stops asking for the module', async () => {
      const getItem = vi.fn();
      vi.stubGlobal('NativeModules', { Other: { getItem } });
      const storage = create(LynxLocalStorage);

      await expect(storage.getItem('a')).resolves.toBeNull();
      await storage.setItem('a', { b: 1 });
      await storage.setItem('c', 2);
      await expect(storage.getItem('a')).resolves.toEqual({ b: 1 });

      await storage.removeItem('a');
      await expect(storage.getItem('a')).resolves.toBeNull();
      await storage.clear();
      await expect(storage.getItem('c')).resolves.toBeNull();

      // A module registered later isn't looked for.
      const { module } = stubModule('AngularLynxLocalStorage');
      await storage.getItem('a');
      expect(module.getItem).not.toHaveBeenCalled();
    });

    it('keeps each service in its own memory', async () => {
      const local = create(LynxLocalStorage);
      const secure = create(LynxSecureStorage);

      await local.setItem('token', 'local');
      await secure.setItem('token', 'secure');

      await expect(local.getItem('token')).resolves.toBe('local');
      await expect(secure.getItem('token')).resolves.toBe('secure');
    });
  });

  describe('on the web', () => {
    it("uses the page's localStorage, under a prefix of its own", async () => {
      const values = stubLocalStorage({ theme: 'dark' });
      const { module } = stubModule('AngularLynxLocalStorage');
      const storage = create(LynxLocalStorage);

      await storage.setItem('settings', { units: 'metric' });

      expect(values.get('angular-lynx:settings')).toBe('{"units":"metric"}');
      await expect(storage.getItem('settings')).resolves.toEqual({
        units: 'metric',
      });
      await expect(storage.getItem('theme')).resolves.toBeNull();
      await storage.removeItem('settings');
      expect(values.has('angular-lynx:settings')).toBe(false);
      expect(module.getItem).not.toHaveBeenCalled();
    });

    it("clears only its own keys, not the page's or the other store's", async () => {
      const values = stubLocalStorage({ theme: 'dark' });
      const local = create(LynxLocalStorage);
      const secure = create(LynxSecureStorage);
      await local.setItem('a', 1);
      await local.setItem('b', 2);
      await secure.setItem('token', 't');

      await local.clear();

      expect(Object.fromEntries(values)).toEqual({
        theme: 'dark',
        'angular-lynx-secure:token': '"t"',
      });
    });

    it('falls back to memory where the browser blocks storage', async () => {
      vi.stubGlobal('SystemInfo', { platform: 'web' });
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get: () => {
          throw new Error('SecurityError');
        },
      });
      try {
        const storage = create(LynxLocalStorage);

        await storage.setItem('a', 1);

        await expect(storage.getItem('a')).resolves.toBe(1);
      } finally {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      }
    });

    it("leaves localStorage alone on a native host that has one, as jsdom's tests do", async () => {
      const values = stubLocalStorage();
      vi.stubGlobal('SystemInfo', { platform: 'ios' });
      stubModule('AngularLynxLocalStorage');

      await create(LynxLocalStorage).setItem('a', 1);

      expect(values.size).toBe(0);
    });
  });
});

describe('LynxSecureStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps its values in the secure storage module', async () => {
    const { module, values } = stubModule('AngularLynxSecureStorage');
    const storage = create(LynxSecureStorage);

    await storage.setItem('session', { token: 'abc' });

    expect(module.setItem).toHaveBeenCalled();
    expect(values.get('session')).toBe('{"token":"abc"}');
    await expect(storage.getItem('session')).resolves.toEqual({
      token: 'abc',
    });
  });

  it('works as a Firebase React Native persistence storage', async () => {
    // Firebase's getReactNativePersistence() probes the storage like this,
    // and stores its values as JSON strings itself.
    stubModule('AngularLynxSecureStorage');
    const storage = create(LynxSecureStorage);

    await storage.setItem('__sak', '1');
    await storage.removeItem('__sak');
    await storage.setItem('firebase:authUser', JSON.stringify({ uid: 'u' }));

    await expect(storage.getItem('__sak')).resolves.toBeNull();
    await expect(storage.getItem('firebase:authUser')).resolves.toBe(
      '{"uid":"u"}',
    );
  });
});
