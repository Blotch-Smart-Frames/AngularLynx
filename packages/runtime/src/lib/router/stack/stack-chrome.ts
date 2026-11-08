import {
  type Signal,
  type WritableSignal,
  Injectable,
  computed,
  signal,
} from '@angular/core';
import type { LynxStackPage } from './stack-page';
import type { StackAnimation } from './stack-motion';

/**
 * What a route says about the bottom bar on its page, in its data:
 *
 * ```ts
 * { path: 'search-results', component: SearchResults, data: { bottomBar: 'visible' } }
 * ```
 *
 * - `'visible'`: the bar shows over the page, even pushed.
 * - `'hidden'`: the bar goes away while the page is on top, even as a
 *   stack's first page.
 *
 * Without it, a page pushed over a stack's first page hides the bar, unless
 * its outlet's `hideBottomBar` is `'never'`, and a stack's first page shows
 * it.
 */
export type StackBottomBar = 'visible' | 'hidden';

/**
 * Which pages of a `<lynx-stack-outlet>` take the bottom bar away when no
 * route says (see {@link StackBottomBar}): `'pushed'`, every page pushed over
 * the stack's first one, as Material does with its navigation bar, or
 * `'never'`, as iOS keeps its tab bar unless a screen hides it
 * (`hidesBottomBarWhenPushed`).
 */
export type StackBottomBarDefault = 'pushed' | 'never';

/**
 * How the bottom bar moves to `bottomBarProgress`: as the pages of the stack
 * move, so it can move with them.
 */
export type StackBarMotion = {
  /**
   * The pages' motion: `'ios'`, where the page under a pushed one slides a
   * little left under it; `'material'`, where pages slide and fade; `'fade'`,
   * the cross-fade a push or a pop makes while Reduce Motion is on; or
   * `'none'`.
   */
  readonly animation: StackAnimation | 'fade';
  /**
   * How long the bar takes to get to `bottomBarProgress`, in ms: a push's or
   * a pop's duration while the pages move, and 0 while a finger drags a page
   * (the progress follows each move) or nothing moves.
   */
  readonly duration: number;
  /** The pages' timing function, as a CSS `transition-timing-function`. */
  readonly easing: string;
  /**
   * How far the page under a pushed one moves, as a share of the outlet's
   * width: -0.3 on iOS, where it slides a third of the way left. A bar that
   * stays with that page, as iOS's tab bar does, moves as far.
   */
  readonly coveredX: number;
};

/**
 * What a page says about the bottom bar: a route's `bottomBar`, or else
 * whether it's pushed over its stack's first page, which hides the bar if the
 * outlet's default says so, or the first page itself, which leaves the bar as
 * the outlets around it have it.
 */
export type PageBar = StackBottomBar | 'pushed' | 'root';

/**
 * Where an outlet has the bottom bar: moving from the bar `from` one page
 * says to what `to` another says, `at` of the way (1 at rest, where both are
 * the top page's).
 */
export type BarState = {
  readonly from: PageBar;
  readonly to: PageBar;
  readonly at: number;
  /** What the page the router has active says, or null while there's none. */
  readonly active: PageBar | null;
  readonly motion: StackBarMotion;
};

/** An outlet, as the chrome follows it. */
export type ChromeClaim = {
  /** The stack page the outlet is on, or null outside any. */
  readonly page: LynxStackPage | null;
  readonly state: Signal<BarState>;
  /** Whether a pushed page hides the bar unless its route says. */
  readonly hidesPushed: Signal<boolean>;
};

/** Nothing moving and no outlet: the bar shows. */
export const STILL: StackBarMotion = {
  animation: 'none',
  duration: 0,
  easing: 'linear',
  coveredX: 0,
};

/**
 * How far away a page has the bar, 0 (shown) or 1 (gone), where the outlets
 * around it have it `fallback` of the way.
 */
export const awayOf = (
  bar: PageBar,
  hidesPushed: boolean,
  fallback: number,
): number => {
  if (bar === 'hidden') return 1;
  if (bar === 'visible') return 0;
  return bar === 'pushed' && hidesPushed ? 1 : fallback;
};

/**
 * A bar a page carries while the pages of a stack move (see
 * LynxStackBottomBar), as the outlets see it.
 */
export type CarriedBar = {
  /** The chrome the bar follows: a page's, for a bar on a stack page. */
  readonly chrome: LynxStackChrome;
  /** The frame the bar is in, or null while it's in its own place. */
  frame(): unknown;
  /**
   * The bar's box relative to the LynxView, from its last layout: in its
   * own place until it's laid out in a page.
   */
  box(): { readonly top: number; readonly height: number };
  /** Puts the bar in a page's frame, over the page at its bottom. */
  carry(frame: unknown): void;
  /** Puts the bar back in its own place. */
  home(): void;
};

