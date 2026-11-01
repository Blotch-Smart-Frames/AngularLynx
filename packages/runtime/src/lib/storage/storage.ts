import { Injectable } from '@angular/core';
import { callOnBackground } from '../background-call';

/**
 * What the shells' storage modules call back with: `{ value }` for a stored
 * value, `{}` for none, or `{ error }`.
 */
type NativeResult = { readonly value?: string; readonly error?: string };

/** Somewhere to keep strings: the native module, the browser, or memory. */
type StringStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
};

/**
 * The part of the browser's `Storage` this uses. The runtime builds without
 * the DOM's types, since Lynx has no DOM.
 */
type BrowserStorage = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * A call that never reached a storage module: the host has none, as in Lynx
 * Explorer and tests. It isn't what the module answered, so it sends the
 * service to its in-memory store rather than to the caller.
 */
class NoModuleError extends Error {}

/**
 * Calls one of the shells' storage modules, which answer through a callback
 * on the background thread, where `NativeModules` lives (see
 * callNativeModuleAsync in background-call.ts).
 */
const nativeStore = (module: string): StringStore => {
  const call = async (method: string, args: string[]) => {
    let result: NativeResult | undefined;
    try {
      result = (await callOnBackground(
        'callNativeModuleAsync',
        module,
        method,
        args,
      )) as NativeResult | undefined;
    } catch (error) {
      throw new NoModuleError((error as Error).message);
    }
    if (result?.error !== undefined) {
      throw new Error(result.error);
    }
    return result?.value ?? null;
  };
  return {
    getItem: (key) => call('getItem', [key]),
    setItem: async (key, value) => {
      await call('setItem', [key, value]);
    },
    removeItem: async (key) => {
      await call('removeItem', [key]);
    },
    clear: async () => {
      await call('clear', []);
    },
  };
};

/**
 * The browser's `localStorage`, with each key behind `prefix`, so `clear()`
 * removes only this store's keys and not the rest of the page's.
 */
const browserStore = (
  storage: BrowserStorage,
  prefix: string,
): StringStore => ({
  getItem: async (key) => storage.getItem(prefix + key),
  setItem: async (key, value) => storage.setItem(prefix + key, value),
  removeItem: async (key) => storage.removeItem(prefix + key),
  clear: async () => {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  },
});

const memoryStore = (): StringStore => {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
    clear: async () => values.clear(),
  };
};

/**
 * The page's `localStorage` in Lynx for Web, or undefined elsewhere.
 *
 * Web-core runs the main thread, where Angular runs, in an iframe with the
 * page's origin, so it has the page's `localStorage`. Reading it throws where
 * the browser blocks storage. Elsewhere it's left alone even where it exists,
 * such as in unit tests under jsdom, which stand in for a native host.
 */
const browserStorage = (): BrowserStorage | undefined => {
  if (
    typeof SystemInfo === 'undefined' ||
    // `@lynx-js/types`' PlatformType leaves out the 'web' web-core reports.
    (SystemInfo.platform as string) !== 'web'
  ) {
    return undefined;
  }
  try {
    return (globalThis as { localStorage?: BrowserStorage }).localStorage;
  } catch {
    return undefined;
  }
};

/**
 * Values are stored as JSON. One that isn't, such as a string the host app
 * wrote, comes back as the string it is.
 */
const decode = <T>(raw: string): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
};

/**
 * What {@link LynxLocalStorage} and {@link LynxSecureStorage} share: a
 * key-value store of JSON values with an async API, kept by a native module
 * of the apps `ng build --platform` makes, by `localStorage` on the web, and
 * in memory elsewhere.
 */
abstract class PersistentStorage {
  readonly #native: StringStore;
  readonly #webPrefix: string;
  readonly #memory = memoryStore();
  /** False once a call found that the host has no native module. */
  #hasModule = true;

  /**
   * @param module - The native module's name in `NativeModules`.
   * @param webPrefix - What this store's keys start with in `localStorage`.
   */
  constructor(module: string, webPrefix: string) {
    this.#native = nativeStore(module);
    this.#webPrefix = webPrefix;
  }

