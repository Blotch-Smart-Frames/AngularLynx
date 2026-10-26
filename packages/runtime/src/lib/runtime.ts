import type { ApplicationConfig, ApplicationRef, Type } from '@angular/core';
import { bootstrapApplication as ngBootstrapApplication } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { markFirstRenderComplete } from './lynx-render-lifecycle';

// Side-effect imports install the runtime's global environment before bootstrap.
// Order mirrors the original monolithic runtime.ts: crash diagnostics first, then
// the browser-shaped environment polyfills, then the Lynx lifecycle/worklet
// callbacks, the global exposure bridge, the background call relay and the log
// relay. They are all the background thread runs of the runtime, since Angular
// boots on the main thread only. `pageReady` is the only value bootstrap itself
// needs from them (renderPage readiness).
import './error-reporting';
import './polyfills';
import { pageReady } from './global-callbacks';
import './exposure/global-exposure-bridge';
import './background-call';
import './lynx-logger/lynx-logger';
import { installLazyBundleLoader } from './lazy-bundle/chunk-loader';
import { handOverPageToNextApp } from './lynx-document/page-ref';
import { carryOverLocation } from './router/lynx-location-strategy';

/**
 * Starts the background thread. The build calls it from the background
 * thread's entry, a module it generates in place of the app's `main.ts`
 * (background-entry.ts in the build plugin): Angular runs on the main thread
 * only, so the background thread loads just this runtime and the modules that
 * define a background function or a `MainThreadRef`.
 *
 * Loading the runtime installs the background half of each bridge (the imports
 * above). This installs `lynx.loadLazyBundle`, for an `import()` in a
 * background function. Importing it is also what keeps the runtime in the
 * background bundle: the package is marked `"sideEffects": false`, so a bare
 * `import '@blotch/angular-lynx'` would be dropped.
 */
export const ɵstartBackgroundThread = (): void => {
  installLazyBundleLoader();
};

/**
 * Bootstrap Angular application on the Lynx runtime. Waits for the main thread to
 * signal it's ready before initializing the framework, then registers global
 * callbacks for page updates and worklet invocations.
 *
 * Angular runs on the main thread only. The background thread starts from an
 * entry the build generates instead of `main.ts` (see
 * {@link ɵstartBackgroundThread}), so it doesn't reach this function, unless a
 * module it loads also bootstraps, such as a `main.ts` that defines a
 * `backgroundFn()` itself. Then it gets no app: the returned promise never
 * settles on that thread. Booting a second copy there ran every constructor,
 * `ngOnInit` and `effect()` twice, and its views went nowhere (issue #81).
 */
export const bootstrapApplication = async (
  rootComponent: Type<unknown>,
  options?: ApplicationConfig,
): Promise<ApplicationRef> => {
  if (!__MAIN_THREAD__) {
    // A pending promise rather than a rejected one: main.ts usually ends in
    // `.catch(console.error)`, which would log an error on every launch.
    // Nothing that needs an ApplicationRef can run here anyway.
    return new Promise<ApplicationRef>(() => {});
  }

  // Lazy routes and @defer blocks are loaded by Lynx's chunk-loading runtime
  // through `lynx.loadLazyBundle`, which the framework must provide. Install it
  // before Angular can trigger any dynamic import. Placed before the hot
  // update teardown and the renderPage wait so it is in place even if a
  // re-bootstrap triggers an import immediately; re-installing is harmless.
  installLazyBundleLoader();

  const bootstrap = bootstrapOnMainThread(rootComponent, options);
  // A hot update that re-runs the app's entry calls this again (see
  // `ɵhmrAccept`). The plugin's main-thread hot update client waits for this
  // promise after applying an update, and reloads the page if it rejects:
  // the old app is already gone by then, so a failed re-bootstrap would
  // otherwise leave a blank screen.
  (globalThis as any).__LYNX_ANGULAR_BOOTSTRAP__ = bootstrap;
  return bootstrap;
};

