import type { EnvironmentInjector, Injector, Signal } from '@angular/core';
import {
  type ActivatedRoute,
  type ActivatedRouteSnapshot,
  type OutletContext,
  type Router,
  type RouterOutlet,
  type RouterOutletContract,
  ChildrenOutletContexts,
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

/**
 * The contexts that the router outlets in one screen of an outlet that keeps
 * its screens (a tab, a stack page) register in, in place of the router's
 * contexts for the outlet's children, which the screens would otherwise share
 * as RouterOutlet's screen does.
 *
 * The router's contexts hold the contexts of the screen shown, and the outlet
 * swaps them as it hides one screen and shows another. Sharing them is right
 * for RouterOutlet, which shows one screen and destroys it as it leaves. A
 * kept screen's outlets live on while it's hidden, though, and one of them
 * can register then: a screen the router left before change detection first
 * reached it (two navigations in a row, as a guard's redirect or a shortcut
 * makes) registers its outlets only once it's checked, hidden by then, and an
 * `@if` can add an outlet to a hidden screen. An outlet registering in the
 * shared contexts takes the context of the shown screen's outlet of the same
 * name, and activates with its route: it builds the shown screen's child in
 * the hidden screen, and the router's later navigations of that outlet go to
 * it (issue #413).
 *
 * So each screen has its own, and its outlets' calls go to the router's
 * contexts while the screen is shown, and to the screen's own while it's
 * hidden. {@link hide} takes the screen's contexts from the router as it
 * leaves the screen, and {@link show} gives them back as it returns. While
 * it's hidden, ChildrenOutletContexts' own methods, which call one another
 * (getOrCreateContext calls getContext) through the ones here, keep to this
 * object's own contexts.
 */
export class ScreenContexts extends ChildrenOutletContexts {
  /** The router's contexts for the outlet's children. */
  readonly #router: ChildrenOutletContexts;
  /** Whether the router's contexts are the screen's (it's shown). */
  #shown = true;

  /**
   * A screen's contexts, shown as it's built: the router activates its
   * outlets right after.
   */
  constructor(router: ChildrenOutletContexts, root: EnvironmentInjector) {
    super(root);
    this.#router = router;
  }

  /**
   * Keeps the screen's contexts, which the router is about to forget as it
   * leaves the screen's route, in this object's own.
   */
  hide(): void {
    if (!this.#shown) return;
    super.onOutletReAttached(this.#router.onOutletDeactivated());
    this.#shown = false;
  }

  /**
   * Gives the router the screen's contexts back, for it to activate the
   * screen's outlets again.
   */
  show(): void {
    if (this.#shown) return;
    this.#router.onOutletReAttached(super.onOutletDeactivated());
    this.#shown = true;
  }

  override onChildOutletCreated(
    childName: string,
    outlet: RouterOutletContract,
  ): void {
    if (this.#shown) {
      this.#router.onChildOutletCreated(childName, outlet);
    } else {
      super.onChildOutletCreated(childName, outlet);
    }
  }

  override onChildOutletDestroyed(childName: string): void {
    if (this.#shown) {
      this.#router.onChildOutletDestroyed(childName);
    } else {
      super.onChildOutletDestroyed(childName);
    }
  }

  override onOutletDeactivated(): Map<string, OutletContext> {
    return this.#shown
      ? this.#router.onOutletDeactivated()
      : super.onOutletDeactivated();
  }

  override onOutletReAttached(contexts: Map<string, OutletContext>): void {
    if (this.#shown) {
      this.#router.onOutletReAttached(contexts);
    } else {
      super.onOutletReAttached(contexts);
    }
  }

  override getOrCreateContext(childName: string): OutletContext {
    return this.#shown
      ? this.#router.getOrCreateContext(childName)
      : super.getOrCreateContext(childName);
  }

  override getContext(childName: string): OutletContext | null {
    return this.#shown
      ? this.#router.getContext(childName)
      : super.getContext(childName);
  }
}

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
