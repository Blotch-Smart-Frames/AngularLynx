import {
  Component,
  Directive,
  HostAttributeToken,
  inject,
} from '@angular/core';
import { Router, RouterOutlet, type Routes } from '@angular/router';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, provideRouter } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiTabBar, UiTabBarItem } from './tab-bar';

@Component({
  selector: 'home-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Home page</text>`,
})
class HomePage {}

@Component({
  selector: 'inbox-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Inbox page</text>`,
})
class InboxPage {}

@Component({
  selector: 'profile-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Profile page</text>`,
})
class ProfilePage {}

const routes: Routes = [
  { path: '', component: HomePage },
  { path: 'inbox', component: InboxPage },
  { path: 'inbox/:id', component: InboxPage },
  { path: 'profile', component: ProfilePage },
];

/** The items the host rendered, in template order. */
let items: UiTabBarItem[] = [];

/**
 * Gives each item the label and icon its template sets, and collects it for
 * the tests. `ng test`, which apps run this spec with, compiles ahead of time
 * and binds them itself. Plain Vitest compiles just in time, and there a
 * template's bindings don't reach signal inputs (see set-input-signal.ts),
 * so a spec run that way would find the required inputs empty.
 */
@Directive({ selector: 'ui-tab-bar-item' })
class TrackItem {
  constructor() {
    const item = inject(UiTabBarItem);
    const label = inject(new HostAttributeToken('label'), { optional: true });
    const icon = inject(new HostAttributeToken('icon'), { optional: true });
    if (label !== null) setInputSignal(item.label, label);
    if (icon !== null) setInputSignal(item.icon, icon);
    items.push(item);
  }
}

@Component({
  imports: [LYNX_ELEMENTS, RouterOutlet, UiTabBar, UiTabBarItem, TrackItem],
  template: `
    <router-outlet />
    <ui-tab-bar>
      <ui-tab-bar-item
        route="/"
        icon="home"
        label="Home"
        [routerLinkActiveOptions]="{ exact: true }"
      />
      <ui-tab-bar-item route="/inbox" icon="inbox" label="Inbox" />
      <ui-tab-bar-item
        route="/profile"
        icon="user"
        label="Profile"
        [queryParams]="{ tab: 'posts' }"
      />
    </ui-tab-bar>
  `,
})
class TabBarHost {}

/** The theme's light colors, as icon-theme.ts resolves them for an SVG. */
const PRIMARY = 'rgba(24, 24, 27, 1)';
const MUTED_FOREGROUND = 'rgba(113, 113, 122, 1)';

/**
 * Runs change detection until `done` holds: a navigation takes a few ticks,
 * and RouterLinkActive reports the result in a microtask after it.
 */
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 20 && !done(); i++) {
    await waitForUpdate();
  }
  expect(done()).toBe(true);
};

const renderTabBar = async () => {
  items = [];
  const result = await render(TabBarHost, {
    providers: [provideRouter(routes)],
  });
  const { container } = result;
  const router = result.componentRef.injector.get(Router);
  /**
   * An item's host is the accessibility element, named by its label.
   */
  const tab = (label: string) =>
    container.querySelector(`[accessibility-label^="${label}"]`)!;
  const isActive = (label: string) =>
    tab(label).getAttribute('accessibility-traits') === 'button,selected';
  await until(() => isActive('Home'));
  return {
    ...result,
    router,
    tab,
    isActive,
    item: (label: string) => items.find((item) => item.label() === label)!,
    labelOf: (label: string) =>
      Array.from(tab(label).querySelectorAll('text')).find(
        (text) => text.textContent === label,
      )!,
    iconOf: (label: string) =>
      tab(label).querySelector('svg')!.getAttribute('content') ?? '',
    page: () =>
      Array.from(container.querySelectorAll('text'))
        .map((text) => text.textContent ?? '')
        .find((text) => text.endsWith(' page')),
  };
};

