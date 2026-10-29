import { Component, type Provider, signal, viewChildren } from '@angular/core';
import { Router, RouterOutlet, type Routes } from '@angular/router';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
  provideRouter,
} from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { lynxMainThread } from '../../../test-utils/lynx-main-thread';
import { UiIcon } from '../icon/icon';
import { provideGlass } from '../glass/glass-design';
import { UiDock, UiDockAccessory, UiDockAction, UiDockItem } from './dock';
import { UiDockState } from './dock-scroll';

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
  selector: 'search-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Search page</text>`,
})
class SearchPage {}

const routes: Routes = [
  { path: '', component: HomePage },
  { path: 'inbox', component: InboxPage },
  { path: 'profile', component: HomePage },
  { path: 'search', component: SearchPage },
];

@Component({
  imports: [
    LYNX_ELEMENTS,
    RouterOutlet,
    UiDock,
    UiDockAccessory,
    UiDockAction,
    UiDockItem,
    UiIcon,
  ],
  template: `
    <router-outlet />
    <ui-dock [class]="dockClass()" [expandLabel]="expandLabel()">
      @if (accessory()) {
        <view ui-dock-accessory class="flex-row">
          <text class="text-glass-foreground">Now playing</text>
          <ui-icon name="play" />
        </view>
      }
      <ui-dock-item
        route="/"
        icon="home"
        label="Home"
        [routerLinkActiveOptions]="{ exact: true }"
      />
      <ui-dock-item
        route="/inbox"
        icon="inbox"
        label="Inbox"
        [badge]="badge()"
        [class]="inboxClass()"
      />
      <ui-dock-item
        route="/profile"
        icon="user"
        label="Profile"
        [queryParams]="{ tab: 'posts' }"
      />
      @if (action()) {
        <ui-dock-action route="/search" icon="search" label="Search" />
      }
    </ui-dock>
  `,
})
class DockHost {
  readonly dockClass = signal('');
  readonly expandLabel = signal('Show tab bar');
  readonly accessory = signal(true);
  readonly action = signal(true);
  readonly badge = signal<string | number | null | undefined>(undefined);
  readonly inboxClass = signal('');
  readonly items = viewChildren(UiDockItem);
}

/**
 * A dock with only an action of the app's own, and no items.
 */
@Component({
  imports: [LYNX_ELEMENTS, UiDock, UiDockAction],
  template: `
    <ui-dock>
      <ui-dock-action
        icon="plus"
        label="New message"
        (pressed)="taps.set(taps() + 1)"
      />
    </ui-dock>
  `,
})
class ActionOnlyHost {
  readonly taps = signal(0);
}

/** Accessibility settings a test can change, as the host app would. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

const IOS_26 = { platform: 'iOS', osVersion: '26.0' };
const IOS_18 = { platform: 'iOS', osVersion: '18.5' };
const ANDROID = { platform: 'Android', osVersion: '15' };

/** The theme's light colors, as icon-theme.ts resolves them for an SVG. */
const PRIMARY = 'rgba(24, 24, 27, 1)';
const PRIMARY_FOREGROUND = 'rgba(250, 250, 250, 1)';
const MUTED_FOREGROUND = 'rgba(113, 113, 122, 1)';
const GLASS_FOREGROUND = 'rgba(9, 9, 11, 1)';

/** How wide the dock lays out in these tests, in px. */
const WIDTH = 370;

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

/**
 * The platform, as `SystemInfo` reports it. Provided rather than stubbed as
 * a global: the router's setup switches the testing library's threads, which
 * puts back its own SystemInfo before the dock reads it.
 */
const onPlatform = (platform: { platform: string; osVersion: string }) => ({
  provide: LynxSystemInfo,
  useValue: platform,
});