/** The outlets every chrome of an app follows, shared by them all. */
type Registry = {
  readonly claims: WritableSignal<readonly ChromeClaim[]>;
  /** The outlet each page is in. */
  readonly owners: WeakMap<LynxStackPage, ChromeClaim>;
  /** The bars a page can carry (see LynxStackBottomBar). */
  readonly bars: Set<CarriedBar>;
};

/**
 * Starts following an outlet, and returns the call that stops. Assigned in
 * LynxStackChrome's static block, as setActive is in LynxStackPage's: only
 * the outlet says what it's doing.
 */
export let follow: (chrome: LynxStackChrome, claim: ChromeClaim) => () => void;

/** Says which outlet a page is in. */
export let own: (
  chrome: LynxStackChrome,
  page: LynxStackPage,
  claim: ChromeClaim,
) => void;

/**
 * The chrome for bars on `page` (see LynxStackChrome), which the page's
 * injector gives its components.
 */
export let chromeOn: (
  chrome: LynxStackChrome,
  page: LynxStackPage,
) => LynxStackChrome;

/**
 * Adds a bar a page can carry, and returns the call that takes it out again.
 * Assigned as follow is.
 */
export let addBar: (chrome: LynxStackChrome, bar: CarriedBar) => () => void;

/** Every bar a page can carry, whichever chrome of the app it follows. */
export let barsOf: (chrome: LynxStackChrome) => readonly CarriedBar[];

/**
 * How far away a chrome has the bar at rest, 0 (shown) or 1 (gone), with a
 * page that says `bar` on top of the outlet `claim` follows: what its
 * `bottomBarHidden` would say, without the outlets inside the outlet's top
 * page. Null if the chrome doesn't follow the outlet (it isn't showing, or
 * it's outside the chrome's page). Assigned as follow is.
 */
export let awayWith: (
  chrome: LynxStackChrome,
  claim: ChromeClaim,
  bar: PageBar,
) => number | null;

/** Each page's chrome, made when a component on it first asks. */
const pageChromes = new WeakMap<LynxStackPage, LynxStackChrome>();

/**
 * What the stack that's showing does, for chrome outside it that belongs to
 * the stack's first page: a tab bar or a dock beside the `<router-outlet>`
 * whose tabs each hold a `<lynx-stack-outlet>`. It says when a page pushed
 * over the stack's first one takes the bar away, as iOS's
 * `hidesBottomBarWhenPushed` and Material's navigation bar do, and how far
 * the bar is on its way, so it can move with the pages. `@blotch/ui`'s dock
 * and tab bar follow it through `LynxStackBottomBar`, which also has
 * the page carry the bar while iOS's motion slides another page over it; a
 * bar of an app's own does the same (see LynxStackBottomBar), or reads this
 * directly to slide away on its own:
 *
 * ```ts
 * @Component({
 *   selector: 'app-player-bar',
 *   host: {
 *     '[style.transform]': 'transform()',
 *     '[style.transition]': 'transition()',
 *   },
 *   template: `…`,
 * })
 * export class PlayerBar {
 *   readonly #chrome = inject(LynxStackChrome);
 *   protected readonly transform = computed(
 *     () => `translateY(${this.#chrome.bottomBarProgress() * 100}%)`,
 *   );
 *   protected readonly transition = computed(() => {
 *     const { duration, easing } = this.#chrome.bottomBarMotion();
 *     return duration > 0 ? `transform ${duration}ms ${easing}` : 'none';
 *   });
 * }
 * ```
 *
 * By default, every page pushed over a stack's first page takes the bar
 * away. A route says otherwise in its data (see {@link StackBottomBar}), and
 * an outlet's `hideBottomBar` changes the default.
 *
 * Only an outlet the app shows counts: one with a page the router has
 * active, on pages that are on top of their own stacks. A tab's stack that
 * the router has left (the tab is out of view) doesn't, nor does an outlet
 * on a page covered by another. With outlets inside one another, the
 * innermost decides, and a page that doesn't say (a stack's first page, or a
 * pushed one under `hideBottomBar="never"`) leaves the bar as the outlets
 * around it have it.
 *
 * Injected on a page of a `<lynx-stack-outlet>`, it follows only the outlets
 * on that page: a bar inside a page moves with the page, so the outlet that
 * moves the page doesn't move the bar too.
 */
