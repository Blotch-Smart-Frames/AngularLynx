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
import { render, waitForUpdate } from './index.js';

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

describe('<lynx-tab-outlet>', () => {
  const setup = async () => {
    const result = await render(Root, { providers: [provideRouter(routes)] });
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
});
