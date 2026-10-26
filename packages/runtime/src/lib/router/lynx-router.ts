import { LocationStrategy, PlatformLocation } from '@angular/common';
import {
  type EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import {
  provideRouter as ngProvideRouter,
  type RouterFeatures,
  type Routes,
  withRouterConfig,
} from '@angular/router';
import { LynxBackButton } from './lynx-back-button';
import { LynxLocationStrategy } from './lynx-location-strategy';
import { LynxPlatformLocation } from './lynx-platform-location';

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
    // No RouteReuseStrategy: leaving a route destroys it, as Angular does on
    // the web. This used to install LynxRouteReuseStrategy against a supposed
    // ~256-slot native element pool. Measured on Lynx 4.1 (iOS and Android,
    // October 2026), there's no such limit, and the strategy saved no
    // elements anyway: a re-attached route rebuilds them (#recreateSubtree in
    // lynx-element.ts). See lynx-route-reuse-strategy.ts.
    ngProvideRouter(
      routes,
      // Unhandled navigation promise rejections (e.g. from unmatched routes or
      // lazy chunk loading failures) left a blank screen with no errors. Resolving as false instead of rejecting prevents
      // this. Trade-off: lazy loading errors are silenced — navigation simply
      // doesn't happen rather than showing an error. Use Router.events with
      // NavigationError/NavigationCancel to detect these failures in app code.
      withRouterConfig({ resolveNavigationPromiseOnError: true }),
      ...features,
    ),
    // The Android back button goes back through this router's history, like
    // the browser's back button on the web (see lynx-back-button.ts).
    provideEnvironmentInitializer(() => inject(LynxBackButton)),
  ]);
};
