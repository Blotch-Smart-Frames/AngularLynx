/**
 * `<lynx-tab-outlet>` through the Lynx renderer (issue #403): a tab another
 * one replaces keeps its elements, and the stack in it its screens, and both
 * show again as they were, without an element made again. The outlet sits in
 * an `@if`, as an app's shell often does, whose root element's container the
 * renderer has to place once the block is in the tree.
 */

import { Component, signal } from '@angular/core';
import { Router, RouterOutlet, type Routes } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxStackOutlet,
  LynxTabOutlet,
  provideRouter,
} from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitForUpdate } from './index.js';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Component selectors are unknown to the Lynx document, which warns.
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

@Component({
  selector: 'tab-screen',
  imports: [LYNX_ELEMENTS],
  template: `<view class="screen"><text>screen</text></view>`,
})
class Screen {}

/**
 * A tab's first screen, by its text.
 */
@Component({
  selector: 'tab-first-screen',
  imports: [LYNX_ELEMENTS],
  template: `<view><text>ON SCREEN</text></view>`,
})
class FirstScreen {}

@Component({
  selector: 'stack-tab',
  imports: [LYNX_ELEMENTS, LynxStackOutlet],
  template: `<lynx-stack-outlet />`,
})
class StackTab {}

@Component({
  selector: 'tab-shell',
  imports: [LYNX_ELEMENTS, LynxTabOutlet],
  template: `
    <view class="shell">
      @if (signedIn()) {
        <lynx-tab-outlet />
      }
    </view>
  `,
})
class Shell {
  readonly signedIn = signal(true);
}

@Component({
  selector: 'tab-root',
  imports: [LYNX_ELEMENTS, RouterOutlet],
  template: `<router-outlet />`,
})
class Root {}

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: '',
    component: Shell,
    children: [
      { path: 'home', component: Screen },
      { path: 'pages', component: Screen },
      {
        path: 'library',
        component: StackTab,
        children: [
          { path: '', component: Screen },
          { path: ':id', component: Screen },
        ],
      },
    ],
  },
];

/**
 * A lazy tab, whose screens are a stack, as an app's tabs often are.
 */
const lazyTab = (path: string): Routes[number] => ({
  path,
  loadChildren: async () => [
    {
      path: '',
      component: StackTab,
      children: [{ path: '', component: FirstScreen }],
    },
  ],
});

const lazyRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: '',
    component: Shell,
    children: [lazyTab('home'), lazyTab('schedule')],
  },
];

describe('<lynx-tab-outlet>', () => {
  const setup = async (appRoutes = routes) => {
    const result = await render(Root, {
      providers: [provideRouter(appRoutes)],
    });
    const router = result.componentRef.injector.get(Router);
    const go = async (url: string) => {
      await router.navigateByUrl(url);
      await waitForUpdate();
    };
    /**
     * The screens on screen, the visible ones and the hidden ones.
     */
    const screens = () =>
      Array.from(result.container.querySelectorAll('.screen'));
    return { ...result, router, go, screens };
  };

  it('keeps the elements of a tab another one replaces', async () => {
    const { go, screens } = await setup();
    await go('/home');
    const [home] = screens();
    await go('/pages');
    expect(screens()).toHaveLength(2);
    await go('/home');
    // The same elements, nothing made again.
    expect(screens()).toHaveLength(2);
    expect(screens()[0]).toBe(home);
  });

  it('keeps the stack in a tab, and goes back to where it was left', async () => {
    const { go, router, screens } = await setup();
    await go('/library');
    await go('/library/3');
    const shown = screens().length;
    const album = screens().at(-1);
    await go('/pages');
    await go('/library');
    expect(router.url).toBe('/library/3');
    expect(screens()).toHaveLength(shown + 1);
    expect(screens()).toContain(album);
  });

  // Issue #413.
  it('shows the tab it kept after a tab not shown yet and straight back', async () => {
    const { router } = await setup(lazyRoutes);
    const [home] = await screen.findAllByText('ON SCREEN');
    await waitForUpdate();
    // Two navigations with no update between them, as a guard's redirect
    // makes: the Schedule tab's stack registers only once it's checked,
    // after Home is back.
    await router.navigateByUrl('/schedule');
    await router.navigateByUrl('/home');
    await waitForUpdate();
    expect(router.url).toBe('/home');
    // Home as it was, and nothing more: the router left the Schedule tab's
    // first screen before its stack was there to show it.
    expect(screen.getAllByText('ON SCREEN')).toEqual([home]);
    // The Schedule tab's stack shows it once the tab is back.
    await router.navigateByUrl('/schedule');
    await waitForUpdate();
    expect(router.url).toBe('/schedule');
    expect(screen.getAllByText('ON SCREEN')).toHaveLength(2);
    await router.navigateByUrl('/home');
    await waitForUpdate();
    expect(screen.getAllByText('ON SCREEN')).toHaveLength(2);
    expect(screen.getAllByText('ON SCREEN')).toContain(home);
  });
});
