import { Component, type Provider, signal, viewChild } from '@angular/core';
import { RouterOutlet, type Routes } from '@angular/router';
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
import { UiSearchField } from '../search-field/search-field';
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
  { path: 'search', component: SearchPage },
];

/**
 * A dock that searches: a search tab, or with `route` null, an action that
 * opens the field over the screen.
 */
@Component({
  imports: [
    LYNX_ELEMENTS,
    RouterOutlet,
    UiDock,
    UiDockAccessory,
    UiDockAction,
    UiDockItem,
    UiSearchField,
  ],
  template: `
    <router-outlet />
    <ui-dock>
      @if (accessory()) {
        <view ui-dock-accessory><text>Now playing</text></view>
      }
      @if (items()) {
        <ui-dock-item
          route="/"
          icon="home"
          label="Home"
          [routerLinkActiveOptions]="{ exact: true }"
        />
        <ui-dock-item route="/inbox" icon="inbox" label="Inbox" />
      }
      @if (action()) {
        <ui-dock-action [route]="route()" icon="search" label="Search" />
      }
      @if (field()) {
        <ui-search-field
          placeholder="Search mail"
          [cancelable]="cancelable()"
          [value]="query()"
          (valueChange)="query.set($event)"
        />
      }
    </ui-dock>
  `,
})
class SearchDockHost {
  readonly accessory = signal(true);
  readonly items = signal(true);
  readonly action = signal(true);
  readonly field = signal(true);
  readonly route = signal<string | null>('/search');
  readonly cancelable = signal(true);
  readonly query = signal('');
  readonly searchField = viewChild(UiSearchField);
}

/** Accessibility settings a test can change, as the host app would. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

/** A phone's screen: 402×874pt, as LynxSystemInfo reports it. */
const SCREEN = { pixelRatio: 3, screenHeight: 874 };
const IOS_26 = { platform: 'iOS', osVersion: '26.0', ...SCREEN };
const IOS_18 = { platform: 'iOS', osVersion: '18.5', ...SCREEN };
const ANDROID = { platform: 'Android', osVersion: '15', ...SCREEN };

/** How wide the dock lays out in these tests, in px. */
const WIDTH = 370;

/**
 * The Lynx function that runs an element's UI methods: focusing an input,
 * or measuring an element (`boundingClientRect`).
 */
type InvokeUIMethod = {
  __InvokeUIMethod: (
    element: Element,
    method: string,
    params: Record<string, unknown>,
    callback: (result: { code: number; data?: unknown }) => void,
  ) => void;
};

/** Whether `boundingClientRect` fails, as it does where nothing's laid out. */
let measuringFails = false;

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

