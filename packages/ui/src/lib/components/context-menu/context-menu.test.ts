import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate as nextUpdate,
  within,
} from '@blotch/angular-lynx-testing-library';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxHaptics,
} from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { DURATION } from '../../utils/animate';
import { UiMenuItem, UiMenuSeparator } from '../menu/menu';
import { UiContextMenu } from './context-menu';

@Component({
  imports: [LYNX_ELEMENTS, UiContextMenu, UiMenuItem, UiMenuSeparator],
  template: `
    <ui-context-menu
      [open]="open()"
      (openChange)="open.set($event)"
      [disabled]="disabled()"
      (closed)="closed()"
    >
      <view class="card" (bindtap)="opened()">
        <text>Kyoto</text>
      </view>
      <ui-menu-item label="Share" icon="upload" (pressed)="shared()" />
      <ui-menu-separator />
      <ui-menu-item
        label="Delete"
        icon="trash"
        variant="destructive"
        (pressed)="deleted()"
      />
    </ui-context-menu>
  `,
})
class ContextMenuHost {
  readonly open = signal(false);
  readonly disabled = signal(false);
  readonly closed = vi.fn();
  readonly opened = vi.fn();
  readonly shared = vi.fn();
  readonly deleted = vi.fn();
}

/**
 * The Lynx function that runs an element's UI methods, such as measuring it
 * (`boundingClientRect`). The testing library defines it on the global
 * object.
 */
type InvokeUIMethod = {
  __InvokeUIMethod: (
    element: Element,
    method: string,
    params: Record<string, unknown>,
    callback: (result: { code: number; data?: unknown }) => void,
  ) => void;
};

/** Accessibility settings a test can change, as the host app would. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

const IOS_26 = { platform: 'iOS', osVersion: '26.0' };

/** Stands in for LynxHaptics, so a test can see the menu's feedback. */
const haptics = {
  impact: vi.fn(),
  selection: vi.fn(),
  notification: vi.fn(),
};

/**
 * Renders the context menu on a platform (none for Material), measuring
 * elements as `boundingClientRect` would on a phone: the safe area (the
 * element that holds the menu) a phone's screen, the menu's content 120pt
 * tall with its rows 44pt apart from its top, and anything else, the pressed
 * element, a card near the top.
 */
const renderContextMenu = async (
  platform: { platform: string; osVersion: string } | null = IOS_26,
) => {
  vi.stubGlobal('SystemInfo', platform ?? undefined);
  vi.spyOn(
    globalThis as unknown as InvokeUIMethod,
    '__InvokeUIMethod',
  ).mockImplementation((element, method, _params, callback) => {
    if (method !== 'boundingClientRect') {
      callback({ code: 0 });
      return;
    }
    const content = element.closest('scroll-view > view');
    const rows = content
      ? [...content.querySelectorAll('[accessibility-traits^="button"]')]
      : [];
    const data = element.querySelector(':scope > blur-view[ui-glass]')
      ? { left: 0, top: 62, width: 402, height: 778 }
      : element === content
        ? { left: 0, top: 0, width: 250, height: 120 }
        : rows.includes(element)
          ? { left: 0, top: rows.indexOf(element) * 44, width: 250, height: 44 }
          : { left: 16, top: 162, width: 370, height: 96 };
    callback({ code: 0, data });
  });
  const result = await render(ContextMenuHost, {
    providers: [
      { provide: LynxAccessibilitySettings, useValue: settings },
      { provide: LynxHaptics, useValue: haptics },
    ],
  });
  const host = result.componentRef.instance as ContextMenuHost;
  const overlay = result.container.querySelector('overlay')!;
  return {
    ...result,
    host,
    overlay,
    menu: within(overlay as HTMLElement),
    card: () => result.getByText('Kyoto').parentElement!,
    /** The element the card is in: its home, or the overlay's slot. */
    holder: () =>
      result.getByText('Kyoto').parentElement!.parentElement!.parentElement!,
    panel: () => overlay.querySelector('blur-view[ui-glass]')!,
  };
};

type Rendered = Awaited<ReturnType<typeof renderContextMenu>>;

// Every test runs on a fake clock (see the beforeEach below), so the test
// decides when time passes. On real time, a busy machine fired the menu's
// timers late, and a test gave up waiting for it to open or close.

