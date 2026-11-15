import {
  type ComponentRef,
  type EnvironmentInjector,
  type InjectOptions,
  type OnDestroy,
  type ProviderToken,
  ApplicationRef,
  ChangeDetectorRef,
  Component,
  ElementRef,
  ErrorHandler,
  Injector,
  Renderer2,
  ViewContainerRef,
  afterNextRender,
  effect,
  inject,
  input,
  isDevMode,
  untracked,
} from '@angular/core';
import {
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type Data,
  type Route,
  type RouterStateSnapshot,
  type UrlTree,
  ActivatedRoute,
  ChildrenOutletContexts,
  NavigationEnd,
  PRIMARY_OUTLET,
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
  leaveRoutes,
  onHiddenPage,
  urlOf,
} from '../routed-outlet';
import { type RoutedAhead, routeAhead } from './route-ahead';
import { LynxTabPage, setTabActive } from './tab-page';

/** A tab: its routed component, and the frame it's shown or hidden in. */
type Tab = {
  /**
   * The route the tab is for, which gives the tab its URL (see tabOf): each
   * route of the outlet is one tab.
   */
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

/** A route in the router's tree, or in a snapshot of it. */
type RouteNode<T> = {
  readonly routeConfig: Route | null;
  readonly parent: T | null;
  readonly outlet: string;
};

/**
 * Whether a route has a component of its own, which the router shows in an
 * outlet: one without shares its parent's outlets.
 */
const hasComponent = (config: Route | null): boolean =>
  config?.component !== undefined || config?.loadComponent !== undefined;

/**
 * The route of the tab a route the outlet shows is for: the route itself, or,
 * for one on `''`, the route above it without a component that gives it its
 * URL, through routes on `''` without one. That's the tab of a route that
 * only loads its children, whose first route has the tab's component:
 *
 * ```ts
 * { path: 'pages', loadChildren: () => import('./pages/routes') },
 * // pages/routes.ts
 * export default [{ path: '', component: PagesStack, children: [...] }];
 * ```
 *
 * The tab there is `pages`, as its tab bar item and the app's `keep` and
 * `prebuild` name it, rather than the `''` route the router shows. A route on
 * `''` under routes on `''` without a component, as a guard groups the tabs
 * with, is its own tab: the routes above it are the other tabs' too.
 */
const tabOf = <T extends RouteNode<T>>(route: T): T => {
  let at = route;
  while (at.routeConfig?.path === '') {
    const parent = at.parent;
    // Not the route whose component has the outlet, nor the root, nor a
    // route of another outlet.
    if (
      !parent?.routeConfig ||
      hasComponent(parent.routeConfig) ||
      parent.outlet !== at.outlet
    ) {
      break;
    }
    if (parent.routeConfig.path !== '') return parent;
    at = parent;
  }
  return route;
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
 * A route that only lazy-loads its children is a tab too, under its own
 * path, when the routes it loads start with the tab's component on `''`:
 *
 * ```ts
 * { path: 'pages', loadChildren: () => import('./pages/routes') },
 * // pages/routes.ts
 * export default [{ path: '', component: PagesStack, children: [...] }];
 * ```
 *
 * `keep`, `prebuild` and the data that says to keep or build the tab ahead
 * go by that route (`pages`), as its tab bar item does.
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
 * The first tap on a tab waits for it to be built. To have it as quick as a
 * return, list the tabs to build before they're first shown in `prebuild`,
 * or say so in a route's data, `data: { prebuild: true }`:
 *
 * ```html
 * <lynx-tab-outlet [prebuild]="['pages', 'schedule']" />
 * ```
 *
 * Once the first tab is drawn, the outlet builds them one at a time, each
 * between frames, hidden, as a tab another one replaced is: its component,
 * and the screens its URL leads to (a `<lynx-stack-outlet>`'s first screen),
 * with their guards and resolvers run, and `LynxTabPage`'s `active` false.
 * The router's URL, its history and the tab bar's selection stay as they
 * are. Tapping the tab then shows it as a return does.
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
   * 'pages']`), for an app that can't afford to keep every tab: for a tab
   * whose route only loads its children, that route's path. Without it,
   * every tab is kept. A route's `data: { keepAlive: true | false }` says
   * for its own tab whatever the list says.
   */
  readonly keep = input<readonly string[] | undefined>(undefined);

  /**
   * The paths of the routes whose tabs are built before they're first shown
   * (`['pages', 'schedule']`), so the first tap on each is as quick as a
   * return to it. A route's `data: { prebuild: true | false }` says for its
   * own tab whatever the list says.
   *
   * It builds the tabs of the routes beside the shown tab's that have a path
   * of their own without a parameter, and a component (`component` or
   * `loadComponent`) or children (`children` or `loadChildren`) that start
   * with the tab's component on `''`. Not `item/:id`, which has no URL of its
   * own, nor a tab the outlet doesn't keep (see `keep`). In development, the
   * outlet warns of a tab it's asked for and can't build.
   *
   * The building starts once the first tab is drawn, and builds one tab at a
   * time, each in a task of its own after the screen is drawn, so that a tap
   * goes first. A tab tapped while it's being built is built once: the
   * router builds it, and the outlet lets go of the one it was building.
   *
   * The routes above the tab's run their guards and resolvers again, as a
   * navigation from another part of the app would.
   */
  readonly prebuild = input<readonly string[] | undefined>(undefined);

  readonly #renderer = inject(Renderer2);
  readonly #host = inject(ElementRef).nativeElement as unknown;
  readonly #tabs = inject(ViewContainerRef);
  readonly #contexts = inject(ChildrenOutletContexts);
  readonly #changes = inject(ChangeDetectorRef);
  readonly #router = inject(Router);
  readonly #root = inject(ApplicationRef).injector;
  readonly #injector = inject(Injector);
  readonly #errors = inject(ErrorHandler);
  /** The stack page the outlet is on, if it's in a `<lynx-stack-outlet>`. */
  readonly #outerPage = inject(LynxStackPage, { optional: true });
  /** The tab the outlet is in, if it's in another `<lynx-tab-outlet>`. */
  readonly #outerTab = inject(LynxTabPage, { optional: true });

  /** The tabs kept, each under its route. */
  readonly #kept = new Map<Route, Tab>();
  /** The tab the router has active, or null between routes. */
  #active: Tab | null = null;
  /**
   * A kept tab the router has left, on screen until the tab it leaves for
   * is in place (see deactivate).
   */
  #leaving: Tab | null = null;
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
   * The routes of the tabs the outlet has tried to build ahead (see
   * `prebuild`), each once while it shows tabs: one whose guards say no
   * isn't tried again.
   */
  readonly #triedAhead = new Set<Route>();
  /** Whether a tab is being built ahead, or waiting its turn. */
  #buildingAhead = false;
  /** The warnings given of tabs it can't build ahead, each given once. */
  readonly #warned = new Set<string>();

  /**
   * Keeps the URL of the tab shown, for where to go back to (see #resume),
   * lets go of parked tabs the router doesn't come back to, and builds the
   * tabs to build ahead once one is shown.
   */
  readonly #navigations = this.#router.events.subscribe((event) => {
    if (!(event instanceof NavigationEnd)) return;
    if (this.#active) {
      this.#active.url = this.#router.url;
      this.#scheduleAhead();
    }
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
    // Tabs the app adds to `prebuild` are built once a tab is shown.
    effect(() => {
      this.prebuild();
      untracked(() => {
        if (this.#active) this.#scheduleAhead();
      });
    });
  }

  override ngOnDestroy(): void {
    this.#destroyed = true;
    // Its tabs go with it, and nothing's shown: a tab being built ahead
    // finds none, and isn't.
    this.#active = null;
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
    const kept = this.#kept.get(tabOf(route).routeConfig!);
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
      // It stays on screen while the router builds the next tab, in this
      // same pass, and hides once that tab is in place (see #putAway).
      // Hidden first, the screen showed neither tab, with nothing but the
      // background, whenever the UI thread drew the page while a slow tab
      // was being built: on iOS a Core Animation transition ending, such as
      // the dock's capsule sliding to the tab tapped, did.
      this.#leaving = tab;
    } else {
      this.#remove(tab);
    }
    this.deactivateEvents.emit(tab.ref.instance);
    // The router activates the next tab straight after, in the same pass.
    // If it doesn't, it left the outlet's route, and the tabs go, unless the
    // page or tab the outlet is on went out of view: then they stay for when
    // it comes back.
    afterRouterPass(this.#router, () => {
      this.#putAway();
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
    const tab = this.#kept.get(tabOf(route).routeConfig!);
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
      config: tabOf(route).routeConfig!,
      ref,
      live,
      route,
      frame,
      contexts,
      tabPage,
      url: this.#router.url,
    };
    this.#kept.set(tab.config, tab);
    // On the route shown rather than the tab's: the router runs it each time
    // it comes into the tab, which it doesn't for the tab's route when it
    // comes from another tab under it (`pages/detail` to `pages`).
    this.#guard(route.routeConfig!);
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

  // --- Building ahead (see `prebuild`) ---------------------------------------

  /**
   * Builds the next tab to build ahead (see #nextAhead), if none is under
   * way: once what's on screen is drawn (after the next render), in a task
   * of its own, so that a tap waiting goes first. Each tab built schedules
   * the next.
   */
  #scheduleAhead(): void {
    const shown = this.#active;
    if (this.#buildingAhead || !shown) return;
    const config = this.#nextAhead(shown);
    if (!config) return;
    this.#buildingAhead = true;
    this.#triedAhead.add(config);
    const url = this.#urlAhead(shown, config);
    afterNextRender(
      () => {
        setTimeout(() => void this.#buildAhead(config, url));
      },
      { injector: this.#injector },
    );
  }

  /**
   * The route of the next tab to build ahead: those `prebuild` names, in its
   * order, then those whose data says to, in the routes' order. Not one the
   * outlet has, or has tried, or whose data says not to, nor one it can't
   * build (see #notAhead), which it warns of.
   */
  #nextAhead(shown: Tab): Route | null {
    const routes = this.#tabRoutes(shown);
    const named = (this.prebuild() ?? []).flatMap((path) => {
      const found = routes.filter((route) => route.path === path);
      if (found.length === 0) {
        this.#warn(
          `prebuild names "${path}", but no route beside the tab shown has that path, so no tab is built ahead for it.`,
        );
      }
      return found;
    });
    const flagged = routes.filter((route) => route.data?.['prebuild'] === true);
    for (const route of [...named, ...flagged]) {
      if (
        route.data?.['prebuild'] === false ||
        this.#kept.has(route) ||
        this.#triedAhead.has(route)
      ) {
        continue;
      }
      const why = this.#notAhead(route);
      if (why === null) return route;
      this.#warnAhead(route, why);
    }
    return null;
  }

  /**
   * Why the outlet can't build a route's tab ahead, or null if it can: it
   * needs a URL of its own, and a component, or children whose first route
   * has one on `''` (see tabOf), which it can only tell once they're loaded,
   * and the outlet must keep it, as its route's data says (`data`, the
   * route's own, or the inherited data of the route its URL shows).
   */
  #notAhead(config: Route, data = config.data): string | null {
    // A path of its own, without a parameter: a URL to build it at.
    if (!/^[^:*]+$/.test(config.path ?? '')) {
      return 'it has no URL of its own (its path is empty or has a parameter)';
    }
    if (!hasComponent(config) && !config.children && !config.loadChildren) {
      return 'its route has no component, children or loadChildren';
    }
    if (!this.#keepsAlive(data, config.path)) {
      return "the outlet doesn't keep it (see keep, and the route's data.keepAlive)";
    }
    return null;
  }

  /**
   * Warns of a tab `prebuild` or a route's data asks for that the outlet
   * can't build ahead.
   */
  #warnAhead(config: Route, why: string): void {
    const tab =
      config.path === undefined ? 'with a matcher' : `at "${config.path}"`;
    this.#warn(`the tab ${tab} isn't built ahead: ${why}.`);
  }

  /**
   * Warns in development, once: nothing else would say why the first tap on
   * a tab the app asked to build ahead waits.
   */
  #warn(message: string): void {
    if (!isDevMode() || this.#warned.has(message)) return;
    this.#warned.add(message);
    console.warn(`<lynx-tab-outlet>: ${message}`);
  }

  /**
   * The routes of this outlet's tabs: the routes beside the shown tab's (see
   * tabOf), which the router has from the app's (its copies, which the tabs
   * are kept under), or loaded for a route's `loadChildren`.
   */
  #tabRoutes(shown: Tab): readonly Route[] {
    const parent = tabOf(shown.route).parent?.routeConfig;
    const routes = parent
      ? // Where the router keeps the routes `loadChildren` loaded, for a
        // route without `children`: one of them has the shown tab.
        (parent.children ??
        (parent as { _loadedRoutes?: Route[] })._loadedRoutes!)
      : this.#router.config;
    return routes.filter(
      (route) => (route.outlet ?? PRIMARY_OUTLET) === this.name,
    );
  }

  /**
   * Builds a tab ahead, at `url`, its own URL (see #urlAhead), then
   * schedules the next.
   */
  async #buildAhead(config: Route, url: UrlTree): Promise<void> {
    try {
      const routed = await routeAhead(this.#router, url, config);
      // A navigation of the app's under way goes first: it may be to this
      // tab, which the router then builds itself, or away from the outlet.
      while (this.#router.currentNavigation()) {
        await new Promise<void>((settled) =>
          afterRouterPass(this.#router, settled),
        );
      }
      if (routed && this.#active && !this.#kept.has(config)) {
        // A route without a component of its own shows one under it, which
        // has to be the tab's, and the route shown can say not to keep it.
        const why =
          tabOf(routed.route).routeConfig === config
            ? this.#notAhead(config, routed.route.snapshot.data)
            : "its route has no component, and the route its URL leads to isn't a child of it on '' with one";
        if (why === null) {
          this.#addAhead(routed, this.#router.serializeUrl(url));
        } else {
          this.#warnAhead(config, why);
        }
      }
    } finally {
      this.#buildingAhead = false;
      this.#scheduleAhead();
    }
  }

  /**
   * The URL of a tab's own route, as its tab bar item has it: the route
   * above the shown tab's (see tabOf), then the tab's path.
   */
  #urlAhead(shown: Tab, config: Route): UrlTree {
    const path = [config.path!];
    return this.#router.createUrlTree(
      this.name === PRIMARY_OUTLET
        ? path
        : [{ outlets: { [this.name]: path } }],
      { relativeTo: tabOf(shown.route).parent },
    );
  }

  /**
   * Builds a tab from the routes worked out for it, hidden: as a tab another
   * one replaced is, so that the router's navigation to it shows it as it
   * shows one coming back.
   */
  #addAhead({ route, children, injector }: RoutedAhead, url: string): void {
    // The router set the component, loading it if it's lazy.
    const component = route.snapshot.component!;
    const tabPage = new LynxTabPage();
    const live = liveRoute(route);
    // Hidden from the start, with the routes for the tab's outlets, which
    // they find as they register.
    const contexts = this.#screenContexts(false);
    contexts.onOutletReAttached(children.onOutletDeactivated());
    const ref = this.#tabs.createComponent(component, {
      index: this.#tabs.length,
      injector: new TabInjector(
        live.route,
        contexts,
        this.#tabs.injector,
        this.routerOutletData,
        tabPage,
      ) as unknown as Injector,
      environmentInjector: injector,
    });
    const tab = this.#addTab(ref, route, live, tabPage, contexts);
    // Where the tab is: a tab bar's item goes there as it is (see #resume).
    tab.url = url;
    this.#hide(tab);
    try {
      this.#bindAhead(tab);
      // Now, rather than in the app's next check with whatever else it has:
      // the tab's components, and its outlets' screens, which they build as
      // they register.
      ref.changeDetectorRef.detectChanges();
    } catch (error) {
      // As a tab the router fails to build: it isn't there, and the error
      // goes where the app's errors go.
      this.#remove(tab);
      this.#errors.handleError(error);
      return;
    }
    // The router left the tab's outlets, as it leaves those of a tab another
    // one replaces, and activates them again as it shows the tab.
    leaveRoutes(contexts);
  }

  /**
   * Sets a tab's inputs from its route, as `withComponentInputBinding()`
   * does for the tab shown, before it's built: the binder binds an outlet's
   * active component, so it's handed one that has this tab's, and lets go
   * of it once it has set them (it sets them as it's called).
   */
  #bindAhead(tab: Tab): void {
    const binder = this.#binder;
    if (!binder) return;
    const outlet = {
      isActivated: true,
      activatedComponentRef: tab.ref,
      activatedRoute: tab.route,
    };
    binder.bindActivatedRouteToOutletComponent(outlet, this.#tabs.injector);
    binder.unsubscribeFromRouteData(outlet);
  }

  /**
   * Makes a tab the one the outlet shows and the router's active one, as
   * RouterOutlet does.
   */
  #activate(tab: Tab): void {
    this.#active = tab;
    this.#reveal(tab);
    this.#putAway();
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
    return this.#keepsAlive(tab.route.snapshot.data, tab.config.path);
  }

  /**
   * Whether the tab of a route with this data and path is kept while it's
   * hidden (see #keeps), for a tab or one to build ahead.
   */
  #keepsAlive(data: Data | undefined, path: string | undefined): boolean {
    const said: unknown = data?.['keepAlive'];
    if (typeof said === 'boolean') return said;
    const keep = this.keep();
    return keep === undefined || keep.includes(path ?? '');
  }

  /**
   * Hides the tab the router left (see deactivate), now that the next one
   * is in place, or the router's pass ended without one. The router may
   * have come back to it.
   */
  #putAway(): void {
    const tab = this.#leaving;
    this.#leaving = null;
    if (tab && tab !== this.#active) this.#hide(tab);
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
    // When it shows tabs again, it's another time, and their guards may say
    // otherwise.
    this.#triedAhead.clear();
  }

  #activeTab(): Tab {
    if (!this.#active) throw new Error('Outlet is not activated');
    return this.#active;
  }

  /**
   * The contexts for a new tab's outlets, which stand in for the router's
   * contexts for this outlet's children: shown, or hidden for a tab built
   * ahead.
   */
  #screenContexts(shown = true): ScreenContexts {
    return new ScreenContexts(
      this.#contexts.getOrCreateContext(this.name).children,
      this.#root,
      shown,
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
