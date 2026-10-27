/**
 * Router link tests: Angular's own `RouterLink` and `RouterLinkActive` on Lynx
 * elements, end to end through the Lynx renderer (issue #113).
 *
 * `RouterLink` listens for `click`, which Lynx elements never fire. The
 * renderer delivers a tap to `click` listeners, as Lynx for Web does, so a
 * tap on `<view routerLink>` navigates. LYNX_ELEMENTS adds the `selected`
 * accessibility trait to the active `routerLinkActive` element.
 */

import { Component, input, signal } from '@angular/core';
import {
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
  type Routes,
} from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxRouterLinkActive,
  provideRouter,
} from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitForUpdate } from './index.js';

/**
 * Custom component selectors are unknown to the Lynx document and trigger a
 * console.warn fallback. Suppress for clean output.
 */
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

@Component({
  selector: 'home-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Home page</text>`,
})
class HomePage {}

@Component({
  selector: 'settings-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Settings page</text>`,
})
class SettingsPage {}

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: HomePage },
  { path: 'settings', component: SettingsPage },
];

/** Taps on the Settings link's own (bindtap). */
const settingsTaps = signal(0);

@Component({
  selector: 'nav-app',
  imports: [LYNX_ELEMENTS, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <view
      class="home"
      routerLink="/home"
      routerLinkActive="active"
      accessibility-traits="button"
    >
      <text>Home</text>
    </view>
    <view
      class="settings"
      routerLink="/settings"
      routerLinkActive="active"
      (bindtap)="countTap()"
    >
      <text>Settings</text>
    </view>
    <router-outlet />
  `,
})
class NavApp {
  countTap(): void {
    settingsTaps.update((taps) => taps + 1);
  }
}

/**
 * A tab that is itself the link, through host directives: selectors don't
 * match host directives, so LynxRouterLinkActive is listed with them.
 */
@Component({
  selector: 'app-tab',
  imports: [LYNX_ELEMENTS],
  hostDirectives: [
    { directive: RouterLink, inputs: ['routerLink: route'] },
    { directive: RouterLinkActive, inputs: ['routerLinkActive: activeClass'] },
    LynxRouterLinkActive,
  ],
  host: { 'accessibility-traits': 'button' },
  template: `<text><ng-content /></text>`,
})
class Tab {
  readonly route = input.required<string>();
}

@Component({
  selector: 'tab-app',
  imports: [LYNX_ELEMENTS, RouterOutlet, Tab],
  template: `
    <app-tab class="home-tab" route="/home" activeClass="active">Home</app-tab>
    <app-tab class="settings-tab" route="/settings" activeClass="active"
      >Settings</app-tab
    >
    <router-outlet />
  `,
})
class TabApp {}

/**
 * Runs change detection until `done` holds: navigation takes a few ticks.
 */
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 20 && !done(); i++) {
    await waitForUpdate();
  }
  expect(done()).toBe(true);
};

const texts = (container: Element): string[] =>
  Array.from(container.querySelectorAll('text')).map(
    (text) => text.textContent?.trim() ?? '',
  );

describe('router links on Lynx elements', () => {
  it('navigates on tap and marks the active link', async () => {
    settingsTaps.set(0);
    const { container } = await render(NavApp, {
      providers: [provideRouter(routes)],
    });
    const home = container.querySelector('.home')!;
    const settings = container.querySelector('.settings')!;

    await until(() => home.classList.contains('active'));
    expect(texts(container)).toContain('Home page');
    // The element's own trait stays, with `selected` added.
    expect(home.getAttribute('accessibility-traits')).toBe('button,selected');
    expect(settings.hasAttribute('accessibility-traits')).toBe(false);

    fireEvent.tap(settings);

    await until(() => settings.classList.contains('active'));
    expect(texts(container)).toContain('Settings page');
    expect(texts(container)).not.toContain('Home page');
    expect(settings.getAttribute('accessibility-traits')).toBe('selected');
    expect(home.classList.contains('active')).toBe(false);
    expect(home.getAttribute('accessibility-traits')).toBe('button');
    // The template's own tap handler on the same element still ran: Lynx keeps
    // one handler per event, which runs both.
    expect(settingsTaps()).toBe(1);
  });

  it('works on a component host through host directives', async () => {
    const { container } = await render(TabApp, {
      providers: [provideRouter(routes)],
    });
    const home = container.querySelector('.home-tab')!;
    const settings = container.querySelector('.settings-tab')!;

    await until(() => home.classList.contains('active'));
    expect(home.getAttribute('accessibility-traits')).toBe('button,selected');

    fireEvent.tap(settings);

    await until(() => settings.classList.contains('active'));
    expect(texts(container)).toContain('Settings page');
    expect(settings.getAttribute('accessibility-traits')).toBe(
      'button,selected',
    );
    expect(home.getAttribute('accessibility-traits')).toBe('button');
  });
});
