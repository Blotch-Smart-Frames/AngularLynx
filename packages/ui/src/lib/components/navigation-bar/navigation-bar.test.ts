import { Location, LocationStrategy } from '@angular/common';
import { MockLocationStrategy } from '@angular/common/testing';
import { Component, type Provider, signal, viewChild } from '@angular/core';
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
import { provideGlass } from '../glass/glass-design';
import { UiBarScroll, UiBarState } from '../toolbar/bar-scroll';
import { UiToolbarItem } from '../toolbar/toolbar';
import { UiNavigationBar } from './navigation-bar';

@Component({
  selector: 'notes-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Notes page</text>`,
})
class NotesPage {}

@Component({
  selector: 'note-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Note page</text>`,
})
class NotePage {}

const routes: Routes = [
  { path: '', component: NotesPage },
  { path: 'note', component: NotePage },
];

@Component({
  imports: [
    LYNX_ELEMENTS,
    RouterOutlet,
    UiBarScroll,
    UiNavigationBar,
    UiToolbarItem,
  ],
  template: `
    @if (scroll()) {
      <scroll-view ui-bar-scroll id="scroll" scroll-orientation="vertical">
        <view style="height: 2000px"></view>
      </scroll-view>
    }
    <ui-navigation-bar
      id="bar"
      [title]="title()"
      [largeTitle]="largeTitle()"
      [titleCentered]="titleCentered()"
      [backLabel]="backLabel()"
      [backRoute]="backRoute()"
      [backButtonHidden]="backButtonHidden()"
      [class]="barClass()"
    >
      <ui-toolbar-item leading label="Edit" />
      <ui-toolbar-item icon="plus" label="New note" />
    </ui-navigation-bar>
    <router-outlet />
  `,
})
class BarHost {
  readonly title = signal('Notes');
  readonly largeTitle = signal(false);
  readonly titleCentered = signal(false);
  readonly backLabel = signal('Back');
  readonly backRoute = signal<string | undefined>(undefined);
  readonly backButtonHidden = signal(false);
  readonly barClass = signal('');
  readonly scroll = signal(false);
  readonly bar = viewChild.required(UiNavigationBar);
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

/**
 * Runs change detection until `done` holds: a navigation takes a few ticks.
 */
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 20 && !done(); i++) {
    await waitForUpdate();
  }
  expect(done()).toBe(true);
};

/**
 * Renders the bar on a platform, with the router unless `router` is false.
 * The platform is provided rather than stubbed as a global: the router's
 * setup switches the testing library's threads, which puts back its own
 * SystemInfo before the bar reads it.
 */
const renderBar = async (
  platform: { platform: string; osVersion: string },
  providers: Provider[] = [],
) => {
  const result = await render(BarHost, {
    providers: [
      provideRouter(routes),
      { provide: LynxSystemInfo, useValue: platform },
      { provide: LynxAccessibilitySettings, useValue: settings },
      ...providers,
    ],
  });
  const host = result.componentRef.instance as BarHost;
  const injector = result.componentRef.injector;
  const state = injector.get(UiBarState);
  const { container } = result;
  const bar = () => container.querySelector<HTMLElement>('#bar')!;
  const row = () =>
    Array.from(bar().children).find((child) =>
      child.className.includes('justify-between'),
    ) as HTMLElement;
  /**
   * The bar's two ends: the views holding Edit and New note.
   */
  const leading = () =>
    result.getByRole('button', { name: 'Edit' }).parentElement!;
  const trailing = () =>
    result.getByRole('button', { name: 'New note' }).parentElement!;
  const title = () => result.queryByRole('heading', { name: host.title() });
  /**
   * The view holding the bar's title, not the copy that measures it.
   */
  const titleBox = () =>
    Array.from(row().children).find(
      (child) =>
        child.className.includes('flex-1') ||
        child.className.includes('bottom-0'),
    ) as HTMLElement;
  const back = () => result.queryByRole('button', { name: host.backLabel() });
  const page = () =>
    Array.from(container.querySelectorAll('text'))
      .map((text) => text.textContent ?? '')
      .find((text) => text.endsWith(' page'));
  const update = async (change: () => void) => {
    change();
    await waitForUpdate();
  };
  await until(() => page() === 'Notes page');
  return {
    ...result,
    host,
    injector,
    state,
    bar,
    row,
    leading,
    trailing,
    title,
    titleBox,
    back,
    page,
    update,
  };
};

const style = (element: HTMLElement, name: string) =>
  element.style.getPropertyValue(name);

// The components' selectors aren't Lynx elements, so the renderer falls back
// to a <view> for each and warns.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  settings.reduceMotion.set(false);
});

