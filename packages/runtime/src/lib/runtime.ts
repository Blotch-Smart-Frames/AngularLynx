import type { ApplicationConfig, ApplicationRef, Type } from '@angular/core';
import { bootstrapApplication as ngBootstrapApplication } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { markFirstRenderComplete } from './lynx-render-lifecycle';

// Side-effect imports install the runtime's global environment before bootstrap.
// Order mirrors the original monolithic runtime.ts: crash diagnostics first, then
// the browser-shaped environment polyfills, then the Lynx lifecycle/worklet
// callbacks. `pageReady` and `__workletMap` are the only values bootstrap itself
// needs to reference (renderPage readiness + HMR worklet reset).
import './error-reporting';
import './polyfills';
import { pageReady } from './global-callbacks';
import { __workletMap } from './worklet-bridge';
import { installLazyBundleLoader } from './lazy-bundle/chunk-loader';

/**
 * Bootstrap Angular application on the Lynx runtime. Waits for the main thread to
 * signal it's ready before initializing the framework, then registers global
 * callbacks for page updates and worklet invocations.
 */
export const bootstrapApplication = async (
  rootComponent: Type<unknown>,
  options?: ApplicationConfig,
): Promise<ApplicationRef> => {
  // Lazy routes and @defer blocks are loaded by Lynx's chunk-loading runtime
  // through `lynx.loadLazyBundle`, which the framework must provide. Install it
  // on both threads before Angular can trigger any dynamic import. Placed before
  // the HMR teardown and the renderPage wait so it is in place even if a
  // re-bootstrap triggers an import immediately; re-installing is harmless.
  installLazyBundleLoader();

  // HMR re-bootstrap: destroy previous app so Angular's platform accepts a new one.
  // When webpack hot-updates a module and the entry re-evaluates, this function
  // is called again. We destroy the old app (which removes its Lynx elements)
  // and create a fresh one with the updated component definitions.
  const prev = (globalThis as any).__LYNX_ANGULAR_APP_REF__ as
    | ApplicationRef
    | undefined;
  if (prev) {
    prev.destroy();
    (globalThis as any).__LYNX_ANGULAR_APP_REF__ = undefined;
    // Clear worklet registry so re-evaluated modules re-register with fresh IDs
    for (const key of Object.keys(__workletMap)) {
      delete __workletMap[key];
    }
  }

  // On first boot (main thread), wait for Lynx's renderPage callback.
  // On re-bootstrap (HMR), the page is already ready — skip the wait.
  if (__MAIN_THREAD__ && !prev) {
    await firstValueFrom(pageReady);
  }

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
  if (__WEB__ && __MAIN_THREAD__ && !wasHydrating) {
    setTimeout(() => __FlushElementTree(), 0);
  }

  return appRef;
};