const bootstrapOnMainThread = async (
  rootComponent: Type<unknown>,
  options: ApplicationConfig | undefined,
): Promise<ApplicationRef> => {
  // Hot update re-bootstrap: destroy the previous app so Angular's platform
  // accepts a new one. A hot update whose changes no component could take in
  // place re-runs the app's entry, which calls this again. The old app is
  // destroyed (which removes its Lynx elements) and a fresh one is created
  // from the updated modules.
  const prev = (globalThis as any).__LYNX_ANGULAR_APP_REF__ as
    | ApplicationRef
    | undefined;
  if (prev) {
    // The new app opens on the screen the old one was showing, with the same
    // Back history, instead of on the initial route.
    carryOverLocation(prev.injector);
    // ...in the page the old app rendered into (see createRootElement).
    handOverPageToNextApp();
    prev.destroy();
    (globalThis as any).__LYNX_ANGULAR_APP_REF__ = undefined;
    // The main-thread worklet registry is deliberately left alone. A hot
    // update re-runs only the changed modules and the ones that import them,
    // so a module-level `mainThreadFn()` elsewhere is never registered again,
    // and clearing the registry (as an earlier version did) broke it. The
    // re-run modules register new functions under new IDs (the IDs come from
    // a counter), and the old app's per-instance functions were released by
    // its DestroyRefs in destroy() above.
  }

  // Wait for Lynx's renderPage callback. After the first boot, pageReady has
  // already fired, and replays it.
  await firstValueFrom(pageReady);

  const appRef = await ngBootstrapApplication(rootComponent, options);
  // Signal that the initial render is done. This is the point where control
  // has returned from Angular's whole bootstrap, so it's safe to run work that
  // must NOT happen while nested inside native's first renderPage() call —
  // specifically a <list>'s first update-list-info + layout flush, which
  // re-enters componentAtIndex (see lynx-render-lifecycle.ts). Any such update
  // queued during bootstrap was parked by _processUpdate()'s isFirstRenderPending()
  // guard; this call drains it onto a fresh setTimeout macrotask. Placed on the
  // line right after bootstrap resolves (not later) so the flag flips before the
  // first post-bootstrap change-detection cycle's end() hook runs.
  markFirstRenderComplete();
  (globalThis as any).__LYNX_ANGULAR_APP_REF__ = appRef;

  // Clear hydration state so subsequent change detection cycles flush normally.
  const wasHydrating =
    __ENABLE_SSR__ && (globalThis as any).__LYNX_IS_HYDRATING__;
  if (wasHydrating) {
    (globalThis as any).__LYNX_IS_HYDRATING__ = false;
    (globalThis as any).__LYNX_HYDRATE_PAGE__ = undefined;
    (globalThis as any).__LYNX_HYDRATE_QUEUE__ = undefined;
  }

  // Web-only: force the first element-tree flush after bootstrap.
  //
  // LynxRendererFactory2.end() deliberately SKIPS __FlushElementTree() on the
  // very first render (isFirstRenderPending) because the NATIVE engine performs
  // its own implicit flush once renderPage() returns. @lynx-js/web-core has no
  // such implicit flush, and its <lynx-view> reveal + page attach happen INSIDE
  // __FlushElementTree (web-core createElementAPI: rootDom.appendChild(page) +
  // host.style.display = 'flex'). Without an explicit flush the page is never
  // attached and the view stays display:none — so every app renders blank on
  // web until some later change-detection cycle (a tap/signal) happens to flush.
  //
  // Deferred to a macrotask so it runs after web-core's renderPage frame has
  // unwound — the same safe context the <list> first-update flush uses (see
  // lynx-render-lifecycle.ts). __WEB__ is a compile-time define (false on
  // native), so this whole block is dead-code-eliminated from native bundles:
  // native behavior is unchanged. Skipped during SSR hydration, where the
  // snapshot tree already exists and web-core shows the view via its [ssr] CSS
  // attribute (mirrors end()'s hydration guard).
  if (__WEB__ && !wasHydrating) {
    setTimeout(() => __FlushElementTree(), 0);
  }

  return appRef;
};
