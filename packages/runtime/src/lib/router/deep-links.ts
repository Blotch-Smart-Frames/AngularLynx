import { LocationStrategy } from '@angular/common';
import {
  type EnvironmentProviders,
  ErrorHandler,
  inject,
  InjectionToken,
  Injector,
  makeEnvironmentProviders,
} from '@angular/core';
import {
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';
import { LynxLinking, routeOfLink } from '../linking';
import { LynxLocationStrategy, startHistoryAt } from './lynx-location-strategy';

/** A link that opened the app, as a {@link DeepLinkRoute} is handed it. */
export type DeepLink = {
  /** The whole URL, such as `myapp://orders/42?tab=items`. */
  readonly url: string;
  /**
   * Where the router goes for it unless the function says otherwise: the
   * URL's path, with its query and fragment, such as `/orders/42?tab=items`.
   * For the app's own scheme, the host is part of the path, as Expo Router
   * reads a link: `myapp://orders/42` leads to `/orders/42`.
   */
  readonly route: string;
  /**
   * Whether the link started the app. If so, the route is the app's first
   * screen. Otherwise the router navigates to it from wherever the app was.
   */
  readonly initial: boolean;
};

/**
 * Decides where the router goes for a link that opens the app: a route to
 * navigate to, or `null` to leave the router where it is (at launch, that's
 * `/`). See {@link provideDeepLinkRoute}.
 */
export type DeepLinkRoute = (link: DeepLink) => string | null;

const DEEP_LINK_ROUTE = new InjectionToken<DeepLinkRoute>('deep-link-route');

/**
 * Changes where the router goes for a link that opens the app, as Expo
 * Router's `redirectSystemPath` does. Without it, the router goes to the
 * link's {@link DeepLink.route}.
 *
 * Return another route to send a link somewhere else, such as an old path
 * the app has renamed, or `null` for a link the app handles itself with
 * `LynxLinking.onURL()`, such as a sign-in's callback.
 *
 * @usageNotes
 * ```typescript
 * bootstrapApplication(App, {
 *   providers: [
 *     provideRouter(routes),
 *     provideDeepLinkRoute(({ url, route }) =>
 *       url.startsWith('myapp://auth') ? null : route,
 *     ),
 *   ],
 * });
 * ```
 */
export const provideDeepLinkRoute = (
  route: DeepLinkRoute,
): EnvironmentProviders =>
  makeEnvironmentProviders([{ provide: DEEP_LINK_ROUTE, useValue: route }]);

/**
 * Where the router goes for `url`, or null for nowhere. An error in the
 * app's {@link DeepLinkRoute} goes to its ErrorHandler, and the link
 * nowhere: it mustn't keep the app from starting.
 */
const routeFor = (
  injector: Injector,
  url: string,
  initial: boolean,
): string | null => {
  const route = routeOfLink(url);
  const decide = injector.get(DEEP_LINK_ROUTE, null);
  if (!decide) return route;
  try {
    return decide({ url, route, initial });
  } catch (error) {
    injector.get(ErrorHandler).handleError(error);
    return null;
  }
};

/**
 * Takes the app back to `/` if the router can't go to the route the link
 * that started it leads to, such as a path no route matches. The router's
 * first screen would otherwise be blank: `provideRouter()` makes a failed
 * navigation resolve rather than throw, and there's no screen before it to
 * stay on. A later navigation that ends first, such as one a guard redirects
 * to or a link that arrives meanwhile, settles it.
 */
const fallBackUnlessRouted = (router: Router, url: string): void => {
  let first: number | undefined;
  const subscription = router.events.subscribe((event) => {
    if (event instanceof NavigationStart) {
      first ??= event.id;
    } else if (event instanceof NavigationEnd) {
      subscription.unsubscribe();
    } else if (event instanceof NavigationError && event.id === first) {
      subscription.unsubscribe();
      // In production too: a link that leads nowhere comes from outside the
      // app, such as an old email, and the log is the only trace of it.
      console.warn(
        `[angular-lynx] The app was opened with ${url}, but the router couldn't go to its route ${event.url}, so the app started at / instead. Add a route for it, or send it elsewhere with provideDeepLinkRoute().`,
      );
      void router.navigateByUrl('/', { replaceUrl: true });
    }
  });
};

/**
 * Makes a link that opens the app navigate the router to its route, as Expo
 * Router does, which needs no code in the app. `provideRouter()` runs it as
 * the app starts:
 *
 * - The link that started the app sets the history's first entry, so the
 *   router's initial navigation goes straight to its route: the app's first
 *   screen is the link's, with nothing under it, as a page opened at an
 *   address in a browser starts there.
 * - A link that arrives while the app is open navigates there, on top of
 *   what's on screen, as `routerLink` does.
 */
export const startDeepLinks = (): void => {
  const injector = inject(Injector);
  const linking = inject(LynxLinking);

  const initialURL = linking.getInitialURL();
  const initial =
    initialURL === null ? null : routeFor(injector, initialURL, true);
  if (initialURL !== null && initial !== null && initial !== '/') {
    const strategy = inject(LocationStrategy);
    if (
      strategy instanceof LynxLocationStrategy &&
      startHistoryAt(strategy, initial)
    ) {
      fallBackUnlessRouted(inject(Router), initialURL);
    }
  }

  linking.onURL((url) => {
    const route = routeFor(injector, url, false);
    if (route !== null) void injector.get(Router).navigateByUrl(route);
  });
};
