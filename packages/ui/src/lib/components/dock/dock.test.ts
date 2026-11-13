import {
  Component,
  ErrorHandler,
  type Provider,
  signal,
  viewChildren,
} from '@angular/core';
import { Router, RouterOutlet, type Routes } from '@angular/router';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxStackChrome,
  LynxSystemInfo,
  type StackBarMotion,
  provideRouter,
} from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { lynxMainThread } from '../../../test-utils/lynx-main-thread';
import { UiIcon } from '../icon/icon';
import { type IconName } from '../icon/icons';
import { provideGlass } from '../glass/glass-design';
import { UiDock, UiDockAccessory, UiDockAction, UiDockItem } from './dock';
import { UiDockState } from './dock-scroll';

/**
 * `value` as the DOM writes it back for `property`. jsdom 31 serializes
 * styles the way browsers do (six significant digits, so a third is
 * `33.3333%`; a shadow's color first; `0.00%` as `0%`), where older versions
 * hand them back as set. Comparing through it keeps this spec passing on
 * either, as dolan copies it into apps that may pin an older jsdom. A
 * property the DOM doesn't know comes back as set.
 */
const serialized = (property: string, value: string): string => {
  const probe = document.createElement('div');
  probe.style.setProperty(property, value);
  return probe.style.getPropertyValue(property) || value;
};

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

@Component({
  imports: [UiDock, UiDockItem],
  template: `
    <ui-dock>
      <ui-dock-item route="/" icon="home" label="Home" class="pt-4" />
    </ui-dock>
  `,
})
class StaticClassHost {}

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

/** A one-color mark, written as an app would: no namespace. */
const MARK =
  '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Z"/></svg>';
const MARK_PATH = 'd="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Z"';

/** A multi-color mark, which already has the namespace. */
const TWO_COLOR_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><path fill="#4285f4" d="M0 0h1v1H0z"/><path fill="#34a853" d="M1 0h1v1H1z"/></svg>';

/**
 * A dock whose items and action draw the app's own marks, as an app puts its
 * logo on the Home item.
 */
@Component({
  imports: [RouterOutlet, UiDock, UiDockAction, UiDockItem],
  template: `
    <router-outlet />
    <ui-dock>
      <ui-dock-item
        route="/"
        [svg]="mark"
        label="Home"
        [routerLinkActiveOptions]="{ exact: true }"
      />
      <ui-dock-item route="/inbox" [svg]="mark" label="Inbox" />
      <ui-dock-item route="/profile" [svg]="twoColorMark" label="Profile" />
      <ui-dock-action route="/search" [svg]="mark" label="Search" />
    </ui-dock>
  `,
})
class SvgDockHost {
  readonly mark = MARK;
  readonly twoColorMark = TWO_COLOR_MARK;
}

/**
 * An item and an action whose icon and svg a test sets, to get them wrong.
 */
