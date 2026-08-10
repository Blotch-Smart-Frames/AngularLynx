import { LocationStrategy, PlatformLocation } from '@angular/common';
import {
  type EnvironmentProviders,
  makeEnvironmentProviders,
} from '@angular/core';
import {
  provideRouter as ngProvideRouter,
  RouteReuseStrategy,
  type RouterFeatures,
  type Routes,
  withRouterConfig,
} from '@angular/router';
import { LynxLocationStrategy } from './lynx-location-strategy';
import { LynxPlatformLocation } from './lynx-platform-location';
import { LynxRouteReuseStrategy } from './lynx-route-reuse-strategy';

/**
 * Provides Angular Router configured for the Lynx runtime.
 *
 * Uses `LynxLocationStrategy` (in-memory routing) instead of Angular's default
 * `PathLocationStrategy` which relies on browser History/Location APIs. This is
 * the Angular equivalent of React Router's `MemoryRouter` — Lynx is a native
 * mobile runtime with no browser URL or History API.
 */
export const provideRouter = (
  routes: Routes,
  ...features: RouterFeatures[]
): EnvironmentProviders => {
  return makeEnvironmentProviders([
    // In-memory routing — Lynx has no browser URL/history APIs.
    // Replaces the default BrowserPlatformLocation → PathLocationStrategy chain.
    // LynxPlatformLocation must be registered first: without it Angular falls back to
    // BrowserPlatformLocation, whose `this.location` is undefined in Lynx (no window.location),
    // so any access to `pathname`/`href` throws a TypeError that silently kills navigation.
    { provide: PlatformLocation, useClass: LynxPlatformLocation },
    { provide: LocationStrategy, useClass: LynxLocationStrategy },
    // Lynx's native element pool is finite (~256 slots on device) and
    // __RemoveElement only detaches elements — it does not free pool slots.
    // Angular's default strategy destroys components on navigation, creating
    // fresh elements each time and exhausting the pool (hard crash on ~9th nav).
    // LynxRouteReuseStrategy detaches views instead: elements are removed from
    // the tree but their pool slots are reused when the route is revisited.
    { provide: RouteReuseStrategy, useClass: LynxRouteReuseStrategy },
    ngProvideRouter(
      routes,
      // Lynx runs Angular on a background thread for layout calculation.
      // Unhandled navigation promise rejections (e.g. from unmatched routes or
      // lazy chunk loading failures) crash the background thread, causing a blank
      // screen with no errors. Resolving as false instead of rejecting prevents
      // this. Trade-off: lazy loading errors are silenced — navigation simply
      // doesn't happen rather than showing an error. Use Router.events with
      // NavigationError/NavigationCancel to detect these failures in app code.
      withRouterConfig({ resolveNavigationPromiseOnError: true }),
      ...features,
    ),
  ]);
};
