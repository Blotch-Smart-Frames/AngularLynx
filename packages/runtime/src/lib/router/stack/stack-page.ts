import { type Signal, computed, signal } from '@angular/core';
import type { ChromeClaim, LynxStackChrome } from './stack-chrome';

/**
 * Sets a page's `active`. Assigned in the class's static block, the only place
 * outside its methods that can reach its private fields, which keeps it out
 * of the class's public API: only the outlet says whether a page is on top.
 */
export let setActive: (page: LynxStackPage, active: boolean) => void;

/**
 * Gives a page what says whether it takes the bottom bar away, which the
 * outlet works out (see LynxStackChrome). Assigned as setActive is.
 */
export let setBottomBarHidden: (
  page: LynxStackPage,
  hidden: Signal<boolean>,
) => void;

/**
 * What the stack keeps about a page (see LynxStackChrome): the outlet it's in,
 * and the chrome the bars on it follow, made when a component on it first
 * asks.
 */
export type PageLinks = {
  owner: ChromeClaim | null;
  chrome: LynxStackChrome | null;
};

/**
 * The page's links (see PageLinks). Assigned as setActive is.
 *
 * They're kept on the page rather than in a WeakMap keyed by it, which on
 * Lynx's main thread would keep every page the app ever had, and the screen
 * on each one (issue #390). What a page leads to leads back to the page: the
 * outlet that owns it holds it in its stack, and the chrome reaches the
 * outlet. PrimJS, the engine that runs the main thread, never lets go of a
 * WeakMap entry whose value leads back to its key through a native element,
 * and a page's components, its elements and their native elements are all
 * on the way. A long-lived WeakMap's entries then stay for good. Held by the
 * page itself, they go when the page does.
 */
export let linksOf: (page: LynxStackPage) => PageLinks;

const SHOWN = signal(false).asReadonly();

/**
 * The page of a `<lynx-stack-outlet>` that a component is on. Every component
 * on the page can inject it, the routed component and those under it:
 *
 * ```ts
 * readonly #page = inject(LynxStackPage, { optional: true });
 * ```
 *
 * Unlike a page of `<router-outlet>`, which is destroyed when the app leaves
 * it, a page under the top one stays alive, so its components keep running
 * while it's covered. `active` says when it's on top, for work that only
 * makes sense while the page shows, as a navigation controller's
 * `viewDidAppear` and `viewDidDisappear` do:
 *
 * ```ts
 * effect(() => (this.#page?.active() ? this.#poll.start() : this.#poll.stop()));
 * ```
 *
 * It also stands for the page itself: something kept per screen can key on
 * it, as `@blotch/ui`'s bars keep their state per page in a `WeakMap`. What
 * the map keeps for a page mustn't hold on to the page's components or
 * elements once they're destroyed, as the bars' state lets go of the bars
 * and the scroll view: on Lynx's main thread, an entry whose value still
 * leads back to its page through an element is never collected, and keeps
 * the page and its screen for as long as the map.
 */
export class LynxStackPage {
  readonly #active = signal(false);
  readonly #bottomBarHidden = signal<Signal<boolean>>(SHOWN);
  readonly #links: PageLinks = { owner: null, chrome: null };

  /**
   * Whether the page is on top of its stack, where the router has it active,
   * rather than covered by another page or on its way out.
   */
  readonly active: Signal<boolean> = this.#active.asReadonly();

  /**
   * Whether the bottom bar (a tab bar or a dock outside the stack) is away
   * while this page is on top: its route's `bottomBar`, or else whether it's
   * pushed over its stack's first page (see LynxStackChrome). A screen that
   * keeps room at its end for the bar can drop it when it's away:
   *
   * ```ts
   * protected readonly endPadding = computed(() =>
   *   this.#page?.bottomBarHidden() ? 'pb-safe-4' : 'pb-safe-40',
   * );
   * ```
   *
   * Unlike LynxStackChrome's `bottomBarHidden`, which follows the page on top,
   * it doesn't change while the page is covered, so a covered page keeps its
   * layout, and its scroll position, for when it comes back.
   */
  readonly bottomBarHidden: Signal<boolean> = computed(() =>
    this.#bottomBarHidden()(),
  );

  static {
    setActive = (page, active) => page.#active.set(active);
    setBottomBarHidden = (page, hidden) => page.#bottomBarHidden.set(hidden);
    linksOf = (page) => page.#links;
  }
}
