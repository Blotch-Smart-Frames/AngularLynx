import {
  Component,
  ElementRef,
  type Provider,
  signal,
  viewChild,
} from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxStackPage,
  LynxTabPage,
} from '@blotch/angular-lynx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { provideGlass } from '../glass/glass-design';
import {
  BAR_SCROLL_ITEM_KEYS,
  injectBarState,
  UiBarScroll,
  UiBarState,
} from './bar-scroll';

@Component({
  imports: [LYNX_ELEMENTS, UiBarScroll],
  template: `
    @if (first()) {
      <scroll-view ui-bar-scroll id="first" scroll-orientation="vertical">
        <view style="height: 2000px"></view>
      </scroll-view>
    }
    @if (second()) {
      <scroll-view ui-bar-scroll id="second" scroll-orientation="vertical">
        <view style="height: 2000px"></view>
      </scroll-view>
    }
  `,
})
class ScrollHost {
  readonly first = signal(true);
  readonly second = signal(false);
}

/**
 * A screen with something beside its large title, as an app would put an
 * account's picture or a status there.
 */
@Component({
  imports: [LYNX_ELEMENTS, UiBarScroll],
  template: `
    <scroll-view ui-bar-scroll id="first" scroll-orientation="vertical">
      <text largeTitleAccessory>3 unread</text>
      <text>The content</text>
    </scroll-view>
  `,
})
class AccessoryHost {}

/**
 * A long feed in a `<list>`, under the bars, with something beside its large
 * title.
 */
@Component({
  imports: [LYNX_ELEMENTS, UiBarScroll],
  template: `
    <list ui-bar-scroll id="feed" scroll-orientation="vertical">
      <text largeTitleAccessory>3 unread</text>
      @for (row of rows(); track row) {
        <list-item [attr.item-key]="row"
          ><text>{{ row }}</text></list-item
        >
      }
    </list>
  `,
})
class ListHost {
  readonly rows = signal(['first', 'second']);
  readonly list = viewChild.required(UiBarScroll, { read: ElementRef });
}

/**
 * A `<list>` that says itself how often it sends `scroll`.
 */
@Component({
  imports: [LYNX_ELEMENTS, UiBarScroll],
  template: `
    <list
      ui-bar-scroll
      id="feed"
      scroll-orientation="vertical"
      [scroll-event-throttle]="100"
    ></list>
  `,
})
class ThrottledListHost {}

const IOS_26 = { platform: 'iOS', osVersion: '26.0' };
const IOS_18 = { platform: 'iOS', osVersion: '18.5' };
const ANDROID = { platform: 'Android', osVersion: '15' };
const WEB = { platform: 'web', osVersion: '' };

/**
 * The bars a screen would have, as a navigation bar and a toolbar say.
 */
const topBar = (largeTitle: string | null = null) => ({
  height: signal(44),
  largeTitle: signal(largeTitle),
});
const bottomBar = () => ({ height: signal(52) });

/**
 * A bar whose title opens a menu, as a navigation bar with `titleMenu` says.
 */
const menuBar = (largeTitle: string) => ({
  ...topBar(largeTitle),
  titleMenu: signal(true),
  titlePressed: vi.fn<() => void>(),
});

/** Accessibility settings a test can change, as the host app would. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

/** The theme's light foreground, as icon-theme.ts resolves it for an SVG. */
const FOREGROUND = 'rgba(9, 9, 11, 1)';

