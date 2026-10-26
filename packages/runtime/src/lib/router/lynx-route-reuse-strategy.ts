import { Injectable } from '@angular/core';
import type {
  ActivatedRouteSnapshot,
  DetachedRouteHandle,
  RouteReuseStrategy,
} from '@angular/router';

/**
 * Route reuse strategy that keeps component views alive across navigations.
 *
 * Opt-in: `provideRouter()` doesn't install it, so leaving a route destroys
 * its components, as Angular does on the web. Provide it yourself to keep
 * every visited route's component, and its state, alive:
 *
 * ```typescript
 * providers: [
 *   provideRouter(routes),
 *   { provide: RouteReuseStrategy, useClass: LynxRouteReuseStrategy },
 * ]
 * ```
 *
 * Nothing is ever evicted, and `ngOnDestroy()` doesn't run when you leave a
 * route.
 *
 * ## Why it exists
 *
 * `provideRouter()` used to install it. A crash investigation in May 2026
 * blamed a ~256-slot native element pool that `__RemoveElement` never freed,
 * and detaching views was meant to reuse their elements. Neither holds on
 * Lynx 4.1 (measured October 2026 on the iOS Simulator and an Android
 * emulator, issue #68): 400 navigations between two 300-element routes
 * created 121,527 native elements without a crash, with this strategy and
 * with Angular's default alike. A re-attached view's native elements were
 * destroyed when it was detached, so `LynxElement` rebuilds them from cache
 * (`#recreateSubtree`), and a revisit creates as many elements as a fresh
 * route.
 */
@Injectable()
export class LynxRouteReuseStrategy implements RouteReuseStrategy {
  readonly #stored = new Map<string, DetachedRouteHandle>();

  #key(route: ActivatedRouteSnapshot): string {
    // Use the full path from root to this route so nested routes don't collide.
    return route.pathFromRoot.map((r) => r.routeConfig?.path ?? '').join('/');
  }

  shouldDetach(_route: ActivatedRouteSnapshot): boolean {
    // Always detach instead of destroy, so the component and its state live on.
    return true;
  }

  store(
    route: ActivatedRouteSnapshot,
    handle: DetachedRouteHandle | null,
  ): void {
    if (handle) {
      this.#stored.set(this.#key(route), handle);
    } else {
      this.#stored.delete(this.#key(route));
    }
  }

  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    return this.#stored.has(this.#key(route));
  }

  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    return this.#stored.get(this.#key(route)) ?? null;
  }

  shouldReuseRoute(
    future: ActivatedRouteSnapshot,
    curr: ActivatedRouteSnapshot,
  ): boolean {
    return future.routeConfig === curr.routeConfig;
  }
}