const renderDock = async (
  platform: { platform: string; osVersion: string },
  providers: Provider[] = [],
) => {
  const result = await render(DockHost, {
    providers: [
      provideRouter(routes),
      onPlatform(platform),
      { provide: LynxAccessibilitySettings, useValue: settings },
      ...providers,
    ],
  });
  const { container } = result;
  const host = result.componentRef.instance as DockHost;
  const injector = result.componentRef.injector;
  const router = injector.get(Router);
  const state = injector.get(UiDockState);

  /**
   * An item's host, the accessibility element named by its label.
   */
  const item = (label: string) =>
    container.querySelector<HTMLElement>(`[accessibility-label^="${label}"]`)!;
  const isSelected = (label: string) =>
    item(label).getAttribute('accessibility-traits') === 'button,selected';
  /**
   * The glass group, and the glass shapes in it.
   */
  const stage = () => container.querySelector<HTMLElement>('[ui-glass-group]')!;
  /**
   * The dock's host, the group's parent.
   */
  const dock = () => stage().parentElement!;
  const shapes = () =>
    Array.from(stage().children).filter((child) =>
      child.hasAttribute('ui-glass'),
    ) as HTMLElement[];
  const bar = () => row().parentElement!;
  const row = () =>
    container.querySelector<HTMLElement>('[accessibility-traits="tabbar"]')!;
  const accessory = () =>
    shapes().find((shape) => shape.querySelector('[ui-dock-accessory]'));
  /**
   * The action's glass, and the button in it.
   */
  const action = () => shapes().find((shape) => shape.contains(button()));
  const button = () =>
    container.querySelector<HTMLElement>('[accessibility-label="Search"]');
  const capsule = () => row().firstElementChild as HTMLElement;
  const restore = () =>
    bar().querySelector<HTMLElement>('[accessibility-label="Show tab bar"]');
  const iconOf = (element: Element) =>
    element.querySelector('svg')!.getAttribute('content') ?? '';
  const labelOf = (label: string) =>
    Array.from(item(label).querySelectorAll('text')).find(
      (text) => text.textContent === label,
    )!;
  const page = () =>
    Array.from(container.querySelectorAll('text'))
      .map((text) => text.textContent ?? '')
      .find((text) => text.endsWith(' page'));
  /**
   * Lays the dock out, as Lynx reports its width after the first frame.
   */
  const layOut = async (width = WIDTH) => {
    fireEvent.layoutchange(dock().firstElementChild!, {
      detail: { width, height: 0 },
    });
    await waitForUpdate();
  };
  const minimize = async (minimized = true) => {
    state.minimized.set(minimized);
    await waitForUpdate();
  };
  await until(() => isSelected('Home'));
  return {
    ...result,
    host,
    router,
    state,
    item,
    isSelected,
    dock,
    stage,
    shapes,
    bar,
    row,
    accessory,
    action,
    button,
    capsule,
    restore,
    iconOf,
    labelOf,
    page,
    layOut,
    minimize,
  };
};

const style = (element: HTMLElement, name: string) =>
  element.style.getPropertyValue(name);

// Item, page and icon selectors aren't Lynx elements, so the renderer falls
// back to a <view> for each and warns.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  settings.reduceMotion.set(false);
});