const renderScroll = async (
  platform: { platform: string; osVersion: string } = IOS_26,
  providers: Provider[] = [],
) => {
  vi.stubGlobal('SystemInfo', platform);
  const result = await render(ScrollHost, { providers });
  const host = result.componentRef.instance as ScrollHost;
  const state = result.componentRef.injector.get(UiBarState);
  const scrollView = (id = 'first') =>
    result.container.querySelector<HTMLElement>(`#${id}`)!;
  /**
   * The spacers the scroll view puts at its ends for the bars.
   */
  const topSpacer = () => firstShown(scrollView());
  const bottomSpacer = () => lastShown(scrollView());
  const update = async (change: () => void) => {
    change();
    await waitForUpdate();
  };
  /**
   * Scrolls the content to `scrollTop`, as Lynx reports it.
   */
  const scrollTo = (scrollTop: number, id = 'first') =>
    fireEvent.scroll(scrollView(id), {
      detail: { scrollTop, scrollHeight: 2000 },
    });
  /**
   * Lays the scroll view out `height` px tall, and its spacers.
   */
  const layOut = async (height: number, top = 0, bottom = 0) => {
    fireEvent.layoutchange(scrollView(), { detail: { width: 402, height } });
    fireEvent.layoutchange(topSpacer(), {
      detail: { width: 402, height: top },
    });
    fireEvent.layoutchange(bottomSpacer(), {
      detail: { width: 402, height: bottom },
    });
    await waitForUpdate();
  };
  return {
    ...result,
    host,
    state,
    scrollView,
    topSpacer,
    bottomSpacer,
    update,
    scrollTo,
    layOut,
  };
};

/**
 * The children of `parent` that are drawn: Angular's anchors for `@if` and
 * the like are hidden views, which may come before a spacer or after it.
 */
const shown = (parent: Element): HTMLElement[] =>
  (Array.from(parent.children) as HTMLElement[]).filter(
    (child) => child.style.display !== 'none',
  );
const firstShown = (parent: Element): HTMLElement => shown(parent)[0]!;
const lastShown = (parent: Element): HTMLElement => shown(parent).at(-1)!;

/**
 * A mask's [how much shows, where] stops, however the DOM writes it back:
 * jsdom versions differ, writing opaque black as `rgb(0, 0, 0)` and leaving
 * out the default `to bottom`.
 */
const stopsIn = (mask: string): [number, string][] =>
  Array.from(
    mask.matchAll(
      /rgba?\(0, 0, 0(?:, ([\d.]+))?\) (calc\([^)]*\)|[\d.]+(?:%|px))/g,
    ),
    ([, alpha, at]): [number, string] => [
      alpha === undefined ? 1 : Number(alpha),
      at,
    ],
  );

/**
 * The scroll view's mask as stops.
 */
const maskStops = (element: HTMLElement): [number, string][] =>
  stopsIn(element.style.getPropertyValue('mask-image'));

/**
 * The stops a mask drawn with `stops` has once the DOM writes it back. jsdom
 * 31 serializes it the way browsers do (`10.00%` as `10%`, and
 * `calc(100% - 0px)` as `calc(100% + 0px)`), where older versions hand it
 * back as set. dolan copies this spec into apps that may pin either, so it
 * compares through the DOM rather than with one version's strings.
 */
const asWritten = (stops: [number, string][]): [number, string][] => {
  const gradient = `linear-gradient(to bottom, ${stops
    .map(([shows, at]) => `rgba(0, 0, 0, ${shows}) ${at}`)
    .join(', ')})`;
  const probe = document.createElement('div');
  probe.style.setProperty('mask-image', gradient);
  return stopsIn(probe.style.getPropertyValue('mask-image') || gradient);
};

afterEach(() => {
  vi.unstubAllGlobals();
  settings.reduceMotion.set(false);
});

/**
 * A bar of its own, which takes the bar state of its screen.
 */
@Component({ template: '' })
class BarProbe {
  readonly state = injectBarState();
}

/**
 * A component that holds a screen of its own, as a sheet does.
 */
@Component({ template: '', providers: [UiBarState] })
class OwnBarProbe {
  readonly state = injectBarState();
}

