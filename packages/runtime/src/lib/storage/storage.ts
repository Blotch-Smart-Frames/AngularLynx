import { Injectable } from '@angular/core';
import { callOnBackground } from '../background-call';
import {
  biometricsFailure,
  biometricsUnavailable,
  callBiometrics,
} from '../biometrics/biometrics';
import type { PlatformType } from '../system-info/system-info';

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
    // The global is typed by `@lynx-js/types`, whose PlatformType leaves out
    // the 'web' web-core reports; AngularLynx's own PlatformType has it.
    (SystemInfo.platform as PlatformType) !== 'web'
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
 * A value as it's stored: JSON, or a TypeError for one JSON can't hold.
 */
const encode = (key: string, value: unknown): string => {
  const raw = JSON.stringify(value);
  if (raw === undefined) {
    throw new TypeError(
      `Can't store a ${typeof value} under "${key}": values are stored as JSON.`,
    );
  }
  return raw;
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
    const raw = encode(key, value);
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

/** How {@link LynxSecureStorage.setItem} keeps a value. */
export type SecureStorageSetOptions = {
  /**
   * Keeps the value where the platform hands it over only after the person
   * confirms who they are with Face ID, Touch ID or a strong fingerprint or
   * face sensor: a Keychain item with `.biometryCurrentSet` access on iOS,
   * and on Android a value only a Keystore key that needs a biometric can
   * decrypt. Storing it doesn't prompt; each `getItem()` does.
   *
   * Setting up a new face or finger makes every such value unreadable, so a
   * thief who learns the passcode can't add their own and read it:
   * `getItem()` then resolves `null`, and the app signs the person in
   * again. Needs `permissions.biometrics` in angular.json, and rejects with
   * a {@link BiometricsError} (`unavailable`) without it, as it does in the
   * web preview, Lynx Explorer and on a phone without a passcode.
   */
  readonly requireBiometrics?: boolean;
};

/** How {@link LynxSecureStorage.getItem} reads a value. */
export type SecureStorageGetOptions = {
  /**
   * What the biometric prompt says, for a value stored with
   * `requireBiometrics`. Defaults to angular.json's `permissions.biometrics`.
   */
  readonly reason?: string;
};

/**
 * A key-value store for secrets such as tokens, which keeps its values after
 * the app closes, encrypted by the platform. It has the same methods as
 * {@link LynxLocalStorage}, and can keep a value behind Face ID, Touch ID or
 * a fingerprint (`requireBiometrics`), which needs `permissions.biometrics`
 * in angular.json (see {@link LynxBiometrics}).
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
  /**
   * False once a call found that the host has no biometrics module, as in
   * every app without `permissions.biometrics`, so the plain calls stop
   * crossing to the background thread to find that out again.
   */
  #hasBiometrics = true;

  /**
   * The last change still running. A change writes one store and then
   * removes the key from the other, so two that overlap could each remove
   * what the other wrote: changes run one at a time, in the order they were
   * made.
   */
  #changes: Promise<unknown> = Promise.resolve();

  constructor() {
    super('AngularLynxSecureStorage', 'angular-lynx-secure:');
  }

  /**
   * Resolves with the value stored under `key`, or `null` if there's none.
   * A value stored with `requireBiometrics` shows the biometric prompt
   * first, and rejects with a {@link BiometricsError} if the person doesn't
   * confirm.
   */
  override async getItem<T = unknown>(
    key: string,
    options: SecureStorageGetOptions = {},
  ): Promise<T | null> {
    const plain = await super.getItem<T>(key);
    if (plain !== null) return plain;
    const result = await this.#biometrics('getItem', [
      key,
      options.reason ?? '',
    ]);
    const failure = biometricsFailure(result);
    if (failure) throw failure;
    const raw = result?.value;
    return typeof raw === 'string' ? decode<T>(raw) : null;
  }

  /**
   * Stores `value` under `key`, as JSON, in place of whatever was there.
   * Resolves once it's stored. With `requireBiometrics`, reading it back
   * asks for Face ID, Touch ID or a fingerprint.
   */
  override async setItem<T = unknown>(
    key: string,
    value: T,
    options: SecureStorageSetOptions = {},
  ): Promise<void> {
    // Checked before it waits its turn, as the plain store checks it.
    const raw = encode(key, value);
    return this.#change(async () => {
      if (!options.requireBiometrics) {
        await super.setItem(key, value);
        await this.#removeGuarded(key);
        return;
      }
      const result = await this.#biometrics('setItem', [key, raw]);
      if (result === undefined && !this.#hasBiometrics) {
        throw biometricsUnavailable();
      }
      const failure = biometricsFailure(result);
      if (failure) throw failure;
      await super.removeItem(key);
    });
  }

  override removeItem(key: string): Promise<void> {
    return this.#change(async () => {
      await super.removeItem(key);
      await this.#removeGuarded(key);
    });
  }

  override clear(): Promise<void> {
    return this.#change(async () => {
      await super.clear();
      const failure = biometricsFailure(await this.#biometrics('clear', []));
      if (failure) throw failure;
    });
  }

  /**
   * Removes the value kept behind biometrics under `key`, and rejects when
   * the platform couldn't, as on iOS when the Keychain refuses: a later read
   * would find it again.
   */
  async #removeGuarded(key: string): Promise<void> {
    const failure = biometricsFailure(
      await this.#biometrics('removeItem', [key]),
    );
    if (failure) throw failure;
  }

  /** Runs `change` once the changes before it have settled. */
  #change(change: () => Promise<void>): Promise<void> {
    const run = this.#changes.then(change, change);
    this.#changes = run.catch(() => undefined);
    return run;
  }

  /**
   * Calls the biometrics module's store, or resolves undefined where the
   * host has none: there's nothing kept behind biometrics there.
   */
  async #biometrics(
    method: string,
    args: unknown[],
  ): Promise<{ value?: unknown; error?: string } | undefined> {
    if (!this.#hasBiometrics) return undefined;
    try {
      return await callBiometrics(method, args);
    } catch {
      // callBiometrics() rejects only where the call never reached a module.
      this.#hasBiometrics = false;
      return undefined;
    }
  }
}
