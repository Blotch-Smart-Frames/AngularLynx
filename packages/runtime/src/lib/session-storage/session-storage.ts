import {
  type Injector,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import type { SessionStorageSubscription } from './session-storage.types';

/**
 * Wraps Lynx's session storage API for sharing data across multiple LynxViews.
 *
 * Session storage is a key-value store that persists for the lifetime of the
 * host app session. Unlike browser localStorage, values are objects (not strings)
 * and reads are asynchronous (callback-based in the native API, Promise-based here).
 *
 * The `setSessionStorageItem` / `getSessionStorageItem` / `subscribeSessionStorage` /
 * `unsubscribeSessionStorage` methods are not declared in `@lynx-js/types`, so we
 * access them via `any` — the APIs are stable and documented on lynxjs.org.
 *
 * The native surface differs by thread, and AngularLynx bootstraps the same
 * component tree on both (see runtime.ts), so this service must detect which
 * thread it's on rather than assume one shape everywhere:
 * - Background thread: `getSessionStorageItem(key, callback)` is async, plus
 *   `subscribeSessionStorage`/`unsubscribeSessionStorage` for pub/sub.
 * - Main thread (Lepus engine, see `Utils::CreateLynx` in lynx core): only
 *   `setSessionStorageItem`/`getSessionStorageItem` are registered — no
 *   subscribe/unsubscribe at all — and `getSessionStorageItem` is
 *   *synchronous*, taking just the key and returning the value directly.
 *   Calling it with a callback (the background-thread shape) throws a native
 *   "GetSessionStorageItem param size should be 1" fatal error.
 *
 * @usageNotes
 * ```typescript
 * const sessionStorage = inject(LynxSessionStorage);
 *
 * // Write
 * sessionStorage.setItem('theme', { mode: 'dark' });
 *
 * // One-shot read
 * const theme = await sessionStorage.getItem<{ mode: string }>('theme');
 *
 * // Reactive signal (auto-subscribes, auto-cleans up with injection context)
 * const theme = sessionStorage.watch<{ mode: string }>('theme');
 * // theme() updates whenever another LynxView calls setItem('theme', ...)
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxSessionStorage {
  // In-memory fallback when native session storage is unavailable (web preview, tests, SSR).
  readonly #store = new Map<string, unknown>();
  readonly #listeners = new Map<
    string,
    Map<number, (value: unknown) => void>
  >();
  #nextId = 0;

  #hasNativeSessionStorage(): boolean {
    return (
      typeof lynx !== 'undefined' &&
      typeof (lynx as any).setSessionStorageItem === 'function'
    );
  }

  /**
   * The main thread's `lynx` global never registers subscribe/unsubscribe
   * (only setSessionStorageItem/getSessionStorageItem exist there), so pub/sub
   * must always fall back to the local listener map on that thread.
   */
  #hasNativeSubscription(): boolean {
    return (
      this.#hasNativeSessionStorage() &&
      !(typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__)
    );
  }

  /**
   * Notifies every locally-registered listener for a key. Extracted so the
   * two callers that must drive the local pub/sub layer — the in-memory
   * fallback and the main-thread native path — share one implementation
   * instead of duplicating the map walk (the main-thread path originally
   * omitted it entirely, which is what left watched signals stale).
   *
   * On the main thread native pub/sub does not exist, so {@link watch}'s
   * subscription lives entirely in this local map and only this call reaches
   * it.
   */
  #notifyLocalListeners(key: string, value: unknown): void {
    const keyListeners = this.#listeners.get(key);
    if (keyListeners) {
      for (const [, cb] of keyListeners) cb(value);
    }
  }

  /**
   * Stores a value in session storage, shared across all LynxViews.
   * Existing subscribers for this key will be notified of the change.
   *
   * Two main-thread quirks are handled here, both discovered as on-device
   * crashes/bugs in the session-storage example:
   *
   * 1. **Values must be objects.** The main thread's native
   *    setSessionStorageItem rejects primitives with a fatal
   *    "SetSessionStorageItem param 1 should be Object" error, so a bare
   *    `setItem('counter', 1)` would crash on Increment. We wrap primitives
   *    in `{ __data }` (getItem unwraps them symmetrically).
   *
   * 2. **No native pub/sub.** The main thread registers only get/set — there
   *    is no subscribeSessionStorage — so {@link watch}'s subscription falls
   *    back to the local listener map (see {@link subscribe}). A native write
   *    alone therefore never reaches those listeners: the counter signal stays
   *    on its seed value and the UI shows "not set" no matter how many times
   *    the user taps Increment. We bridge the gap by firing the local
   *    listeners ourselves right after the native write.
   *
   * The background thread deliberately does NOT call #notifyLocalListeners:
   * there, watch() subscribes through native subscribeSessionStorage, and the
   * native layer already fans the change out to every LynxView (including this
   * one). Firing local listeners too would double-notify. There is no infinite
   * loop in either case — #notifyLocalListeners only invokes stored callbacks,
   * it never calls setItem back.
   */
  setItem<T = unknown>(key: string, value: T): void {
    if (this.#hasNativeSessionStorage()) {
      // Main thread requires values to be objects; wrap primitives.
      if (typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__) {
        const wrapped =
          typeof value === 'object' && value !== null
            ? value
            : { __data: value };
        (lynx as any).setSessionStorageItem(key, wrapped);
        // Native subscribe/unsubscribe don't exist on the main thread, so
        // bridge the write to the local listener map that watch() relies on —
        // without this the watched signal never updates and the UI stays stale.
        this.#notifyLocalListeners(key, value);
        return;
      }
      // Background thread: native pub/sub notifies subscribers, so we don't.
      (lynx as any).setSessionStorageItem(key, value);
      return;
    }

    // In-memory fallback (web preview, tests, SSR): the local map is both the
    // store and the pub/sub layer, so write then notify.
    this.#store.set(key, value);
    this.#notifyLocalListeners(key, value);
  }

  /**
   * Reads a value from session storage. The native API is callback-based;
   * this wraps it in a Promise for ergonomic use with `async`/`await`.
   *
   * On the main thread, wrapped primitives are unwrapped here to match
   * the user's expectation that the value they stored is the value they get.
   */
  getItem<T = unknown>(key: string): Promise<T> {
    if (this.#hasNativeSessionStorage()) {
      // Main thread: synchronous, single-arg — see the class-level doc comment.
      if (typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__) {
        const raw = (lynx as any).getSessionStorageItem(key);
        // Undo setItem's primitive wrapping so callers get back exactly what
        // they stored. The `Object.keys(raw).length === 1` guard is what keeps
        // this from mangling genuine user objects: a real payload that happens
        // to have a `__data` key (e.g. `{ __data, other }`) has more than one
        // key and is returned untouched, so only our own single-key wrapper
        // { __data } is unwrapped.
        const unwrapped =
          raw != null &&
          typeof raw === 'object' &&
          '__data' in raw &&
          Object.keys(raw).length === 1
            ? (raw.__data as T)
            : (raw as T);
        return Promise.resolve(unwrapped);
      }

      return new Promise<T>((resolve) => {
        (lynx as any).getSessionStorageItem(key, (value: T) => resolve(value));
      });
    }

    return Promise.resolve(this.#store.get(key) as T);
  }

  /**
   * Subscribes to changes for a session storage key. The callback fires
   * whenever any LynxView calls `setItem` with the same key.
   *
   * Returns the subscription needed for {@link unsubscribe}.
   */
  subscribe<T = unknown>(
    key: string,
    callback: (value: T) => void,
  ): SessionStorageSubscription {
    if (this.#hasNativeSubscription()) {
      const listenerId: number = (lynx as any).subscribeSessionStorage(
        key,
        callback,
      );
      return { key, listenerId };
    }

    const id = this.#nextId++;
    let keyListeners = this.#listeners.get(key);
    if (!keyListeners) {
      keyListeners = new Map();
      this.#listeners.set(key, keyListeners);
    }
    keyListeners.set(id, callback as (value: unknown) => void);
    return { key, listenerId: id };
  }

  /**
   * Cancels a session storage subscription created by {@link subscribe}.
   */
  unsubscribe(subscription: SessionStorageSubscription): void {
    if (this.#hasNativeSubscription()) {
      (lynx as any).unsubscribeSessionStorage(
        subscription.key,
        subscription.listenerId,
      );
      return;
    }

    this.#listeners.get(subscription.key)?.delete(subscription.listenerId);
  }

  /**
   * Creates a reactive signal that tracks a session storage key.
   *
   * Seeds the signal with the current value via `getItem`, then subscribes
   * to future changes. The subscription is automatically cleaned up when the
   * calling component/service is destroyed.
   *
   * Must be called from an injection context (constructor, field initializer,
   * or `runInInjectionContext`) unless an explicit `injector` is provided.
   */
  watch<T = unknown>(
    key: string,
    options?: { injector?: Injector },
  ): ReturnType<typeof signal<T | undefined>> {
    const value = signal<T | undefined>(undefined);

    // Seed with current value.
    this.getItem<T>(key).then((v) => value.set(v));

    // Subscribe to future changes.
    const subscription = this.subscribe<T>(key, (v) => value.set(v));

    // Auto-cleanup when the caller's injection context is destroyed.
    const destroyRef = options?.injector
      ? options.injector.get(DestroyRef)
      : inject(DestroyRef);
    destroyRef.onDestroy(() => this.unsubscribe(subscription));

    return value;
  }
}
