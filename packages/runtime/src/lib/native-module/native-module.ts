import { Injectable } from '@angular/core';
import type { NativeModuleMap } from './native-module.types';

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
    return (
      typeof NativeModules !== 'undefined' &&
      NativeModules != null &&
      typeof NativeModules.bridge?.call === 'function'
    );
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
   * Returns `undefined` when `NativeModules` is unavailable (web preview, tests).
   */
  call<T = unknown>(
    name: string,
    params: Record<string, unknown> = {},
  ): Promise<T | undefined> {
    if (!this.#hasNativeModules()) {
      return Promise.resolve(undefined);
    }

    return new Promise<T>((resolve) => {
      NativeModules.bridge.call(name, params, (...args: unknown[]) => {
        resolve(args[0] as T);
      });
    });
  }

  /**
   * Subscribes to a native event via `NativeModules.bridge.on()`.
   *
   * No-op when `NativeModules` is unavailable.
   */
  on(name: string, callback: (...args: unknown[]) => void): void {
    if (!this.#hasNativeModules()) {
      return;
    }

    NativeModules.bridge.on(name, callback);
  }

  /**
   * Retrieves a custom native module by name from the `NativeModules` global.
   *
   * Augment the {@link NativeModuleMap} interface for type-safe access:
   *
   * ```typescript
   * declare module '@blotch/angular-lynx' {
   *   interface NativeModuleMap {
   *     NativeLocalStorageModule: { ... };
   *   }
   * }
   *
   * const storage = modules.getNativeModule('NativeLocalStorageModule');
   * ```
   *
   * Returns `undefined` when `NativeModules` is unavailable or the module
   * is not registered.
   */
  getNativeModule<K extends string>(
    name: K,
  ): K extends keyof NativeModuleMap ? NativeModuleMap[K] : unknown {
    if (typeof NativeModules === 'undefined' || NativeModules == null) {
      return undefined as any;
    }

    return (NativeModules as any)[name];
  }

  /**
   * Retrieves a JS module registered within this LynxView.
   *
   * This wraps `lynx.getJSModule()` — the same API used internally
   * for `GlobalEventEmitter`.
   *
   * Returns `undefined` when `lynx` is unavailable or the module
   * is not registered.
   */
  getJSModule<T = unknown>(name: string): T | undefined {
    if (!this.#hasLynx()) {
      return undefined;
    }

    return lynx.getJSModule<T>(name);
  }

  /**
   * Registers a JS module for sharing within this LynxView.
   *
   * Other code (including native callbacks) can retrieve it via
   * `getJSModule()` or `lynx.getJSModule()`.
   *
   * No-op when `lynx` is unavailable.
   */
  registerJSModule<T extends object>(name: string, module: T): void {
    if (!this.#hasLynx()) {
      return;
    }

    lynx.registerModule(name, module);
  }
}
