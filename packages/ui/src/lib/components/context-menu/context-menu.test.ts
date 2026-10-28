import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
  within,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * Renders the context menu on a platform (none for Material), measuring
 * elements as `boundingClientRect` would on a phone: the safe area (the
 * element that holds the menu) a phone's screen, the menu's content 120pt
 * tall, and anything else, the pressed element, a card near the top.
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
    const data = element.querySelector(':scope > blur-view[ui-glass]')
      ? { left: 0, top: 62, width: 402, height: 778 }
      : element.parentElement?.tagName.toLowerCase() === 'scroll-view'
        ? { left: 0, top: 0, width: 250, height: 120 }
        : { left: 16, top: 162, width: 370, height: 96 };
    callback({ code: 0, data });
  });
  const result = await render(ContextMenuHost, {
    providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
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

/**
 * Waits until the menu has opened.
 */
const waitForOpen = (rendered: Rendered) =>
  vi.waitFor(() =>
    expect(rendered.panel().getAttribute('accessibility-exclusive-focus')).toBe(
      'true',
    ),
  );

/**
 * Waits until the menu has closed and its animation has finished.
 */
const waitForClose = async (rendered: Rendered) => {
  await vi.waitFor(() => expect(rendered.host.closed).toHaveBeenCalled());
  await waitForUpdate();
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
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
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
});