describe('UiDock on iOS 26 and later', () => {
  it('floats a glass bar, the action beside it and the accessory above, in one glass group', async () => {
    const { dock, stage, shapes, bar, accessory, action } =
      await renderDock(IOS_26);

    expect(dock().classList).toContain('absolute');
    expect(dock().classList).toContain('bottom-0');
    // It clears the home indicator, floating a little above it.
    expect(dock().classList).toContain('pb-safe-2');
    expect(stage().getAttribute('blur-effect')).toBe('glass-container');
    expect(stage().getAttribute('spacing')).toBe('8');

    // The accessory, the bar and the action are the group's glass shapes.
    expect(shapes()).toHaveLength(3);
    for (const shape of shapes()) {
      expect(shape.getAttribute('blur-effect')).toBe('glass');
      expect(shape.getAttribute('glass-interactive')).toBe('true');
    }
    expect(bar().classList).toContain('rounded-full');
    expect(action()?.classList).toContain('rounded-full');

    // Bottom up: the bar and the action share a row, the accessory above.
    expect(style(stage(), 'height')).toBe('120px');
    expect(style(bar(), 'right')).toBe('72px');
    expect(style(bar(), 'height')).toBe('62px');
    expect(style(action()!, 'width')).toBe('62px');
    expect(style(action()!, 'bottom')).toBe('0px');
    expect(style(accessory()!, 'bottom')).toBe('72px');
    expect(style(accessory()!, 'height')).toBe('48px');
    expect(style(accessory()!, 'left')).toBe('0px');
    expect(style(accessory()!, 'right')).toBe('0px');
  });

  it('puts the accessory and the action in their glass, and draws icons there in the glass foreground', async () => {
    const { accessory, action, iconOf } = await renderDock(IOS_26);
    expect(accessory()?.textContent).toContain('Now playing');
    expect(iconOf(accessory()!)).toContain(GLASS_FOREGROUND);
    expect(action()).toBeTruthy();
  });

  it('leaves out the accessory and the action without them', async () => {
    const { host, shapes, stage, bar, accessory, action } =
      await renderDock(IOS_26);
    host.accessory.set(false);
    host.action.set(false);
    await waitForUpdate();

    expect(shapes()).toHaveLength(1);
    expect(accessory()).toBeUndefined();
    expect(action()).toBeUndefined();
    expect(style(stage(), 'height')).toBe('62px');
    expect(style(bar(), 'right')).toBe('0px');
  });

  it('marks the selected item with a capsule that slides to the item tapped', async () => {
    const { item, capsule, isSelected, page, labelOf, iconOf } =
      await renderDock(IOS_26);

    // Three items share the row, so the capsule is a third of it, and moves
    // by its own width per item.
    expect(style(capsule(), 'width')).toBe('33.333333333333336%');
    expect(style(capsule(), 'transform')).toBe('translateX(0%)');
    expect(style(capsule(), 'opacity')).toBe('0.1');
    expect(style(capsule(), 'transition')).toContain('transform');
    expect(labelOf('Home').classList).toContain('text-primary');
    expect(iconOf(item('Home'))).toContain(PRIMARY);
    expect(labelOf('Inbox').classList).toContain('text-glass-foreground');
    expect(iconOf(item('Inbox'))).toContain(GLASS_FOREGROUND);

    fireEvent.tap(item('Inbox'));
    await until(() => page() === 'Inbox page');
    await until(() => isSelected('Inbox'));
    expect(style(capsule(), 'transform')).toBe('translateX(100%)');
    expect(isSelected('Home')).toBe(false);
  });

  it('selects the action while its route is active, and hides the capsule', async () => {
    const { button, capsule, isSelected, page, iconOf } =
      await renderDock(IOS_26);
    expect(iconOf(button()!)).toContain(GLASS_FOREGROUND);

    fireEvent.tap(button()!);
    await until(() => page() === 'Search page');
    await until(
      () =>
        button()!.getAttribute('accessibility-traits') === 'button,selected',
    );
    expect(iconOf(button()!)).toContain(PRIMARY);
    expect(isSelected('Home')).toBe(false);
    expect(style(capsule(), 'opacity')).toBe('0');
  });

  it('reads to a screen reader as a tab bar, the current item selected', async () => {
    const { getByRole, queryByRole } = await renderDock(IOS_26);
    expect(getByRole('tablist')).toBeTruthy();
    expect(getByRole('button', { name: 'Home', selected: true })).toBeTruthy();
    expect(queryByRole('button', { name: 'Inbox', selected: true })).toBeNull();
    expect(getByRole('button', { name: 'Search' })).toBeTruthy();
  });

  it('keeps the bar whole until it knows its width, then lays the row out at it', async () => {
    const { row, minimize, layOut, restore } = await renderDock(IOS_26);
    expect(style(row(), 'width')).toBe('');

    // Minimizing needs the width to shrink from.
    await minimize();
    expect(restore()).toBeNull();
    expect(style(row(), 'opacity')).toBe('1');

    await layOut();
    // The bar's width less its padding: 370 - 62 - 10 - 2 × 4.
    expect(style(row(), 'width')).toBe('290px');
    expect(restore()).toBeTruthy();
  });

  it('minimizes to the selected icon, with the accessory between it and the action', async () => {
    const {
      stage,
      bar,
      row,
      accessory,
      action,
      restore,
      iconOf,
      minimize,
      layOut,
      state,
    } = await renderDock(IOS_26);
    await layOut();
    expect(style(row(), 'transition')).toContain('opacity');

    await minimize();
    expect(style(stage(), 'height')).toBe('48px');
    // The bar shrinks to a 48px circle at the left…
    expect(style(bar(), 'right')).toBe(`${WIDTH - 48}px`);
    expect(style(bar(), 'height')).toBe('48px');
    // …the action to one at the right…
    expect(style(action()!, 'width')).toBe('48px');
    expect(style(action()!, 'height')).toBe('48px');
    // …and the accessory moves down between them.
    expect(style(accessory()!, 'left')).toBe('58px');
    expect(style(accessory()!, 'right')).toBe('58px');
    expect(style(accessory()!, 'bottom')).toBe('0px');
    expect(style(accessory()!, 'height')).toBe('48px');
    // The shapes move and resize with a transition, which the glass follows.
    expect(style(bar(), 'transition')).toContain('right');

    // The items fade out of the way, and out of a screen reader's reach.
    expect(style(row(), 'opacity')).toBe('0');
    expect(row().getAttribute('accessibility-elements-hidden')).toBe('true');
    // The minimized bar is one button that brings the dock back.
    expect(iconOf(restore()!)).toContain(PRIMARY);
    expect(restore()!.getAttribute('accessibility-value')).toBe('Home');

    fireEvent.tap(restore()!);
    await waitForUpdate();
    expect(state.minimized()).toBe(false);
    expect(restore()).toBeNull();
    expect(style(bar(), 'height')).toBe('62px');
    expect(style(row(), 'opacity')).toBe('1');
    expect(row().hasAttribute('accessibility-elements-hidden')).toBe(false);
  });

  it('minimizes without an action or accessory, the bar alone at the left', async () => {
    const { host, accessory, bar, minimize, layOut } = await renderDock(IOS_26);
    host.action.set(false);
    await waitForUpdate();
    await layOut();
    await minimize();
    expect(style(bar(), 'right')).toBe(`${WIDTH - 48}px`);

    host.accessory.set(true);
    await waitForUpdate();
    expect(style(accessory()!, 'right')).toBe('0px');
  });

  it('shows the first item on the minimized bar while the action is selected', async () => {
    const { button, restore, iconOf, minimize, layOut, page } =
      await renderDock(IOS_26);
    fireEvent.tap(button()!);
    await until(() => page() === 'Search page');
    await layOut();
    await minimize();
    await until(() => !restore()!.hasAttribute('accessibility-value'));
    // The home icon, in the selected color.
    expect(iconOf(restore()!)).toContain(PRIMARY);
  });

  it('fades the minimized icon in, but not under Reduce Motion', async () => {
    const { minimize, layOut, capsule, bar, row } = await renderDock(IOS_26);
    const animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    /**
     * How many animations started: `__ElementAnimate`'s 0 starts one.
     */
    const started = () =>
      animate.mock.calls.filter(([, args]) => args[0] === 0).length;
    await layOut();
    await minimize();
    expect(started()).toBe(1);

    await minimize(false);
    settings.reduceMotion.set(true);
    await waitForUpdate();
    await minimize();
    expect(started()).toBe(1);
    // Nothing slides, shrinks or fades either: it changes at once.
    expect(style(bar(), 'transition')).toBe('none');
    expect(style(row(), 'transition')).toBe('none');
    expect(style(capsule(), 'transition')).toBe('none');
  });

  it("uses the dock's class and expand label", async () => {
    const { host, dock, restore, bar, minimize, layOut } =
      await renderDock(IOS_26);
    host.dockClass.set('px-6');
    host.expandLabel.set('Show tabs');
    await waitForUpdate();
    expect(dock().classList).toContain('px-6');
    expect(dock().classList).not.toContain('px-4');

    await layOut();
    await minimize();
    expect(restore()).toBeNull();
    expect(
      bar().querySelector('[accessibility-label="Show tabs"]'),
    ).toBeTruthy();
  });
});