describe('injectBarState', () => {
  it("is the root's off a stack page", async () => {
    const { componentRef } = await render(BarProbe);
    expect(componentRef.instance.state).toBe(
      componentRef.injector.get(UiBarState),
    );
  });

  it("is each stack page's own on one, the same for all of the page's", async () => {
    const page = new LynxStackPage();
    const first = await render(BarProbe, {
      providers: [{ provide: LynxStackPage, useValue: page }],
    });
    const root = first.componentRef.injector.get(UiBarState);
    const own = first.componentRef.instance.state;
    expect(own).not.toBe(root);
    first.unmount();

    const again = await render(BarProbe, {
      providers: [{ provide: LynxStackPage, useValue: page }],
    });
    expect(again.componentRef.instance.state).toBe(own);
    again.unmount();

    const other = await render(BarProbe, {
      providers: [{ provide: LynxStackPage, useValue: new LynxStackPage() }],
    });
    expect(other.componentRef.instance.state).not.toBe(own);
  });

  it("is each tab's own in one, and a stack page's on a page in a tab", async () => {
    const tab = new LynxTabPage();
    const first = await render(BarProbe, {
      providers: [{ provide: LynxTabPage, useValue: tab }],
    });
    const own = first.componentRef.instance.state;
    expect(own).not.toBe(first.componentRef.injector.get(UiBarState));
    first.unmount();

    const again = await render(BarProbe, {
      providers: [{ provide: LynxTabPage, useValue: tab }],
    });
    expect(again.componentRef.instance.state).toBe(own);
    again.unmount();

    // A page of a stack in the tab has its own.
    const paged = await render(BarProbe, {
      providers: [
        { provide: LynxTabPage, useValue: tab },
        { provide: LynxStackPage, useValue: new LynxStackPage() },
      ],
    });
    expect(paged.componentRef.instance.state).not.toBe(own);
  });

  it("is a component's own when it provides one, on a stack page too", async () => {
    const { componentRef } = await render(OwnBarProbe, {
      providers: [{ provide: LynxStackPage, useValue: new LynxStackPage() }],
    });
    expect(componentRef.instance.state).toBe(
      componentRef.injector.get(UiBarState),
    );
    expect(componentRef.instance.state).not.toBe(
      componentRef.injector.get(UiBarState, null, { skipSelf: true }),
    );
  });
});

