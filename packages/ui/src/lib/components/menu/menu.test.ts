import { Component, ErrorHandler, type Provider, signal } from '@angular/core';
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
import { UiGlass } from '../glass/glass';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import { type IconName, provideIcons } from '../icon/icons';
import {
  UiMenu,
  UiMenuItem,
  UiMenuSection,
  UiMenuSeparator,
  UiMenuTrigger,
} from './menu';
import { starIcon, trashIcon, uploadIcon } from '../icon/icon-set';

// The icons these specs draw by name, registered as an app registers its own.
const TEST_ICONS = provideIcons({ starIcon, trashIcon, uploadIcon });

/**
 * An app's own one-color mark, with no SVG namespace, as an app writes one.
 */
const MARK =
  '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Z"/></svg>';

@Component({
  providers: [TEST_ICONS],
  imports: [
    LYNX_ELEMENTS,
    UiGlass,
    UiMenu,
    UiMenuTrigger,
    UiMenuItem,
    UiMenuSection,
    UiMenuSeparator,
  ],
  template: `
    <ui-menu
      [open]="open()"
      (openChange)="open.set($event)"
      (closed)="closed()"
    >
      @if (glassTrigger()) {
        <blur-view
          ui-glass
          uiMenuTrigger
          class="trigger"
          [accessibility-element]="true"
          accessibility-traits="button"
          accessibility-label="Sort"
        >
          <text>Sort</text>
        </blur-view>
      } @else if (withTrigger()) {
        <view
          uiMenuTrigger
          class="trigger"
          [accessibility-element]="true"
          accessibility-traits="button"
          accessibility-label="Sort"
        >
          <text>Sort</text>
        </view>
      }
      <ui-menu-section title="Sort by">
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
      <ui-menu-separator />
      <ui-menu-section>
        <ui-menu-item label="Share" icon="upload" (pressed)="shared()" />
        <ui-menu-item
          label="Delete"
          icon="trash"
          variant="destructive"
          (pressed)="deleted()"
        />
        <ui-menu-item
          label="Archive"
          accessibilityLabel="Archive, unavailable offline"
          disabled
          (pressed)="archived()"
        />
        <ui-menu-item
          label="Open in Acme"
          [icon]="markIcon()"
          [svg]="mark()"
          [variant]="markVariant()"
        />
        <ui-menu-item label="Bold" checked />
        <ui-menu-item label="Pin" [checked]="pinned()" />
      </ui-menu-section>
    </ui-menu>
  `,
})
class MenuHost {
  readonly open = signal(false);
  readonly withTrigger = signal(true);
  readonly glassTrigger = signal(false);
  readonly sort = signal<'name' | 'date'>('date');
  readonly pinned = signal<boolean | undefined>(undefined);
  readonly mark = signal<string | undefined>(MARK);
  readonly markIcon = signal<IconName | undefined>(undefined);
  readonly markVariant = signal<'default' | 'destructive'>('default');
  readonly closed = vi.fn();
  readonly shared = vi.fn();
  readonly deleted = vi.fn();
  readonly archived = vi.fn();
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
const IOS_18 = { platform: 'iOS', osVersion: '18.5' };

/** Where the trigger is on screen, near the top: the menu opens below it. */
const TRIGGER = { left: 16, top: 80, width: 80, height: 44 };
/** How tall each of the menu's rows is, as measured. */
const ROW_HEIGHT = 44;

/**
 * Renders the menu on a platform (none for Material), measuring elements as
 * `boundingClientRect` would on a phone: the safe area (the element that
 * holds the menu) a phone's screen, the menu's content 120pt tall with its
 * rows ROW_HEIGHT apart from its top, in document order, and anything
 * else, the trigger, at `trigger`.
 */
const renderMenu = async (
  platform: { platform: string; osVersion: string } | null = IOS_26,
  trigger = TRIGGER,
  providers: Provider[] = [],
) => {
  vi.stubGlobal('SystemInfo', platform ?? undefined);
  const invoke = vi
    .spyOn(globalThis as unknown as InvokeUIMethod, '__InvokeUIMethod')
    .mockImplementation((element, method, _params, callback) => {
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
          ? { left: 0, top: 0, width: 250, height: 120 }
          : rows.includes(element)
            ? {
                left: 0,
                top: rows.indexOf(element) * ROW_HEIGHT,
                width: 250,
                height: ROW_HEIGHT,
              }
            : trigger;
      callback({ code: 0, data });
    });
  const result = await render(MenuHost, {
    providers: [
      { provide: LynxAccessibilitySettings, useValue: settings },
      ...providers,
    ],
  });
  const host = result.componentRef.instance as MenuHost;
  const overlay = result.container.querySelector('overlay')!;
  return {
    ...result,
    host,
    invoke,
    overlay,
    menu: within(overlay as HTMLElement),
    trigger: () => result.container.querySelector('.trigger') as HTMLElement,
    panel: () => overlay.querySelector('blur-view[ui-glass]')!,
  };
};

type Rendered = Awaited<ReturnType<typeof renderMenu>>;

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
 * Renders the menu and opens it: a screen reader, and the queries, reach
 * its items only while it shows.
 */
const renderOpenMenu = async (
  platform: { platform: string; osVersion: string } | null = IOS_26,
) => {
  const rendered = await renderMenu(platform);
  rendered.host.open.set(true);
  await waitForOpen(rendered);
  return rendered;
};

/**
 * Whether `first` comes before `second` in the document.
 */
const precedes = (first: Node, second: Node) =>
  !!(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

/**
 * Waits until the menu has closed and its animation has finished.
 */
const waitForClose = async (rendered: Rendered) => {
  await after(CLOSED);
  expect(rendered.host.closed).toHaveBeenCalled();
};

const style = (element: Element, name: string) =>
  (element as HTMLElement).style.getPropertyValue(name);

/**
 * An item's row: the element a screen reader reads as a button.
 */
const row = (rendered: Rendered, name: string | RegExp) =>
  rendered.menu.getByRole('button', { name });

// The renderer warns that the components' selectors aren't Lynx elements.
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('UiMenu', () => {
  it('opens from its trigger and grows out of it, hiding it meanwhile', async () => {
    const rendered = await renderMenu();
    const { host, trigger, overlay, invoke } = rendered;
    expect(overlay.getAttribute('visible')).toBe('false');

    fireEvent.tap(trigger());
    await waitForOpen(rendered);

    expect(host.open()).toBe(true);
    expect(overlay.getAttribute('visible')).toBe('true');
    // Measured from the trigger.
    expect(invoke).toHaveBeenCalledWith(
      trigger(),
      'boundingClientRect',
      { relativeTo: 'screen' },
      expect.any(Function),
    );
    expect(style(trigger(), 'visibility')).toBe('hidden');

    // A tap on the trigger again closes it, and the trigger comes back.
    fireEvent.tap(trigger());
    await waitForClose(rendered);
    expect(host.open()).toBe(false);
    expect(style(trigger(), 'visibility')).toBe('');
    // A trigger that isn't glass has no glass to hand over.
    expect(trigger().hasAttribute('glass-effect-id')).toBe(false);
  });

  it("takes a glass trigger's glass over, shown as the trigger hides", async () => {
    const rendered = await renderMenu();
    rendered.host.glassTrigger.set(true);
    await waitForUpdate();
    const { trigger, panel } = rendered;

    // The trigger and the menu share an id of the menu's own, for the shell
    // to pair the two across the change.
    const id = trigger().getAttribute('glass-effect-id');
    expect(id).toMatch(/^ui-menu-\d+$/);
    expect(panel().getAttribute('glass-effect-id')).toBe(id);
    expect(style(panel(), 'visibility')).toBe('hidden');

    fireEvent.tap(trigger());
    await waitForOpen(rendered);
    expect(style(panel(), 'visibility')).toBe('');
    expect(style(trigger(), 'visibility')).toBe('hidden');

    fireEvent.tap(trigger());
    await waitForClose(rendered);
    expect(style(panel(), 'visibility')).toBe('hidden');
    expect(style(trigger(), 'visibility')).toBe('');

    // A trigger that goes takes its glass with it.
    rendered.host.glassTrigger.set(false);
    await waitForUpdate();
    expect(trigger().tagName.toLowerCase()).toBe('view');
  });

  it('closes when an item is chosen, after telling it', async () => {
    const rendered = await renderMenu();
    rendered.host.open.set(true);
    await waitForOpen(rendered);

    fireEvent.tap(row(rendered, 'Share'));

    expect(rendered.host.shared).toHaveBeenCalledTimes(1);
    expect(rendered.host.open()).toBe(false);
    await waitForClose(rendered);
    expect(rendered.overlay.getAttribute('visible')).toBe('false');
  });

  it('closes on a tap outside it', async () => {
    const rendered = await renderMenu();
    rendered.host.open.set(true);
    await waitForOpen(rendered);

    fireEvent.tap(rendered.overlay.firstElementChild!);

    expect(rendered.host.open()).toBe(false);
    await waitForClose(rendered);
  });

  it('grows out of the menu itself without a marked trigger', async () => {
    const rendered = await renderMenu();
    rendered.host.withTrigger.set(false);
    await waitForUpdate();

    rendered.host.open.set(true);
    await waitForOpen(rendered);

    // The menu's own element holds the overlay's element.
    expect(rendered.invoke).toHaveBeenCalledWith(
      rendered.overlay.parentElement!.parentElement,
      'boundingClientRect',
      { relativeTo: 'screen' },
      expect.any(Function),
    );
  });

  it('opens beside its trigger on Material, leaving it in view', async () => {
    const rendered = await renderMenu(null);

    fireEvent.tap(rendered.trigger());
    await waitForOpen(rendered);

    expect(style(rendered.trigger(), 'visibility')).toBe('');
    // Below the trigger, a gap away.
    expect(style(rendered.panel(), 'top')).toBe(`${80 + 44 + 8}px`);
  });
});

describe('UiMenuItem', () => {
  it('is a button named by its label, and says when it is destructive', async () => {
    const rendered = await renderOpenMenu();

    expect(row(rendered, 'Share')).toBeTruthy();
    expect(row(rendered, 'Delete, destructive')).toBeTruthy();
    expect(row(rendered, 'Archive, unavailable offline')).toBeTruthy();
    expect(
      within(row(rendered, 'Delete, destructive')).getByText('Delete')
        .className,
    ).toContain('text-destructive');
    expect(
      within(row(rendered, 'Share')).getByText('Share').className,
    ).toContain('text-glass-foreground');
  });

  it('shows a checkmark, and is selected to a screen reader, when checked', async () => {
    const rendered = await renderOpenMenu();
    const date = row(rendered, 'Date');
    const name = row(rendered, 'Name');

    expect(date.getAttribute('accessibility-traits')).toBe('button,selected');
    expect(name.getAttribute('accessibility-traits')).toBe('button');
    // Both keep the checkmark's column, so the labels line up.
    expect(date.querySelector('.h-5.w-5 svg')).not.toBeNull();
    expect(name.querySelector('.h-5.w-5')).not.toBeNull();
    expect(name.querySelector('.h-5.w-5 svg')).toBeNull();

    fireEvent.tap(name);
    await waitForUpdate();
    expect(rendered.host.sort()).toBe('name');
    expect(name.getAttribute('accessibility-traits')).toBe('button,selected');
    expect(date.getAttribute('accessibility-traits')).toBe('button');
    await waitForClose(rendered);
  });

  it('is checked by a bare checked attribute, and unset when bound to undefined', async () => {
    const rendered = await renderOpenMenu();
    const bold = row(rendered, 'Bold');
    const pin = row(rendered, 'Pin');

    expect(bold.getAttribute('accessibility-traits')).toBe('button,selected');
    expect(bold.querySelector('.h-5.w-5 svg')).not.toBeNull();
    // Unset, it's an item that's never checked: no checkmark column.
    expect(pin.querySelector('.h-5.w-5')).toBeNull();

    rendered.host.pinned.set(false);
    await waitForUpdate();
    expect(pin.querySelector('.h-5.w-5')).not.toBeNull();
    expect(pin.querySelector('.h-5.w-5 svg')).toBeNull();
  });

  it('highlights while pressed, by touch or mouse', async () => {
    const rendered = await renderOpenMenu();
    const share = row(rendered, 'Share');
    const highlight = share.firstElementChild!;
    expect(style(highlight, 'opacity')).toBe('0');

    for (const [down, up] of [
      ['touchstart', 'touchend'],
      ['touchstart', 'touchcancel'],
      ['mousedown', 'mouseup'],
      ['mousedown', 'mouseleave'],
    ]) {
      fireLynxEvent(share, down!);
      await waitForUpdate();
      expect(style(highlight, 'opacity')).toBe('0.08');
      fireLynxEvent(share, up!);
      await waitForUpdate();
      expect(style(highlight, 'opacity')).toBe('0');
    }
  });

  it('highlights a pressed row as its platform does', async () => {
    const pressed = async (
      platform: { platform: string; osVersion: string } | null,
    ) => {
      const rendered = await renderOpenMenu(platform);
      const share = row(rendered, 'Share');
      fireLynxEvent(share, 'touchstart');
      await waitForUpdate();
      const highlight = share.firstElementChild!;
      return {
        classes: highlight.className.split(' '),
        opacity: style(highlight, 'opacity'),
      };
    };

    // iOS 26's capsule, inset from the menu's sides.
    const glass = await pressed(IOS_26);
    expect(glass.classes).toEqual(
      expect.arrayContaining(['left-[10px]', 'right-[10px]', 'rounded-full']),
    );
    expect(glass.opacity).toBe('0.08');
    // Edge to edge before iOS 26, and as Material's state layer.
    for (const platform of [IOS_18, null]) {
      const { classes, opacity } = await pressed(platform);
      expect(classes).toEqual(expect.arrayContaining(['left-0', 'right-0']));
      expect(classes).not.toContain('rounded-full');
      expect(opacity).toBe('0.1');
    }
  });

  it("can't be pressed or chosen when disabled", async () => {
    const rendered = await renderOpenMenu();
    const archive = row(rendered, 'Archive, unavailable offline');

    expect(archive.className).toContain('opacity-40');
    fireEvent.touchstart(archive);
    await waitForUpdate();
    expect(style(archive.firstElementChild!, 'opacity')).toBe('0');
    fireEvent.tap(archive);

    expect(rendered.host.archived).not.toHaveBeenCalled();
    expect(rendered.host.open()).toBe(true);
  });

  it('lays out as iOS 26 does: 44pt rows with the icon first', async () => {
    const rendered = await renderOpenMenu();
    const share = row(rendered, 'Share');
    const label = within(share).getByText('Share');

    expect(share.className).toContain('min-h-[44px]');
    expect(label.className).toContain('text-[17px]');
    expect(precedes(share.querySelector('svg')!, label)).toBe(true);
  });

  it('puts the icon after the label before iOS 26', async () => {
    const rendered = await renderOpenMenu(IOS_18);
    const share = row(rendered, 'Share');

    expect(
      precedes(within(share).getByText('Share'), share.querySelector('svg')!),
    ).toBe(true);
  });

  it('lays out as Material 3 does: 48dp rows with a leading icon', async () => {
    const rendered = await renderOpenMenu(null);
    const share = row(rendered, 'Share');
    const label = within(share).getByText('Share');

    expect(share.className).toContain('min-h-[48px]');
    expect(label.className).toContain('text-[16px]');
    expect(precedes(share.querySelector('svg')!, label)).toBe(true);
  });
});

/**
 * A touch event with one finger at (x, y) in the window, as Lynx sends it.
 */
const touchAt = (x: number, y: number) => ({
  touches: [{ clientX: x, clientY: y }],
});
/**
 * A touchend: the finger that lifted is only in changedTouches.
 */
const liftAt = (x: number, y: number) => ({
  touches: [],
  changedTouches: [{ clientX: x, clientY: y }],
});

/**
 * The middle of a row on screen, by its place in the menu: the menu opens
 * over the trigger at TRIGGER's corner, and its rows are ROW_HEIGHT apart.
 */
const rowAt = (index: number) => ({
  x: TRIGGER.left + 100,
  y: TRIGGER.top + index * ROW_HEIGHT + ROW_HEIGHT / 2,
});
const NAME = 0;
const SHARE = 2;
const ARCHIVE = 4;

const highlight = (rendered: Rendered, name: string | RegExp) =>
  style(row(rendered, name).firstElementChild!, 'opacity');

describe('dragging across the menu', () => {
  /**
   * Renders the menu and presses its trigger down, which opens it on iOS,
   * with LynxHaptics' selection tap spied on.
   */
  const pressTrigger = async (
    platform: { platform: string; osVersion: string } | null = IOS_26,
  ) => {
    const rendered = await renderMenu(platform);
    const selection = vi.spyOn(
      rendered.componentRef.injector.get(LynxHaptics),
      'selection',
    );
    fireLynxEvent(rendered.trigger(), 'touchstart', touchAt(40, 100));
    await waitForUpdate();
    return { ...rendered, selection };
  };

  const moveTo = async (
    rendered: Rendered,
    point: { x: number; y: number },
  ) => {
    fireLynxEvent(rendered.trigger(), 'touchmove', touchAt(point.x, point.y));
    await waitForUpdate();
  };

  it('opens on iOS as the finger touches the trigger down, and stays open when it lifts', async () => {
    const rendered = await pressTrigger();
    expect(rendered.host.open()).toBe(true);
    await waitForOpen(rendered);

    // The tap that ends the press doesn't close it again.
    fireLynxEvent(rendered.trigger(), 'touchend', liftAt(40, 100));
    fireEvent.tap(rendered.trigger());
    await waitForUpdate();
    expect(rendered.host.open()).toBe(true);
    expect(rendered.host.shared).not.toHaveBeenCalled();
  });

  it("doesn't choose the item that grew under a finger that lifts without sliding", async () => {
    const rendered = await pressTrigger();
    await waitForOpen(rendered);

    // Lynx sends the press's tap to the row under the finger by then.
    fireLynxEvent(rendered.trigger(), 'touchend', liftAt(40, 100));
    fireEvent.tap(row(rendered, 'Name'));
    await waitForUpdate();
    expect(rendered.host.sort()).toBe('date');
    expect(rendered.host.open()).toBe(true);

    // A tap of its own chooses it.
    await after(600);
    fireEvent.tap(row(rendered, 'Name'));
    expect(rendered.host.sort()).toBe('name');
  });

  it("stays open when the press's tap lands outside it, as beside a trigger wider than the menu", async () => {
    const rendered = await pressTrigger();
    await waitForOpen(rendered);

    fireLynxEvent(rendered.trigger(), 'touchend', liftAt(380, 100));
    fireEvent.tap(rendered.overlay.firstElementChild!);
    await waitForUpdate();
    expect(rendered.host.open()).toBe(true);

    // A tap of its own outside it closes it.
    await after(600);
    fireEvent.tap(rendered.overlay.firstElementChild!);
    expect(rendered.host.open()).toBe(false);
  });

  it('chooses the item the finger slides onto and lifts on, with a tap on each', async () => {
    const rendered = await pressTrigger();
    await waitForOpen(rendered);

    await moveTo(rendered, rowAt(NAME));
    expect(highlight(rendered, 'Name')).toBe('0.08');
    await moveTo(rendered, rowAt(SHARE));
    expect(highlight(rendered, 'Name')).toBe('0');
    expect(highlight(rendered, 'Share')).toBe('0.08');
    expect(rendered.selection).toHaveBeenCalledTimes(2);
    // Moving within the row lights nothing new.
    await moveTo(rendered, { ...rowAt(SHARE), y: rowAt(SHARE).y + 5 });
    expect(rendered.selection).toHaveBeenCalledTimes(2);

    const { x, y } = rowAt(SHARE);
    fireLynxEvent(rendered.trigger(), 'touchend', liftAt(x, y));
    fireEvent.tap(rendered.trigger());
    await waitForUpdate();

    expect(rendered.host.shared).toHaveBeenCalledTimes(1);
    expect(rendered.host.open()).toBe(false);
    await waitForClose(rendered);
  });

  it("doesn't light up or choose a disabled item", async () => {
    const rendered = await pressTrigger();
    await waitForOpen(rendered);

    await moveTo(rendered, rowAt(ARCHIVE));
    expect(highlight(rendered, 'Archive, unavailable offline')).toBe('0');
    expect(rendered.selection).not.toHaveBeenCalled();
    fireLynxEvent(
      rendered.trigger(),
      'touchend',
      liftAt(rowAt(ARCHIVE).x, rowAt(ARCHIVE).y),
    );
    expect(rendered.host.archived).not.toHaveBeenCalled();
    expect(rendered.host.open()).toBe(true);
  });

  it("doesn't light up or choose anything beside the menu, or below it", async () => {
    const rendered = await pressTrigger();
    await waitForOpen(rendered);
    // The press is followed: the row lights up under the finger.
    await moveTo(rendered, rowAt(SHARE));
    expect(highlight(rendered, 'Share')).toBe('0.08');

    await moveTo(rendered, { x: 380, y: rowAt(SHARE).y });
    expect(highlight(rendered, 'Share')).toBe('0');
    await moveTo(rendered, { x: rowAt(SHARE).x, y: 700 });
    expect(highlight(rendered, 'Share')).toBe('0');
    fireLynxEvent(rendered.trigger(), 'touchend', liftAt(rowAt(SHARE).x, 700));
    await waitForUpdate();
    expect(rendered.host.shared).not.toHaveBeenCalled();
    expect(rendered.host.open()).toBe(true);
  });

  it('turns the highlight off when the system takes the touch over', async () => {
    const rendered = await pressTrigger();
    await waitForOpen(rendered);
    await moveTo(rendered, rowAt(SHARE));
    expect(highlight(rendered, 'Share')).toBe('0.08');

    fireLynxEvent(rendered.trigger(), 'touchcancel');
    await waitForUpdate();
    expect(highlight(rendered, 'Share')).toBe('0');
    expect(rendered.host.open()).toBe(true);

    // No tap follows a canceled touch, so the next tap is one of its own.
    fireEvent.tap(row(rendered, 'Share'));
    expect(rendered.host.shared).toHaveBeenCalledTimes(1);
  });

  it('chooses the row the lifting finger is on, not one another finger rests on', async () => {
    const rendered = await pressTrigger();
    await waitForOpen(rendered);
    await moveTo(rendered, rowAt(SHARE));

    const share = rowAt(SHARE);
    const name = rowAt(NAME);
    fireLynxEvent(rendered.trigger(), 'touchend', {
      touches: [{ clientX: name.x, clientY: name.y }],
      changedTouches: [{ clientX: share.x, clientY: share.y }],
    });
    await waitForUpdate();
    expect(rendered.host.shared).toHaveBeenCalledTimes(1);
    expect(rendered.host.sort()).toBe('date');
  });

  it('chooses nothing while the menu is still growing', async () => {
    const rendered = await pressTrigger();
    await moveTo(rendered, rowAt(SHARE));
    fireLynxEvent(
      rendered.trigger(),
      'touchend',
      liftAt(rowAt(SHARE).x, rowAt(SHARE).y),
    );
    await waitForOpen(rendered);

    expect(rendered.host.shared).not.toHaveBeenCalled();
    expect(highlight(rendered, 'Share')).toBe('0');
  });

  it('opens on the tap on Material, as Android does, without following the finger', async () => {
    const rendered = await pressTrigger(null);
    expect(rendered.host.open()).toBe(false);

    fireLynxEvent(rendered.trigger(), 'touchend', liftAt(40, 100));
    fireEvent.tap(rendered.trigger());
    await waitForOpen(rendered);
    expect(rendered.host.open()).toBe(true);
  });

  it('toggles on a tap that comes on its own, as a screen reader sends', async () => {
    const rendered = await pressTrigger();
    await waitForOpen(rendered);
    fireLynxEvent(rendered.trigger(), 'touchend', liftAt(40, 100));

    // Long after the press, a tap is one of its own.
    await after(600);
    fireEvent.tap(rendered.trigger());
    await waitForUpdate();
    expect(rendered.host.open()).toBe(false);
  });

  it("ignores a press on the trigger while it's open, and moves without a press", async () => {
    const rendered = await renderOpenMenu();
    await moveTo(rendered, rowAt(SHARE));
    expect(highlight(rendered, 'Share')).toBe('0');

    fireLynxEvent(rendered.trigger(), 'touchstart', touchAt(40, 100));
    await moveTo(rendered, rowAt(SHARE));
    expect(highlight(rendered, 'Share')).toBe('0');
  });

  it('stops listening for moves once the trigger goes', async () => {
    const rendered = await pressTrigger();
    await waitForOpen(rendered);
    const trigger = rendered.trigger();
    rendered.host.withTrigger.set(false);
    await waitForUpdate();

    fireLynxEvent(
      trigger,
      'touchmove',
      touchAt(rowAt(SHARE).x, rowAt(SHARE).y),
    );
    await waitForUpdate();
    expect(highlight(rendered, 'Share')).toBe('0');

    // Its press can't lift any more, so the next tap is one of its own.
    fireEvent.tap(row(rendered, 'Share'));
    expect(rendered.host.shared).toHaveBeenCalledTimes(1);
  });
});

describe('a menu that opens upward', () => {
  /** A trigger near the bottom of the screen, too low for the menu below. */
  const LOW_TRIGGER = { left: 16, top: 740, width: 80, height: 44 };

  const direction = (element: Element) => style(element, 'flex-direction');
  const content = (rendered: Rendered) =>
    rendered.overlay.querySelector('scroll-view > view')!;
  const sectionItems = (rendered: Rendered) =>
    row(rendered, 'Name').parentElement!.parentElement!;

  it('lists its items from the bottom up on iOS, so the first is nearest the finger', async () => {
    const rendered = await renderMenu(IOS_26, LOW_TRIGGER);
    expect(direction(content(rendered))).toBe('column');

    rendered.host.open.set(true);
    await waitForOpen(rendered);

    expect(direction(content(rendered))).toBe('column-reverse');
    // A section's items too, under its title, as in UIKit.
    const items = sectionItems(rendered);
    expect(direction(items)).toBe('column-reverse');
    const title = rendered.menu.getByRole('heading', { name: 'Sort by' });
    expect(precedes(title, items)).toBe(true);

    rendered.host.open.set(false);
    await waitForClose(rendered);
    expect(direction(content(rendered))).toBe('column');
    expect(direction(items)).toBe('column');
  });

  it('keeps the order on Material, as Android does', async () => {
    const rendered = await renderMenu(null, LOW_TRIGGER);
    rendered.host.open.set(true);
    await waitForOpen(rendered);

    expect(direction(content(rendered))).toBe('column');
  });

  it('keeps the order when it opens downward', async () => {
    const rendered = await renderOpenMenu();

    expect(direction(content(rendered))).toBe('column');
  });
});

describe("UiMenuItem's own svg", () => {
  /**
   * The markup the item's icon draws.
   */
  const iconOf = (rendered: Rendered, name: string) =>
    row(rendered, name).querySelector('svg')!.getAttribute('content') ?? '';

  it("draws the app's own svg in the item's color, where the set's icon goes", async () => {
    const rendered = await renderOpenMenu();
    const item = row(rendered, 'Open in Acme');
    const icon = iconOf(rendered, 'Open in Acme');

    // The namespace the web preview needs to draw it, and the glass's
    // foreground in place of currentColor, at the row's icon size.
    expect(icon).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(icon).toContain(`fill="${ICON_LIGHT_COLORS['glass-foreground']}"`);
    expect(icon).not.toContain('currentColor');
    expect(item.querySelector<HTMLElement>('svg')!.style.width).toBe('20px');
    expect(
      precedes(
        item.querySelector('svg')!,
        within(item).getByText('Open in Acme'),
      ),
    ).toBe(true);

    // A destructive item draws it in the destructive color, as it does the
    // set's icons.
    rendered.host.markVariant.set('destructive');
    await waitForUpdate();
    expect(iconOf(rendered, 'Open in Acme, destructive')).toContain(
      `fill="${ICON_LIGHT_COLORS['destructive']}"`,
    );
  });

  it('puts it after the label before iOS 26, as the set’s icons', async () => {
    const rendered = await renderOpenMenu(IOS_18);
    const item = row(rendered, 'Open in Acme');

    expect(
      precedes(
        within(item).getByText('Open in Acme'),
        item.querySelector('svg')!,
      ),
    ).toBe(true);
  });

  it('reports an error with both an icon and an svg', async () => {
    const handleError = vi.fn();
    const rendered = await renderMenu(IOS_26, TRIGGER, [
      { provide: ErrorHandler, useValue: { handleError } },
    ]);
    rendered.host.open.set(true);
    await waitForOpen(rendered);
    expect(handleError).not.toHaveBeenCalled();

    rendered.host.markIcon.set('star');
    await waitForUpdate();
    expect(handleError.mock.calls.map(([error]) => error)).toContainEqual(
      new Error('<ui-menu-item> takes an icon or an svg, not both.'),
    );

    // The icon alone is right, and so is neither.
    handleError.mockClear();
    rendered.host.mark.set(undefined);
    await waitForUpdate();
    expect(handleError).not.toHaveBeenCalled();
    expect(iconOf(rendered, 'Open in Acme')).toContain('<svg');
    rendered.host.markIcon.set(undefined);
    await waitForUpdate();
    expect(handleError).not.toHaveBeenCalled();
    expect(row(rendered, 'Open in Acme').querySelector('svg')).toBeNull();
  });
});

describe('UiMenuSection and UiMenuSeparator', () => {
  it('titles a section, as a heading', async () => {
    const rendered = await renderOpenMenu();

    const title = rendered.menu.getByRole('heading', { name: 'Sort by' });
    expect(title.className).toContain('px-4');
    // The untitled section has no heading.
    expect(rendered.menu.getAllByRole('heading')).toHaveLength(1);
  });

  // Angular gives a component's host every static attribute written on it
  // (issue #181): the title was also the host's tooltip in the web preview.
  it("doesn't give its title to its host as well", async () => {
    const rendered = await renderOpenMenu();

    expect(rendered.container.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('indents a Material section title as Material does', async () => {
    const rendered = await renderOpenMenu(null);

    expect(
      rendered.menu.getByRole('heading', { name: 'Sort by' }).className,
    ).toContain('px-3');
  });

  it('parts sections with a line, or a band before iOS 26', async () => {
    const separatorLine = async (
      platform: { platform: string; osVersion: string } | null,
    ) => {
      const rendered = await renderMenu(platform);
      const line = rendered.overlay.querySelector(
        '[class~="h-px"], [class~="h-2"]',
      )!.className;
      rendered.unmount();
      return line;
    };

    expect((await separatorLine(IOS_26)).split(' ')).toEqual(
      expect.arrayContaining(['h-px', 'bg-glass-foreground', 'opacity-20']),
    );
    expect((await separatorLine(IOS_18)).split(' ')).toEqual(
      expect.arrayContaining(['h-2', 'bg-glass-foreground', 'opacity-10']),
    );
    expect((await separatorLine(null)).split(' ')).toEqual(
      expect.arrayContaining(['h-px', 'bg-border']),
    );
  });
});