describe('UiNavigationBar on iOS 26 and later', () => {
  it('floats over the top of the content below the status bar, with no background', async () => {
    const { bar, state, row } = await renderBar(IOS_26);
    expect(bar().classList).toContain('absolute');
    expect(bar().classList).toContain('top-0');
    expect(bar().classList).toContain('pt-safe');
    expect(bar().classList).not.toContain('bg-background');
    expect(bar().querySelector('[shape="rounded"]')).toBeNull();
    expect(row().className).toContain('h-[44px]');
    expect(style(row(), 'padding-left')).toBe('16px');
    // It tells the scroll view under it how much room it takes.
    expect(state.topBar()?.height()).toBe(44);
    expect(state.topBar()?.largeTitle()).toBeNull();
  });

  it('shows the title as a heading, with the leading items after the Back button and the rest at the end', async () => {
    const { title, leading, trailing, row, host, update } =
      await renderBar(IOS_26);
    expect(title()?.className).toContain('font-semibold');
    expect(title()?.className).toContain('text-center');
    const ends = Array.from(row().children);
    expect(ends.indexOf(leading())).toBeLessThan(ends.indexOf(trailing()));

    await update(() => host.title.set('Inbox'));
    expect(title()?.textContent).toBe('Inbox');
  });

  it('centers the title on the screen when it fits, or between the ends when it doesn’t', async () => {
    const { row, leading, trailing, titleBox, container } =
      await renderBar(IOS_26);
    const copy = () =>
      container.querySelector<HTMLElement>(
        '[accessibility-elements-hidden="true"] text',
      )!;
    const lay = async (element: Element, width: number) => {
      fireEvent.layoutchange(element, { detail: { width, height: 44 } });
      await waitForUpdate();
    };
    await lay(row(), 402);
    await lay(leading(), 44);
    await lay(trailing(), 100);
    await lay(copy(), 80);
    // Clear of the wider end on both sides: 16 + 100 + 8.
    expect(style(titleBox(), 'left')).toBe('124px');
    expect(style(titleBox(), 'right')).toBe('124px');

    // Too wide for that: between the ends.
    await lay(copy(), 200);
    expect(style(titleBox(), 'left')).toBe('68px');
    expect(style(titleBox(), 'right')).toBe('124px');
  });

  it('shows a Back button while there’s a screen to go back to, and goes back through the router', async () => {
    const { back, injector, page, host, update } = await renderBar(IOS_26);
    expect(back()).toBeNull();

    await injector.get(Router).navigateByUrl('/note');
    await until(() => page() === 'Note page');
    await update(() => host.backLabel.set('Notes'));
    expect(back()).not.toBeNull();
    expect(host.bar().canGoBack()).toBe(true);

    fireEvent.tap(back()!);
    await until(() => page() === 'Notes page');
    expect(back()).toBeNull();
  });

  it('hides the Back button on a screen that asks', async () => {
    const { back, injector, page, host, update } = await renderBar(IOS_26);
    await injector.get(Router).navigateByUrl('/note');
    await until(() => page() === 'Note page');
    await update(() => host.backButtonHidden.set(true));
    expect(back()).toBeNull();
  });

  it('goes to backRoute in place of the screen when there’s no history', async () => {
    const { back, injector, page, host, update } = await renderBar(IOS_26);
    await injector.get(Router).navigateByUrl('/note', { replaceUrl: true });
    await until(() => page() === 'Note page');
    expect(back()).toBeNull();

    await update(() => host.backRoute.set('/'));
    fireEvent.tap(back()!);
    await until(() => page() === 'Notes page');
    // It replaced the note: there's still nothing to go back to.
    expect(host.bar().canGoBack()).toBe(false);
    expect(injector.get(Location).path()).toBe('');
  });

  it('does nothing on goBack() with nowhere to go', async () => {
    const { host, page } = await renderBar(IOS_26);
    host.bar().goBack();
    await waitForUpdate();
    expect(page()).toBe('Notes page');
  });

  it('starts the title large at the top of the content, and shows it once it has scrolled under', async () => {
    const { host, state, update, title, titleBox, getAllByRole } =
      await renderBar(IOS_26);
    await update(() => host.largeTitle.set(true));
    // Without a scroll view there's no large title, so the bar keeps it.
    expect(title()).not.toBeNull();
    expect(state.topBar()?.largeTitle()).toBe('Notes');

    await update(() => host.scroll.set(true));
    // The scroll view draws the large title; the bar's hides.
    expect(getAllByRole('heading', { name: 'Notes' })).toHaveLength(1);
    expect(style(titleBox(), 'opacity')).toBe('0');
    expect(style(titleBox(), 'transition')).toContain('opacity');

    await update(() => state.largeTitleUnder.set(true));
    expect(getAllByRole('heading', { name: 'Notes' })).toHaveLength(2);
    expect(style(titleBox(), 'opacity')).toBe('1');
  });

  it('shows the title at once under Reduce Motion', async () => {
    const { host, update, titleBox } = await renderBar(IOS_26);
    await update(() => {
      host.largeTitle.set(true);
      host.scroll.set(true);
      settings.reduceMotion.set(true);
    });
    expect(style(titleBox(), 'transition')).toBe('none');
  });

  it('takes extra classes', async () => {
    const { host, update, bar } = await renderBar(IOS_26);
    await update(() => host.barClass.set('z-10'));
    expect(bar().classList).toContain('z-10');
  });
});