describe('UiBarScroll', () => {
  it('makes no room and draws no edge without bars over it', async () => {
    const { topSpacer, bottomSpacer, scrollView, layOut, queryByRole } =
      await renderScroll();
    await layOut(800);
    expect(topSpacer().style.height).toBe('');
    expect(bottomSpacer().style.height).toBe('');
    expect(scrollView().style.getPropertyValue('mask-image')).toBe('');
    expect(queryByRole('heading')).toBeNull();
  });

  it('starts the content below the top bar and ends it above the bottom bar', async () => {
    const { state, topSpacer, bottomSpacer, update } = await renderScroll();
    await update(() => {
      state.topBar.set(topBar());
      state.bottomBar.set(bottomBar());
    });
    // The status bar and the home indicator count too. jsdom versions write
    // the sum in different orders.
    expect(topSpacer().style.height).toContain('44px');
    expect(topSpacer().style.height).toContain('env(safe-area-inset-top)');
    expect(bottomSpacer().style.height).toContain('52px');
    expect(bottomSpacer().style.height).toContain(
      'env(safe-area-inset-bottom)',
    );
  });

  it('puts the large title at the top of the content, and tells the bar when it has scrolled under', async () => {
    const { state, update, getByRole, scrollTo } = await renderScroll();
    await update(() => state.topBar.set(topBar('Inbox')));
    const title = getByRole('heading', { name: 'Inbox' });
    expect(title.className).toContain('text-[34px]');
    expect(title.parentElement?.className).toContain('h-[52px]');

    scrollTo(20);
    expect(state.scrolledUnderTop()).toBe(true);
    expect(state.largeTitleUnder()).toBe(false);
    scrollTo(44);
    expect(state.largeTitleUnder()).toBe(true);
    scrollTo(0);
    expect(state.scrolledUnderTop()).toBe(false);
    expect(state.largeTitleUnder()).toBe(false);
  });

  it('draws Material’s large title, the medium flexible app bar’s', async () => {
    const { state, update, getByRole, scrollTo } = await renderScroll(ANDROID);
    await update(() => state.topBar.set(topBar('Inbox')));
    const title = getByRole('heading', { name: 'Inbox' });
    expect(title.className).toContain('text-[28px]');
    expect(title.parentElement?.className).toContain('h-[48px]');
    scrollTo(40);
    expect(state.largeTitleUnder()).toBe(true);
  });

  it('says whether content continues under the bottom bar', async () => {
    const { state, scrollView, scrollTo, layOut } = await renderScroll();
    // Before the scroll view is laid out, it can't tell.
    scrollTo(0);
    expect(state.scrolledUnderBottom()).toBe(false);

    await layOut(800);
    expect(state.scrolledUnderBottom()).toBe(true);
    scrollTo(1200);
    expect(state.scrolledUnderBottom()).toBe(false);

    // iOS and Android say when the content's height changes.
    fireLynxEvent(scrollView(), 'contentsizechanged', {
      detail: { scrollTop: 1200, scrollHeight: 2400 },
    });
    expect(state.scrolledUnderBottom()).toBe(true);
  });

  it('fades content out under glass bars, from their measured room', async () => {
    const { state, scrollView, update, layOut } = await renderScroll();
    await update(() => {
      state.topBar.set(topBar());
      state.bottomBar.set(bottomBar());
    });
    // Not laid out yet: no edge.
    expect(scrollView().style.getPropertyValue('mask-image')).toBe('');

    // 1000px tall, with 100px for the top bar and 50px for the bottom one.
    await layOut(1000, 100, 50);
    expect(scrollView().style.getPropertyValue('mask-image')).toContain(
      'linear-gradient(',
    );
    expect(maskStops(scrollView())).toEqual(
      asWritten([
        [0, '0.00%'],
        [0, '7.00%'],
        [0.12, '9.00%'],
        [1, '10.00%'],
        [1, '95.00%'],
        [0.12, '95.50%'],
        [0, '96.50%'],
        [0, '100.00%'],
      ]),
    );

    // A top bar alone fades the top only, and a bottom bar alone the bottom.
    await layOut(1000, 100, 0);
    expect(maskStops(scrollView()).slice(-2)).toEqual(
      asWritten([
        [1, '10.00%'],
        [1, '100.00%'],
      ]),
    );
    await layOut(1000, 0, 50);
    expect(maskStops(scrollView()).slice(0, 2)).toEqual(
      asWritten([
        [1, '0.00%'],
        [1, '95.00%'],
      ]),
    );
  });

  it('fades with lengths in the web preview, whose scroll view reports no layout', async () => {
    const { state, scrollView, update, topSpacer, bottomSpacer } =
      await renderScroll(WEB);
    await update(() => {
      state.topBar.set(topBar());
      state.bottomBar.set(bottomBar());
    });
    fireEvent.layoutchange(topSpacer(), {
      detail: { width: 402, height: 100 },
    });
    await waitForUpdate();
    expect(maskStops(scrollView())).toEqual(
      asWritten([
        [0, '0px'],
        [0, '70px'],
        [0.12, '90px'],
        [1, '100px'],
        [1, 'calc(100% - 0px)'],
      ]),
    );

    fireEvent.layoutchange(bottomSpacer(), {
      detail: { width: 402, height: 50 },
    });
    await waitForUpdate();
    expect(maskStops(scrollView()).slice(-4)).toEqual(
      asWritten([
        [1, 'calc(100% - 50px)'],
        [0.12, 'calc(100% - 45px)'],
        [0, 'calc(100% - 35px)'],
        [0, 'calc(100% - 0px)'],
      ]),
    );
  });

  it('leaves the edge to Android’s glass bars, as its scroll view takes no mask', async () => {
    vi.stubGlobal('SystemInfo', ANDROID);
    const result = await render(ScrollHost, {
      providers: [provideGlass({ android: 'glass' })],
    });
    const state = result.componentRef.injector.get(UiBarState);
    state.topBar.set(topBar());
    await waitForUpdate();
    const scrollView = result.container.querySelector<HTMLElement>('#first')!;
    fireEvent.layoutchange(scrollView, {
      detail: { width: 402, height: 1000 },
    });
    fireEvent.layoutchange(firstShown(scrollView), {
      detail: { width: 402, height: 100 },
    });
    await waitForUpdate();
    expect(scrollView.style.getPropertyValue('mask-image')).toBe('');
  });

  it('leaves the edge to the bars before iOS 26, which mark it with their background', async () => {
    const { state, scrollView, update, layOut } = await renderScroll(IOS_18);
    await update(() => state.topBar.set(topBar()));
    await layOut(1000, 100);
    expect(scrollView().style.getPropertyValue('mask-image')).toBe('');
  });

  it('lets the last scroll view tell the bars, and resets them when it goes', async () => {
    const { host, state, update, scrollTo } = await renderScroll();
    scrollTo(200);
    expect(state.scrolledUnderTop()).toBe(true);

    // A second scroll view, a sheet's say, takes over.
    await update(() => host.second.set(true));
    scrollTo(0, 'second');
    expect(state.scrolledUnderTop()).toBe(false);
    scrollTo(200);
    expect(state.scrolledUnderTop()).toBe(false);

    // The first going leaves the second's state alone.
    scrollTo(300, 'second');
    await update(() => host.first.set(false));
    expect(state.scrolledUnderTop()).toBe(true);
    expect(state.content()).not.toBeNull();

    // The last going resets it, for the next screen.
    await update(() => host.second.set(false));
    expect(state.content()).toBeNull();
    expect(state.scrolledUnderTop()).toBe(false);
  });
});