const renderDock = async (
  platform: Record<string, unknown>,
  setUp: (host: SearchDockHost) => void = () => {},
  providers: Provider[] = [],
) => {
  // The dock and the page sit at the bottom of the screen.
  const invoke = vi
    .spyOn(globalThis as unknown as InvokeUIMethod, '__InvokeUIMethod')
    .mockImplementation((_element, method, _params, callback) => {
      if (method !== 'boundingClientRect') {
        callback({ code: 0 });
      } else if (measuringFails) {
        callback({ code: 1 });
      } else {
        callback({ code: 0, data: { left: 0, top: 0, bottom: 874 } });
      }
    });
  const result = await render(SearchDockHost, {
    providers: [
      provideRouter(routes),
      { provide: LynxSystemInfo, useValue: platform },
      { provide: LynxAccessibilitySettings, useValue: settings },
      ...providers,
    ],
  });
  const { container } = result;
  const host = result.componentRef.instance as SearchDockHost;
  setUp(host);
  await waitForUpdate();
  const state = result.componentRef.injector.get(UiDockState);

  const stage = () => container.querySelector<HTMLElement>('[ui-glass-group]')!;
  const dock = () => stage().parentElement!;
  const shapes = () =>
    Array.from(stage().children).filter((child) =>
      child.hasAttribute('ui-glass'),
    ) as HTMLElement[];
  const input = () => container.querySelector<HTMLElement>('input')!;
  /**
   * The field's shape: the glass the field is in.
   */
  const search = () =>
    shapes().find((shape) => shape.contains(input())) as HTMLElement;
  const searchContent = () => search().lastElementChild as HTMLElement;
  const button = () =>
    container.querySelector<HTMLElement>('[accessibility-label="Search"]')!;
  const action = () => shapes().find((shape) => shape.contains(button()))!;
  const row = () =>
    container.querySelector<HTMLElement>('[accessibility-traits="tabbar"]')!;
  const bar = () => row().parentElement!;
  const accessory = () =>
    shapes().find((shape) => shape.querySelector('[ui-dock-accessory]'));
  const cancel = () =>
    shapes().find(
      (shape) => shape.getAttribute('accessibility-label') === 'Cancel',
    );
  const restore = () =>
    bar().querySelector<HTMLElement>('[accessibility-label="Show tab bar"]');
  const page = () =>
    Array.from(container.querySelectorAll('text'))
      .map((text) => text.textContent ?? '')
      .find((text) => text.endsWith(' page'));
  const methods = () => invoke.mock.calls.map(([, method]) => method);
  const layOut = async () => {
    fireEvent.layoutchange(dock().firstElementChild!, {
      detail: { width: WIDTH, height: 0 },
    });
    await waitForUpdate();
  };
  /**
   * Opens the search by the action, as a person does.
   */
  const openSearch = async () => {
    fireEvent.tap(button());
    await until(() => searchContent()?.style.opacity === '1');
  };
  const keyboard = async (height: number) => {
    fireLynxEvent(input(), 'keyboardheightchange', { detail: { height } });
    await waitForUpdate();
    await waitForUpdate();
  };
  await until(() => page() === 'Home page');
  await layOut();
  return {
    ...result,
    host,
    state,
    invoke,
    stage,
    dock,
    shapes,
    input,
    search,
    searchContent,
    button,
    action,
    row,
    bar,
    accessory,
    cancel,
    restore,
    page,
    methods,
    layOut,
    openSearch,
    keyboard,
  };
};

const style = (element: HTMLElement, name: string) =>
  element.style.getPropertyValue(name);

// Item, page and field selectors aren't Lynx elements, so the renderer
// falls back to a <view> for each and warns.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  settings.reduceMotion.set(false);
  measuringFails = false;
});

