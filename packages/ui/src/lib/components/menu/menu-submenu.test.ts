import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate as nextUpdate,
  within,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { DURATION } from '../../utils/animate';
import { UiMenu, UiMenuItem, UiMenuSection, UiMenuTrigger } from './menu';
import { UiMenuSubmenu } from './menu-submenu';

@Component({
  imports: [
    LYNX_ELEMENTS,
    UiMenu,
    UiMenuTrigger,
    UiMenuItem,
    UiMenuSection,
    UiMenuSubmenu,
  ],
  template: `
    <ui-menu
      [open]="open()"
      (openChange)="open.set($event)"
      (closed)="closed()"
    >
      <view
        uiMenuTrigger
        class="trigger"
        [accessibility-element]="true"
        accessibility-traits="button"
        accessibility-label="View"
      >
        <text>View</text>
      </view>
      <ui-menu-submenu label="Sort by" icon="arrow-down">
        <ui-menu-section>
          <ui-menu-item
            label="Name"
            [checked]="sort() === 'name'"
            (pressed)="sort.set('name')"
          />
          <ui-menu-item
            label="Date"
            [checked]="sort() === 'date'"
            (pressed)="sort.set('date')"
          />
        </ui-menu-section>
      </ui-menu-submenu>
      <ui-menu-submenu label="Move to" disabled>
        <ui-menu-item label="Archive" (pressed)="moved()" />
      </ui-menu-submenu>
      <ui-menu-item label="Select" (pressed)="selected()" />
    </ui-menu>
  `,
})
class SubmenuHost {
  readonly open = signal(false);
  readonly sort = signal<'name' | 'date'>('date');
  readonly closed = vi.fn();
  readonly moved = vi.fn();
  readonly selected = vi.fn();
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

const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

const IOS_26 = { platform: 'iOS', osVersion: '26.0' };
const IOS_18 = { platform: 'iOS', osVersion: '18.5' };

const TRIGGER = { left: 16, top: 80, width: 80, height: 44 };
const ROW_HEIGHT = 44;

/**
 * Renders the menu on a platform (none for Material), measuring elements as
 * `boundingClientRect` would on a phone: each safe area a phone's screen,
 * each menu's content 132pt tall with its rows ROW_HEIGHT apart from its
 * top, and the trigger near the top of the screen.
 */
const renderSubmenu = async (
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
      ? { left: 0, top: 0, width: 402, height: 800 }
      : element === content
        ? { left: 0, top: 0, width: 250, height: 132 }
        : rows.includes(element)
          ? {
              left: 0,
              top: rows.indexOf(element) * ROW_HEIGHT,
              width: 250,
              height: ROW_HEIGHT,
            }
          : TRIGGER;
    callback({ code: 0, data });
  });
  const result = await render(SubmenuHost, {
    providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
  });
  const host = result.componentRef.instance as SubmenuHost;
  const menuOverlay = result.container.querySelector('overlay')!;
  // The first submenu's overlay: the disabled one's comes after it.
  const submenuOverlay = menuOverlay.querySelector('overlay')!;
  return {
    ...result,
    host,
    menuOverlay,
    submenuOverlay,
    menu: within(menuOverlay as HTMLElement),
    submenu: within(submenuOverlay as HTMLElement),
    trigger: () => result.container.querySelector('.trigger') as HTMLElement,
    /** The menu's own rows, which fade while a submenu covers them. */
    menuContent: () => menuOverlay.querySelector('scroll-view')!,
  };
};

type Rendered = Awaited<ReturnType<typeof renderSubmenu>>;

const waitForUpdate = async () => {
  const update = nextUpdate();
  await vi.advanceTimersByTimeAsync(1);
  await update;
};

const after = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await waitForUpdate();
};

/** How long a menu takes to open (see menu.test.ts). */
const OPENED = 60;
/** How long a menu takes to close: its animation, then 20ms more. */
const CLOSED = DURATION.normal + 30;

const style = (element: Element, name: string) =>
  (element as HTMLElement).style.getPropertyValue(name);

