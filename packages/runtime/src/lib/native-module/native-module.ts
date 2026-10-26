import { Injectable } from '@angular/core';
import {
  callOnBackground,
  isMainThread,
  relayedModule,
  relayFunctions,
  relayModuleObject,
} from '../background-call';
import type { NativeModuleMap, NativeModuleProxy } from './native-module.types';

/**
 * Wraps the Lynx native module bridge and JS module registry as an Angular injectable.
 *
 * **Native modules** (`NativeModules` global) let JS code call native platform
 * functions (iOS / Android / HarmonyOS). The host app registers modules on the
 * native side; this service provides typed access from Angular.
 *
 * **JS modules** (`lynx.getJSModule` / `lynx.registerModule`) share JavaScript
 * values within a single LynxView. This is the same API used internally by
 * `LynxInitData` and `LynxGlobalData` (via `GlobalEventEmitter`).
 *
 * Lynx provides both only on the background thread, while Angular runs on the
 * main thread. So on the main thread every method goes through the background
 * call relay (background-call.ts): calls run on the background thread, their
 * results and callbacks come back as JSON, and a module is a proxy whose
 * methods return promises.
 *
 * @usageNotes
 * ```typescript
 * const modules = inject(LynxNativeModule);
 *
 * // Call a native method (Promise-based wrapper over bridge.call)
 * const result = await modules.call<string>('getDeviceId', {});
 *
 * // Listen for native events
 * modules.on('onDeepLink', (url) => console.log(url));
 *
 * // Access a typed custom native module
 * const storage = modules.getNativeModule('NativeLocalStorageModule');
 * storage?.setStorageItem('key', 'value');
 *
 * // JS module sharing within the LynxView
 * modules.registerJSModule('mySharedState', { count: 0 });
 * const state = modules.getJSModule<{ count: number }>('mySharedState');
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxNativeModule {
  #hasNativeModules(): boolean {
    return typeof NativeModules !== 'undefined' && NativeModules != null;
  }

  #hasLynx(): boolean {
    return (
      typeof lynx !== 'undefined' && typeof lynx.getJSModule === 'function'
    );
  }

  /**
   * Calls a native method via `NativeModules.bridge.call()`.
   *
   * The native callback API is wrapped in a Promise for ergonomic
   * use with `async`/`await`.
   *
   * Resolves `undefined` when there is no bridge (web preview, tests).
   */
  call<T = unknown>(
    name: string,
    params: Record<string, unknown> = {},
  ): Promise<T | undefined> {
    if (isMainThread() && typeof lynx === 'undefined') {
      // No background thread to relay to.
      return Promise.resolve(undefined);
    }
    return callOnBackground('nativeBridgeCall', name, params) as Promise<
      T | undefined
    >;
  }

  /**
   * Subscribes to a native event via `NativeModules.bridge.on()`. From the
   * main thread, the callback gets the event's arguments copied as JSON.
   *
   * No-op when there is no bridge.
   */
  on(name: string, callback: (...args: unknown[]) => void): void {
    callOnBackground('nativeBridgeOn', name, relayFunctions(callback)).catch(
      () => {
        // Without a background thread there's no bridge to listen to.
      },
    );
  }

  /**
   * Retrieves a custom native module by name from the `NativeModules` global.
   *
   * Augment the {@link NativeModuleMap} interface for type-safe access:
   *
   * ```typescript
   * export {};
   *
   * declare module '@blotch/angular-lynx' {
   *   interface NativeModuleMap {
   *     NativeLocalStorageModule: { ... };
   *   }
   * }
   *
   * const storage = modules.getNativeModule('NativeLocalStorageModule');
   * ```
   *
   * On the main thread, which can't reach native modules, it returns a proxy:
   * each method call runs on the background thread and returns a promise of
   * its result, and a call to a module or method the host doesn't have
   * rejects. The return type says so: a module in {@link NativeModuleMap}
   * comes back as a {@link NativeModuleProxy} of it, and any other name as
   * `unknown`.
   *
   * Returns `undefined` outside Lynx, or on the background thread when the
   * module is not registered.
   */
  getNativeModule<K extends string>(
    name: K,
  ): K extends keyof NativeModuleMap
    ? NativeModuleProxy<NativeModuleMap[K]> | undefined
    : unknown {
    if (isMainThread()) {
      return (
        typeof lynx !== 'undefined' ? relayedModule('native', name) : undefined
      ) as any;
    }
    if (!this.#hasNativeModules()) {
      return undefined as any;
    }

    return (NativeModules as any)[name];
  }

  /**
   * Retrieves a JS module registered within this LynxView.
   *
   * This wraps `lynx.getJSModule()` — the same API used internally
   * for `GlobalEventEmitter`. On the main thread it returns a proxy, as
   * getNativeModule() does.
   *
   * Returns `undefined` when `lynx` is unavailable or, on the background
   * thread, when the module is not registered.
   */
  getJSModule<T = unknown>(name: string): T | undefined {
    if (isMainThread()) {
      return (
        typeof lynx !== 'undefined' ? relayedModule('js', name) : undefined
      ) as T | undefined;
    }
    if (!this.#hasLynx()) {
      return undefined;
    }

    return lynx.getJSModule<T>(name);
  }

  /**
   * Registers a JS module for sharing within this LynxView.
   *
   * Other code (including native callbacks) can retrieve it via
   * `getJSModule()` or `lynx.getJSModule()`. From the main thread, the
   * background thread registers a copy whose methods call this module's, with
   * their arguments copied as JSON and their return values dropped.
   *
   * No-op when `lynx` is unavailable.
   */
  registerJSModule<T extends object>(name: string, module: T): void {
    if (typeof lynx === 'undefined') {
      return;
    }
    callOnBackground('registerJSModule', name, relayModuleObject(module)).catch(
      () => {
        // Without a background thread there's no registry to add it to.
      },
    );
  }
}