describe('UiTabBar', () => {
  // Item and page selectors aren't Lynx elements, so the renderer falls back
  // to a <view> for each and warns.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('lays the bar out as a row above the bottom safe area', async () => {
    const { container, componentRef } = await render(UiTabBar);
    const bar = container.querySelector('[accessibility-traits="tabbar"]')!;
    expect(bar.classList).toContain('flex-row');
    expect(bar.classList).toContain('pb-safe');
    expect(bar.classList).toContain('border-t');

    setInputSignal((componentRef.instance as UiTabBar).userClass, 'border-t-0');
    await waitForUpdate();
    expect(bar.classList).toContain('border-t-0');
    expect(bar.classList).not.toContain('border-t');
  });

  it('draws an icon and a label in each tab', async () => {
    const { tab, labelOf, iconOf } = await renderTabBar();
    for (const label of ['Home', 'Inbox', 'Profile']) {
      expect(labelOf(label)).toBeTruthy();
      expect(iconOf(label)).toContain('<svg');
      // Each tab is one button for a screen reader, and takes an equal share
      // of the row.
      expect(tab(label).getAttribute('accessibility-element')).toBe('true');
      expect(tab(label).classList).toContain('flex-1');
    }
  });

  it('marks the tab of the current route as selected, in the primary color', async () => {
    const { isActive, labelOf, iconOf } = await renderTabBar();
    expect(isActive('Home')).toBe(true);
    expect(labelOf('Home').classList).toContain('text-primary');
    expect(iconOf('Home')).toContain(PRIMARY);

    expect(isActive('Inbox')).toBe(false);
    expect(labelOf('Inbox').classList).toContain('text-muted-foreground');
    expect(iconOf('Inbox')).toContain(MUTED_FOREGROUND);
  });

  it('navigates on a tap, and moves the selection to the tapped tab', async () => {
    const { tab, isActive, page, labelOf, item } = await renderTabBar();
    const pressed = vi.fn();
    item('Inbox').pressed.subscribe(pressed);
    expect(page()).toBe('Home page');

    fireEvent.tap(tab('Inbox'));

    await until(() => page() === 'Inbox page');
    expect(isActive('Inbox')).toBe(true);
    expect(labelOf('Inbox').classList).toContain('text-primary');
    // `exact` keeps "/" from matching every route.
    expect(isActive('Home')).toBe(false);
    expect(labelOf('Home').classList).toContain('text-muted-foreground');
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it('keeps a tab selected on the routes under it', async () => {
    const { router, isActive, page } = await renderTabBar();
    await router.navigateByUrl('/inbox/7');
    await until(() => page() === 'Inbox page');
    expect(isActive('Inbox')).toBe(true);
    expect(isActive('Home')).toBe(false);
  });

  it("navigates with the item's RouterLink options", async () => {
    const { router, tab, isActive } = await renderTabBar();
    fireEvent.tap(tab('Profile'));
    await until(() => isActive('Profile'));
    expect(router.url).toBe('/profile?tab=posts');
  });

  it('emits pressed for a tap on the selected tab too', async () => {
    const { router, tab, item } = await renderTabBar();
    const pressed = vi.fn();
    item('Home').pressed.subscribe(pressed);
    fireEvent.tap(tab('Home'));
    await waitForUpdate();
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(router.url).toBe('/');
  });

  it("shows a badge over the icon, and says it after the tab's name", async () => {
    const { tab, item } = await renderTabBar();
    const inbox = item('Inbox');
    const badge = () =>
      Array.from(tab('Inbox').querySelectorAll('text')).find(
        (text) => text.textContent !== 'Inbox',
      );
    expect(badge()).toBeUndefined();

    setInputSignal(inbox.badge, 3);
    await waitForUpdate();
    expect(badge()?.textContent).toBe('3');
    expect(badge()?.parentElement?.classList).toContain('bg-destructive');
    expect(tab('Inbox').getAttribute('accessibility-label')).toBe('Inbox, 3');

    setInputSignal(inbox.badge, 'New');
    await waitForUpdate();
    expect(badge()?.textContent).toBe('New');

    // A count of 0 and an empty value show nothing, so a count binds as is.
    for (const empty of [0, '', null, undefined]) {
      setInputSignal(inbox.badge, empty);
      await waitForUpdate();
      expect(badge()).toBeUndefined();
      expect(tab('Inbox').getAttribute('accessibility-label')).toBe('Inbox');
    }
  });

  it('shrinks a tab while it is pressed', async () => {
    const { tab } = await renderTabBar();
    const inbox = tab('Inbox') as HTMLElement;
    const scale = () => inbox.style.getPropertyValue('transform');
    /**
     * Fires a Lynx event the testing library's fireEvent has no shortcut
     * for.
     */
    const fire = (name: string) =>
      inbox.dispatchEvent(
        Object.assign(new Event(`bindEvent:${name}`), {
          eventType: 'bindEvent',
          eventName: name,
        }),
      );

    fireEvent.touchstart(inbox);
    expect(scale()).toBe('scale(0.97)');
    fireEvent.touchend(inbox);
    expect(scale()).toBe('scale(1)');

    fireEvent.touchstart(inbox);
    // A scroll taking over cancels the touch.
    fireEvent.touchcancel(inbox);
    expect(scale()).toBe('scale(1)');

    // The web preview, in a browser, sends mouse events instead.
    fireEvent.mousedown(inbox);
    expect(scale()).toBe('scale(0.97)');
    fireEvent.mouseup(inbox);
    expect(scale()).toBe('scale(1)');
    fireEvent.mousedown(inbox);
    fire('mouseleave');
    expect(scale()).toBe('scale(1)');
  });

  it("merges an item's class into its content, the given class winning", async () => {
    const { tab, item } = await renderTabBar();
    const content = () => tab('Inbox').querySelector('view')!;
    expect(content().classList).toContain('pt-2');

    setInputSignal(item('Inbox').userClass, 'pt-3');
    await waitForUpdate();
    expect(content().classList).toContain('pt-3');
    expect(content().classList).not.toContain('pt-2');
  });
});