@Component({
  imports: [UiDock, UiDockAction, UiDockItem],
  template: `
    <ui-dock>
      <ui-dock-item
        route="/"
        [icon]="itemIcon()"
        [svg]="itemSvg()"
        label="Home"
      />
      <ui-dock-action
        [icon]="actionIcon()"
        [svg]="actionSvg()"
        label="New message"
      />
    </ui-dock>
  `,
})
class IconOrSvgHost {
  readonly itemIcon = signal<IconName | undefined>('home');
  readonly itemSvg = signal<string | undefined>(undefined);
  readonly actionIcon = signal<IconName | undefined>('plus');
  readonly actionSvg = signal<string | undefined>(undefined);
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
  /**
   * The view around the group, which stops the shapes' taps while the stack
   * has the dock away.
   */
  const shield = () => stage().parentElement!;
  const dock = () => shield().parentElement!;
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
    shield,
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
    expect(style(capsule(), 'width')).toBe(serialized('width', `${100 / 3}%`));
    expect(style(capsule(), 'transform')).toBe('translateX(0%)');
    expect(style(capsule(), 'opacity')).toBe('0.1');
    // A shade of the glass's foreground, not of the primary color.
    expect(capsule().classList).toContain('bg-glass-foreground');
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
  it('floats a Material toolbar, with a capsule behind the selected item and a floating action button', async () => {
    const { bar, action, accessory, item, capsule, labelOf, iconOf } =
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

    // The capsule is behind the whole item, not a pill behind its icon: it's
    // the row's own, one item wide and as tall as the row, in a tint of the
    // primary color.
    expect(capsule().classList).toContain('bg-primary');
    expect(capsule().classList).toContain('top-0');
    expect(capsule().classList).toContain('bottom-0');
    expect(style(capsule(), 'width')).toBe(serialized('width', `${100 / 3}%`));
    expect(style(capsule(), 'opacity')).toBe('0.12');
    expect(item('Home').querySelector('.bg-primary')).toBeNull();
    // So the selected item is drawn in the primary color, over the tint.
    expect(iconOf(item('Home'))).toContain(PRIMARY);
    expect(labelOf('Home').classList).toContain('text-primary');
    expect(labelOf('Home').classList).toContain('font-semibold');
    expect(labelOf('Home').classList).toContain('text-xs');
    expect(iconOf(item('Inbox'))).toContain(MUTED_FOREGROUND);
    expect(labelOf('Inbox').classList).toContain('text-muted-foreground');
  });

