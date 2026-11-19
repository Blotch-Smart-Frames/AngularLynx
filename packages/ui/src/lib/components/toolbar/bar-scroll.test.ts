import { Component, type Provider, signal } from '@angular/core';
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
import { injectBarState, UiBarScroll, UiBarState } from './bar-scroll';

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
  const topSpacer = () => scrollView().firstElementChild as HTMLElement;
  const bottomSpacer = () => scrollView().lastElementChild as HTMLElement;
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
    fireEvent.layoutchange(scrollView.firstElementChild!, {
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
