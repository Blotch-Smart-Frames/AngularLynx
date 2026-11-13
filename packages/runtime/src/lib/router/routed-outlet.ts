import type { Injector, Signal } from '@angular/core';
import {
  type ActivatedRoute,
  type ActivatedRouteSnapshot,
  type Router,
  type RouterOutlet,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
} from '@angular/router';

/** The router's input binder (`withComponentInputBinding()`), as RouterOutlet keeps it. */
export type InputBinder = {
  bindActivatedRouteToOutletComponent(
    outlet: unknown,
    injector: Injector,
  ): void;
  unsubscribeFromRouteData(outlet: unknown): void;
};

/**
 * An outlet's input binder, or null without `withComponentInputBinding()`.
 * RouterOutlet keeps it in a field of its own, and the token it injects it
 * by isn't exported, so the outlets that extend it read it there.
 */
export const binderOf = (outlet: RouterOutlet): InputBinder | null =>
  (outlet as unknown as { inputBinder: InputBinder | null }).inputBinder;

/**
 * The URL of a route's page: its path from the root, matrix parameters and
 * all, without the query, which every page shares.
 */
export const urlOf = (route: ActivatedRoute | ActivatedRouteSnapshot): string =>
  `/${('snapshot' in route ? route.snapshot : route).pathFromRoot
    .flatMap((snapshot) => snapshot.url.map(String))
    .join('/')}`;

/**
 * The path of a URL the router serialized, without its query and fragment,
 * as {@link urlOf} has it.
 */
export const pathOf = (url: string): string => url.split(/[?#]/, 1)[0]!;

/** A page or a tab, as far as whether it's shown goes. */
type Shown = { readonly active: Signal<boolean> } | null;

/**
 * Whether the stack page or the tab an outlet is on is hidden: covered by
 * another page, or a tab another one replaced.
 *
 * The router leaves every outlet on such a page as it leaves the page, the
 * innermost first, and only then hides the page. An outlet that keeps its
 * pages asks once the router is done, in a microtask, and keeps them for when
 * the router comes back to the page, where an outlet whose route the router
 * left for good shows nothing.
 */
export const onHiddenPage = (page: Shown, tab: Shown): boolean =>
  (page !== null && !page.active()) || (tab !== null && !tab.active());

/**
 * Runs `run` once the router's pass that's under way is over: in a
 * microtask, as an outlet the router leaves waits to see whether the router
 * activates it again in the same pass.
 *
 * On a device, a microtask can run in the middle of the pass: a synchronous
 * UI method, such as the `boundingClientRect` a new screen's
 * `getBoundingClientRect()` asks for, runs the pending microtasks inside the
 * call. An outlet that decided then would find itself empty while the router
 * was still activating it, and destroy the screens it was about to show. So
 * if a navigation is still under way when the microtask runs, `run` waits
 * for it to end.
 */
export const afterRouterPass = (router: Router, run: () => void): void => {
  queueMicrotask(() => {
    if (!router.currentNavigation()) {
      run();
      return;
    }
    const settled = router.events.subscribe((event) => {
      if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError ||
        event instanceof NavigationSkipped
      ) {
        settled.unsubscribe();
        run();
      }
    });
  });
};