  it('slides the capsule to the item tapped, at once under Reduce Motion', async () => {
    const { item, capsule, page, isSelected } = await renderDock(ANDROID);
    expect(style(capsule(), 'transform')).toBe('translateX(0%)');
    fireEvent.tap(item('Inbox'));
    await until(() => page() === 'Inbox page');
    await until(() => isSelected('Inbox'));
    expect(style(capsule(), 'transform')).toBe('translateX(100%)');
    expect(style(capsule(), 'transition')).toContain('transform');

    settings.reduceMotion.set(true);
    await waitForUpdate();
    expect(style(capsule(), 'transition')).toBe('none');
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

describe('UiDock in a stack', () => {
  /**
   * What a `<lynx-stack-outlet>` says through LynxStackChrome, as a test
   * sets it: a chrome of its own, which the dock's LynxStackBottomBar
   * follows. No page carries the dock here (no outlet does); a page that
   * does leaves it as it is at rest (see LynxStackBottomBar).
   */
  class TestChrome extends LynxStackChrome {
    override readonly bottomBarHidden = signal(false);
    override readonly bottomBarProgress = signal(0);
    override readonly bottomBarMotion = signal<StackBarMotion>({
      animation: 'ios',
      duration: 0,
      easing: 'linear',
      coveredX: -0.3,
    });
  }
  const chrome = new TestChrome();
  const stack = { provide: LynxStackChrome, useValue: chrome };
  const IOS_PUSH: StackBarMotion = {
    animation: 'ios',
    duration: 350,
    easing: 'cubic-bezier(0.32, 0.68, 0.12, 1)',
    coveredX: -0.3,
  };
  /**
   * Sets what the stack says, and lets the dock follow.
   */
  const moveTo = async (
    progress: number,
    motion: Partial<StackBarMotion> = {},
    hidden = progress > 0,
  ) => {
    chrome.bottomBarHidden.set(hidden);
    chrome.bottomBarProgress.set(progress);
    chrome.bottomBarMotion.set({ ...IOS_PUSH, duration: 0, ...motion });
    await waitForUpdate();
  };

  afterEach(() => moveTo(0));

  it("slides down off the screen where no page carries it, on the pages' curve", async () => {
    const { dock, shield } = await renderDock(IOS_26, [stack]);
    expect(style(dock(), 'transform')).toBe('translateY(0%)');
    expect(dock().hasAttribute('accessibility-elements-hidden')).toBe(false);
    expect(shield().getAttribute('user-interaction-enabled')).toBe('true');

    await moveTo(1, IOS_PUSH);
    expect(style(dock(), 'transform')).toBe('translateY(100%)');
    expect(style(dock(), 'transition')).toBe(
      'transform 350ms cubic-bezier(0.32, 0.68, 0.12, 1)',
    );
    expect(dock().getAttribute('accessibility-elements-hidden')).toBe('true');
    expect(shield().getAttribute('user-interaction-enabled')).toBe('false');

    // A finger drags the page half way back: the dock follows at once.
    await moveTo(0.5, {}, true);
    expect(style(dock(), 'transform')).toBe('translateY(50%)');
    expect(style(dock(), 'transition')).toBe('');

    await moveTo(0);
    expect(style(dock(), 'transform')).toBe('translateY(0%)');
    expect(shield().getAttribute('user-interaction-enabled')).toBe('true');
  });

  it('slides down off the screen as Android pages move', async () => {
    const { dock } = await renderDock(ANDROID, [stack]);
    await moveTo(1, {
      animation: 'material',
      duration: 450,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
    });
    expect(style(dock(), 'transform')).toBe('translateY(100%)');
    expect(style(dock(), 'transition')).toBe(
      'transform 450ms cubic-bezier(0.2, 0, 0, 1)',
    );
    expect(dock().classList).not.toContain('overflow-hidden');
  });

  it('goes at once while the pages cross-fade under Reduce Motion', async () => {
    const { dock } = await renderDock(IOS_26, [stack]);
    await moveTo(1, { animation: 'fade', duration: 250 });
    expect(style(dock(), 'transform')).toBe('translateY(100%)');
    expect(style(dock(), 'transition')).toBe('');
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

  it("merges an item's class with its own, the given class winning", async () => {
    const { host, item } = await renderDock(IOS_26);
    expect(item('Inbox').classList).toContain('gap-0.5');

    host.inboxClass.set('gap-2');
    await waitForUpdate();
    expect(item('Inbox').classList).toContain('gap-2');
    expect(item('Inbox').classList).not.toContain('gap-0.5');
  });

  // Angular gives a component's host every static attribute written on it,
  // so an item that also styled a view inside its host applied the class
  // twice (issue #181).
  it('puts a class written on an item on that one element', async () => {
    const { container } = await render(StaticClassHost, {
      providers: [
        provideRouter(routes),
        onPlatform(IOS_26),
        { provide: LynxAccessibilitySettings, useValue: settings },
      ],
    });
    expect([...container.querySelectorAll('.pt-4')]).toEqual([
      container.querySelector('[accessibility-label="Home"]'),
    ]);
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
      container.querySelector('[ui-glass-group]')!.parentElement!
        .previousElementSibling!,
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

describe("UiDock with an app's own marks", () => {
  const renderSvgDock = async (platform: {
    platform: string;
    osVersion: string;
  }) => {
    const result = await render(SvgDockHost, {
      providers: [
        provideRouter(routes),
        onPlatform(platform),
        { provide: LynxAccessibilitySettings, useValue: settings },
      ],
    });
    const { container } = result;
    const item = (label: string) =>
      container.querySelector<HTMLElement>(`[accessibility-label="${label}"]`)!;
    const isSelected = (label: string) =>
      item(label).getAttribute('accessibility-traits') === 'button,selected';
    const iconOf = (label: string) =>
      item(label).querySelector('svg')!.getAttribute('content') ?? '';
    await until(() => isSelected('Home'));
    return { ...result, item, isSelected, iconOf };
  };

  it("draws an item's mark in its color for its state, as the set's icons are drawn", async () => {
    const { item, isSelected, iconOf } = await renderSvgDock(IOS_26);
    expect(iconOf('Home')).toContain(MARK_PATH);
    expect(iconOf('Home')).toContain(`fill="${PRIMARY}"`);
    expect(iconOf('Home')).not.toContain('currentColor');
    expect(iconOf('Inbox')).toContain(`fill="${GLASS_FOREGROUND}"`);

    // The selection moves the color with it.
    fireEvent.tap(item('Inbox'));
    await until(() => isSelected('Inbox'));
    expect(iconOf('Inbox')).toContain(`fill="${PRIMARY}"`);
    expect(iconOf('Home')).toContain(`fill="${GLASS_FOREGROUND}"`);
  });

  it("draws the action's mark in the button's color", async () => {
    const { iconOf } = await renderSvgDock(IOS_26);
    expect(iconOf('Search')).toContain(MARK_PATH);
    expect(iconOf('Search')).toContain(`fill="${GLASS_FOREGROUND}"`);

    const android = await renderSvgDock(ANDROID);
    expect(android.iconOf('Search')).toContain(`fill="${PRIMARY_FOREGROUND}"`);
    expect(android.iconOf('Inbox')).toContain(`fill="${MUTED_FOREGROUND}"`);
  });

  // The web preview draws the markup as an image, which a browser leaves
  // blank without the namespace.
  it('adds the SVG namespace when the markup has none, and keeps colors written out', async () => {
    const { iconOf } = await renderSvgDock(IOS_26);
    expect(iconOf('Home')).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 16 16">/,
    );
    expect(iconOf('Search')).toMatch(/^<svg xmlns=/);
    expect(iconOf('Profile')).toBe(TWO_COLOR_MARK);
  });

  it("minimizes to the selected item's mark, in the primary color", async () => {
    const { container, componentRef } = await renderSvgDock(IOS_26);
    fireEvent.layoutchange(
      container.querySelector('[ui-glass-group]')!.parentElement!
        .previousElementSibling!,
      { detail: { width: WIDTH, height: 0 } },
    );
    componentRef.injector.get(UiDockState).minimized.set(true);
    await waitForUpdate();
    const restore = container.querySelector(
      '[accessibility-label="Show tab bar"]',
    )!;
    const icon = restore.querySelector('svg')!.getAttribute('content') ?? '';
    expect(icon).toMatch(/^<svg xmlns=/);
    expect(icon).toContain(MARK_PATH);
    expect(icon).toContain(`fill="${PRIMARY}"`);
  });
});

describe('UiDockItem and UiDockAction without exactly one of icon and svg', () => {
  const ITEM = new Error('<ui-dock-item> needs an icon or an svg, not both.');
  const ACTION = new Error(
    '<ui-dock-action> needs an icon or an svg, not both.',
  );

  /**
   * Renders the host, keeping the errors Angular reports: an error in change
   * detection goes to the app's ErrorHandler rather than out of render().
   */
  const renderIconOrSvg = async () => {
    const handleError = vi.fn();
    const result = await render(IconOrSvgHost, {
      providers: [
        provideRouter(routes),
        onPlatform(IOS_26),
        { provide: LynxAccessibilitySettings, useValue: settings },
        { provide: ErrorHandler, useValue: { handleError } },
      ],
    });
    const host = result.componentRef.instance as IconOrSvgHost;
    /**
     * Sets the host's inputs, and the errors the change reports.
     */
    const change = async (set: () => void) => {
      handleError.mockClear();
      set();
      await waitForUpdate();
      return handleError.mock.calls.map(([error]) => error);
    };
    return { host, handleError, change };
  };

  it("reports an item's error with both, or neither", async () => {
    const { host, handleError, change } = await renderIconOrSvg();
    expect(handleError).not.toHaveBeenCalled();

    expect(await change(() => host.itemSvg.set(MARK))).toContainEqual(ITEM);
    // The svg alone is right.
    expect(await change(() => host.itemIcon.set(undefined))).toEqual([]);
    expect(await change(() => host.itemSvg.set(undefined))).toContainEqual(
      ITEM,
    );
  });

  it("reports an action's error with both, or neither", async () => {
    const { host, change } = await renderIconOrSvg();
    expect(await change(() => host.actionSvg.set(MARK))).toContainEqual(ACTION);
    expect(await change(() => host.actionIcon.set(undefined))).toEqual([]);
    expect(await change(() => host.actionSvg.set(undefined))).toContainEqual(
      ACTION,
    );
  });
});