describe('UiDock with a search field, on iOS 26 and later', () => {
  it('keeps the field folded into the action, out of sight, until the search opens', async () => {
    const { shapes, search, searchContent, cancel, input } =
      await renderDock(IOS_26);

    // The accessory, the bar, the action, the field's glass and its Cancel.
    expect(shapes()).toHaveLength(5);
    // The field draws no glass of its own inside the dock's.
    expect(search().querySelectorAll('[ui-glass]')).toHaveLength(0);
    expect(search().classList).toContain('rounded-full');
    // A point at the action's center: 62px wide, at the dock's right.
    expect(style(search(), 'left')).toBe(`${WIDTH - 31}px`);
    expect(style(search(), 'right')).toBe('31px');
    expect(style(search(), 'bottom')).toBe('31px');
    expect(style(search(), 'height')).toBe('0px');
    expect(style(cancel()!, 'height')).toBe('0px');
    expect(style(searchContent(), 'opacity')).toBe('0');
    expect(searchContent().getAttribute('accessibility-elements-hidden')).toBe(
      'true',
    );
    expect(input().getAttribute('placeholder')).toBe('Search mail');
  });

  it('grows the field out of the search tab across the bottom, and shrinks the bar to a button back', async () => {
    const rendered = await renderDock(IOS_26);
    const { stage, bar, row, action, search, searchContent, accessory } =
      rendered;
    await rendered.openSearch();
    expect(rendered.page()).toBe('Search page');

    // The bar is a 48px circle at the left, showing the item it goes back to.
    expect(style(bar(), 'right')).toBe(`${WIDTH - 48}px`);
    expect(style(bar(), 'height')).toBe('48px');
    expect(row().getAttribute('accessibility-elements-hidden')).toBe('true');
    expect(rendered.restore()?.getAttribute('accessibility-value')).toBe(
      'Home',
    );
    // The field fills the rest, as tall as the button.
    expect(style(search(), 'left')).toBe('58px');
    expect(style(search(), 'right')).toBe('0px');
    expect(style(search(), 'bottom')).toBe('0px');
    expect(style(search(), 'height')).toBe('48px');
    expect(style(searchContent(), 'transition')).toContain('opacity');
    expect(searchContent().hasAttribute('accessibility-elements-hidden')).toBe(
      false,
    );
    // The action shrinks into the field's end, out of a screen reader's way.
    expect(style(action(), 'width')).toBe('0px');
    expect(style(action(), 'right')).toBe('24px');
    expect(action().getAttribute('accessibility-elements-hidden')).toBe('true');
    // Its icon fades, so it doesn't show through the field.
    expect(style(rendered.button(), 'opacity')).toBe('0');
    expect(style(rendered.button(), 'transition')).toContain('opacity');
    // The accessory stays above, across the dock.
    expect(style(accessory()!, 'bottom')).toBe('58px');
    expect(style(accessory()!, 'left')).toBe('0px');
    expect(style(stage(), 'height')).toBe('106px');
  });

  it('doesn’t minimize while it searches', async () => {
    const rendered = await renderDock(IOS_26);
    await rendered.openSearch();
    rendered.state.minimized.set(true);
    await waitForUpdate();
    expect(style(rendered.search(), 'height')).toBe('48px');
  });

  it('grows Cancel out of the field while it’s in use, which clears it and keeps the search tab open', async () => {
    const rendered = await renderDock(IOS_26);
    const { host, search, cancel, input } = rendered;
    await rendered.openSearch();
    expect(style(cancel()!, 'bottom')).toBe('24px');

    fireEvent.focus(input());
    await waitForUpdate();
    expect(style(cancel()!, 'left')).toBe(`${WIDTH - 48}px`);
    expect(style(cancel()!, 'height')).toBe('48px');
    expect(style(search(), 'right')).toBe('58px');
    expect(
      style(
        cancel()!.querySelector('svg') as unknown as HTMLElement,
        'opacity',
      ),
    ).toBe('1');

    fireEvent.input(input(), { detail: { value: 'invoices' } });
    fireEvent.tap(cancel()!);
    await waitForUpdate();
    expect(host.query()).toBe('');
    expect(rendered.methods()).toContain('blur');
    expect(rendered.page()).toBe('Search page');
    expect(style(search(), 'height')).toBe('48px');
  });

  it('leaves Cancel out for a field that isn’t cancelable', async () => {
    const { shapes } = await renderDock(IOS_26, (host) =>
      host.cancelable.set(false),
    );
    expect(shapes()).toHaveLength(4);
  });

  it('goes back to the last item from the bar’s button, and closes the keyboard', async () => {
    const rendered = await renderDock(IOS_26);
    await rendered.openSearch();
    rendered.invoke.mockClear();

    fireEvent.tap(rendered.restore()!);
    await until(() => rendered.page() === 'Home page');
    await until(() => style(rendered.search(), 'height') === '0px');
    expect(rendered.methods()).toContain('blur');
    expect(rendered.restore()).toBeNull();
  });

  it('opens the field over the screen from an action without a route, and gives it the keyboard', async () => {
    const rendered = await renderDock(IOS_26, (host) => host.route.set(null));
    const { state, search, cancel, input } = rendered;
    await rendered.openSearch();
    expect(state.searching()).toBe(true);
    expect(rendered.page()).toBe('Home page');
    expect(rendered.methods()).toContain('focus');
    // The bar's button shows the item that's selected.
    expect(rendered.restore()?.getAttribute('accessibility-value')).toBe(
      'Home',
    );

    // Its Cancel closes the search.
    fireEvent.focus(input());
    await waitForUpdate();
    fireEvent.tap(cancel()!);
    await until(() => style(search(), 'height') === '0px');
    expect(state.searching()).toBe(false);
  });

  it('closes a search the bar’s button ends, without going anywhere', async () => {
    const rendered = await renderDock(IOS_26, (host) => host.route.set(null));
    await rendered.openSearch();
    fireEvent.tap(rendered.restore()!);
    await waitForUpdate();
    expect(rendered.state.searching()).toBe(false);
    expect(rendered.page()).toBe('Home page');
  });

  it('goes back to the first item from a search no item came before', async () => {
    const rendered = await renderDock(IOS_26, (host) => host.items.set(false));
    await rendered.openSearch();
    rendered.host.items.set(true);
    await waitForUpdate();
    expect(rendered.restore()?.hasAttribute('accessibility-value')).toBe(false);

    fireEvent.tap(rendered.restore()!);
    await until(() => rendered.page() === 'Home page');
  });

  it('closes the search when its field goes', async () => {
    const rendered = await renderDock(IOS_26, (host) => host.route.set(null));
    await rendered.openSearch();
    rendered.host.field.set(false);
    await waitForUpdate();
    expect(rendered.shapes()).toHaveLength(3);
  });

  it('searches only with an action to open the field', async () => {
    const rendered = await renderDock(IOS_26, (host) => host.action.set(false));
    rendered.state.searching.set(true);
    await waitForUpdate();
    expect(rendered.input()).toBeNull();
    // Canceled from code, the field has no search to close.
    rendered.host.searchField()?.cancel();
    await waitForUpdate();
    expect(rendered.state.searching()).toBe(false);
  });

  it('rises with its field above the keyboard, and settles as it closes', async () => {
    const rendered = await renderDock(IOS_26);
    const { dock } = rendered;
    await rendered.openSearch();
    expect(style(dock(), 'transition')).toContain('padding-bottom');

    // The dock ends at the screen's bottom: a 336pt keyboard covers 336pt of
    // it, and the dock floats 8pt above.
    await rendered.keyboard(336);
    await until(() => style(dock(), 'padding-bottom') === '344px');

    await rendered.keyboard(0);
    expect(style(dock(), 'padding-bottom')).toBe('');
  });

  it('drops a keyboard measure that a newer change has overtaken', async () => {
    const rendered = await renderDock(IOS_26);
    await rendered.openSearch();
    let answer: (() => void) | undefined;
    rendered.invoke.mockImplementation(
      (_element, _method, _params, callback) => {
        answer = () => callback({ code: 0, data: { bottom: 874 } });
      },
    );

    fireLynxEvent(rendered.input(), 'keyboardheightchange', {
      detail: { height: 336 },
    });
    await waitForUpdate();
    await rendered.keyboard(0);
    answer?.();
    await waitForUpdate();
    expect(style(rendered.dock(), 'padding-bottom')).toBe('');
  });

  it('stays down where the dock can’t be measured', async () => {
    const rendered = await renderDock(IOS_26);
    await rendered.openSearch();
    measuringFails = true;
    await rendered.keyboard(336);
    expect(style(rendered.dock(), 'padding-bottom')).toBe('');
  });

  it('grows, shrinks and rises without moving under Reduce Motion', async () => {
    settings.reduceMotion.set(true);
    const rendered = await renderDock(IOS_26);
    await rendered.openSearch();
    expect(style(rendered.search(), 'transition')).toBe('none');
    expect(style(rendered.searchContent(), 'transition')).toBe('none');
    expect(style(rendered.dock(), 'transition')).toBe('');
    expect(style(rendered.button(), 'opacity')).toBe('0');
    expect(style(rendered.button(), 'transition')).toBe('');
  });

  it('folds the field into the minimized action, with Cancel', async () => {
    const rendered = await renderDock(IOS_26);
    rendered.state.minimized.set(true);
    await waitForUpdate();
    expect(style(rendered.search(), 'left')).toBe(`${WIDTH - 24}px`);
    expect(style(rendered.cancel()!, 'bottom')).toBe('24px');
  });
});

