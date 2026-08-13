import '@angular/compiler';
import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ActivatedRouteSnapshot,
  DetachedRouteHandle,
} from '@angular/router';
import { LynxRouteReuseStrategy } from './lynx-route-reuse-strategy';

/**
 * Builds a minimal ActivatedRouteSnapshot with a routeConfig path hierarchy.
 * `segments` maps to a chain of snapshots from root to leaf.
 */
const makeRoute = (
  segments: (string | null)[],
  routeConfig: object | null = { path: segments.at(-1) ?? '' },
): ActivatedRouteSnapshot => {
  const pathFromRoot = segments.map((seg) => ({
    routeConfig: seg !== null ? { path: seg } : null,
  })) as ActivatedRouteSnapshot[];

  return {
    pathFromRoot,
    routeConfig,
  } as unknown as ActivatedRouteSnapshot;
};

const handle: DetachedRouteHandle = { componentRef: {} } as DetachedRouteHandle;

describe('LynxRouteReuseStrategy', () => {
  let strategy: LynxRouteReuseStrategy;

  beforeEach(() => {
    strategy = new LynxRouteReuseStrategy();
  });

  describe('shouldDetach', () => {
    it('always returns true to keep native elements in the pool', () => {
      expect(strategy.shouldDetach(makeRoute(['home']))).toBe(true);
      expect(strategy.shouldDetach(makeRoute([null]))).toBe(true);
    });
  });

  describe('store / shouldAttach / retrieve', () => {
    it('stores a handle and reports the route as attachable', () => {
      const route = makeRoute(['home']);
      strategy.store(route, handle);
      expect(strategy.shouldAttach(route)).toBe(true);
    });

    it('retrieves the stored handle', () => {
      const route = makeRoute(['home']);
      strategy.store(route, handle);
      expect(strategy.retrieve(route)).toBe(handle);
    });

    it('returns false from shouldAttach for an un-stored route', () => {
      expect(strategy.shouldAttach(makeRoute(['home']))).toBe(false);
    });

    it('returns null from retrieve for an un-stored route', () => {
      expect(strategy.retrieve(makeRoute(['home']))).toBeNull();
    });

    it('removes a stored route when store is called with null', () => {
      const route = makeRoute(['home']);
      strategy.store(route, handle);
      strategy.store(route, null);
      expect(strategy.shouldAttach(route)).toBe(false);
      expect(strategy.retrieve(route)).toBeNull();
    });

    it('does not store anything when called with a null handle', () => {
      const route = makeRoute(['home']);
      strategy.store(route, null);
      expect(strategy.shouldAttach(route)).toBe(false);
    });
  });

  describe('key uniqueness', () => {
    it('treats routes with different paths as separate entries', () => {
      const home = makeRoute(['home']);
      const about = makeRoute(['about']);

      strategy.store(home, handle);

      expect(strategy.shouldAttach(home)).toBe(true);
      expect(strategy.shouldAttach(about)).toBe(false);
    });

    it('distinguishes nested routes from sibling routes', () => {
      const parent = makeRoute(['parent']);
      const child = makeRoute(['parent', 'child']);

      strategy.store(child, handle);

      expect(strategy.shouldAttach(child)).toBe(true);
      expect(strategy.shouldAttach(parent)).toBe(false);
    });

    it('uses the full path from root so nested routes do not collide', () => {
      const aChild = makeRoute(['a', 'child']);
      const bChild = makeRoute(['b', 'child']);
      const handleA: DetachedRouteHandle = { id: 'a' } as DetachedRouteHandle;
      const handleB: DetachedRouteHandle = { id: 'b' } as DetachedRouteHandle;

      strategy.store(aChild, handleA);
      strategy.store(bChild, handleB);

      expect(strategy.retrieve(aChild)).toBe(handleA);
      expect(strategy.retrieve(bChild)).toBe(handleB);
    });

    it('handles route segments without a routeConfig (null segments become empty string)', () => {
      const route = makeRoute([null, 'home']);
      strategy.store(route, handle);
      expect(strategy.shouldAttach(route)).toBe(true);
    });
  });

  describe('shouldReuseRoute', () => {
    it('returns true when future and current share the same routeConfig reference', () => {
      const config = { path: 'home' };
      const future = makeRoute(['home'], config);
      const curr = makeRoute(['home'], config);
      expect(strategy.shouldReuseRoute(future, curr)).toBe(true);
    });

    it('returns false when future and current have different routeConfig references', () => {
      const future = makeRoute(['home'], { path: 'home' });
      const curr = makeRoute(['home'], { path: 'home' });
      expect(strategy.shouldReuseRoute(future, curr)).toBe(false);
    });

    it('returns true when both routeConfigs are null', () => {
      const future = makeRoute([null], null);
      const curr = makeRoute([null], null);
      expect(strategy.shouldReuseRoute(future, curr)).toBe(true);
    });

    it('returns false when one routeConfig is null and the other is not', () => {
      const future = makeRoute(['home'], { path: 'home' });
      const curr = makeRoute([null], null);
      expect(strategy.shouldReuseRoute(future, curr)).toBe(false);
    });
  });
});
