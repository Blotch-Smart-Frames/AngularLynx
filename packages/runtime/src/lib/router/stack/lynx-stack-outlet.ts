import { Location, LocationStrategy } from '@angular/common';
import {
  type ComponentRef,
  type EnvironmentInjector,
  type InjectOptions,
  type Injector,
  type OnDestroy,
  type ProviderToken,
  type WritableSignal,
  ApplicationRef,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Renderer2,
  ViewContainerRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  type Data,
  ActivatedRoute,
  ChildrenOutletContexts,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  ROUTER_OUTLET_DATA,
  Router,
  RouterOutlet,
} from '@angular/router';
import { LynxAccessibilitySettings } from '../../accessibility/accessibility-settings';
import { isAndroid } from '../../lynx-document/android-blur-capture';
import { LynxElement } from '../../lynx-element/lynx-element';
import { pointerIdOf } from '../../lynx-element/pointer-events';
import {
  type HistoryEntry,
  LynxLocationStrategy,
  historyEntryAt,
  restoreHistory,
  rewindHistory,
} from '../lynx-location-strategy';
import {
  ScreenContexts,
  afterRouterPass,
  binderOf,
  onHiddenPage,
  pathOf,
  type InputBinder,
  urlOf,
} from '../routed-outlet';
import { LynxTabPage } from '../tabs/tab-page';
import { type LiveRoute, liveRoute } from './live-route';
import {
  type BarState,
  type CarriedBar,
  type ChromeClaim,
  type PageBar,
  type StackBarMotion,
  type StackBottomBarDefault,
  LynxStackChrome,
  STILL,
  awayOf,
  awayWith,
  barsOf,
  chromeOn,
  follow,
  own,
} from './stack-chrome';
import { type StackNavigationInfo, changeFor } from './stack-change';
import {
  type Corners,
  type PageLook,
  type ScreenBox,
  type ScreenSize,
  type StackAnimation,
  type StackMotion,
  AT_REST,
  FADE_MOTION,
  IOS_MOTION,
  MATERIAL_MOTION,
  ON_EDGE,
  SQUARE,
  cornerStyle,
  lookStyles,
  mixLooks,
  screenCorners,
  shrunkCorners,
} from './stack-motion';
import { LynxStackPage, setActive, setBottomBarHidden } from './stack-page';
import { type MeasuredElement, boxInLynxView } from './stack-box';
import { SwipeTracker } from './swipe-tracker';

/**
 * What the outlet needs of an element it moves: the renderer's element, which
 * on Lynx is a LynxElement and in a test's DOM an HTMLElement. Neither has
 * `animate()` for sure (jsdom has none), so it's optional.
 */
type FrameElement = {
  animate?: (
    keyframes: Record<string, string | number>[],
    options: { duration: number; easing: string; fill: 'forwards' },
  ) => { cancel(): void } | undefined;
};

/**
 * The outlet's own element, whose box a swipe measures, and the moving
 * page's corners: LynxElement keeps it from the element's layouts (see
 * lynx-element/layout.ts), relative to the LynxView. The outlet reads it
 * through boxInLynxView, which puts Lynx for Web's in the same terms.
 */
type HostElement = FrameElement & MeasuredElement;

/** A page in the stack: the routed component, and the frame it moves in. */
type Page = {
  readonly ref: ComponentRef<unknown>;
  /** What the component injects as its ActivatedRoute (see live-route.ts). */
  readonly live: LiveRoute;
  /** The route the router activated it with last. */
  route: ActivatedRoute;
  /** The view the outlet moves, rounds and hides, holding the component's host. */
  readonly frame: FrameElement;
  /**
   * Where the history was when the page last came to the top (see
   * LynxLocationStrategy.historyIndex): the swipe goes back to the entry
   * before it.
   */
  historyIndex: number;
  /**
   * The contexts the page's own router outlets register in, which keep them
   * while the page isn't on top: the router forgets them when it leaves the
   * page's route, and the outlets, which live on with the page, never
   * register again (see ScreenContexts).
   */
  readonly contexts: ScreenContexts;
  /** What the page's components inject to know about it. */
  readonly stackPage: LynxStackPage;
  /** What it says about the bottom bar (see LynxStackChrome). */
  readonly bar: WritableSignal<PageBar>;
};

/**
 * A stack the router left while the page or tab it's on was hidden (see
 * onHiddenPage): its pages stay as they were until the router comes back.
 */
type Parked = {
  /**
   * The history entry of each page under the top one, from when the stack
   * was left, to put back when it comes back (see #restoreHistory).
   */
  readonly entries: ReadonlyMap<Page, HistoryEntry>;
};

/** One element moving from one look to another. */
type Move = {
  readonly element: FrameElement;
  readonly from: Record<string, string>;
  readonly to: Record<string, string>;
};

/**
 * The bottom bar moving with a transition: from what one page says about it
 * to what another says, `at` of the way once the transition ends.
 */
type BarMove = {
  readonly from: Page;
  readonly to: Page;
  readonly at: number;
  /**
   * The pages that can carry a bar that goes away or comes back (see
   * #carryBars): those still in the stack when the pages stop.
   */
  readonly carriers: readonly Page[];
};

/**
 * A transition running: `finish()` jumps it to its end, as a navigation
 * that comes in mid-transition does, and `stop()` abandons it, as the
 * outlet's destruction does (its pages go with it).
 */
type Transition = { finish(): void; stop(): void };

/** A finger dragging the top page back. */
type Swipe = {
  readonly tracker: SwipeTracker;
  /** The touch it follows, or null for a mouse. */
  readonly touch: number | null;
  readonly top: Page;
  readonly under: Page;
  /** Whether the pages are following the finger yet. */
  dragging: boolean;
  /** The top page's corners at rest, from when it started following. */
  corners: Corners;
  /** Its `border-radius` now, so a move sets it only when it changes. */
  radius: string | null;
};

/** A touch, as Lynx and the DOM both report one. */
type TouchPoint = {
  readonly identifier: number;
  readonly pageX: number;
  readonly pageY: number;
  /** Lynx for Web's position relative to the LynxView (see positionOf). */
  readonly x?: number;
  readonly y?: number;
};

/** A touch or mouse event, as Lynx and the DOM both report one. */
type PointerEvent = {
  readonly touches: ArrayLike<TouchPoint>;
  readonly changedTouches: ArrayLike<TouchPoint>;
  readonly target?: unknown;
  readonly x?: number;
  readonly y?: number;
  readonly buttons?: number;
};

/** The elements a finger swipes sideways in on its own. */
const SIDEWAYS_ELEMENTS = new Set(['viewpager', 'swiper', 'x-swiper']);

/**
 * The injector a page's component gets, as RouterOutlet's OutletInjector
 * (not exported) is: it gives the page its route, its outlets' contexts and
 * the outlet's data, and leaves the rest to the outlet's own injector.
 */