describe('UiDock on iOS 15 to 25', () => {
  it("runs edge to edge on the bars' chrome material, over the home indicator", async () => {
    const { dock, stage, bar, row, action, accessory, capsule } =
      await renderDock(IOS_18);

    expect(dock().classList).not.toContain('px-4');
    expect(stage().getAttribute('blur-effect')).toBe('light');
    expect(bar().getAttribute('blur-effect')).toBe('extra-light');
    for (const shape of [bar(), action()!, accessory()!]) {
      expect(shape.getAttribute('blur-material')).toBe('chrome');
    }
    expect(bar().classList).toContain('pb-safe');
    expect(action()?.classList).toContain('pb-safe');
    expect(row().classList).toContain('h-[49px]');
    // A hairline along the top of the bar and the action.
    expect(bar().querySelector('.bg-border')).toBeTruthy();
    expect(action()?.querySelector('.bg-border')).toBeTruthy();
    expect(style(bar(), 'right')).toBe('64px');
    expect(style(action()!, 'width')).toBe('64px');
    expect(style(accessory()!, 'left')).toBe('8px');
    expect(style(accessory()!, 'border-radius')).toBe('12px');
    // No capsule: the selected item takes the primary color.
    expect(style(capsule(), 'opacity')).toBe('0');
  });

  it('marks the selected item in the primary color and the others gray', async () => {
    const { item, labelOf, iconOf, action } = await renderDock(IOS_18);
    expect(labelOf('Home').classList).toContain('text-primary');
    expect(iconOf(item('Home'))).toContain(PRIMARY);
    expect(labelOf('Inbox').classList).toContain('text-muted-foreground');
    expect(iconOf(item('Inbox'))).toContain(MUTED_FOREGROUND);
    // The action is a tinted bar button.
    expect(iconOf(action()!)).toContain(PRIMARY);
  });

  it("doesn't minimize, as Apple's tab bars didn't", async () => {
    const { host, stage, minimize, layOut, restore, row } =
      await renderDock(IOS_18);
    await layOut();
    await minimize();
    expect(restore()).toBeNull();
    expect(style(row(), 'opacity')).toBe('1');
    expect(style(row(), 'width')).toBe('');

    host.accessory.set(false);
    host.action.set(false);
    await waitForUpdate();
    expect(stage().getAttribute('style')).toContain('height');
  });
});