describe('UiDock with a search field, on iOS 15 to 25', () => {
  it('opens UISearchBar’s field in a bar above the tab bar, which stays', async () => {
    const rendered = await renderDock(IOS_18);
    const { stage, search, searchContent, accessory, row } = rendered;
    expect(style(search(), 'height')).toBe('0px');
    expect(style(search(), 'transition')).toContain('height');

    await rendered.openSearch();
    expect(search().querySelector('.h-\\[0\\.5px\\]')).toBeTruthy();
    expect(search().classList).not.toContain('rounded-full');
    expect(style(search(), 'height')).toBe('52px');
    expect(style(search(), 'bottom')).toBe(
      'calc(49px + env(safe-area-inset-bottom))',
    );
    expect(searchContent().classList).toContain('px-[8px]');
    // The field keeps its own fill on the bar.
    expect(searchContent().querySelector('.bg-muted')).toBeTruthy();
    // The accessory moves up above it; the tab bar's items stay.
    expect(style(accessory()!, 'bottom')).toBe(
      'calc(109px + env(safe-area-inset-bottom))',
    );
    expect(style(stage(), 'height')).toBe(
      'calc(157px + env(safe-area-inset-bottom))',
    );
    expect(row().hasAttribute('accessibility-elements-hidden')).toBe(false);
  });

  it('puts the field’s bar on the keyboard, with the tab bar under it', async () => {
    const rendered = await renderDock(IOS_18);
    await rendered.openSearch();
    await rendered.keyboard(336);
    await until(
      () =>
        style(rendered.dock(), 'padding-bottom') ===
        'calc(287px - env(safe-area-inset-bottom))',
    );
  });

  it('keeps the search tab open on Cancel', async () => {
    const rendered = await renderDock(IOS_18);
    await rendered.openSearch();
    fireEvent.focus(rendered.input());
    await waitForUpdate();
    fireEvent.tap(rendered.getByRole('button', { name: 'Cancel' }));
    await waitForUpdate();
    expect(rendered.page()).toBe('Search page');
    expect(style(rendered.search(), 'height')).toBe('52px');
  });
});

