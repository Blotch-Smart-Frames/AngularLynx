import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { provideGlass } from '../glass/glass-design';
import { UiBarScroll, UiBarState } from './bar-scroll';

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

const renderScroll = async (
  platform: { platform: string; osVersion: string } = IOS_26,
) => {
  vi.stubGlobal('SystemInfo', platform);
  const result = await render(ScrollHost);
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
 * The scroll view's mask as [how much shows, where] stops, however the DOM
 * writes it back: jsdom versions differ, writing opaque black as
 * `rgb(0, 0, 0)` and leaving out the default `to bottom`.
 */
const maskStops = (element: HTMLElement): [number, string][] =>
  Array.from(
    element.style
      .getPropertyValue('mask-image')
      .matchAll(
        /rgba?\(0, 0, 0(?:, ([\d.]+))?\) (calc\([^)]*\)|[\d.]+(?:%|px))/g,
      ),
    ([, alpha, at]): [number, string] => [
      alpha === undefined ? 1 : Number(alpha),
      at,
    ],
  );

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(maskStops(scrollView())).toEqual([
      [0, '0.00%'],
      [0, '7.00%'],
      [0.12, '9.00%'],
      [1, '10.00%'],
      [1, '95.00%'],
      [0.12, '95.50%'],
      [0, '96.50%'],
      [0, '100.00%'],
    ]);

    // A top bar alone fades the top only, and a bottom bar alone the bottom.
    await layOut(1000, 100, 0);
    expect(maskStops(scrollView()).slice(-2)).toEqual([
      [1, '10.00%'],
      [1, '100.00%'],
    ]);
    await layOut(1000, 0, 50);
    expect(maskStops(scrollView()).slice(0, 2)).toEqual([
      [1, '0.00%'],
      [1, '95.00%'],
    ]);
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
    expect(maskStops(scrollView())).toEqual([
      [0, '0px'],
      [0, '70px'],
      [0.12, '90px'],
      [1, '100px'],
      [1, 'calc(100% - 0px)'],
    ]);

    fireEvent.layoutchange(bottomSpacer(), {
      detail: { width: 402, height: 50 },
    });
    await waitForUpdate();
    expect(maskStops(scrollView()).slice(-4)).toEqual([
      [1, 'calc(100% - 50px)'],
      [0.12, 'calc(100% - 45px)'],
      [0, 'calc(100% - 35px)'],
      [0, 'calc(100% - 0px)'],
    ]);
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
