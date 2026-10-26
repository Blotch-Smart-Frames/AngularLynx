// @vitest-environment jsdom
import '@angular/compiler';
import { LocationStrategy, PlatformLocation } from '@angular/common';
import { Injector, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import {
  BaseRouteReuseStrategy,
  RouteReuseStrategy,
  ROUTES,
  type Routes,
  withRouterConfig,
} from '@angular/router';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LynxLocationStrategy } from './lynx-location-strategy';
import { LynxPlatformLocation } from './lynx-platform-location';
import { LynxRouteReuseStrategy } from './lynx-route-reuse-strategy';
import { provideRouter } from './lynx-router';

/**
 * A root injector, as in an app: provideRouter() starts LynxBackButton, which
 * needs root services such as Location.
 */
const createInjector = (...args: Parameters<typeof provideRouter>) => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideRouter(...args)],
  });
  return TestBed.inject(Injector);
};

describe('provideRouter', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('provider overrides', () => {
    it('provides LynxPlatformLocation as PlatformLocation', () => {
      const injector = createInjector([]);

      expect(injector.get(PlatformLocation)).toBeInstanceOf(
        LynxPlatformLocation,
      );
    });

    it('provides LynxLocationStrategy as LocationStrategy', () => {
      const injector = createInjector([]);

      expect(injector.get(LocationStrategy)).toBeInstanceOf(
        LynxLocationStrategy,
      );
    });

    it("keeps Angular's own RouteReuseStrategy, which destroys a route you leave", () => {
      const injector = createInjector([]);

      // Angular's DefaultRouteReuseStrategy isn't exported; it extends this.
      const strategy = injector.get(RouteReuseStrategy);
      expect(strategy).toBeInstanceOf(BaseRouteReuseStrategy);
      expect(strategy).not.toBeInstanceOf(LynxRouteReuseStrategy);
    });

    it('lets an app opt in to LynxRouteReuseStrategy', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([]),
          { provide: RouteReuseStrategy, useClass: LynxRouteReuseStrategy },
        ],
      });

      expect(TestBed.inject(RouteReuseStrategy)).toBeInstanceOf(
        LynxRouteReuseStrategy,
      );
    });

    it('singletons — PlatformLocation and LocationStrategy resolve to the same instance on repeated access', () => {
      const injector = createInjector([]);

      expect(injector.get(PlatformLocation)).toBe(
        injector.get(PlatformLocation),
      );
      expect(injector.get(LocationStrategy)).toBe(
        injector.get(LocationStrategy),
      );
      expect(injector.get(RouteReuseStrategy)).toBe(
        injector.get(RouteReuseStrategy),
      );
    });
  });

  describe('routes', () => {
    it('registers the provided routes', () => {
      const routes: Routes = [
        { path: 'home', loadComponent: () => Promise.resolve({}) as never },
        { path: 'about', loadComponent: () => Promise.resolve({}) as never },
      ];
      const injector = createInjector(routes);

      const allRoutes = injector.get(ROUTES) as Routes[];
      expect(allRoutes.flat()).toEqual(expect.arrayContaining(routes));
    });

    it('registers an empty routes array', () => {
      const injector = createInjector([]);

      const allRoutes = injector.get(ROUTES) as Routes[];
      expect(allRoutes.flat()).toEqual([]);
    });
  });

  describe('features', () => {
    it('forwards additional RouterFeatures to the underlying provideRouter', () => {
      // withRouterConfig is a valid RouterFeature — should not throw when passed through
      expect(() =>
        createInjector([], withRouterConfig({ onSameUrlNavigation: 'reload' })),
      ).not.toThrow();
    });

    it('accepts multiple features', () => {
      expect(() =>
        createInjector(
          [],
          withRouterConfig({ onSameUrlNavigation: 'reload' }),
          withRouterConfig({ canceledNavigationResolution: 'computed' }),
        ),
      ).not.toThrow();
    });
  });
});
