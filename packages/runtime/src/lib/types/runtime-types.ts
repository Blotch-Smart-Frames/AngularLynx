import type { TouchEvent } from '@lynx-js/types';

declare global {
  /**
   * Determines if code should be placed in the background thread, used as a compile-time define macro
   */
  // eslint-disable-next-line no-var
  var __BACKGROUND__: boolean;
  /**
   * Determines if code should be placed in the main thread, used as a compile-time define macro
   */
  // eslint-disable-next-line no-var
  var __MAIN_THREAD__: boolean;
  /**
   * Whether this bundle targets the web runtime (`@lynx-js/web-core`) rather
   * than native Lynx. Compile-time define injected by the rsbuild plugin
   * (`environment.name === 'web'`). Used to branch on web-only behavior that
   * must be dead-code-eliminated from native bundles — e.g. web-core has no
   * implicit post-`renderPage` flush, so the runtime forces the first
   * `__FlushElementTree` itself (see `bootstrapApplication` in runtime.ts).
   */
  // eslint-disable-next-line no-var
  var __WEB__: boolean;
  /**
   * Determines if running in dev mode
   */
  // eslint-disable-next-line no-var
  var __DEV__: boolean;
  /**
   * Determines if running in profile mode
   */
  // eslint-disable-next-line no-var
  var __PROFILE__: boolean;
  /**
   * Whether SSR (Instant First-Frame Rendering) is enabled. When true, the
   * runtime registers `ssrEncode` and `ssrHydrate` global callbacks that
   * the Lynx engine calls to snapshot and restore the element tree.
   */
  // eslint-disable-next-line no-var
  var __ENABLE_SSR__: boolean;
  /**
   * Full URL of the dev log server (e.g. http://192.168.1.91:3001/__dev_logs).
   * Injected by the rsbuild plugin's DefinePlugin in dev builds only.
   */
  // eslint-disable-next-line no-var
  var __DEV_LOG_URL__: string;
  /**
   * The source locale from angular.json i18n config (e.g. 'en-US', 'fr').
   * Injected by the rsbuild plugin's DefinePlugin. Used by LynxLocale
   * as a fallback when lynx.__globalProps.appLocale is not set.
   */
  // eslint-disable-next-line no-var
  var __LYNX_SOURCE_LOCALE__: string;

  // MTS worklet registry — set up in runtime.ts, used by mainThreadFn()
  // oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for global augmentation
  interface Window {
    registerWorklet: (type: string, id: string, fn: Function) => void;
    __workletRefMap: Record<number, { current: unknown }>;
    __lynxMtsPendingResolvers: Record<
      number,
      { resolve: (v: unknown) => void; reject: (e: unknown) => void }
    >;
    __lynxMtsNextResolveId: () => number;
    __lynxRunMainThreadWorklet: (wkltId: string, args: unknown[]) => unknown;
  }
  // eslint-disable-next-line no-var
  var registerWorklet: (type: string, id: string, fn: Function) => void;
  // eslint-disable-next-line no-var
  var __workletRefMap: Record<number, { current: unknown }>;
  // eslint-disable-next-line no-var
  var __lynxMtsPendingResolvers: Record<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >;
  // eslint-disable-next-line no-var
  var __lynxMtsNextResolveId: () => number;
  // Synchronously runs a registered worklet by id — used when runOnMainThread()
  // is invoked from code already executing on the main thread (see runtime.ts).
  // eslint-disable-next-line no-var
  var __lynxRunMainThreadWorklet: (wkltId: string, args: unknown[]) => unknown;
  // Available on main thread only — dispatches a function call to the background thread
  function runOnBackground(
    handle: { _wkltId: string },
    ...args: unknown[]
  ): Promise<unknown>;
}

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for global augmentation
  interface HTMLElementEventMap {
    bindtap: TouchEvent;
    catchtap: TouchEvent;
    'capture-bindtap': TouchEvent;
    'capture-catchtap': TouchEvent;
    'global-bindtap': TouchEvent;
    bindtouchstart: TouchEvent;
    bindtouchend: TouchEvent;
    bindtouchmove: TouchEvent;
    bindtouchcancel: TouchEvent;
    bindlongpress: TouchEvent;
    catchtouchstart: TouchEvent;
    catchtouchend: TouchEvent;
    catchtouchmove: TouchEvent;
    catchtouchcancel: TouchEvent;
    catchlongpress: TouchEvent;
  }
}