describe('UiNavigationBar before iOS 26', () => {
  it("is clear at the top of the content, and on the bars' chrome material with a hairline once content scrolls under it", async () => {
    const { bar, state, update, row } = await renderBar(IOS_18);
    const material = () => bar().querySelector('[shape="rounded"]');
    expect(material()).toBeNull();
    expect(style(row(), 'padding-left')).toBe('8px');

    await update(() => state.scrolledUnderTop.set(true));
    expect(material()?.getAttribute('blur-material')).toBe('chrome');
    expect(material()?.getAttribute('blur-effect')).toBe('extra-light');
    expect(bar().querySelector('.h-\\[0\\.5px\\]')).not.toBeNull();
  });

  it('shows the previous screen’s title beside the Back button’s chevron', async () => {
    const { back, injector, page, host, update } = await renderBar(IOS_18);
    await injector.get(Router).navigateByUrl('/note');
    await until(() => page() === 'Note page');
    await update(() => host.backLabel.set('Notes'));
    expect(back()?.querySelector('text')?.textContent).toBe('Notes');
  });
});

describe('UiNavigationBar on Android', () => {
  it('is Material 3’s small top app bar, the title at the start', async () => {
    const { bar, row, state, title, titleBox, leading, trailing, container } =
      await renderBar(ANDROID);
    expect(row().className).toContain('h-[64px]');
    expect(state.topBar()?.height()).toBe(64);
    expect(bar().classList).toContain('bg-background');
    expect(title()?.className).toContain('text-[22px]');
    expect(title()?.className).not.toContain('text-center');
    expect(titleBox().className).toContain('flex-1');
    expect(leading().className).toContain('min-w-[12px]');
    expect(trailing().className).toContain('pr-[4px]');
    // Laid out in the row, so it measures no copy.
    expect(
      container.querySelector('[accessibility-elements-hidden="true"]'),
    ).toBeNull();
  });

  it('centers the title in the center-aligned app bar', async () => {
    const { host, update, title, titleBox, leading } = await renderBar(ANDROID);
    await update(() => host.titleCentered.set(true));
    expect(title()?.className).toContain('text-center');
    expect(titleBox().className).toContain('top-0');
    expect(leading().className).not.toContain('min-w-[12px]');
  });

  it('turns to the surface container color as content scrolls under it', async () => {
    const { bar, state, update } = await renderBar(ANDROID);
    expect(style(bar(), 'transition')).toContain('background-color');
    await update(() => state.scrolledUnderTop.set(true));
    expect(bar().classList).toContain('bg-secondary');

    await update(() => settings.reduceMotion.set(true));
    expect(style(bar(), 'transition')).toBe('');
  });
});

/**
 * A bar in an app without the router.
 */
@Component({
  imports: [LYNX_ELEMENTS, UiNavigationBar],
  template: `<ui-navigation-bar title="Settings" backRoute="/" />`,
})
class PlainBarHost {
  readonly bar = viewChild.required(UiNavigationBar);
}

describe('UiNavigationBar with glass on Android', () => {
  it('fades the content beneath it itself, as Android’s scroll view takes no mask', async () => {
    const { bar } = await renderBar(ANDROID, [
      provideGlass({ android: 'glass' }),
    ]);
    const fade = style(bar(), 'background-image');
    expect(fade).toContain('linear-gradient(to bottom');
    expect(fade).toContain('var(--background-rgb)');
    // It isn't Material's bar.
    expect(bar().classList).not.toContain('bg-background');
  });
});

describe('UiNavigationBar without the Lynx router', () => {
  it('has no history to go back through without the router', async () => {
    const result = await render(PlainBarHost, {
      providers: [
        { provide: LynxSystemInfo, useValue: IOS_26 },
        { provide: LynxAccessibilitySettings, useValue: settings },
      ],
    });
    const host = result.componentRef.instance as PlainBarHost;
    expect(host.bar().canGoBack()).toBe(false);
    // backRoute still shows the button, for an app with routes of its own.
    expect(result.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('has no Back button with a LocationStrategy of the app’s own', async () => {
    const { back, host } = await renderBar(IOS_26, [
      { provide: LocationStrategy, useClass: MockLocationStrategy },
    ]);
    expect(back()).toBeNull();
    expect(host.bar().canGoBack()).toBe(false);
  });
});
