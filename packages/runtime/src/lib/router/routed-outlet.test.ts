import '@angular/compiler';
import type { EnvironmentInjector } from '@angular/core';
import {
  type RouterOutletContract,
  ChildrenOutletContexts,
} from '@angular/router';
import { describe, expect, it } from 'vitest';
import { ScreenContexts } from './routed-outlet';

/**
 * The injector a context falls back to without a route: the contexts only
 * keep it.
 */
const root = {} as EnvironmentInjector;

/**
 * A stand-in outlet: the contexts only keep it.
 */
const outlet = (): RouterOutletContract => ({}) as RouterOutletContract;

describe('ScreenContexts', () => {
  const setup = () => {
    const router = new ChildrenOutletContexts(root);
    const screen = new ScreenContexts(router, root);
    return { router, screen };
  };

  it("is the router's contexts while its screen is shown", () => {
    const { router, screen } = setup();
    const primary = outlet();
    screen.onChildOutletCreated('primary', primary);
    expect(router.getContext('primary')?.outlet).toBe(primary);
    expect(screen.getContext('primary')).toBe(router.getContext('primary'));
    expect(screen.getOrCreateContext('side')).toBe(router.getContext('side'));
    screen.onChildOutletDestroyed('primary');
    expect(router.getContext('primary')?.outlet).toBeNull();

    const taken = screen.onOutletDeactivated();
    expect(taken.has('primary')).toBe(true);
    expect(router.getContext('primary')).toBeNull();
    screen.onOutletReAttached(taken);
    expect(router.getContext('primary')).toBe(taken.get('primary'));
  });

  it("keeps its screen's contexts while it's hidden, and gives them back", () => {
    const { router, screen } = setup();
    const primary = outlet();
    screen.onChildOutletCreated('primary', primary);
    const context = router.getContext('primary');
    screen.hide();
    expect(router.getContext('primary')).toBeNull();
    expect(screen.getContext('primary')).toBe(context);

    // Another screen's outlets take the router's contexts meanwhile.
    const other = new ScreenContexts(router, root);
    const shown = outlet();
    other.onChildOutletCreated('primary', shown);

    // One registering in the hidden screen stays in its own, and leaves the
    // shown screen's alone.
    const late = outlet();
    screen.onChildOutletCreated('side', late);
    expect(router.getContext('side')).toBeNull();
    expect(router.getContext('primary')?.outlet).toBe(shown);
    expect(screen.getOrCreateContext('side').outlet).toBe(late);
    screen.onChildOutletDestroyed('side');
    expect(screen.getContext('side')?.outlet).toBeNull();
    expect(router.getContext('primary')?.outlet).toBe(shown);

    other.hide();
    screen.show();
    expect(router.getContext('primary')).toBe(context);
    expect(router.getContext('primary')?.outlet).toBe(primary);
    expect(router.getContext('side')).not.toBeNull();
  });

  it("swaps a hidden screen's own contexts without the router's", () => {
    const { router, screen } = setup();
    screen.onChildOutletCreated('primary', outlet());
    screen.hide();
    const taken = screen.onOutletDeactivated();
    expect(taken.has('primary')).toBe(true);
    expect(screen.getContext('primary')).toBeNull();
    screen.onOutletReAttached(taken);
    expect(screen.getContext('primary')).toBe(taken.get('primary'));
    expect(router.getContext('primary')).toBeNull();
  });

  it('hides and shows once, however often it is told', () => {
    const { router, screen } = setup();
    const primary = outlet();
    screen.onChildOutletCreated('primary', primary);
    // Shown already: the router's contexts stay as they are.
    screen.show();
    expect(router.getContext('primary')?.outlet).toBe(primary);
    screen.hide();
    // Another screen's, which a second hide() mustn't take.
    const other = new ScreenContexts(router, root);
    other.onChildOutletCreated('primary', outlet());
    screen.hide();
    expect(screen.getContext('primary')?.outlet).toBe(primary);
    expect(router.getContext('primary')?.outlet).not.toBe(primary);
  });
});
