import '@angular/compiler';
import { LocationStrategy, PlatformLocation } from '@angular/common';
import { Injector } from '@angular/core';
import {
  RouteReuseStrategy,
  ROUTES,
  type Routes,
  withRouterConfig,
} from '@angular/router';
import { describe, expect, it } from 'vitest';
import { LynxLocationStrategy } from './lynx-location-strategy';
import { LynxPlatformLocation } from './lynx-platform-location';
import { LynxRouteReuseStrategy } from './lynx-route-reuse-strategy';
import { provideRouter } from './lynx-router';

const createInjector = (...args: Parameters<typeof provideRouter>) =>
  Injector.create({ providers: [provideRouter(...args)] });

describe('provideRouter', () => {
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

    it('provides LynxRouteReuseStrategy as RouteReuseStrategy', () => {
      const injector = createInjector([]);

      expect(injector.get(RouteReuseStrategy)).toBeInstanceOf(
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