class PageInjector {
  constructor(
    readonly route: ActivatedRoute,
    readonly childContexts: ScreenContexts,
    readonly parent: Injector,
    readonly outletData: unknown,
    readonly stackPage: LynxStackPage,
    readonly chrome: LynxStackChrome,
  ) {}

  get<T>(
    token: ProviderToken<T>,
    notFoundValue?: unknown,
    options?: InjectOptions,
  ): T {
    const key: unknown = token;
    if (key === ActivatedRoute) return this.route as T;
    if (key === ChildrenOutletContexts) return this.childContexts as T;
    if (key === ROUTER_OUTLET_DATA) return this.outletData as T;
    if (key === LynxStackPage) return this.stackPage as T;
    // A bar on the page follows only the outlets on the page: the outlet
    // moving the page moves the bar with it.
    if (key === LynxStackChrome) {
      return chromeOn(this.chrome, this.stackPage) as T;
    }
    return this.parent.get(token, notFoundValue as T, options);
  }
}

/**
 * A router outlet that keeps a stack of pages and moves between them as the
 * platform's navigation does: on iOS, a new page slides in from the right
 * with rounded corners over the last one, which slides a third of the way
 * left under a shadow of dark, and going back slides it away again; on
 * Android, pages slide and fade as Android's activities do. A finger dragging
 * a page from the left edge, or anywhere on it that doesn't scroll sideways,
 * takes it back, and the page follows the finger.
 *
 * A moving page rounds only the corners that are in a corner of the screen,
 * as iOS and Android do: an outlet under an app bar moves its pages with
 * square corners at the top, where the bar meets them.
 *
 * Use it in place of `<router-outlet>`; it's one, with the same inputs and
 * outputs. The pages under the top one stay alive, as a navigation
 * controller's do, so going back finds them as they were, scrolled where they
 * were.
 *
 * ```html
 * <lynx-stack-outlet />
 * ```
 *
 * The stack follows the URL (see {@link changeFor}): a deeper URL pushes a
 * page, a URL in the stack pops back to it, and a URL at the same depth, as
 * from a tab bar, starts a new stack without a transition. A navigation's
 * `info` can say otherwise ({@link StackNavigationInfo}).
 *
 * Going back goes through the router: Back (`Location.back()`), the Android
 * back button and a swipe all navigate, so guards and resolvers run, and a
 * guard that refuses brings a swiped page back. A link that pops back to a
 * page takes the history back with the stack, as Back would have, so going
 * back from the page then goes to the one under it, not to a page it popped.
 *
 * A page pushed over the stack's first one takes the app's bottom bar (a
 * tab bar or a dock outside the outlet) away, and the bar comes back as the
 * page goes, with the pages and with a finger dragging them: the outlet says
 * so through {@link LynxStackChrome}, which `@blotch/ui`'s dock and tab bar
 * follow. A route's `data: { bottomBar: 'visible' }` keeps the bar on its
 * page, and `hideBottomBar="never"` keeps it on every page whose route
 * doesn't say.
 */
@Component({
  selector: 'lynx-stack-outlet',
  exportAs: 'outlet',
  template: '',
  host: {
    // The pages fill the outlet, one over another, and a page coming in from
    // the side is clipped by it.
    style: 'position: relative; overflow: hidden; flex: 1 1 0%;',
  },
})
export class LynxStackOutlet extends RouterOutlet implements OnDestroy {
  /**
   * How pages move: `'ios'`, `'material'`, or `'none'`, which swaps them at
   * once and turns the swipe off. By default, Material on Android and iOS
   * everywhere else, the web included. While Reduce Motion is on, a push or a
   * pop cross-fades instead, as iOS's does; a drag still moves the page.
   */
  readonly animation = input<StackAnimation | undefined>(undefined);

  /**
   * Whether a finger dragging the top page to the right takes it back: from
   * the left edge, or anywhere on the page that doesn't scroll sideways itself,
   * as on iOS 26.
   */
  readonly swipeBack = input(true, { transform: booleanAttribute });

  /**
   * Classes for each page's frame, the view that holds the routed component
   * and moves. Without them a page is drawn on the theme's background
   * (`var(--background)`, white without the `@blotch/ui` theme), so the page
   * under it doesn't show through; give a class with a background of its own
   * for another (`pageClass="bg-card"`).
   */
  readonly pageClass = input('');

  /**
   * Which pages take the app's bottom bar away when their route's data
   * doesn't say (its `bottomBar`): `'pushed'`, every page over the stack's
   * first one, as Material does, or `'never'`, as iOS keeps its tab bar
   * unless a screen hides it.
   */
  readonly hideBottomBar = input<StackBottomBarDefault>('pushed');

  readonly #renderer = inject(Renderer2);
  readonly #host = inject(ElementRef).nativeElement as HostElement;
  readonly #pages = inject(ViewContainerRef);
  readonly #contexts = inject(ChildrenOutletContexts);
  readonly #changes = inject(ChangeDetectorRef);
  readonly #router = inject(Router);
  readonly #root = inject(ApplicationRef).injector;
  readonly #location = inject(Location);
  readonly #strategy = inject(LocationStrategy);
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #chrome = inject(LynxStackChrome);
  /** The stack page the outlet is on, inside another outlet, if it is. */
  readonly #outerPage = inject(LynxStackPage, { optional: true });
  /** The tab of a `<lynx-tab-outlet>` the outlet is in, if it is. */
  readonly #tab = inject(LynxTabPage, { optional: true });
  readonly #android = isAndroid();

  /** The pages, the bottom one first. */
  #stack: Page[] = [];
  /** The page the router has active: the top one, or null between routes. */
  #active: Page | null = null;
  /**
   * Set while the router has left the stack on a page or tab that's hidden,
   * which keeps the pages for when it comes back.
   */
  #parked: Parked | null = null;
  /** Every page's frame, for the bars they carry (see #homeBars). */
  readonly #frames = new WeakSet<FrameElement>();
  /**
   * The frames that carried bars when the router last left the outlet, until
   * it comes back in the same pass (see #lendBars).
   */
  readonly #lent = new Map<CarriedBar, FrameElement>();
  /**
   * What each component's page gave it, for a component the reuse strategy
   * hands back: it keeps them.
   */
  readonly #given = new WeakMap<
    ComponentRef<unknown>,
    Pick<Page, 'live' | 'contexts'>
  >();
  #transition: Transition | null = null;
  #swipe: Swipe | null = null;
  /** The page a swipe took away, until the navigation back settles. */
  #swiped: Page | null = null;
  /** Darkens the page under a moving one. */
  readonly #scrim = this.#overlay({ 'background-color': '#000000' });
  /** Takes the touches meant for pages while they move (see #shield). */
  readonly #shieldElement = this.#overlay({});
  #destroyed = false;

