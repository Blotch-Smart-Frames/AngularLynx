import { type Signal, computed, signal } from '@angular/core';

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
 * it, as `@blotch/ui`'s bars keep their state per page.
 */
export class LynxStackPage {
  readonly #active = signal(false);
  readonly #bottomBarHidden = signal<Signal<boolean>>(SHOWN);

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
  }
}