describe('UiDock on Android', () => {
  it('floats a Material toolbar, with an indicator behind the selected icon and a floating action button', async () => {
    const { bar, action, accessory, item, labelOf, iconOf } =
      await renderDock(ANDROID);

    // Solid surfaces with an elevation shadow, not glass.
    expect(bar().classList).toContain('bg-secondary');
    expect(style(bar(), 'box-shadow')).not.toBe('');
    expect(bar().classList).toContain('rounded-full');
    expect(style(bar(), 'height')).toBe('64px');
    // The button is filled with the primary color, and centered on the bar.
    // (jsdom writes the theme's rgba(…, 1) as rgb().)
    expect(style(action()!, 'background-color')).toBe('rgb(24, 24, 27)');
    expect(style(action()!, 'border-radius')).toBe('16px');
    expect(style(action()!, 'bottom')).toBe('4px');
    expect(iconOf(action()!)).toContain(PRIMARY_FOREGROUND);
    expect(style(accessory()!, 'border-radius')).toBe('16px');

    const indicator = (label: string) =>
      item(label).querySelector<HTMLElement>('.bg-primary')!;
    expect(style(indicator('Home'), 'opacity')).toBe('1');
    expect(style(indicator('Home'), 'transform')).toBe('scaleX(1)');
    expect(iconOf(item('Home'))).toContain(PRIMARY_FOREGROUND);
    expect(labelOf('Home').classList).toContain('text-foreground');
    expect(labelOf('Home').classList).toContain('text-xs');
    expect(style(indicator('Inbox'), 'opacity')).toBe('0');
    expect(style(indicator('Inbox'), 'transform')).toBe('scaleX(0.5)');
    expect(iconOf(item('Inbox'))).toContain(MUTED_FOREGROUND);
    expect(labelOf('Inbox').classList).toContain('text-muted-foreground');
  });

  it('widens the indicator on the item tapped, at once under Reduce Motion', async () => {
    const { item, page, isSelected } = await renderDock(ANDROID);
    const indicator = (label: string) =>
      item(label).querySelector<HTMLElement>('.bg-primary')!;
    fireEvent.tap(item('Inbox'));
    await until(() => page() === 'Inbox page');
    await until(() => isSelected('Inbox'));
    expect(style(indicator('Inbox'), 'transition')).toContain('transform');
    // It leaves the item it moves from at once.
    expect(style(indicator('Home'), 'transition')).toBe('none');

    settings.reduceMotion.set(true);
    await waitForUpdate();
    expect(style(indicator('Inbox'), 'transition')).toBe('none');
  });

  it('slides the toolbar and the accessory away when minimized, and keeps the button', async () => {
    const { bar, accessory, action, stage, minimize, layOut } =
      await renderDock(ANDROID);
    await layOut();
    expect(style(bar(), 'transform')).toBe('translateY(0px)');

    await minimize();
    expect(style(bar(), 'transform')).toBe('translateY(128px)');
    expect(style(accessory()!, 'transform')).toBe('translateY(196px)');
    expect(style(action()!, 'width')).toBe('56px');
    expect(style(stage(), 'height')).toBe('132px');
  });

  it('draws glass when the app opts in', async () => {
    const { bar } = await renderDock(ANDROID, [
      provideGlass({ android: 'glass' }),
    ]);
    expect(bar().getAttribute('blur-effect')).toBe('glass');
    expect(bar().classList).not.toContain('bg-secondary');
  });
});