  /** Where the outlet has the bottom bar (see LynxStackChrome). */
  readonly #bar = signal<BarState>({
    from: 'root',
    to: 'root',
    at: 1,
    active: null,
    motion: STILL,
  });
  readonly #claim: ChromeClaim = {
    page: this.#outerPage,
    state: this.#bar.asReadonly(),
    hidesPushed: computed(() => this.hideBottomBar() === 'pushed'),
  };
  readonly #unfollow = follow(this.#chrome, this.#claim);

  constructor() {
    super();
    this.#ownView(this.#host);
    // Starts tracking the outlet's layout (see lynx-element/layout.ts), so
    // the outlet's width is known by the time a finger needs it.
    this.#host.getBoundingClientRect?.();
    this.#listen('bindtouchstart', (event) => this.#touchStart(event));
    this.#listen('bindtouchmove', (event) => this.#touchMove(event));
    this.#listen('bindtouchend', (event) => this.#touchEnd(event));
    this.#listen('bindtouchcancel', (event) => this.#touchEnd(event, true));
    if (__WEB__) {
      // A desktop browser sends a mouse no touches, and Lynx for Web passes
      // mouse events through rather than making touches of them, so the
      // mouse drags pages there itself, as the bottom sheet's handle does.
      this.#listen('bindmousedown', (event) => this.#mouseDown(event));
      this.#listen('bindmousemove', (event) => this.#mouseMove(event));
      this.#listen('bindmouseup', () => this.#release(false));
    }
    effect(() => {
      const classes = this.pageClass();
      for (const page of this.#stack) this.#styleFrame(page.frame, classes);
    });
  }

  /**
   * A parked stack whose page or tab is shown again without the router
   * coming back to it (it left the outlet's route for good meanwhile, as a
   * named outlet's is) shows nothing, as the router has it.
   */
  readonly #dropsParked = this.#router.events.subscribe((event) => {
    if (
      event instanceof NavigationEnd &&
      this.#parked &&
      !this.#active &&
      !onHiddenPage(this.#outerPage, this.#tab)
    ) {
      this.#parked = null;
      this.#clear();
    }
  });

  override ngOnDestroy(): void {
    this.#destroyed = true;
    this.#dropsParked.unsubscribe();
    this.#transition?.stop();
    // Before the pages go, and their views are released.
    this.#homeBars();
    this.#unfollow();
    super.ngOnDestroy();
  }

  override get isActivated(): boolean {
    return this.#active !== null;
  }

  override get component(): object {
    return this.#activePage().ref.instance as object;
  }

  override get activatedRoute(): ActivatedRoute {
    return this.#activePage().route;
  }

  override get activatedRouteData(): Data {
    return this.#active?.route.snapshot.data ?? {};
  }

  get activatedComponentRef(): ComponentRef<unknown> | null {
    return this.#active?.ref ?? null;
  }

  override activateWith(
    route: ActivatedRoute,
    environmentInjector: EnvironmentInjector,
  ): void {
    if (this.#active) {
      throw new Error('Cannot activate an already activated outlet');
    }
    const component = route.snapshot.component;
    if (!component) throw new Error('The route has no component to show');
    this.#show(route, (injector) =>
      this.#pages.createComponent(component, {
        index: this.#pages.length,
        injector,
        environmentInjector,
      }),
    );
  }

  override deactivate(): void {
    const page = this.#active;
    if (!page) return;
    this.#binder?.unsubscribeFromRouteData(this);
    // The router forgets the contexts of the page's outlets as it leaves
    // the page's route (it calls this right after). Keep them for when the
    // page comes back to the top.
    page.contexts.hide();
    this.#active = null;
    setActive(page.stackPage, false);
    this.#leaveBar();
    this.#lendBars();
    this.deactivateEvents.emit(page.ref.instance);
    // The router activates the next route straight after, in the same
    // pass. If it doesn't, this outlet shows nothing now, unless the router
    // left it because the page or tab it's on went out of view: then the
    // pages stay as they are, native views and all, for when it comes back,
    // as a navigation controller in a covered screen or a hidden tab keeps
    // its stack.
    afterRouterPass(this.#router, () => {
      this.#lent.clear();
      if (this.#active || this.#destroyed) return;
      if (onHiddenPage(this.#outerPage, this.#tab)) {
        this.#park();
      } else {
        this.#clear();
      }
    });
  }

  /**
   * Keeps the pages as they are while the page or tab the outlet is on is
   * hidden, and the history entries of those under the top one: the app
   * goes elsewhere meanwhile, and they may not be in the history any more
   * when it comes back (see #restoreHistory).
   */
  #park(): void {
    const entries = new Map<Page, HistoryEntry>();
    const strategy = this.#strategy;
    if (strategy instanceof LynxLocationStrategy) {
      for (const page of this.#stack.slice(0, -1)) {
        const entry = historyEntryAt(strategy, page.historyIndex);
        if (entry && pathOf(entry.url) === urlOf(page.route)) {
          entries.set(page, entry);
        }
      }
    }
    this.#parked = { entries };
  }

  override detach(): ComponentRef<unknown> {
    const page = this.#activePage();
    this.#binder?.unsubscribeFromRouteData(this);
    this.#transition?.finish();
    this.#cancelSwipe();
    // The strategy has the page now: it leaves the stack alive, and comes
    // back through attach().
    this.#pages.detach(this.#pages.indexOf(page.ref.hostView));
    this.#stack.splice(this.#stack.indexOf(page), 1);
    this.#removePage(page, false);
    this.#active = null;
    setActive(page.stackPage, false);
    this.#leaveBar();
    this.#homeBars();
    this.detachEvents.emit(page.ref.instance);
    return page.ref;
  }

  override attach(ref: ComponentRef<unknown>, route: ActivatedRoute): void {
    this.#show(route, () => {
      this.#pages.insert(ref.hostView);
      return ref;
    });
    this.attachEvents.emit(ref.instance);
  }

  // --- Navigation -----------------------------------------------------------

  /**
   * Shows the route's page, a new one from `create` or one in the stack,
   * moving the stack as the navigation says (see changeFor).
   */
  #show(
    route: ActivatedRoute,
    create: (injector: Injector) => ComponentRef<unknown>,
  ): void {
    const parked = this.#parked;
    this.#parked = null;
    try {
      this.#change(route, create, parked);
      if (parked) this.#restoreHistory(parked);
    } finally {
      // Where the pages end up, unless they're moving: a transition leaves
      // the bars where it wants them until it's over.
      this.#settleBars();
    }
  }

  #change(
    route: ActivatedRoute,
    create: (injector: Injector) => ComponentRef<unknown>,
    parked: Parked | null,
  ): void {
    this.#transition?.finish();
    this.#cancelSwipe();
    this.#takeBackBars();
    const navigation = this.#router.currentNavigation();
    const top = this.#stack.at(-1);
    const historyIndex = this.#historyIndex();
    const popstate = navigation?.trigger === 'popstate';
    // A stack coming back with its page or tab changes at once: nobody saw
    // it go, so nothing slides.
    const animates = this.#animates && !parked;

    // Back where it was left: the top page shows again as it was.
    if (parked && top && urlOf(route) === urlOf(top.route)) {
      this.#follow(top, route);
      top.historyIndex = historyIndex;
      this.#activate(top);
      this.#rest(top);
      return;
    }

    const change = changeFor({
      stack: this.#stack.map((page) => urlOf(page.route)),
      url: urlOf(route),
      popstate,
      forward: top !== undefined && historyIndex > top.historyIndex,
      replaceUrl: navigation?.extras.replaceUrl === true,
      hint: (navigation?.extras.info as StackNavigationInfo | undefined)?.stack,
    });
    // A page a swipe took away is gone already: whatever the navigation does,
    // nothing more slides.
    const swiped = this.#swiped;
    this.#swiped = null;

    if (change.kind === 'pop') {
      const page = this.#stack[change.index]!;
      const leaving = this.#stack.splice(change.index + 1);
      this.#follow(page, route);
      // Back, Android's back button and a swipe went back in the history to
      // the page already; a link to it went forward, and the history goes
      // back to the page's entry with the stack. A parked stack's entries
      // are where the history was when it was left, and #restoreHistory puts
      // them back instead.
      page.historyIndex =
        popstate || parked ? historyIndex : this.#rewindTo(page);
      this.#activate(page);
      if (swiped || !animates) {
        this.#rest(page);
        for (const gone of leaving) this.#removePage(gone);
      } else {
        // Only the top page slides away, as UIKit's popToViewController
        // does: the ones between go at once.
        const sliding = leaving.pop()!;
        for (const gone of leaving) this.#removePage(gone);
        this.#slide(sliding, page, 'out', () => this.#removePage(sliding));
      }
      return;
    }

    const page = this.#createPage(route, historyIndex, create);
    if (change.kind === 'push') {
      this.#stack.push(page);
      this.#activate(page);
      if (top && change.animated && animates) {
        this.#slide(page, top, 'in', () => this.#hide(top));
      } else if (top) {
        this.#hide(top);
      }
      return;
    }

    // A replace or a reset: the page takes the top one's place, or all of
    // theirs, at once or sliding in from behind.
    const leaving =
      change.kind === 'replace'
        ? this.#stack.splice(-1)
        : this.#stack.splice(0);
    this.#stack.push(page);
    this.#activate(page);
    if (
      change.kind === 'reset' &&
      change.animated &&
      top &&
      !swiped &&
      animates
    ) {
      // The new page goes under the top one, which slides away off it.
      this.#renderer.insertBefore(this.#host, page.frame, top.frame);
      const sliding = leaving.pop()!;
      for (const gone of leaving) this.#removePage(gone);
      this.#slide(sliding, page, 'out', () => this.#removePage(sliding));
    } else {
      for (const gone of leaving) this.#removePage(gone);
    }
  }

  /**
   * Makes a page the router's active one, as RouterOutlet does.
   */
  #activate(page: Page): void {
    this.#active = page;
    setActive(page.stackPage, true);
    // Where it is in the stack, and its route, decide what it says about the
    // bar, and both can have changed since it was last on top.
    page.bar.set(this.#barOf(page));
    this.#restBar(page);
    this.#changes.markForCheck();
    this.#binder?.bindActivatedRouteToOutletComponent(
      this,
      this.#pages.injector,
    );
    this.activateEvents.emit(page.ref.instance);
  }

  /**
   * Points a page in the stack at the route the router activates it with now,
   * and gives its outlets back their contexts (see Page.contexts).
   */
  #follow(page: Page, route: ActivatedRoute): void {
    page.route = route;
    page.live.follow(route);
    page.contexts.show();
  }

  /**
   * Has the history lead back through the pages of a stack that comes back
   * with its page or tab (see #park), as each page leads back to the one
   * under it: Back, Android's back button and the swipe then go to the page
   * under the top one, not to wherever the app went meanwhile.
   *
   * If the history has the pages before the current entry already, as when
   * Back brings the stack back, they keep their entries. Otherwise the
   * pages' entries go back in before the current one (see restoreHistory),
   * as a tab bar brings back a tab's back stack.
   */
  #restoreHistory(parked: Parked): void {
    const strategy = this.#strategy;
    if (!(strategy instanceof LynxLocationStrategy)) return;
    const under = this.#stack.slice(0, -1);
    const first = strategy.historyIndex - under.length;
    const inPlace = under.every(
      (page, index) =>
        pathOf(historyEntryAt(strategy, first + index)?.url ?? '') ===
        urlOf(page.route),
    );
    if (!inPlace) {
      restoreHistory(
        strategy,
        under.map(
          (page) =>
            parked.entries.get(page) ?? { state: null, url: urlOf(page.route) },
        ),
      );
    }
    const top = strategy.historyIndex;
    under.forEach((page, index) => {
      page.historyIndex = top - under.length + index;
    });
    this.#stack.at(-1)!.historyIndex = top;
  }

  #createPage(
    route: ActivatedRoute,
    historyIndex: number,
    create: (injector: Injector) => ComponentRef<unknown>,
  ): Page {
    const live = liveRoute(route);
    const stackPage = new LynxStackPage();
    const contexts = new ScreenContexts(this.#childContexts, this.#root);
    const injector = new PageInjector(
      live.route,
      contexts,
      this.#pages.injector,
      this.routerOutletData,
      stackPage,
      this.#chrome,
    ) as unknown as Injector;
    const ref = create(injector);
    // A component the reuse strategy hands back has the route of the page it
    // was on, which now follows this one, and that page's contexts, which its
    // outlets registered in. The router gave their contexts back before
    // attach(), and the page's are shown, as they were when it was detached.
    const remembered = this.#given.get(ref);
    remembered?.live.follow(route);
    const frame = this.#renderer.createElement('view') as FrameElement;
    this.#frames.add(frame);
    this.#ownView(frame);
    this.#styleFrame(frame, this.pageClass());
    this.#setStyles(frame, {
      position: 'absolute',
      top: '0px',
      left: '0px',
      right: '0px',
      bottom: '0px',
      display: 'flex',
      'flex-direction': 'column',
      overflow: 'hidden',
    });
    this.#renderer.appendChild(this.#host, frame);
    // The view container puts the component's host beside the outlet; it
    // belongs in its frame.
    this.#renderer.appendChild(frame, ref.location.nativeElement);
    const bar = signal<PageBar>('root');
    const page: Page = {
      ref,
      live: remembered?.live ?? live,
      route,
      frame,
      historyIndex,
      contexts: remembered?.contexts ?? contexts,
      stackPage,
      bar,
    };
    this.#given.set(ref, { live: page.live, contexts: page.contexts });
    own(stackPage, this.#claim);
    // The page's own answer, or the answer of the page it's in.
    setBottomBarHidden(
      stackPage,
      computed(
        () =>
          awayOf(
            bar(),
            this.#claim.hidesPushed(),
            this.#outerPage?.bottomBarHidden() ? 1 : 0,
          ) === 1,
      ),
    );
    return page;
  }

  #styleFrame(frame: FrameElement, classes: string): void {
    this.#renderer.setAttribute(frame, 'class', classes);
    if (classes) {
      this.#renderer.removeStyle(frame, 'background-color');
    } else {
      // A bare var() works in Lynx's inline styles, fallback and all.
      this.#renderer.setStyle(
        frame,
        'background-color',
        'var(--background, #ffffff)',
      );
    }
  }

  /**
   * Takes a page off the screen and destroys it.
   */
  #removePage(page: Page, destroy = true): void {
    // A bar the page carries goes back to its place first: it isn't the
    // page's, and goes on without it.
    this.#homeBars(page);
    if (destroy) page.ref.destroy();
    this.#renderer.removeChild(this.#host, page.frame);
  }

  /**
   * Destroys every page: the router left this outlet empty.
   */
  #clear(): void {
    this.#transition?.finish();
    this.#cancelSwipe();
    for (const page of this.#stack.splice(0)) this.#removePage(page);
  }

  #activePage(): Page {
    if (!this.#active) throw new Error('Outlet is not activated');
    return this.#active;
  }

  get #childContexts(): ChildrenOutletContexts {
    return this.#contexts.getOrCreateContext(this.name).children;
  }

  get #binder(): InputBinder | null {
    return binderOf(this);
  }

  #historyIndex(): number {
    return this.#strategy instanceof LynxLocationStrategy
      ? this.#strategy.historyIndex
      : 0;
  }

  /**
   * Takes the history back to `page`'s entry, as a link that pops the stack
   * back to the page goes forward in it (see rewindHistory): the entries of
   * the pages it popped go, so going back from the page goes to the page
   * under it, not to the page that went. Returns where the history is then.
   *
   * Only the Lynx history can be rewritten. With another strategy (a
   * browser's), Back goes back through the entries the link left, as a web
   * app's does.
   */
  #rewindTo(page: Page): number {
    const strategy = this.#strategy;
    if (strategy instanceof LynxLocationStrategy) {
      rewindHistory(strategy, page.historyIndex);
    }
    return this.#historyIndex();
  }

  /**
   * --- Bottom bar -------------------------------------------------------------
   */

  /**
   * What a page says about the bottom bar: its route's `bottomBar`, or else
   * whether it's pushed over the stack's first page.
   */
  #barOf(page: Page): PageBar {
    const said: unknown = page.route.snapshot.data['bottomBar'];
    if (said === 'visible' || said === 'hidden') return said;
    return this.#stack.indexOf(page) > 0 ? 'pushed' : 'root';
  }

  /**
   * Has the bar moving from where `from` has it to where `to` does, `at` of
   * the way, as `motion` says.
   */
  #moveBar(from: Page, to: Page, at: number, motion: StackBarMotion): void {
    this.#bar.set({
      from: from.bar(),
      to: to.bar(),
      at,
      active: this.#active?.bar() ?? null,
      motion,
    });
  }

  /**
   * Leaves the bar where `page`, on top, has it, with nothing moving.
   */
  #restBar(page: Page): void {
    this.#moveBar(page, page, 1, this.#stillMotion());
  }

  /**
   * The router left the outlet without a page: it doesn't say anything about
   * the bar until it has one again.
   */
  #leaveBar(): void {
    this.#bar.update((state) => ({ ...state, active: null }));
  }

  /**
   * The pages stopped moving where the bar was going.
   */
  #settleBar(): void {
    this.#bar.update((state) => ({
      ...state,
      motion: { ...state.motion, duration: 0 },
    }));
  }

  /**
   * The motion of a bar that follows the pages at once: at rest, or under a
   * finger.
   */
  #stillMotion(): StackBarMotion {
    const motion = this.#motion;
    return {
      animation: this.#animates ? motion.animation : 'none',
      duration: 0,
      easing: 'linear',
      coveredX: motion.covered.x,
    };
  }

  /**
   * --- Bars a page carries ----------------------------------------------------
   */

  /**
   * As the pages move from `from` on top to `to`, puts each bar that goes
   * away or comes back (see LynxStackBottomBar) in the page that has it, if
   * that page is one of `carriers`, as UIKit puts its tab bar in the view of
   * the screen that has it while its navigation controller moves: the page
   * pushed over it, or popped off it, covers the bar as it covers the page,
   * with its rounded corners and its shadow, and the scrim dims it. A bar
   * outside the stack would lie over both pages.
   *
   * Only iOS's motion slides one page over another. Material's slides the
   * bar away on its own, and the cross-fade under Reduce Motion swaps it at
   * once. A popped page, and a top page a finger drags, which may go, carry
   * nothing: the bar would go with it. The bar slides away on its own then.
   */
  #carryBars(
    from: Page,
    to: Page,
    motion: StackMotion,
    carriers: readonly Page[],
  ): void {
    if (motion.animation !== 'ios') return;
    for (const bar of barsOf(this.#chrome)) {
      const start = this.#awayOn(bar, from);
      // The bar follows this outlet whichever page is on top, or it doesn't.
      if (start === null || start === this.#awayOn(bar, to)) continue;
      const page = start === 0 ? from : to;
      if (carriers.includes(page)) bar.carry(page.frame);
    }
  }

  /**
   * How far away the bar is with `page` on top: 0 (shown) or 1 (gone), or
   * null if the bar doesn't follow this outlet.
   */
  #awayOn(bar: CarriedBar, page: Page): number | null {
    return awayWith(bar.chrome, this.#claim, page.bar());
  }

  /**
   * With the pages at rest, puts each bar a page of this outlet carries back
   * in its place, unless it's away and the page carrying it is still covered:
   * there the page keeps it, under the one on top, for when it comes back.
   */
  #settleBars(): void {
    if (this.#transition) return;
    const top = this.#stack.at(-1)?.frame;
    for (const bar of barsOf(this.#chrome)) {
      const frame = bar.frame() as FrameElement;
      if (!this.#frames.has(frame)) continue;
      if (frame === top || !bar.chrome.bottomBarHidden()) bar.home();
    }
  }

  /**
   * Gives each bar a page carries back to the app as the router leaves the
   * outlet, as it does when it leaves the stack (a tab), remembering which
   * page had it: a navigation in the stack leaves the outlet too, and comes
   * straight back (see #takeBackBars).
   */
  #lendBars(): void {
    for (const bar of barsOf(this.#chrome)) {
      const frame = bar.frame() as FrameElement;
      if (!this.#frames.has(frame)) continue;
      this.#lent.set(bar, frame);
      bar.home();
    }
  }

  /**
   * As the router comes back to the outlet in the same pass, has the pages
   * that carried bars carry them again, as if it had never left: a page
   * pushed over a page that hides the bar too leaves it with the page that
   * has it, for when it comes back.
   */
  #takeBackBars(): void {
    // The pages are as the router left them: finishing a transition takes
    // away only a page that doesn't carry a bar (see #carryBars), and a bar
    // destroyed meanwhile, out of the tree, stays out of it.
    for (const [bar, frame] of this.#lent) bar.carry(frame);
    this.#lent.clear();
  }

  /**
   * Puts each bar a page of this outlet carries back in its place, or only
   * the bar `page` carries. A page taken out of the stack, on its way off
   * the screen, still counts.
   */
  #homeBars(page?: Page): void {
    for (const bar of barsOf(this.#chrome)) {
      const frame = bar.frame() as FrameElement;
      if (page ? frame === page.frame : this.#frames.has(frame)) bar.home();
    }
  }

  /**
   * --- Motion -----------------------------------------------------------------
   */

  get #animation(): StackAnimation {
    return this.animation() ?? (this.#android ? 'material' : 'ios');
  }

  get #animates(): boolean {
    return this.#animation !== 'none';
  }

  /**
   * The platform's motion, which a finger drags with.
   */
  get #motion(): StackMotion {
    return this.#animation === 'material' ? MATERIAL_MOTION : IOS_MOTION;
  }

  get #width(): number {
    return boxInLynxView(this.#host).width;
  }

  /**
   * Slides `moving` in over `under` (a push) or out off it (a pop), then runs
   * `done`.
   */
  #slide(
    moving: Page,
    under: Page,
    direction: 'in' | 'out',
    done: () => void,
  ): void {
    const motion = this.#settings.reduceMotion() ? FADE_MOTION : this.#motion;
    // The moving page on top, the page under it covered and dimmed.
    const onTop = { top: AT_REST, under: motion.covered, scrim: motion.dim };
    // The moving page off screen, the page under it shown.
    const away = { top: motion.offscreen, under: AT_REST, scrim: 0 };
    const [from, to] = direction === 'in' ? [away, onTop] : [onTop, away];
    this.#run(
      moving,
      under,
      motion,
      () => (motion.roundsAnimated ? this.#cornersFor(motion) : SQUARE),
      from,
      to,
      motion.duration,
      motion.easing,
      // The bar goes where the page that ends up on top has it. A popped
      // page goes, so it doesn't carry a bar.
      direction === 'in'
        ? { from: under, to: moving, at: 1, carriers: [moving, under] }
        : { from: moving, to: under, at: 1, carriers: [under] },
      done,
    );
  }

  /**
   * Animates the top page and the one under it, and the scrim between them,
   * from one set of looks to another, then leaves them at rest: the top page
   * shown, the one under it hidden. The top page has `corners` as it moves,
   * worked out once a page carries the bottom bar, which moves as `bar`
   * says, with them.
   */
  #run(
    top: Page,
    under: Page,
    motion: StackMotion,
    corners: () => Corners,
    from: { top: PageLook; under: PageLook; scrim: number },
    to: { top: PageLook; under: PageLook; scrim: number },
    duration: number,
    easing: string,
    bar: BarMove,
    done: () => void,
  ): void {
    const width = this.#width;
    this.#carryBars(bar.from, bar.to, motion, bar.carriers);
    this.#uncover(under);
    this.#raise(top, motion, corners());
    const scrim = this.#placeScrim(top);
    const moves: Move[] = [
      {
        element: top.frame,
        from: lookStyles(from.top, width),
        to: lookStyles(to.top, width),
      },
      {
        element: under.frame,
        from: lookStyles(from.under, width),
        to: lookStyles(to.under, width),
      },
      {
        element: scrim,
        from: { opacity: String(from.scrim) },
        to: { opacity: String(to.scrim) },
      },
    ];
    this.#shield(true);
    // Each element starts where the transition does, from this update on.
    for (const move of moves) this.#setStyles(move.element, move.from);
    // The bar outside the stack goes where the transition ends, as long as
    // the pages take and on their curve, for it to move there with them.
    this.#moveBar(bar.from, bar.to, bar.at, {
      animation: motion.animation,
      duration,
      easing,
      coveredX: motion.covered.x,
    });
    let animations: ({ cancel(): void } | undefined)[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The animations start on the next turn, once this update has been
    // flushed: Lynx drops an animation on an element it doesn't have yet,
    // such as a page pushed this turn, and the page would just appear.
    const start = setTimeout(() => {
      animations = moves.map((move) =>
        move.element.animate?.([move.from, move.to], {
          duration,
          easing,
          fill: 'forwards',
        }),
      );
      // Lynx tells a script nothing when an animation ends, so a timer does.
      timer = setTimeout(finish, duration);
    }, 0);
    /**
     * Only the outlet ends a transition, through #transition, which holds the
     * one running: a new one starts once it's over.
     */
    const end = (): void => {
      clearTimeout(start);
      clearTimeout(timer);
      this.#transition = null;
    };
    const finish = (): void => {
      end();
      // Set the end inline before canceling, so the frame between them
      // doesn't draw the start.
      for (const move of moves) this.#setStyles(move.element, move.to);
      for (const animation of animations) animation?.cancel();
      this.#dropScrim();
      this.#lower(top);
      this.#shield(false);
      this.#settleBar();
      done();
      this.#settleBars();
    };
    const stop = (): void => {
      end();
      for (const animation of animations) animation?.cancel();
    };
    const transition: Transition = { finish, stop };
    this.#transition = transition;
  }

  /**
   * Leaves a page shown on top at rest, the one under it hidden.
   */
  #rest(page: Page): void {
    this.#setStyles(page.frame, lookStyles(AT_REST, 0));
    this.#renderer.removeStyle(page.frame, 'visibility');
    const index = this.#stack.indexOf(page);
    for (const below of this.#stack.slice(0, index)) this.#hide(below);
  }

  /**
   * Hides a covered page, at rest under the others.
   */
  #hide(page: Page): void {
    this.#setStyles(page.frame, {
      ...lookStyles(AT_REST, 0),
      visibility: 'hidden',
    });
  }

  /**
   * Shows a covered page, for the one above it to move over.
   */
  #uncover(page: Page): void {
    this.#renderer.removeStyle(page.frame, 'visibility');
  }

  /**
   * The corners of a page moving in the outlet, where it is now: round only
   * in the screen's corners (see screenCorners).
   */
  #cornersFor(motion: StackMotion): Corners {
    return screenCorners(this.#box(), screenSize(), motion.radius);
  }

  /**
   * The outlet's box, and the room under it of a bar a page of its carries
   * out of the layout: a tab bar under the outlet, which then runs to the
   * bar's bottom edge, the screen's, once Lynx lays it out again. A push
   * that carries the bar works out the pushed page's corners before then.
   */
  #box(): ScreenBox {
    const box = boxInLynxView(this.#host);
    let bottom = box.top + box.height;
    for (const bar of barsOf(this.#chrome)) {
      if (!this.#frames.has(bar.frame() as FrameElement)) continue;
      const room = bar.box();
      if (Math.abs(room.top - bottom) <= ON_EDGE)
        bottom = room.top + room.height;
    }
    return {
      left: box.left,
      top: box.top,
      width: box.width,
      height: bottom - box.top,
    };
  }

  /**
   * Rounds and shadows a page that moves.
   */
  #raise(page: Page, motion: StackMotion, corners: Corners): void {
    this.#round(page, cornerStyle(corners));
    if (motion.shadow) {
      this.#renderer.setStyle(page.frame, 'box-shadow', motion.shadow);
    }
  }

  /**
   * Gives a page's frame a `border-radius`, or takes it away for null.
   */
  #round(page: Page, radius: string | null): void {
    if (radius) {
      this.#renderer.setStyle(page.frame, 'border-radius', radius);
    } else {
      this.#renderer.removeStyle(page.frame, 'border-radius');
    }
  }

  #lower(page: Page): void {
    this.#renderer.removeStyle(page.frame, 'border-radius');
    this.#renderer.removeStyle(page.frame, 'box-shadow');
  }

  /**
   * A view over the whole outlet, put in it when it's needed: the scrim or
   * the shield.
   */
  #overlay(styles: Record<string, string>): FrameElement {
    const overlay = this.#renderer.createElement('view') as FrameElement;
    this.#ownView(overlay);
    this.#setStyles(overlay, {
      position: 'absolute',
      top: '0px',
      left: '0px',
      right: '0px',
      bottom: '0px',
      ...styles,
    });
    return overlay;
  }

  /**
   * Puts the scrim right under a page that moves.
   */
  #placeScrim(top: Page): FrameElement {
    this.#renderer.insertBefore(this.#host, this.#scrim, top.frame);
    this.#setStyles(this.#scrim, { display: 'flex', opacity: '0' });
    return this.#scrim;
  }

  #dropScrim(): void {
    this.#setStyles(this.#scrim, { display: 'none' });
  }

  /**
   * Puts a clear view over the pages while they move, so a tap can't reach
   * one mid-transition, as UIKit ignores touches while its navigation
   * controller animates. It also takes the click a browser sends after a
   * mouse drag, which would otherwise tap whatever is under the cursor.
   */
  #shield(on: boolean): void {
    if (on) this.#renderer.appendChild(this.#host, this.#shieldElement);
    this.#setStyles(this.#shieldElement, { display: on ? 'flex' : 'none' });
  }

  /**
   * Gives an element a native view of its own on Android, which otherwise
   * draws a view with no listeners into its parent ("flattens" it): there a
   * `transform` animation runs without moving it, and `overflow: hidden`
   * clips absolutely placed children unreliably (see "`flatten` (Android)" in
   * investigations/lynx-vs-web-differences.md). Android decides when it first
   * draws the element, so it's set as the element is made. Nothing elsewhere.
   */
  #ownView(element: FrameElement): void {
    this.#renderer.setAttribute(element, 'flatten', false as never);
  }

  #setStyles(element: FrameElement, styles: Record<string, string>): void {
    for (const [name, value] of Object.entries(styles)) {
      this.#renderer.setStyle(element, name, value);
    }
  }

  #listen(name: string, handler: (event: PointerEvent) => void): void {
    this.#renderer.listen(this.#host, name, handler);
  }

  /**
   * --- Swipe ----------------------------------------------------------------
   */

  #touchStart(event: PointerEvent): void {
    const touch = event.touches[0];
    if (!touch || this.#swipe) return;
    const [x, y] = positionOf(touch);
    this.#begin(x, y, pointerIdOf(touch), event.target);
  }

  #touchMove(event: PointerEvent): void {
    const swipe = this.#swipe;
    if (!swipe) return;
    // pointerIdOf, as Lynx's own identifier for a single touch changes from
    // one event to the next on iOS.
    const touch = Array.from(event.touches).find(
      (t) => pointerIdOf(t) === swipe.touch,
    );
    if (touch) this.#move(...positionOf(touch));
  }

  #touchEnd(event: PointerEvent, canceled = false): void {
    const swipe = this.#swipe;
    if (!swipe) return;
    const lifted = Array.from(event.changedTouches).some(
      (t) => pointerIdOf(t) === swipe.touch,
    );
    // Another finger lifting leaves this one dragging.
    if (lifted) this.#release(canceled);
  }

  #mouseDown(event: PointerEvent): void {
    if (this.#swipe || event.x === undefined || event.y === undefined) return;
    this.#begin(event.x, event.y, null, event.target);
  }

  #mouseMove(event: PointerEvent): void {
    if (!this.#swipe || this.#swipe.touch !== null) return;
    // No button held: the button came up outside the Lynx view, which
    // web-core doesn't listen in. The first move back in is the release.
    if (event.buttons === 0) {
      this.#release(false);
      return;
    }
    if (event.x !== undefined && event.y !== undefined) {
      this.#move(event.x, event.y);
    }
  }

  /**
   * A finger (or the mouse) went down: it may be starting a swipe back.
   */
  #begin(x: number, y: number, touch: number | null, target: unknown): void {
    const top = this.#stack.at(-1);
    const under = this.#stack.at(-2);
    const box = boxInLynxView(this.#host);
    if (
      !this.swipeBack() ||
      !this.#animates ||
      !top ||
      !under ||
      top !== this.#active ||
      this.#transition ||
      this.#swiped ||
      box.width <= 0
    ) {
      return;
    }
    const tracker = new SwipeTracker(
      x - box.left,
      y - box.top,
      Date.now(),
      box.width,
      !this.#inHorizontalScroller(target),
    );
    if (tracker.state === 'ignored') return;
    this.#swipe = {
      tracker,
      touch,
      top,
      under,
      dragging: false,
      corners: SQUARE,
      radius: null,
    };
  }

  #move(x: number, y: number): void {
    const swipe = this.#swipe!;
    const box = boxInLynxView(this.#host);
    const state = swipe.tracker.move(x - box.left, y - box.top, Date.now());
    if (state === 'ignored') {
      this.#swipe = null;
      return;
    }
    if (state !== 'dragging') return;
    if (!swipe.dragging) {
      swipe.dragging = true;
      // The top page may go: only the page under it carries a bar.
      this.#carryBars(swipe.top, swipe.under, this.#motion, [swipe.under]);
      swipe.corners = this.#cornersFor(this.#motion);
      swipe.radius = cornerStyle(swipe.corners);
      this.#uncover(swipe.under);
      this.#raise(swipe.top, this.#motion, swipe.corners);
      this.#placeScrim(swipe.top);
      this.#shield(true);
    }
    this.#drag(swipe, swipe.tracker.progress);
  }

  /**
   * Puts the pages where a finger `progress` of the way across has them.
   */
  #drag(swipe: Swipe, progress: number): void {
    const motion = this.#motion;
    const width = this.#width;
    this.#setStyles(
      swipe.top.frame,
      lookStyles(motion.dragged(progress), width),
    );
    this.#setStyles(
      swipe.under.frame,
      lookStyles(mixLooks(motion.covered, AT_REST, progress), width),
    );
    this.#setStyles(this.#scrim, {
      opacity: String(motion.dim * (1 - progress)),
    });
    const radius = cornerStyle(this.#dragCorners(swipe, progress));
    if (radius !== swipe.radius) {
      swipe.radius = radius;
      this.#round(swipe.top, radius);
    }
    // The bar follows the finger toward where the page under has it.
    this.#moveBar(swipe.top, swipe.under, progress, this.#stillMotion());
  }

  /**
   * The top page's corners with a finger `progress` of the way across.
   */
  #dragCorners(swipe: Swipe, progress: number): Corners {
    const motion = this.#motion;
    return motion.roundsShrinking
      ? shrunkCorners(swipe.corners, motion.radius, progress)
      : swipe.corners;
  }

  /**
   * The finger let go (or the system took the touch): the page goes the rest
   * of the way, and the router goes back, or it comes back.
   */
  #release(canceled: boolean): void {
    const swipe = this.#swipe;
    this.#swipe = null;
    if (!swipe?.dragging) return;
    const { tracker, top, under } = swipe;
    const completes = !canceled && tracker.completes();
    const motion = this.#motion;
    const progress = tracker.progress;
    const at = {
      top: motion.dragged(progress),
      under: mixLooks(motion.covered, AT_REST, progress),
      scrim: motion.dim * (1 - progress),
    };
    const to = completes
      ? { top: motion.dismissed, under: AT_REST, scrim: 0 }
      : { top: AT_REST, under: motion.covered, scrim: motion.dim };
    // The rest of the way takes as long as the finger's speed would, at the
    // start of the spring's curve, which leaves at about twice its average
    // speed (so the page doesn't jump or stall as the finger lets go), within
    // reason.
    const left = Math.abs((completes ? 1 : 0) - progress) * this.#width;
    const speed = Math.abs(tracker.velocity);
    const duration = Math.round(
      Math.min(
        IOS_MOTION.duration,
        Math.max(150, speed > 0.05 ? (2 * left) / speed : IOS_MOTION.duration),
      ),
    );
    this.#run(
      top,
      under,
      motion,
      // Lynx can't animate a border-radius, so the page keeps the corners
      // the finger left it with.
      () => this.#dragCorners(swipe, progress),
      at,
      to,
      duration,
      IOS_MOTION.easing,
      { from: top, to: under, at: completes ? 1 : 0, carriers: [under] },
      () => {
        if (completes) {
          // Hidden where it went, off the screen, not put back in place: a
          // native view under it, such as iOS's glass, can ignore the
          // visibility and draw over the page under it until the navigation
          // destroys the page.
          this.#renderer.setStyle(top.frame, 'visibility', 'hidden');
          this.#goBack(top);
        } else {
          this.#hide(under);
        }
      },
    );
  }

  /**
   * Lets go of a swipe in progress, putting the pages back as they were.
   */
  #cancelSwipe(): void {
    const swipe = this.#swipe;
    this.#swipe = null;
    if (!swipe?.dragging) return;
    this.#setStyles(swipe.top.frame, lookStyles(AT_REST, 0));
    this.#lower(swipe.top);
    this.#hide(swipe.under);
    this.#dropScrim();
    this.#shield(false);
    this.#restBar(swipe.top);
  }

  /**
   * Goes back to the page under `top`, which a swipe took away, through the
   * history: to the entry before `top`'s, past any it added since. If the
   * router doesn't go there (a guard refuses, or the history leads
   * elsewhere), the page comes back.
   */
  #goBack(top: Page): void {
    this.#swiped = top;
    const settled = this.#router.events.subscribe((event) => {
      if (
        !(event instanceof NavigationEnd) &&
        !(event instanceof NavigationCancel) &&
        !(event instanceof NavigationError) &&
        !(event instanceof NavigationSkipped)
      ) {
        return;
      }
      settled.unsubscribe();
      if (this.#swiped === top) this.#swiped = null;
      // Still on top: the router didn't go back. (Anywhere else in the stack,
      // it's covered, and hidden already.)
      if (this.#stack.at(-1) === top && !this.#destroyed) this.#bringBack(top);
    });
    const strategy = this.#strategy;
    if (strategy instanceof LynxLocationStrategy && top.historyIndex > 0) {
      this.#location.historyGo(top.historyIndex - 1 - strategy.historyIndex);
    } else {
      this.#location.back();
    }
  }

  /**
   * Slides a page a swipe took away back in, when the router didn't go back.
   */
  #bringBack(top: Page): void {
    const under = this.#stack.at(-2)!;
    this.#renderer.removeStyle(top.frame, 'visibility');
    this.#slide(top, under, 'in', () => this.#hide(under));
  }

  /**
   * Whether a touch on `target` is in something that scrolls sideways
   * itself: there, only a swipe from the edge goes back, as iOS 26 leaves
   * such a touch to the scroller.
   */
  #inHorizontalScroller(target: unknown): boolean {
    let element = elementOf(target);
    while (element && element !== (this.#host as unknown)) {
      const tag = element.tagName?.toLowerCase();
      if (tag && SIDEWAYS_ELEMENTS.has(tag)) return true;
      if (
        (tag === 'scroll-view' || tag === 'list') &&
        (element.getAttribute?.('scroll-orientation') === 'horizontal' ||
          String(element.getAttribute?.('scroll-x')) === 'true')
      ) {
        return true;
      }
      element = parentOf(element);
    }
    return false;
  }
}