describe('UiDock with a search field, on Android', () => {
  it('grows the floating action button into a search bar, and slides the toolbar away', async () => {
    const rendered = await renderDock(ANDROID);
    const { bar, action, search } = rendered;
    // At rest, a point at the button's center.
    expect(style(search(), 'right')).toBe('28px');
    expect(style(search(), 'bottom')).toBe('32px');
    expect(rendered.cancel()).toBeUndefined();

    await rendered.openSearch();
    expect(style(bar(), 'transform')).toBe('translateY(128px)');
    expect(style(action(), 'width')).toBe('0px');
    expect(style(action(), 'bottom')).toBe('32px');
    expect(style(search(), 'left')).toBe('0px');
    expect(style(search(), 'right')).toBe('0px');
    expect(style(search(), 'bottom')).toBe('4px');
    expect(style(search(), 'height')).toBe('56px');
    expect(rendered.row().getAttribute('accessibility-elements-hidden')).toBe(
      'true',
    );
  });

  it('goes back from the search bar’s back arrow', async () => {
    const rendered = await renderDock(ANDROID, (host) =>
      host.cancelable.set(false),
    );
    await rendered.openSearch();
    fireEvent.tap(rendered.getByRole('button', { name: 'Cancel' }));
    await until(() => rendered.page() === 'Home page');
  });
});

describe('UiDock with a search field and no items', () => {
  it('stays on the search tab, with nowhere to go back to', async () => {
    const rendered = await renderDock(IOS_26, (host) => host.items.set(false));
    await rendered.openSearch();
    fireEvent.tap(rendered.restore()!);
    await waitForUpdate();
    expect(rendered.page()).toBe('Search page');
  });
});