  /**
   * Resolves with the value stored under `key`, or `null` if there's none.
   */
  async getItem<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.#run((store) => store.getItem(key));
    return raw === null ? null : decode<T>(raw);
  }

  /**
   * Stores `value` under `key`, as JSON: an object, an array, a string, a
   * number, a boolean or `null`. Resolves once it's stored.
   */
  async setItem<T = unknown>(key: string, value: T): Promise<void> {
    const raw = JSON.stringify(value);
    if (raw === undefined) {
      throw new TypeError(
        `Can't store a ${typeof value} under "${key}": values are stored as JSON.`,
      );
    }
    await this.#run((store) => store.setItem(key, raw));
  }

  /**
   * Removes the value stored under `key`, if there is one.
   */
  async removeItem(key: string): Promise<void> {
    await this.#run((store) => store.removeItem(key));
  }

  /**
   * Removes every value in this store.
   */
  async clear(): Promise<void> {
    await this.#run((store) => store.clear());
  }

  /**
   * Runs `operation` on the store this host has. The native module is tried
   * first, except on the web, and a host without one, which stays without
   * it, gets the in-memory store from then on.
   */
  async #run<R>(operation: (store: StringStore) => Promise<R>): Promise<R> {
    const web = browserStorage();
    if (web) {
      return operation(browserStore(web, this.#webPrefix));
    }
    if (this.#hasModule) {
      try {
        return await operation(this.#native);
      } catch (error) {
        if (!(error instanceof NoModuleError)) throw error;
        this.#hasModule = false;
      }
    }
    return operation(this.#memory);
  }
}

/**
 * A key-value store that keeps its values after the app closes, like the
 * browser's `localStorage`. Values are JSON (objects, arrays, strings,
 * numbers, booleans) and every method returns a promise.
 *
 * - **iOS:** `UserDefaults`, in a suite of its own.
 * - **Android:** `SharedPreferences`, in a file of its own.
 * - **Web:** the page's `localStorage`, with each key starting with
 *   `angular-lynx:`.
 *
 * For tokens and other secrets, use {@link LynxSecureStorage}.
 *
 * Only the apps `ng build --platform` makes have the native module behind
 * it, `AngularLynxLocalStorage`. Elsewhere, such as in Lynx Explorer and
 * tests, it keeps values in memory, so they last until the app closes.
 *
 * @usageNotes
 * ```typescript
 * const storage = inject(LynxLocalStorage);
 *
 * await storage.setItem('settings', { units: 'metric' });
 * const settings = await storage.getItem<Settings>('settings');
 * await storage.removeItem('settings');
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxLocalStorage extends PersistentStorage {
  constructor() {
    super('AngularLynxLocalStorage', 'angular-lynx:');
  }
}

/**
 * A key-value store for secrets such as tokens, which keeps its values after
 * the app closes, encrypted by the platform. It has the same methods as
 * {@link LynxLocalStorage}.
 *
 * - **iOS:** the Keychain, readable once the phone has been unlocked after it
 *   starts, and never copied to another device. The Keychain keeps its items
 *   when the app is deleted, so a reinstalled app finds them again.
 * - **Android:** `SharedPreferences`, each value encrypted with AES-GCM by a
 *   key the Android Keystore holds. The file is left out of backups, which
 *   can't take the key with them.
 * - **Web:** the page's `localStorage`, with each key starting with
 *   `angular-lynx-secure:`. Browsers have no store for secrets, and web
 *   sign-in libraries keep their tokens there too.
 *
 * Only the apps `ng build --platform` makes have the native module behind
 * it, `AngularLynxSecureStorage`. Elsewhere, such as in Lynx Explorer and
 * tests, it keeps values in memory, so they last until the app closes.
 *
 * @usageNotes
 * ```typescript
 * const storage = inject(LynxSecureStorage);
 *
 * await storage.setItem('session', session);
 * const session = await storage.getItem<Session>('session');
 * await storage.removeItem('session');
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxSecureStorage extends PersistentStorage {
  constructor() {
    super('AngularLynxSecureStorage', 'angular-lynx-secure:');
  }
}