/** An element a touch can land on, as Lynx's elements and the DOM's both are. */
type TargetElement = {
  readonly tagName?: string;
  getAttribute?(name: string): unknown;
  parentNode?: (() => TargetElement | null) | TargetElement | null;
};

/**
 * The element a touch landed on. Lynx reports the element's unique id, which
 * leads to its LynxElement; the DOM (in tests) the element itself.
 */
const elementOf = (target: unknown): TargetElement | null => {
  if (!target || typeof target !== 'object') return null;
  const uid = (target as { uid?: unknown }).uid;
  if (typeof uid === 'number') {
    return (LynxElement.byUniqueId(uid) as TargetElement | undefined) ?? null;
  }
  return target as TargetElement;
};

/**
 * An element's parent: LynxElement's `parentNode()`, or the DOM's property.
 */
const parentOf = (element: TargetElement): TargetElement | null => {
  const parent = element.parentNode;
  return typeof parent === 'function' ? parent.call(element) : (parent ?? null);
};

/**
 * Where a touch is, relative to the LynxView, in its px, as the outlet's box
 * is measured (see boxInLynxView): native Lynx's `pageX` and `pageY`. Lynx
 * for Web's `pageX` and `pageY` are the browser's, from the document's top
 * left, so there it's the touch's `x` and `y`, which web-core measures from
 * the `<lynx-view>`, as it does a mouse event's.
 */
const positionOf = (touch: TouchPoint): [number, number] =>
  __WEB__ && touch.x !== undefined && touch.y !== undefined
    ? [touch.x, touch.y]
    : [touch.pageX, touch.pageY];

/**
 * The screen's size: the LynxView's, which `innerWidth` and `innerHeight` are
 * on Lynx (see global-events/window.ts), the screen's until its first layout.
 */
const screenSize = (): ScreenSize => {
  const view = globalThis as { innerWidth?: number; innerHeight?: number };
  return { width: view.innerWidth ?? 0, height: view.innerHeight ?? 0 };
};
