import {
  type ComponentRef,
  type EnvironmentInjector,
  type InjectOptions,
  type Injector,
  type OnDestroy,
  type ProviderToken,
  ApplicationRef,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Renderer2,
  ViewContainerRef,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import {
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type Data,
  type Route,
  type RouterStateSnapshot,
  ActivatedRoute,
  ChildrenOutletContexts,
  NavigationEnd,
  ROUTER_OUTLET_DATA,
  RedirectCommand,
  Router,
  RouterOutlet,
} from '@angular/router';
import { type LiveRoute, liveRoute } from '../stack/live-route';
import type { StackNavigationInfo } from '../stack/stack-change';
import { LynxStackPage } from '../stack/stack-page';
import {
  type InputBinder,
  ScreenContexts,
  afterRouterPass,
  binderOf,
  onHiddenPage,
  urlOf,
} from '../routed-outlet';
import { LynxTabPage, setTabActive } from './tab-page';

/** A tab: its routed component, and the frame it's shown or hidden in. */
type Tab = {
  /** The route the tab is for: each route of the outlet is one tab. */
  readonly config: Route;
  readonly ref: ComponentRef<unknown>;
  /** What the component injects as its ActivatedRoute (see live-route.ts). */
  readonly live: LiveRoute;
  /** The route the router activated it with last. */
  route: ActivatedRoute;
  /** The view that holds the component's host, which hides the tab. */
  readonly frame: unknown;
  /**
   * The contexts the tab's own router outlets register in, which keep them
   * while the tab is hidden: the router forgets them when it leaves the
   * tab's route, and the outlets, which live on with the tab, never register
   * again (see ScreenContexts).
   */
  readonly contexts: ScreenContexts;
  /** What the tab's components inject to know about it. */
  readonly tabPage: LynxTabPage;
  /** The router's URL the last time the tab was shown (see #resume). */
  url: string;
};

/**
 * The injector a tab's component gets, as RouterOutlet's OutletInjector (not
 * exported) is: it gives the tab its route, its outlets' contexts and the
 * outlet's data, and leaves the rest to the outlet's own injector.
 */
class TabInjector {
  constructor(
    readonly route: ActivatedRoute,
    readonly childContexts: ScreenContexts,
    readonly parent: Injector,
    readonly outletData: unknown,
    readonly tabPage: LynxTabPage,
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
    if (key === LynxTabPage) return this.tabPage as T;
    return this.parent.get(token, notFoundValue as T, options);
  }
}

/**
 * Works out where a navigation into a hidden tab goes (see #resume).
 * Assigned in the class's static block, the only place outside its methods
 * that can reach its private fields.
 */
let resumeOf: (
  outlet: LynxTabOutlet,
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => true | RedirectCommand;

/**
 * The outlet a route goes in, from the outlets the app has now: out from the
 * root through the outlets of its ancestors that have a component (a route
 * without one shares its parent's outlets).
 */
const outletOf = (
  root: ChildrenOutletContexts,
  route: ActivatedRouteSnapshot,
): unknown => {
  let contexts = root;
  for (const ancestor of route.pathFromRoot.slice(1, -1)) {
    if (!ancestor.component) continue;
    const children = contexts.getContext(ancestor.outlet)?.children;
    // An ancestor the app isn't showing: it has no tabs yet.
    if (!children) return null;
    contexts = children;
  }
  return contexts.getContext(route.outlet)?.outlet ?? null;
};

/**
 * The guard a tab's route gets from its outlet, which takes a tab bar back to
 * where the tab was left (see #resume). It's the same function for every
 * tab, so a route has it once.
 */
const resumeTab: CanActivateFn = (route, state) => {
  const outlet = outletOf(inject(ChildrenOutletContexts), route);
  return outlet instanceof LynxTabOutlet
    ? resumeOf(outlet, route, state)
    : true;
};

/**
 * A router outlet for an app's tabs, which keeps each tab once it has been
 * shown, as a tab bar does on iOS (`UITabBarController`) and Android (the
 * navigation bar's saved back stacks): switching back to a tab finds it as it
 * was left, its screens, scroll positions and native views (a `<canvas>`'s
 * WebGL context, a `<webview>`'s page) and all, without building anything.
 *
 * Use it in place of `<router-outlet>` beside a tab bar or a dock; it's one,
 * with the same inputs and outputs, and each route under it is a tab:
 *
 * ```html
 * <lynx-tab-outlet />
 * <ui-dock>
 *   <ui-dock-item route="/home" icon="home" label="Home" />
 *   <ui-dock-item route="/pages" icon="file" label="Pages" />
 * </ui-dock>
 * ```
 *
 * The first navigation into a tab builds it. Navigating to another tab hides
 * it (out of view, of screen readers and of taps) and keeps it, with the
 * `<lynx-stack-outlet>` in it and the screens on that. A hidden tab's
 * components keep running: `LynxTabPage`'s `active` says when the tab is
 * shown, for work that should stop while it isn't.
 *
 * A navigation to a hidden tab's own URL, as its tab bar item makes, goes to
 * where the tab was left: `/home` from the Pages tab shows Home at
 * `/home/notes/3` if that's where it was, as a tab bar shows a tab's stack as
 * it was. From the tab itself, it goes to `/home`, popping the stack to its
 * first screen as tapping the selected tab does. A navigation through the
 * history (Back) goes where the history says, and one whose `info` says
 * `{ stack: 'root' }` goes to the URL it names, starting the tab's stack
 * there.
 *
 * Every tab shown is kept, as a tab bar keeps them. To let one go when it's
 * hidden, say so in its route's data, `data: { keepAlive: false }`, or list
 * the paths of the tabs to keep in `keep`. Leaving the outlet's route, as
 * signing out does, destroys every tab in it.
 *
 * A plain `<router-outlet>` in a tab builds its screen again when the tab
 * comes back, as it does everywhere: the router leaves it as the tab hides.
 * Use `<lynx-stack-outlet>` (or another `<lynx-tab-outlet>`) for the screens
 * of a tab that should be kept with it.
 */
@Component({
  selector: 'lynx-tab-outlet',
  exportAs: 'outlet',
  template: '',
  host: {
    // The tabs fill the outlet, one over another, and a hidden one waits
    // outside it, clipped away.
    style: 'position: relative; overflow: hidden; flex: 1 1 0%;',
  },
})
export class LynxTabOutlet extends RouterOutlet implements OnDestroy {
  /**
   * The paths of the routes whose tabs are kept while hidden (`['home',
   * 'pages']`), for an app that can't afford to keep every tab. Without it,
   * every tab is kept. A route's `data: { keepAlive: true | false }` says
   * for its own tab whatever the list says.
   */
  readonly keep = input<readonly string[] | undefined>(undefined);

  readonly #renderer = inject(Renderer2);
  readonly #host = inject(ElementRef).nativeElement as unknown;
  readonly #tabs = inject(ViewContainerRef);
  readonly #contexts = inject(ChildrenOutletContexts);
  readonly #changes = inject(ChangeDetectorRef);
  readonly #router = inject(Router);
  readonly #root = inject(ApplicationRef).injector;
  /** The stack page the outlet is on, if it's in a `<lynx-stack-outlet>`. */
  readonly #outerPage = inject(LynxStackPage, { optional: true });
  /** The tab the outlet is in, if it's in another `<lynx-tab-outlet>`. */
  readonly #outerTab = inject(LynxTabPage, { optional: true });

  /** The tabs kept, each under its route. */
  readonly #kept = new Map<Route, Tab>();
  /** The tab the router has active, or null between routes. */
  #active: Tab | null = null;
  /**
   * Each detached component's tab, for a component the reuse strategy hands
   * back. It dies with the outlet.
   */
  readonly #detached = new WeakMap<
    ComponentRef<unknown>,
    Pick<Tab, 'live' | 'tabPage' | 'contexts'>
  >();
  /**
   * Set while the router has left the outlet on a page or tab that's hidden
   * (see onHiddenPage), which keeps the tabs for when it comes back.
   */
  #parked = false;
  #destroyed = false;

  /**
   * Keeps the URL of the tab shown, for where to go back to (see #resume),
   * and lets go of parked tabs the router doesn't come back to.
   */
  readonly #navigations = this.#router.events.subscribe((event) => {
    if (!(event instanceof NavigationEnd)) return;
    if (this.#active) this.#active.url = this.#router.url;
    if (
      this.#parked &&
      !this.#active &&
      !onHiddenPage(this.#outerPage, this.#outerTab)
    ) {
      this.#parked = false;
      this.#clear();
    }
  });

  constructor() {
    super();
    this.#ownView(this.#host);
    // Tabs the app stops keeping go once they're hidden.
    effect(() => {
      this.keep();
      untracked(() => {
        for (const tab of this.#kept.values()) {
          if (tab !== this.#active && !this.#keeps(tab)) this.#remove(tab);
        }
      });
    });
  }

  override ngOnDestroy(): void {
    this.#destroyed = true;
    this.#navigations.unsubscribe();
    super.ngOnDestroy();
  }

  override get isActivated(): boolean {
    return this.#active !== null;
  }

  override get component(): object {
    return this.#activeTab().ref.instance as object;
  }

  override get activatedRoute(): ActivatedRoute {
    return this.#activeTab().route;
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
    this.#parked = false;
    const kept = this.#kept.get(route.routeConfig!);
    if (kept) {
      // Back to a tab it kept: it shows as it was, and its outlets register
      // again, for the router to come back to them.
      kept.route = route;
      kept.live.follow(route);
      kept.contexts.show();
      this.#activate(kept);
      return;
    }
    const tabPage = new LynxTabPage();
    const live = liveRoute(route);
    const contexts = this.#screenContexts();
    const injector = new TabInjector(
      live.route,
      contexts,
      this.#tabs.injector,
      this.routerOutletData,
      tabPage,
    ) as unknown as Injector;
    const ref = this.#tabs.createComponent(component, {
      index: this.#tabs.length,
      injector,
      environmentInjector,
    });
    this.#activate(this.#addTab(ref, route, live, tabPage, contexts));
  }

  override deactivate(): void {
    const tab = this.#active;
    if (!tab) return;
    this.#binder?.unsubscribeFromRouteData(this);
    // The router forgets the contexts of the tab's outlets as it leaves the
    // tab's route (it calls this right after). Keep them for when the tab
    // comes back.
    tab.contexts.hide();
    this.#active = null;
    setTabActive(tab.tabPage, false);
    if (this.#keeps(tab)) {
      this.#hide(tab);
    } else {
      this.#remove(tab);
    }
    this.deactivateEvents.emit(tab.ref.instance);
    // The router activates the next tab straight after, in the same pass.
    // If it doesn't, it left the outlet's route, and the tabs go, unless the
    // page or tab the outlet is on went out of view: then they stay for when
    // it comes back.
    afterRouterPass(this.#router, () => {
      if (this.#active || this.#destroyed) return;
      if (onHiddenPage(this.#outerPage, this.#outerTab)) {
        this.#parked = true;
      } else {
        this.#clear();
      }
    });
  }

  override detach(): ComponentRef<unknown> {
    const tab = this.#activeTab();
    this.#binder?.unsubscribeFromRouteData(this);
    // The reuse strategy has the component now, and gives it back through
    // attach(). Its native views go, as a detached view's do (see
    // LynxRouteReuseStrategy).
    this.#tabs.detach(this.#tabs.indexOf(tab.ref.hostView));
    this.#kept.delete(tab.config);
    this.#renderer.removeChild(this.#host, tab.frame);
    // Only what the component holds already: the tab holds the component,
    // and an entry whose value leads back to its key never goes on Lynx's
    // main thread (see linksOf in stack-page.ts).
    // The router takes the contexts of the tab's outlets as it stores the
    // component, and gives them back before attach(): they stay with the
    // router meanwhile, as RouterOutlet's do.
    this.#detached.set(tab.ref, {
      live: tab.live,
      tabPage: tab.tabPage,
      contexts: tab.contexts,
    });
    this.#active = null;
    setTabActive(tab.tabPage, false);
    this.detachEvents.emit(tab.ref.instance);
    return tab.ref;
  }

  override attach(ref: ComponentRef<unknown>, route: ActivatedRoute): void {
    this.#tabs.insert(ref.hostView);
    const detached = this.#detached.get(ref);
    const live = detached?.live ?? liveRoute(route);
    live.follow(route);
    const tab = this.#addTab(
      ref,
      route,
      live,
      detached?.tabPage ?? new LynxTabPage(),
      detached?.contexts ?? this.#screenContexts(),
    );
    this.#activate(tab);
    this.attachEvents.emit(ref.instance);
  }

  /**
   * Where a navigation to `route`, one of this outlet's tabs, goes: to where
   * the tab was left, if it's hidden and the navigation goes to the tab's
   * own URL and nothing more (`/home` for the tab at `home`, without a query
   * or a deeper path), as a tab bar's item does. Anything else goes where it
   * says: a deeper URL in the tab, the tab with other params (`/item/3` for
   * a tab left at `/item/2`), a query, a navigation through the history, one
   * that says `{ stack: 'root' }`, and one from the tab itself, which pops
   * its stack to its first screen as tapping the selected tab does.
   */
  #resume(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): true | RedirectCommand {
    const tab = this.#kept.get(route.routeConfig!);
    if (!tab || tab === this.#active || tab.url === state.url) return true;
    const own = urlOf(route);
    if (state.url !== own || urlOf(tab.route) !== own) return true;
    const navigation = this.#router.currentNavigation();
    const info = navigation?.extras.info as StackNavigationInfo | undefined;
    if (navigation?.trigger === 'popstate' || info?.stack === 'root') {
      return true;
    }
    return new RedirectCommand(this.#router.parseUrl(tab.url));
  }

  /**
   * Puts a new tab's component in a frame of its own, and keeps the tab.
   */
  #addTab(
    ref: ComponentRef<unknown>,
    route: ActivatedRoute,
    live: LiveRoute,
    tabPage: LynxTabPage,
    contexts: ScreenContexts,
  ): Tab {
    const frame = this.#renderer.createElement('view') as unknown;
    this.#ownView(frame);
    this.#setStyles(frame, {
      position: 'absolute',
      top: '0px',
      left: '0px',
      right: '0px',
      bottom: '0px',
      display: 'flex',
      'flex-direction': 'column',
    });
    this.#renderer.appendChild(this.#host, frame);
    // The view container puts the component's host beside the outlet; it
    // belongs in its frame.
    this.#renderer.appendChild(frame, ref.location.nativeElement);
    const tab: Tab = {
      // Every route an outlet shows has one: only the root's doesn't.
      config: route.routeConfig!,
      ref,
      live,
      route,
      frame,
      contexts,
      tabPage,
      url: this.#router.url,
    };
    this.#kept.set(tab.config, tab);
    this.#guard(tab.config);
    return tab;
  }

  /**
   * Gives a tab's route the guard that takes a tab bar back to where the tab
   * was left (see #resume), once. Angular reads a route's guards as each
   * navigation checks them, and gives no other way to change where a
   * navigation goes before it gets there. The route is the router's own copy
   * of the app's (Angular copies each route it's given), so the app's route
   * objects stay as they are.
   */
  #guard(config: Route): void {
    const guards = config.canActivate ?? [];
    if (!guards.includes(resumeTab)) {
      // A new array: the route's may be shared with other routes.
      config.canActivate = [...guards, resumeTab];
    }
  }

  /**
   * Makes a tab the one the outlet shows and the router's active one, as
   * RouterOutlet does.
   */
  #activate(tab: Tab): void {
    this.#active = tab;
    this.#reveal(tab);
    setTabActive(tab.tabPage, true);
    this.#changes.markForCheck();
    this.#binder?.bindActivatedRouteToOutletComponent(
      this,
      this.#tabs.injector,
    );
    this.activateEvents.emit(tab.ref.instance);
  }

  /**
   * Whether a tab is kept while it's hidden: as its route's data says, or
   * else as `keep` does.
   */
  #keeps(tab: Tab): boolean {
    const said: unknown = tab.route.snapshot.data['keepAlive'];
    if (typeof said === 'boolean') return said;
    const keep = this.keep();
    return keep === undefined || keep.includes(tab.config.path ?? '');
  }

  /**
   * Hides a tab: invisible, so out of screen readers' reach, and outside the
   * outlet, so a touch can't land on it and native views that draw through
   * a hidden ancestor (iOS's glass) are clipped away. Its layout stays, and
   * with it the scroll positions of its scroll views: `display: none`
   * resizes everything in it to 0×0 on Lynx.
   */
  #hide(tab: Tab): void {
    this.#setStyles(tab.frame, {
      visibility: 'hidden',
      transform: 'translateX(100%)',
    });
  }

  #reveal(tab: Tab): void {
    this.#renderer.removeStyle(tab.frame, 'visibility');
    this.#renderer.removeStyle(tab.frame, 'transform');
  }

  /**
   * Destroys a tab, which the outlet doesn't keep.
   */
  #remove(tab: Tab): void {
    this.#kept.delete(tab.config);
    tab.ref.destroy();
    this.#renderer.removeChild(this.#host, tab.frame);
  }

  /**
   * Destroys every tab: the router left this outlet empty.
   */
  #clear(): void {
    for (const tab of this.#kept.values()) this.#remove(tab);
  }

  #activeTab(): Tab {
    if (!this.#active) throw new Error('Outlet is not activated');
    return this.#active;
  }

  /**
   * The contexts for a new tab's outlets, which stand in for the router's
   * contexts for this outlet's children.
   */
  #screenContexts(): ScreenContexts {
    return new ScreenContexts(
      this.#contexts.getOrCreateContext(this.name).children,
      this.#root,
    );
  }

  get #binder(): InputBinder | null {
    return binderOf(this);
  }

  /**
   * Gives an element a native view of its own on Android, which otherwise
   * draws a view with no listeners into its parent ("flattens" it): there a
   * `transform` doesn't move it, and `overflow: hidden` clips absolutely
   * placed children unreliably (see "`flatten` (Android)" in
   * investigations/lynx-vs-web-differences.md).
   */
  #ownView(element: unknown): void {
    this.#renderer.setAttribute(element, 'flatten', false as never);
  }

  #setStyles(element: unknown, styles: Record<string, string>): void {
    for (const [name, value] of Object.entries(styles)) {
      this.#renderer.setStyle(element, name, value);
    }
  }

  static {
    resumeOf = (outlet, route, state) => outlet.#resume(route, state);
  }
}