/**
 * The testing library's waitForUpdate on the fake clock. It waits on a
 * zero-delay timer, which Node runs a millisecond later; the fake clock puts
 * a zero-delay timer set by another timer a millisecond later too, so this
 * lets one pass.
 */
const waitForUpdate = async () => {
  const update = nextUpdate();
  await vi.advanceTimersByTimeAsync(1);
  await update;
};

/**
 * Lets `ms` pass on the fake clock, then renders what it changed.
 */
const after = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await waitForUpdate();
};

/**
 * How long the menu takes to open: 32ms for its overlay to lay out, 16ms at
 * its start frame, and the updates around them.
 */
const OPENED = 60;
/** How long the menu takes to close: its animation, then 20ms more. */
const CLOSED = DURATION.normal + 30;

/**
 * Waits until the menu has opened.
 */
const waitForOpen = async (rendered: Rendered) => {
  await after(OPENED);
  expect(rendered.panel().getAttribute('accessibility-exclusive-focus')).toBe(
    'true',
  );
};

/**
 * Waits until the menu has closed and its animation has finished.
 */
const waitForClose = async (rendered: Rendered) => {
  await after(CLOSED);
  expect(rendered.host.closed).toHaveBeenCalled();
};

/**
 * Long-presses an element. The press bubbles, as Lynx's touch events do, to
 * the context menu around the element.
 */
const longPress = (element: Element) =>
  fireEvent.longpress(element, { bubbles: true });

const style = (element: Element, name: string) =>
  (element as HTMLElement).style.getPropertyValue(name);

// The renderer warns that the components' selectors aren't Lynx elements.
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  haptics.impact.mockClear();
  haptics.selection.mockClear();
  vi.unstubAllGlobals();
});

