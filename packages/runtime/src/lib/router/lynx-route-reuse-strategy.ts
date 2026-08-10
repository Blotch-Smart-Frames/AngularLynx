import { Injectable } from '@angular/core';
import type {
  ActivatedRouteSnapshot,
  DetachedRouteHandle,
  RouteReuseStrategy,
} from '@angular/router';

/**
 * Route reuse strategy that keeps component views alive across navigations.
 *
 * ## Why this is required on Lynx
 *
 * Lynx's native element APIs (`__CreateView`, `__CreateText`, etc.) allocate
 * elements in a fixed-size native pool. `__RemoveElement` detaches an element
 * from the tree but does NOT free its pool slot — there is no `__ReleaseElement`
 * API in Lynx's public surface. Angular's default `RouteReuseStrategy` destroys
 * components on every navigation, creating fresh native elements each time. Those
 * freed elements accumulate in the pool until it overflows (~256 slots on device),
 * causing a hard native crash on the 9th navigation in a back-and-forth pattern.
 *
 * ## What this strategy does
 *
 * Instead of destroying a component when navigating away, Angular calls
 * `ViewContainerRef.detach()`. The component's DOM elements are removed from the
 * native tree (the slots are occupied but unused). When navigating back,
 * `ViewContainerRef.insert()` re-adds those same native elements to the tree —
 * reusing their existing pool slots with no new allocations. The pool stays bounded
 * by (initial elements) + (max elements for any single route), regardless of how
 * many times the user navigates.
 */
@Injectable()
export class LynxRouteReuseStrategy implements RouteReuseStrategy {
  readonly #stored = new Map<string, DetachedRouteHandle>();

  #key(route: ActivatedRouteSnapshot): string {
    // Use the full path from root to this route so nested routes don't collide.
    return route.pathFromRoot.map((r) => r.routeConfig?.path ?? '').join('/');
  }

  shouldDetach(_route: ActivatedRouteSnapshot): boolean {
    // Always detach instead of destroy — keeps native elements in the pool.
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
