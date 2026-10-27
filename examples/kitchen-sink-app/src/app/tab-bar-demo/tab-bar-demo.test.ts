import { Component } from '@angular/core';
import { Router, RouterOutlet, type Routes } from '@angular/router';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { provideRouter } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TabBarAlerts,
  TabBarDemo,
  TabBarFeed,
  TabBarSearch,
} from './tab-bar-demo';

// The demo's tabs are relative routes, so it has to be a route's component,
// as it is in the app, for them to resolve under /tab-bar-demo.
const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tab-bar-demo' },
  {
    path: 'tab-bar-demo',
    component: TabBarDemo,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'feed' },
      { path: 'feed', component: TabBarFeed },
      { path: 'search', component: TabBarSearch },
      { path: 'alerts', component: TabBarAlerts },
    ],
  },
];

@Component({
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class Shell {}

/**
 * Runs change detection until `done` holds: navigation takes a few ticks.
 */
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 20 && !done(); i++) {
    await waitForUpdate();
  }
  expect(done()).toBe(true);
};

describe('TabBarDemo', () => {
  // Component selectors aren't Lynx elements: the renderer warns as it falls
  // back to a <view> for each.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('switches its child routes from its own tab bar', async () => {
    const { container, componentRef, getByText } = await render(Shell, {
      providers: [provideRouter(routes)],
    });
    const router = componentRef.injector.get(Router);
    const tab = (label: string) =>
      container.querySelector(`[accessibility-label^="${label}"]`)!;
    const selected = (label: string) =>
      tab(label)?.getAttribute('accessibility-traits') === 'button,selected';

    await until(() => selected('Feed'));
    expect(router.url).toBe('/tab-bar-demo/feed');

    fireEvent.tap(tab('Alerts'));
    await until(() => selected('Alerts'));
    expect(router.url).toBe('/tab-bar-demo/alerts');
    expect(selected('Feed')).toBe(false);
    expect(tab('Alerts').getAttribute('accessibility-label')).toBe('Alerts, 3');

    // The alerts screen shares the demo's count, which the badge shows.
    fireEvent.tap(getByText('Clear alerts').parentElement!);
    await until(
      () => tab('Alerts').getAttribute('accessibility-label') === 'Alerts',
    );
  });
});