describe('UiContextMenu', () => {
  it('opens on a long press, lifting the element above the dimmed screen', async () => {
    const rendered = await renderContextMenu();
    const home = rendered.holder();

    longPress(rendered.card());
    await waitForOpen(rendered);

    expect(rendered.host.open()).toBe(true);
    // The element itself is in the menu's overlay now, lifted, and the spot
    // it left keeps its size.
    expect(rendered.overlay.contains(rendered.card())).toBe(true);
    expect(style(rendered.holder(), 'transform')).toBe('scale(1.03)');
    expect(style(home, 'width')).toBe('370px');
    expect(style(home, 'height')).toBe('96px');
    expect(rendered.overlay.querySelector('.bg-glass-dim')).not.toBeNull();
    // The menu opens below it.
    expect(style(rendered.panel(), 'top')).toBe(`${100 + 96 + 8}px`);
    // With a tap, as the press turns into the menu.
    expect(haptics.impact.mock.calls).toEqual([['medium']]);
  });

  it('runs the chosen item and closes, putting the element back', async () => {
    const rendered = await renderContextMenu();
    longPress(rendered.card());
    await waitForOpen(rendered);

    fireEvent.tap(
      rendered.menu.getByRole('button', { name: 'Delete, destructive' }),
    );

    expect(rendered.host.deleted).toHaveBeenCalledTimes(1);
    expect(rendered.host.open()).toBe(false);
    await waitForClose(rendered);
    expect(rendered.overlay.contains(rendered.card())).toBe(false);
    expect(style(rendered.holder(), 'height')).toBe('');
    // A tap on the element still reaches it.
    fireEvent.tap(rendered.card());
    expect(rendered.host.opened).toHaveBeenCalledTimes(1);
  });

  it('closes on a tap outside the menu', async () => {
    const rendered = await renderContextMenu();
    rendered.host.open.set(true);
    await waitForOpen(rendered);
    // Opened from code, there's no press to answer.
    expect(haptics.impact).not.toHaveBeenCalled();

    fireEvent.tap(rendered.overlay.firstElementChild!);

    expect(rendered.host.open()).toBe(false);
    await waitForClose(rendered);
  });

  it("doesn't open on a long press when disabled", async () => {
    const rendered = await renderContextMenu();
    rendered.host.disabled.set(true);
    await waitForUpdate();

    longPress(rendered.card());
    await waitForUpdate();

    expect(rendered.host.open()).toBe(false);
    expect(haptics.impact).not.toHaveBeenCalled();
  });

  it('opens a Material menu beside the element on Android, leaving it in place', async () => {
    const rendered = await renderContextMenu(null);
    const home = rendered.holder();

    longPress(rendered.card());
    await waitForOpen(rendered);

    expect(home.contains(rendered.card())).toBe(true);
    expect(style(home, 'height')).toBe('');
    expect(rendered.overlay.querySelector('.bg-glass-dim')).toBeNull();
    expect(rendered.menu.getByRole('button', { name: 'Share' })).toBeTruthy();
  });

  describe('with a finger that slides on from the long press', () => {
    /**
     * A touch event with one finger at (x, y) in the window.
     */
    const touchAt = (x: number, y: number) => ({
      touches: [{ clientX: x, clientY: y }],
    });
    /**
     * The middle of a row on screen: the menu opens 8pt below the card, in
     * the safe area 62pt down, with its rows 44pt apart.
     */
    const onRow = (index: number) => ({
      x: 100,
      y: 62 + 204 + index * 44 + 22,
    });
    const ON_SHARE = onRow(0);
    const ON_DELETE = onRow(1);

    /**
     * The element the long press lands on: the card's holder.
     */
    const pressed = (rendered: Rendered) => rendered.card().parentElement!;

    it('chooses the item it lifts on, as on iOS', async () => {
      const rendered = await renderContextMenu();
      fireLynxEvent(pressed(rendered), 'touchstart', touchAt(100, 200));
      longPress(rendered.card());
      await waitForOpen(rendered);

      fireLynxEvent(
        pressed(rendered),
        'touchmove',
        touchAt(ON_SHARE.x, ON_SHARE.y),
      );
      await waitForUpdate();
      const share = rendered.menu.getByRole('button', { name: 'Share' });
      expect(style(share.firstElementChild!, 'opacity')).toBe('0.08');
      expect(haptics.selection).toHaveBeenCalledTimes(1);

      fireLynxEvent(pressed(rendered), 'touchend', {
        touches: [],
        changedTouches: [{ clientX: ON_SHARE.x, clientY: ON_SHARE.y }],
      });
      expect(rendered.host.shared).toHaveBeenCalledTimes(1);
      expect(rendered.host.open()).toBe(false);
      await waitForClose(rendered);
    });

    it('chooses the row it lifts on, not the first', async () => {
      const rendered = await renderContextMenu();
      fireLynxEvent(pressed(rendered), 'touchstart', touchAt(100, 200));
      longPress(rendered.card());
      await waitForOpen(rendered);

      fireLynxEvent(
        pressed(rendered),
        'touchmove',
        touchAt(ON_DELETE.x, ON_DELETE.y),
      );
      fireLynxEvent(pressed(rendered), 'touchend', {
        touches: [],
        changedTouches: [{ clientX: ON_DELETE.x, clientY: ON_DELETE.y }],
      });

      expect(rendered.host.deleted).toHaveBeenCalledTimes(1);
      expect(rendered.host.shared).not.toHaveBeenCalled();
      await waitForClose(rendered);
    });

    it('turns the highlight off when the system takes the touch over', async () => {
      const rendered = await renderContextMenu();
      fireLynxEvent(pressed(rendered), 'touchstart', touchAt(100, 200));
      longPress(rendered.card());
      await waitForOpen(rendered);
      fireLynxEvent(
        pressed(rendered),
        'touchmove',
        touchAt(ON_SHARE.x, ON_SHARE.y),
      );
      fireLynxEvent(pressed(rendered), 'touchcancel');
      await waitForUpdate();

      const share = rendered.menu.getByRole('button', { name: 'Share' });
      expect(style(share.firstElementChild!, 'opacity')).toBe('0');
      expect(rendered.host.open()).toBe(true);
    });

    it("isn't followed on Android's Material menus, or when disabled", async () => {
      for (const [platform, disabled] of [
        [null, false],
        [IOS_26, true],
      ] as const) {
        const rendered = await renderContextMenu(platform);
        rendered.host.disabled.set(disabled);
        rendered.host.open.set(true);
        await waitForOpen(rendered);

        fireLynxEvent(pressed(rendered), 'touchstart', touchAt(100, 200));
        fireLynxEvent(
          pressed(rendered),
          'touchmove',
          touchAt(ON_SHARE.x, ON_SHARE.y),
        );
        await waitForUpdate();
        expect(haptics.selection).not.toHaveBeenCalled();
        rendered.unmount();
      }
    });
  });
});