describe('UiBarScroll with an accessory beside the large title', () => {
  const renderAccessory = async (
    platform: { platform: string; osVersion: string } = IOS_26,
  ) => {
    vi.stubGlobal('SystemInfo', platform);
    const result = await render(AccessoryHost);
    const state = result.componentRef.injector.get(UiBarState);
    const update = async (change: () => void) => {
      change();
      await waitForUpdate();
    };
    return { ...result, state, update };
  };

  it('puts it at the end of the title’s line, centered on the title, and lets the title give way', async () => {
    const { state, update, getByRole, getByText } = await renderAccessory();
    await update(() => state.topBar.set(topBar('Inbox')));
    const title = getByRole('heading', { name: 'Inbox' });
    const band = title.parentElement!;
    const box = getByText('3 unread').parentElement!;
    // On the title's line, after it, with the row's ends between them.
    expect(box.parentElement).toBe(band);
    expect(Array.from(band.children).indexOf(box)).toBeGreaterThan(
      Array.from(band.children).indexOf(title),
    );
    expect(band.className).toContain('flex-row');
    expect(band.className).toContain('justify-between');
    expect(band.className).toContain('items-end');
    // As tall as the title's line, so the accessory centers on it.
    expect(box.className).toContain('h-[41px]');
    expect(box.className).toContain('items-center');
    // It keeps its width, and the title shortens before it.
    expect(box.className).toContain('shrink-0');
    expect(title.className).toContain('shrink');
    expect(title.className).toContain('min-w-0');
    // The rest of the content stays below the title's band.
    expect(getByText('The content').parentElement).not.toBe(band);
  });

  it('ends a long plain title with "…" on its one line, before the accessory', async () => {
    const { state, update, getByRole, getByText } = await renderAccessory();
    const long = 'Everything that arrived while you were away';
    await update(() => state.topBar.set(topBar(long)));
    const title = getByRole('heading', { name: long });
    // A <text> wraps unless it's told its lines, and a second line would
    // leave the title's band: the accessory takes some of the row.
    expect(title.getAttribute('text-maxline')).toBe('1');
    expect(title.className).toContain('text-ellipsis');
    // The title is what gives way, and the accessory stays on its line.
    expect(title.className).toContain('shrink');
    expect(getByText('3 unread').parentElement?.parentElement).toBe(
      title.parentElement,
    );
  });

  it('keeps it beside a title that opens a menu', async () => {
    const { state, update, getByRole, getByText } = await renderAccessory();
    await update(() => state.topBar.set(menuBar('Inbox')));
    const band = getByRole('button', { name: 'Inbox' }).parentElement!;
    expect(getByText('3 unread').parentElement?.parentElement).toBe(band);
  });

  it('sizes its box to Material’s title line', async () => {
    const { state, update, getByText } = await renderAccessory(ANDROID);
    await update(() => state.topBar.set(topBar('Inbox')));
    expect(getByText('3 unread').parentElement?.className).toContain(
      'h-[36px]',
    );
  });

  it('draws it only with a large title, which it scrolls away with', async () => {
    const { state, update, queryByText, getByText } = await renderAccessory();
    // No bar, and a bar with no large title, have no line to put it on.
    expect(queryByText('3 unread')).toBeNull();
    await update(() => state.topBar.set(topBar()));
    expect(queryByText('3 unread')).toBeNull();
    expect(getByText('The content')).toBeTruthy();

    await update(() => state.topBar.set(topBar('Inbox')));
    expect(getByText('3 unread')).toBeTruthy();
  });
});