@Injectable({ providedIn: 'root' })
export class LynxStackChrome {
  #registry: Registry = {
    claims: signal([]),
    owners: new WeakMap(),
    bars: new Set(),
  };
  /** The page whose outlets this chrome follows, or null for every outlet. */
  #scope: LynxStackPage | null = null;

  /**
   * The outlets that count, the outermost first: those that are showing
   * (see the class), in the scope.
   */
  readonly #shown = computed(() => {
    const { claims, owners } = this.#registry;
    const shown: { claim: ChromeClaim; depth: number }[] = [];
    for (const claim of claims()) {
      if (claim.state().active === null) continue;
      // Out through the pages the outlet is on, to the scope: each must be
      // on top of its own stack.
      let page = claim.page;
      let depth = 0;
      let showing = true;
      while (page && page !== this.#scope) {
        if (!page.active()) showing = false;
        page = owners.get(page)?.page ?? null;
        depth++;
      }
      if (showing && page === this.#scope) shown.push({ claim, depth });
    }
    return shown.sort((a, b) => a.depth - b.depth).map((entry) => entry.claim);
  });

  /**
   * Whether the bottom bar should be away: the page on top of the stack
   * that's showing takes it away. It changes as a push or a pop starts, and
   * as the router goes back after a swipe, not while a finger drags a page.
   * A bar that's away should leave screen readers and taps alone.
   */
  readonly bottomBarHidden: Signal<boolean> = computed(() =>
    this.#shown().reduce((hidden, claim) => {
      const { active } = claim.state();
      return awayOf(active!, claim.hidesPushed(), hidden ? 1 : 0) === 1;
    }, false),
  );

  /**
   * How far the bar is away, from 0 (shown) to 1 (gone). A finger dragging a
   * page back moves it with every move. A push or a pop sets it to where it
   * ends up as the pages start to move, and `bottomBarMotion` says how long
   * they take and on what curve, so a bar can move there with them in a CSS
   * transition.
   */
  readonly bottomBarProgress: Signal<number> = computed(() =>
    this.#shown().reduce((fallback, claim) => {
      const { from, to, at } = claim.state();
      const hides = claim.hidesPushed();
      const start = awayOf(from, hides, fallback);
      return start + (awayOf(to, hides, fallback) - start) * at;
    }, 0),
  );

  /**
   * How the bar moves to `bottomBarProgress` (see {@link StackBarMotion}):
   * the motion of the innermost outlet whose pages are moving, or else the
   * innermost one's at rest.
   */
  readonly bottomBarMotion: Signal<StackBarMotion> = computed(
    () => {
      const shown = this.#shown();
      let motion = shown.at(-1)?.state().motion ?? STILL;
      for (const claim of shown) {
        const own = claim.state().motion;
        if (own.duration > 0) motion = own;
      }
      return motion;
    },
    {
      equal: (a, b) =>
        a.animation === b.animation &&
        a.duration === b.duration &&
        a.easing === b.easing &&
        a.coveredX === b.coveredX,
    },
  );

  static {
    follow = (chrome, claim) => {
      const { claims } = chrome.#registry;
      claims.update((list) => [...list, claim]);
      return () => claims.update((list) => list.filter((c) => c !== claim));
    };
    own = (chrome, page, claim) => chrome.#registry.owners.set(page, claim);
    addBar = (chrome, bar) => {
      const { bars } = chrome.#registry;
      bars.add(bar);
      return () => bars.delete(bar);
    };
    barsOf = (chrome) => [...chrome.#registry.bars];
    awayWith = (chrome, claim, bar) => {
      const shown = chrome.#shown();
      if (!shown.includes(claim)) return null;
      const { owners } = chrome.#registry;
      /**
       * Whether an outlet is on a page of the outlet's (its top page, as
       * it's showing): it says what that page has, not the page `bar`
       * stands for.
       */
      const inside = (other: ChromeClaim): boolean => {
        // Every page an outlet is on is in an outlet (see own).
        for (let page = other.page; page; page = owners.get(page)!.page) {
          if (owners.get(page) === claim) return true;
        }
        return false;
      };
      return shown.reduce((away, other) => {
        if (other === claim) return awayOf(bar, other.hidesPushed(), away);
        if (inside(other)) return away;
        return awayOf(other.state().active!, other.hidesPushed(), away);
      }, 0);
    };
    chromeOn = (chrome, page) => {
      let scoped = pageChromes.get(page);
      if (!scoped) {
        scoped = new LynxStackChrome();
        scoped.#registry = chrome.#registry;
        scoped.#scope = page;
        pageChromes.set(page, scoped);
      }
      return scoped;
    };
  }
}