const precedes = (first: Node, second: Node) =>
  !!(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

/**
 * The row that opens the submenu, in the menu.
 */
const sortRow = (rendered: Rendered) =>
  rendered.menu.getAllByRole('button', { name: 'Sort by' })[0]!;

const renderOpenMenu = async (
  platform: { platform: string; osVersion: string } | null = IOS_26,
) => {
  const rendered = await renderSubmenu(platform);
  rendered.host.open.set(true);
  await after(OPENED);
  return rendered;
};

const openSubmenu = async (rendered: Rendered) => {
  fireEvent.tap(sortRow(rendered));
  await after(OPENED);
  expect(rendered.submenuOverlay.getAttribute('visible')).toBe('true');
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('UiMenuSubmenu', () => {
  it('opens over the menu from its row, which fades behind it, and goes back from its header', async () => {
    const rendered = await renderOpenMenu();
    expect(rendered.submenuOverlay.getAttribute('visible')).toBe('false');
    expect(style(rendered.menuContent(), 'opacity')).toBe('1');
    const row = sortRow(rendered);

    await openSubmenu(rendered);
    expect(style(rendered.menuContent(), 'opacity')).toBe('0.3');
    // It grows out of its row, which hides under it meanwhile.
    expect(style(row, 'visibility')).toBe('hidden');
    const header = rendered.submenu.getByRole('button', { name: 'Sort by' });
    expect(
      precedes(header, rendered.submenu.getByRole('button', { name: 'Name' })),
    ).toBe(true);

    fireEvent.tap(header);
    await after(CLOSED);
    expect(rendered.submenuOverlay.getAttribute('visible')).toBe('false');
    expect(style(rendered.menuContent(), 'opacity')).toBe('1');
    expect(style(row, 'visibility')).toBe('');
    expect(rendered.host.open()).toBe(true);
  });

  it('closes every menu when one of its items is chosen', async () => {
    const rendered = await renderOpenMenu();
    await openSubmenu(rendered);

    fireEvent.tap(rendered.submenu.getByRole('button', { name: 'Name' }));
    expect(rendered.host.sort()).toBe('name');
    expect(rendered.host.open()).toBe(false);
    await after(CLOSED);
    expect(rendered.host.closed).toHaveBeenCalled();
    expect(rendered.menuOverlay.getAttribute('visible')).toBe('false');
    expect(rendered.submenuOverlay.getAttribute('visible')).toBe('false');

    // The menu opens on its own items next time.
    rendered.host.open.set(true);
    await after(OPENED);
    expect(rendered.submenuOverlay.getAttribute('visible')).toBe('false');
    expect(style(rendered.menuContent(), 'opacity')).toBe('1');
  });

  it('closes on its own on a tap outside it, or on Android back', async () => {
    const rendered = await renderOpenMenu();
    await openSubmenu(rendered);

    fireEvent.tap(rendered.submenuOverlay.firstElementChild!);
    await after(CLOSED);
    expect(rendered.submenuOverlay.getAttribute('visible')).toBe('false');
    expect(rendered.host.open()).toBe(true);

    await openSubmenu(rendered);
    fireLynxEvent(rendered.submenuOverlay, 'requestclose');
    await after(CLOSED);
    expect(rendered.submenuOverlay.getAttribute('visible')).toBe('false');
    expect(rendered.host.open()).toBe(true);
  });

  it('closes with the menu it is in', async () => {
    const rendered = await renderOpenMenu();
    await openSubmenu(rendered);

    rendered.host.open.set(false);
    await after(CLOSED);
    expect(rendered.submenuOverlay.getAttribute('visible')).toBe('false');

    rendered.host.open.set(true);
    await after(OPENED);
    expect(rendered.submenuOverlay.getAttribute('visible')).toBe('false');
  });

  it("can't be opened or pressed when disabled", async () => {
    const rendered = await renderOpenMenu();
    const moveTo = rendered.menu.getByRole('button', { name: 'Move to' });
    expect(moveTo.className).toContain('opacity-40');

    fireEvent.touchstart(moveTo);
    await waitForUpdate();
    expect(style(moveTo.firstElementChild!, 'opacity')).toBe('0');
    fireEvent.tap(moveTo);
    await after(OPENED);
    expect(
      rendered.container.querySelectorAll('overlay[visible="true"]'),
    ).toHaveLength(1);
  });

  it('highlights its row while pressed, by touch or mouse', async () => {
    const rendered = await renderOpenMenu();
    const highlight = sortRow(rendered).firstElementChild!;

    for (const [down, up] of [
      ['touchstart', 'touchend'],
      ['touchstart', 'touchcancel'],
      ['mousedown', 'mouseup'],
      ['mousedown', 'mouseleave'],
    ]) {
      fireLynxEvent(sortRow(rendered), down!);
      await waitForUpdate();
      expect(style(highlight, 'opacity')).toBe('0.08');
      fireLynxEvent(sortRow(rendered), up!);
      await waitForUpdate();
      expect(style(highlight, 'opacity')).toBe('0');
    }
  });

  it('opens when a finger slides from the trigger onto its row and lifts', async () => {
    const rendered = await renderSubmenu();
    fireLynxEvent(rendered.trigger(), 'touchstart', {
      touches: [{ clientX: 40, clientY: 100 }],
    });
    await after(OPENED);

    // The row is the menu's first, over the trigger.
    const point = { clientX: 100, clientY: TRIGGER.top + ROW_HEIGHT / 2 };
    fireLynxEvent(rendered.trigger(), 'touchmove', { touches: [point] });
    await waitForUpdate();
    expect(style(sortRow(rendered).firstElementChild!, 'opacity')).toBe('0.08');
    fireLynxEvent(rendered.trigger(), 'touchend', {
      touches: [],
      changedTouches: [point],
    });
    await after(OPENED);

    expect(rendered.submenuOverlay.getAttribute('visible')).toBe('true');
  });

  it("doesn't open on the tap of the press that opened the menu", async () => {
    const rendered = await renderSubmenu();
    fireLynxEvent(rendered.trigger(), 'touchstart', {
      touches: [{ clientX: 40, clientY: 100 }],
    });
    await after(OPENED);
    fireLynxEvent(rendered.trigger(), 'touchend', {
      touches: [],
      changedTouches: [{ clientX: 40, clientY: 100 }],
    });
    fireEvent.tap(sortRow(rendered));
    await after(OPENED);

    expect(rendered.submenuOverlay.getAttribute('visible')).toBe('false');
  });

  it('lays its row out as iOS 26 does: the icon first, a chevron last', async () => {
    const rendered = await renderOpenMenu();
    const row = sortRow(rendered);
    const [icon, chevron] = [...row.querySelectorAll('svg')];
    const label = within(row).getByText('Sort by');

    expect(row.className).toContain('min-h-[44px]');
    expect(precedes(icon!, label)).toBe(true);
    expect(chevron!.getAttribute('name')).toBe('chevron-right');
    expect(precedes(label, chevron!)).toBe(true);
    expect(style(icon!, 'width')).toBe('20px');

    await openSubmenu(rendered);
    const header = rendered.submenu.getByRole('button', { name: 'Sort by' });
    expect(within(header).getByText('Sort by').className).toContain(
      'font-semibold',
    );
    expect(header.querySelector('svg')!.getAttribute('name')).toBe(
      'chevron-down',
    );
  });

  it('puts the icon after the label before iOS 26', async () => {
    const rendered = await renderOpenMenu(IOS_18);
    const row = sortRow(rendered);
    const [icon] = [...row.querySelectorAll('svg')];

    expect(icon!.getAttribute('content')).toContain('M12 5v14');
    expect(precedes(within(row).getByText('Sort by'), icon!)).toBe(true);
  });

  it('lays out as Material 3 does, with a back arrow in its header', async () => {
    const rendered = await renderOpenMenu(null);
    const row = sortRow(rendered);
    expect(row.className).toContain('min-h-[48px]');
    expect(style(row.querySelector('svg')!, 'width')).toBe('24px');

    await openSubmenu(rendered);
    const header = rendered.submenu.getByRole('button', { name: 'Sort by' });
    const arrow = header.querySelector('svg')!;
    expect(arrow.getAttribute('name')).toBe('chevron-left');
    expect(precedes(arrow, within(header).getByText('Sort by'))).toBe(true);
  });
});
