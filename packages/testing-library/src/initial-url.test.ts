/**
 * The link that started the app under the testing library (issue #479):
 * render()'s initialURL hands it over as the shells do, in the global props,
 * so a spec can check what LynxLinking.getInitialURL() and the router make of
 * it.
 */

import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxLinking,
  provideRouter,
} from '@blotch/angular-lynx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitForUpdate } from './index.js';

/**
 * Waits until the router's first navigation has drawn its screen.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'launch-link',
  imports: [LYNX_ELEMENTS],
  template: `<text>Started by: {{ url ?? 'icon' }}</text>`,
})
class LaunchLink {
  readonly url = inject(LynxLinking).getInitialURL();
}

@Component({
  selector: 'home-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Home</text>`,
})
class Home {}

@Component({
  selector: 'order-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Order {{ id }}</text>`,
})
class Order {
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
}

@Component({
  selector: 'app-shell',
  imports: [LYNX_ELEMENTS, RouterOutlet],
  template: `<view><router-outlet /></view>`,
})
class Shell {}

const routes = [
  { path: '', component: Home },
  { path: 'orders/:id', component: Order },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('render() with initialURL', () => {
  it('is the link getInitialURL() returns', async () => {
    await render(LaunchLink, { initialURL: 'myapp://orders/42' });

    expect(
      screen.getByText('Started by: myapp://orders/42'),
    ).toBeInTheDocument();
  });

  it('starts the app from its icon when left out', async () => {
    await render(LaunchLink);

    expect(screen.getByText('Started by: icon')).toBeInTheDocument();
  });

  it("starts the router at the link's route, with nothing under it", async () => {
    const { componentRef } = await render(Shell, {
      providers: [provideRouter(routes)],
      initialURL: 'myapp://orders/42',
    });
    await settle();

    expect(screen.getByText('Order 42')).toBeInTheDocument();
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(componentRef.injector.get(Router).url).toBe('/orders/42');

    // The link's screen is the history's first entry, so there's no screen
    // to go back to.
    componentRef.injector.get(Location).back();
    await settle();
    expect(componentRef.injector.get(Router).url).toBe('/orders/42');
  });

  it('starts at / when the router has no route for the link', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { componentRef } = await render(Shell, {
      providers: [provideRouter(routes)],
      initialURL: 'myapp://nowhere',
    });
    await settle();

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(componentRef.injector.get(Router).url).toBe('/');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('opened with myapp://nowhere'),
    );
  });

  it("doesn't carry the link to a later render() without one", async () => {
    const { rerender } = await render(LaunchLink, {
      initialURL: 'myapp://orders/42',
    });

    await rerender(LaunchLink);

    expect(screen.getByText('Started by: icon')).toBeInTheDocument();
  });
});