describe('UiBarScroll under a bar whose title opens a menu', () => {
  it('makes the large title a button with a chevron after it, and tells the bar when it’s tapped', async () => {
    const { state, update, getByRole, queryByRole } = await renderScroll();
    const bar = menuBar('Inbox');
    await update(() => state.topBar.set(bar));
    const button = getByRole('button', { name: 'Inbox' });
    // One element for screen readers, still the screen's heading.
    expect(getByRole('heading', { name: 'Inbox' })).toBe(button);
    // It keeps the title's type and band, and to the title's own width.
    const [text, chevron] = Array.from(button.children) as HTMLElement[];
    expect(text?.textContent).toBe('Inbox');
    expect(text?.className).toContain('text-[34px]');
    expect(button.parentElement?.className).toContain('h-[52px]');
    // A long title ends with "…" on its one line, inside the screen.
    expect(text?.getAttribute('text-maxline')).toBe('1');
    expect(text?.className).toContain('text-ellipsis');
    expect(button.classList).toContain('shrink');
    expect(button.classList).toContain('min-w-0');
    // A chevron pointing down, in the title's color and to its size.
    expect(chevron?.localName).toBe('svg');
    expect(chevron?.classList).toContain('shrink-0');
    expect(chevron?.getAttribute('content')).toContain('m6 9 6 6 6-6');
    expect(chevron?.getAttribute('content')).toContain(FOREGROUND);
    expect(chevron?.style.width).toBe('34px');
    expect(chevron?.style.height).toBe('34px');

    fireEvent.tap(button);
    expect(bar.titlePressed).toHaveBeenCalledTimes(1);

    // A plain title again once the bar's opens no menu.
    await update(() => bar.titleMenu.set(false));
    expect(queryByRole('button', { name: 'Inbox' })).toBeNull();
    expect(getByRole('heading', { name: 'Inbox' }).localName).toBe('text');
  });

  it('sizes the chevron to Material’s large title', async () => {
    const { state, update, getByRole } = await renderScroll(ANDROID);
    await update(() => state.topBar.set(menuBar('Inbox')));
    const button = getByRole('button', { name: 'Inbox' });
    expect(button.querySelector('text')?.className).toContain('text-[28px]');
    expect(button.querySelector('svg')?.style.width).toBe('28px');
  });

  it('dims the title under a finger, and fades it back when the finger lifts', async () => {
    const { state, update, getByRole } = await renderScroll(IOS_26, [
      { provide: LynxAccessibilitySettings, useValue: settings },
    ]);
    await update(() => state.topBar.set(menuBar('Inbox')));
    const button = getByRole('button', { name: 'Inbox' });
    const after = async (act: () => void) => {
      act();
      await waitForUpdate();
      return [
        button.style.getPropertyValue('opacity'),
        button.style.getPropertyValue('transition'),
      ];
    };
    // Dimmed at once, as a control answers the touch.
    expect(await after(() => fireEvent.touchstart(button))).toEqual([
      '0.4',
      'none',
    ]);
    const [opacity, transition] = await after(() => fireEvent.touchend(button));
    expect(opacity).toBe('1');
    expect(transition).toContain('opacity');

    // A touch the scroll took, and a mouse in the web preview, release it too.
    await after(() => fireEvent.touchstart(button));
    expect((await after(() => fireEvent.touchcancel(button)))[0]).toBe('1');
    expect((await after(() => fireLynxEvent(button, 'mousedown')))[0]).toBe(
      '0.4',
    );
    expect((await after(() => fireLynxEvent(button, 'mouseleave')))[0]).toBe(
      '1',
    );
    await after(() => fireLynxEvent(button, 'mousedown'));
    expect((await after(() => fireLynxEvent(button, 'mouseup')))[0]).toBe('1');

    // Under Reduce Motion it comes back at once.
    expect(await after(() => settings.reduceMotion.set(true))).toEqual([
      '1',
      'none',
    ]);
  });

  it('leaves a tap alone under a bar of an app’s own that takes none', async () => {
    const { state, update, getByRole } = await renderScroll();
    await update(() =>
      state.topBar.set({ ...topBar('Inbox'), titleMenu: signal(true) }),
    );
    const button = getByRole('button', { name: 'Inbox' });
    expect(() => fireEvent.tap(button)).not.toThrow();
    expect(button.querySelector('text')?.textContent).toBe('Inbox');
  });
});