describe('UiDockItem', () => {
  it("navigates with the item's RouterLink options", async () => {
    const { router, item, isSelected } = await renderDock(IOS_26);
    fireEvent.tap(item('Profile'));
    await until(() => isSelected('Profile'));
    expect(router.url).toBe('/profile?tab=posts');
  });

  it('emits pressed for every tap, the selected item too', async () => {
    const { item, router, host } = await renderDock(IOS_26);
    const pressed = vi.fn();
    host.items()[0].pressed.subscribe(pressed);
    fireEvent.tap(item('Home'));
    await waitForUpdate();
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(router.url).toBe('/');
  });

  it("shows a badge over the icon, and says it after the item's name", async () => {
    const { host, item } = await renderDock(IOS_26);
    const badge = () =>
      Array.from(item('Inbox').querySelectorAll('text')).find(
        (text) => text.textContent !== 'Inbox',
      );
    expect(badge()).toBeUndefined();

    host.badge.set(3);
    await waitForUpdate();
    expect(badge()?.textContent).toBe('3');
    expect(badge()?.parentElement?.classList).toContain('bg-destructive');
    expect(item('Inbox').getAttribute('accessibility-label')).toBe('Inbox, 3');

    for (const empty of [0, '', null, undefined]) {
      host.badge.set(empty);
      await waitForUpdate();
      expect(badge()).toBeUndefined();
      expect(item('Inbox').getAttribute('accessibility-label')).toBe('Inbox');
    }
  });

  it('shrinks an item while it is pressed', async () => {
    const { item } = await renderDock(IOS_26);
    const inbox = item('Inbox');
    const scale = () => inbox.style.getPropertyValue('transform');

    fireEvent.touchstart(inbox);
    expect(scale()).toBe('scale(0.97)');
    fireEvent.touchend(inbox);
    expect(scale()).toBe('scale(1)');
    fireEvent.touchstart(inbox);
    fireEvent.touchcancel(inbox);
    expect(scale()).toBe('scale(1)');
    fireEvent.mousedown(inbox);
    expect(scale()).toBe('scale(0.97)');
    fireEvent.mouseup(inbox);
    expect(scale()).toBe('scale(1)');
    fireEvent.mousedown(inbox);
    fireLynxEvent(inbox, 'mouseleave');
    expect(scale()).toBe('scale(1)');
  });

  it("merges an item's class into its content, the given class winning", async () => {
    const { host, item } = await renderDock(IOS_26);
    const content = () => item('Inbox').querySelector('view')!;
    expect(content().classList).toContain('gap-0.5');

    host.inboxClass.set('gap-2');
    await waitForUpdate();
    expect(content().classList).toContain('gap-2');
    expect(content().classList).not.toContain('gap-0.5');
  });
});

describe('UiDockAction', () => {
  it('emits pressed for an action without a route, and shrinks while pressed', async () => {
    const { container, componentRef } = await render(ActionOnlyHost, {
      providers: [
        provideRouter(routes),
        onPlatform(IOS_26),
        { provide: LynxAccessibilitySettings, useValue: settings },
      ],
    });
    const host = componentRef.instance as ActionOnlyHost;
    const button = container.querySelector<HTMLElement>(
      '[accessibility-label="New message"]',
    )!;
    fireEvent.tap(button);
    await waitForUpdate();
    expect(host.taps()).toBe(1);

    const scale = () => button.style.getPropertyValue('transform');
    fireEvent.touchstart(button);
    expect(scale()).toBe('scale(0.97)');
    fireEvent.touchend(button);
    expect(scale()).toBe('scale(1)');
    fireEvent.mousedown(button);
    fireEvent.mouseup(button);
    expect(scale()).toBe('scale(1)');
    fireEvent.touchcancel(button);
    fireLynxEvent(button, 'mouseleave');
    expect(scale()).toBe('scale(1)');
  });

  it('minimizes to an empty bar with no items', async () => {
    const { container, componentRef } = await render(ActionOnlyHost, {
      providers: [
        provideRouter(routes),
        onPlatform(IOS_26),
        { provide: LynxAccessibilitySettings, useValue: settings },
      ],
    });
    fireEvent.layoutchange(
      container.querySelector('[ui-glass-group]')!.previousElementSibling!,
      { detail: { width: WIDTH, height: 0 } },
    );
    componentRef.injector.get(UiDockState).minimized.set(true);
    await waitForUpdate();
    const restore = container.querySelector(
      '[accessibility-label="Show tab bar"]',
    )!;
    expect(restore.querySelector('svg')?.getAttribute('content') ?? '').toBe(
      '',
    );
    expect(restore.hasAttribute('accessibility-value')).toBe(false);
  });
});
