import {
  DestroyRef,
  type EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  Router,
  ROUTES,
} from '@angular/router';
import {
  LynxSplashScreen,
  SPLASH_SCREEN_HIDE,
  type SplashScreenHide,
} from './splash-screen';

/** What {@link provideSplashScreen} takes. */
export type SplashScreenOptions = {
  /**
   * When the splash screen goes: after the router's first navigation (the
   * default), or when the app calls `LynxSplashScreen.hide()`.
   */
  readonly hide?: SplashScreenHide;
};

/**
 * Keeps the app's launch screen (angular.json's `splash`) up until the app's
 * first screen is ready, rather than until Angular first draws, which is
 * what happens without it.
 *
 * With `hide: 'afterFirstNavigation'`, the default, it goes once the router's
 * first navigation has ended (its guards and resolvers run, its lazy routes
 * loaded, any redirect followed) and the screen it leads to is drawn. A
 * navigation that fails or is canceled ends it too, so the app is never left
 * behind its logo. With `hide: 'manual'`, the app hides it with
 * {@link LynxSplashScreen.hide}, for a first screen that waits on something
 * else.
 *
 * @usageNotes
 * ```typescript
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideRouter(routes),
 *     provideSplashScreen({ hide: 'afterFirstNavigation' }),
 *   ],
 * };
 * ```
 */
export const provideSplashScreen = (
  options: SplashScreenOptions = {},
): EnvironmentProviders => {
  const hide = options.hide ?? 'afterFirstNavigation';
  return makeEnvironmentProviders([
    { provide: SPLASH_SCREEN_HIDE, useValue: hide },
    ...(hide === 'afterFirstNavigation'
      ? [provideEnvironmentInitializer(hideAfterFirstNavigation)]
      : []),
  ]);
};

/**
 * Hides the splash screen once the router has no navigation under way after
 * one ended: a guard that redirects cancels the navigation and starts
 * another, whose screen is the one to wait for.
 */
const hideAfterFirstNavigation = (): void => {
  // The Router itself is `providedIn: 'root'`, so it's there without
  // provideRouter() too, but it never navigates: the routes tell.
  if (!inject(ROUTES, { optional: true })) {
    throw new Error(
      "provideSplashScreen({ hide: 'afterFirstNavigation' }) needs the router: add provideRouter(routes) to the app's providers, or hide the splash screen yourself with { hide: 'manual' } and LynxSplashScreen.hide().",
    );
  }
  const router = inject(Router);
  const splash = inject(LynxSplashScreen);
  const events = router.events.subscribe((event) => {
    if (
      !(event instanceof NavigationEnd) &&
      !(event instanceof NavigationCancel) &&
      !(event instanceof NavigationError) &&
      !(event instanceof NavigationSkipped)
    ) {
      return;
    }
    // In a microtask, by when a redirect has started its navigation.
    queueMicrotask(() => {
      if (router.currentNavigation()) return;
      events.unsubscribe();
      // Does nothing if the app has hidden it already.
      splash.hide();
    });
  });
  inject(DestroyRef).onDestroy(() => events.unsubscribe());
};
