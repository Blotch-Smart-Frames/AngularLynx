import { type Signal, signal } from '@angular/core';

/**
 * Sets a page's `active`. Assigned in the class's static block, the only place
 * outside its methods that can reach its private fields, which keeps it out
 * of the class's public API: only the outlet says whether a page is on top.
 */
export let setActive: (page: LynxStackPage, active: boolean) => void;

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

  /**
   * Whether the page is on top of its stack, where the router has it active,
   * rather than covered by another page or on its way out.
   */
  readonly active: Signal<boolean> = this.#active.asReadonly();

  static {
    setActive = (page, active) => page.#active.set(active);
  }
}
