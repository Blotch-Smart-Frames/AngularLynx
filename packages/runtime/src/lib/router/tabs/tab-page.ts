import { type Signal, signal } from '@angular/core';

/**
 * Sets a tab's `active`. Assigned by the class's first constructor, inside the
 * class where its private fields can be reached, which keeps it out of the
 * class's public API: only the outlet says whether a tab is shown.
 *
 * Not in a static block, which would make defining the class a side effect
 * and keep it in bundles that don't use it (see snapshotOf in
 * lynx-location-strategy.ts). It takes a tab, so a constructor has always run
 * before it's called.
 */
export let setTabActive: (tab: LynxTabPage, active: boolean) => void;

/** Whether a tab's constructor has assigned setTabActive. */
let accessorsSet = false;

/**
 * The tab of a `<lynx-tab-outlet>` that a component is on. Every component
 * in the tab can inject it, the tab's routed component and those under it,
 * the screens of a `<lynx-stack-outlet>` in the tab included:
 *
 * ```ts
 * readonly #tab = inject(LynxTabPage, { optional: true });
 * ```
 *
 * Unlike a screen of `<router-outlet>`, which is destroyed when the app
 * leaves it, a tab stays alive while another one is shown, as a tab bar's do
 * on iOS and Android, so its components keep running while nobody sees them.
 * `active` says when it's the tab shown, for work that only makes sense
 * then: a 3D scene stops drawing frames, a poll stops polling.
 *
 * ```ts
 * effect(() => (this.#tab?.active() ? this.#poll.start() : this.#poll.stop()));
 * ```
 */
export class LynxTabPage {
  readonly #active = signal(false);

  /** Whether the tab is the one its outlet shows. */
  readonly active: Signal<boolean> = this.#active.asReadonly();

  constructor() {
    if (!accessorsSet) {
      accessorsSet = true;
      setTabActive = (tab, active) => tab.#active.set(active);
    }
  }
}
