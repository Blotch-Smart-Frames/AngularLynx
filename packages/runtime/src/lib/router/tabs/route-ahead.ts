import { type LocationStrategy, Location } from '@angular/common';
import {
  type EnvironmentInjector,
  type Type,
  createEnvironmentInjector,
} from '@angular/core';
import {
  type ActivatedRoute,
  type Route,
  type UrlTree,
  BaseRouteReuseStrategy,
  ChildrenOutletContexts,
  RouteReuseStrategy,
  Router,
} from '@angular/router';

/**
 * What a route leads to, worked out ahead (see {@link routeAhead}).
 */
export type RoutedAhead = {
  /** The route, with its params, data and resolved data. */
  readonly route: ActivatedRoute;
  /**
   * The contexts of its outlets: each has the route its outlet shows, and the
   * contexts of that one's outlets, as the router leaves them for outlets
   * that register later.
   */
  readonly children: ChildrenOutletContexts;
  /** The injector the route's component is made in. */
  readonly injector: EnvironmentInjector;
};

/**
 * Each method of a history that goes nowhere: it keeps nothing, and every
 * URL in it is empty.
 */
const nowhere = (): string => '';

/**
 * The history of the router {@link routeAhead} makes, which keeps its URL to
 * itself: a navigation it cancels puts its own URL back.
 */
const noHistory = (): LocationStrategy =>
  ({
    path: nowhere,
    prepareExternalUrl: nowhere,
    getState: nowhere,
    pushState: nowhere,
    replaceState: nowhere,
    forward: nowhere,
    back: nowhere,
    onPopState: nowhere,
    getBaseHref: nowhere,
  }) as unknown as LocationStrategy;

/**
 * Keeps nothing: the app's strategy is for the app's router's routes.
 */
class KeepNothing extends BaseRouteReuseStrategy {}

/** The parts of Angular's router {@link routeAhead} reaches into. */
type RouterInternals = {
  readonly navigationTransitions: TransitionsInternals;
  readonly stateManager: object;
  injectorCleanup: unknown;
};

type TransitionsInternals = {
  environmentInjector: EnvironmentInjector;
  readonly configLoader: {
    onLoadStartListener?: unknown;
    onLoadEndListener?: unknown;
  };
  navigationErrorHandler: unknown;
  createViewTransition: unknown;
  titleStrategy: unknown;
};

/**
 * Works out what a navigation to `url` would show for `config`, one of the
 * app's routes, without navigating: the route's params and data, its
 * guards and resolvers run, and the routes under it the URL leads to. Null
 * if the navigation doesn't get there: a guard says no or redirects, a
 * resolver fails, or the URL leads to another route.
 *
 * The app's router can't do it: a navigation changes its URL, its history
 * and its state, which links follow, and runs the guards that say whether
 * the screen shown can be left. So a second router does, on the app's
 * routes, with a history that goes nowhere, and nothing shown: its outlets
 * are contexts that no outlet has registered in, and keep the routes for
 * outlets that will. The guards and resolvers run in the app's injectors,
 * where they `inject(Router)` the app's router, as in a navigation of it.
 * The routes above `config` run their guards and resolvers too: the second
 * router starts from nothing.
 *
 * Angular has no API for this, so the second router is made of the app's
 * router's parts (its classes that aren't exported, taken from the app's
 * router), and the parts it would share with the app's router are its own:
 * its state and history, and the hooks that change the app (the title, view
 * transitions, the navigation error handler and the injector cleanup).
 */
export const routeAhead = async (
  router: Router,
  url: UrlTree,
  config: Route,
): Promise<RoutedAhead | null> => {
  const internals = router as unknown as RouterInternals;
  const transitions = internals.navigationTransitions;
  const root = transitions.environmentInjector;
  const Transitions = transitions.constructor as Type<unknown>;
  const State = internals.stateManager.constructor as Type<unknown>;
  // The router injects its state by the abstract class the app's extends.
  const StateToken = Object.getPrototypeOf(State) as Type<unknown>;
  const injector = createEnvironmentInjector(
    [
      { provide: Location, useFactory: () => new Location(noHistory()) },
      { provide: StateToken, useClass: State },
      { provide: Transitions, useClass: Transitions },
      {
        provide: ChildrenOutletContexts,
        useFactory: () => new ChildrenOutletContexts(root),
      },
      { provide: RouteReuseStrategy, useClass: KeepNothing },
      { provide: Router, useClass: Router },
    ],
    root,
  );
  try {
    // The loader of lazy routes is the app's, shared so a route loads once,
    // and a new router's transitions take its listeners, which give the
    // app's router's events: they go back to it.
    const loader = transitions.configLoader;
    const { onLoadStartListener, onLoadEndListener } = loader;
    const ahead = injector.get(Router);
    loader.onLoadStartListener = onLoadStartListener;
    loader.onLoadEndListener = onLoadEndListener;

    const own = ahead as unknown as RouterInternals;
    // The routes' injectors are the app's, so the components made in them
    // inject the app's router, and live on when this one goes.
    own.navigationTransitions.environmentInjector = root;
    own.navigationTransitions.navigationErrorHandler = null;
    own.navigationTransitions.createViewTransition = null;
    own.navigationTransitions.titleStrategy = null;
    // It would destroy the injectors of the routes the app's router shows.
    own.injectorCleanup = null;
    // The app's routes, and with them the routes loaded lazily, which are
    // the tabs the outlet keeps (it keys them by route).
    ahead.config = router.config;

    const done = await ahead.navigateByUrl(url, { skipLocationChange: true });
    if (!done) return null;
    const route = find(ahead.routerState.root, config);
    if (!route) return null;
    // Out from the root through the outlets of its ancestors that have a
    // component (one without shares its parent's outlets), as the router
    // went.
    let contexts = injector.get(ChildrenOutletContexts);
    for (const ancestor of route.pathFromRoot.slice(1, -1)) {
      if (ancestor.component) {
        contexts = contexts.getOrCreateContext(ancestor.outlet).children;
      }
    }
    const context = contexts.getOrCreateContext(route.outlet);
    return { route, children: context.children, injector: context.injector };
  } catch {
    // A guard or a resolver that throws: no route, as a navigation that
    // fails has none.
    return null;
  } finally {
    injector.destroy();
  }
};

/**
 * The route for `config` in the tree from `route`, if it's there.
 */
const find = (route: ActivatedRoute, config: Route): ActivatedRoute | null => {
  if (route.routeConfig === config) return route;
  for (const child of route.children) {
    const found = find(child, config);
    if (found) return found;
  }
  return null;
};