describe('UiBarScroll on a <list>', () => {
  const renderList = async (
    platform: { platform: string; osVersion: string } = IOS_26,
  ) => {
    vi.stubGlobal('SystemInfo', platform);
    const result = await render(ListHost);
    const host = result.componentRef.instance as ListHost;
    const state = result.componentRef.injector.get(UiBarState);
    const list = () => result.container.querySelector<HTMLElement>('#feed')!;
    /**
     * The list's items in order. A unit test doesn't play native's part,
     * which asks for them (componentAtIndex), so they're read from the
     * list's own record of them rather than the element tree.
     */
    const items = () =>
      (
        host.list().nativeElement as { getUIChildren(): HTMLElement[] }
      ).getUIChildren();
    const item = (key: string) =>
      items().find((each) => each.getAttribute('item-key') === key)!;
    const keys = () => items().map((each) => each.getAttribute('item-key'));
    /**
     * The spacer each end's list item holds.
     */
    const topSpacer = () =>
      item(BAR_SCROLL_ITEM_KEYS.top).firstElementChild as HTMLElement;
    const bottomSpacer = () =>
      item(BAR_SCROLL_ITEM_KEYS.bottom).firstElementChild as HTMLElement;
    const update = async (change: () => void) => {
      change();
      await waitForUpdate();
    };
    return {
      ...result,
      host,
      state,
      list,
      items,
      item,
      keys,
      topSpacer,
      bottomSpacer,
      update,
    };
  };

  it('puts the room for the bars in list items of their own, before the list’s items and after them', async () => {
    const { state, keys, item, topSpacer, bottomSpacer, update } =
      await renderList();
    expect(keys()).toEqual([
      BAR_SCROLL_ITEM_KEYS.top,
      'first',
      'second',
      BAR_SCROLL_ITEM_KEYS.bottom,
    ]);

    await update(() => {
      state.topBar.set(topBar());
      state.bottomBar.set(bottomBar());
    });
    expect(topSpacer().style.height).toContain('44px');
    expect(topSpacer().style.height).toContain('env(safe-area-inset-top)');
    expect(bottomSpacer().style.height).toContain('52px');
    expect(bottomSpacer().style.height).toContain(
      'env(safe-area-inset-bottom)',
    );
    // Each takes a whole row in a list of columns.
    expect(item(BAR_SCROLL_ITEM_KEYS.top).getAttribute('full-span')).toBe(
      'true',
    );
    expect(item(BAR_SCROLL_ITEM_KEYS.bottom).getAttribute('full-span')).toBe(
      'true',
    );
  });

  it('keeps the list’s items between them as they change', async () => {
    const { host, keys, update } = await renderList();
    await update(() => host.rows.set(['zero', 'first', 'second', 'third']));
    expect(keys()).toEqual([
      BAR_SCROLL_ITEM_KEYS.top,
      'zero',
      'first',
      'second',
      'third',
      BAR_SCROLL_ITEM_KEYS.bottom,
    ]);
  });

  it('puts the large title, with its accessory, in an item after the top bar’s room', async () => {
    const { state, keys, item, update, list } = await renderList();
    await update(() => state.topBar.set(topBar('Inbox')));
    expect(keys()).toEqual([
      BAR_SCROLL_ITEM_KEYS.top,
      BAR_SCROLL_ITEM_KEYS.largeTitle,
      'first',
      'second',
      BAR_SCROLL_ITEM_KEYS.bottom,
    ]);
    const titleItem = item(BAR_SCROLL_ITEM_KEYS.largeTitle);
    expect(titleItem.getAttribute('full-span')).toBe('true');
    const band = titleItem.firstElementChild as HTMLElement;
    expect(band.className).toContain('h-[52px]');
    const title = band.querySelector('text')!;
    expect(title.textContent).toBe('Inbox');
    expect(title.getAttribute('accessibility-traits')).toBe('header');
    expect(band.textContent).toContain('3 unread');

    // It scrolls away into the bar, as on a scroll view.
    fireEvent.scroll(list(), { detail: { scrollTop: 44, scrollHeight: 2000 } });
    expect(state.scrolledUnderTop()).toBe(true);
    expect(state.largeTitleUnder()).toBe(true);

    await update(() => state.topBar.set(topBar()));
    expect(keys()).not.toContain(BAR_SCROLL_ITEM_KEYS.largeTitle);
  });

  it('makes a title that opens a menu a button there too', async () => {
    const { state, item, update } = await renderList();
    const bar = menuBar('Inbox');
    await update(() => state.topBar.set(bar));
    const button = item(BAR_SCROLL_ITEM_KEYS.largeTitle).querySelector(
      '[accessibility-label="Inbox"]',
    )!;
    expect(button.getAttribute('accessibility-traits')).toContain('button');
    fireEvent.tap(button);
    expect(bar.titlePressed).toHaveBeenCalledTimes(1);
  });

  it('sends scroll about every frame, unless the list says how often', async () => {
    const { list } = await renderList();
    expect(list().getAttribute('scroll-event-throttle')).toBe('16');
    expect(list().getAttribute('need-layout-complete-info')).toBe('true');

    vi.stubGlobal('SystemInfo', IOS_26);
    const own = await render(ThrottledListHost);
    expect(
      own.container
        .querySelector('#feed')
        ?.getAttribute('scroll-event-throttle'),
    ).toBe('100');
  });

  it('leaves a scroll view’s own events as they are', async () => {
    const { scrollView } = await renderScroll();
    expect(scrollView().getAttribute('scroll-event-throttle')).toBeNull();
    expect(scrollView().getAttribute('need-layout-complete-info')).toBeNull();
  });

  it('says whether content continues under the bottom bar from the list’s layout, before anything scrolls', async () => {
    const { state, list } = await renderList();
    fireEvent.layoutchange(list(), { detail: { width: 402, height: 800 } });
    // A layout without the scroll info (an older engine) says nothing.
    fireLynxEvent(list(), 'layoutcomplete', { detail: {} });
    expect(state.scrolledUnderBottom()).toBe(false);

    fireLynxEvent(list(), 'layoutcomplete', {
      detail: { scrollInfo: { scrollTop: 0, scrollHeight: 2000 } },
    });
    expect(state.scrolledUnderBottom()).toBe(true);
    fireEvent.scroll(list(), {
      detail: { scrollTop: 1200, scrollHeight: 2000 },
    });
    expect(state.scrolledUnderBottom()).toBe(false);
  });

  it('fades content out under glass bars, from its items’ measured room', async () => {
    const { state, list, topSpacer, bottomSpacer, update } = await renderList();
    await update(() => {
      state.topBar.set(topBar());
      state.bottomBar.set(bottomBar());
    });
    fireEvent.layoutchange(list(), { detail: { width: 402, height: 1000 } });
    fireEvent.layoutchange(topSpacer(), {
      detail: { width: 402, height: 100 },
    });
    fireEvent.layoutchange(bottomSpacer(), {
      detail: { width: 402, height: 50 },
    });
    await waitForUpdate();
    expect(maskStops(list())).toEqual(
      asWritten([
        [0, '0.00%'],
        [0, '7.00%'],
        [0.12, '9.00%'],
        [1, '10.00%'],
        [1, '95.00%'],
        [0.12, '95.50%'],
        [0, '96.50%'],
        [0, '100.00%'],
      ]),
    );
  });
});
