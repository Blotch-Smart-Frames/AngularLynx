import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
  within,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { UiGlass } from '../glass/glass';
import {
  UiMenu,
  UiMenuItem,
  UiMenuSection,
  UiMenuSeparator,
  UiMenuTrigger,
} from './menu';

@Component({
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

/**
 * Renders the menu on a platform (none for Material), measuring elements as
 * `boundingClientRect` would on a phone: the safe area (the element that
 * holds the menu) a phone's screen, the menu's content 120pt tall, and
 * anything else, the trigger, a small box near the top.
 */
const renderMenu = async (
  platform: { platform: string; osVersion: string } | null = IOS_26,
) => {
  vi.stubGlobal('SystemInfo', platform ?? undefined);
  const invoke = vi
    .spyOn(globalThis as unknown as InvokeUIMethod, '__InvokeUIMethod')
    .mockImplementation((element, method, _params, callback) => {
      if (method !== 'boundingClientRect') {
        callback({ code: 0 });
        return;
      }
      const data = element.querySelector(':scope > blur-view[ui-glass]')
        ? { left: 0, top: 0, width: 402, height: 800 }
        : element.parentElement?.tagName.toLowerCase() === 'scroll-view'
          ? { left: 0, top: 0, width: 250, height: 120 }
          : { left: 16, top: 80, width: 80, height: 44 };
      callback({ code: 0, data });
    });
  const result = await render(MenuHost, {
    providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
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
  await vi.waitFor(() => expect(rendered.host.closed).toHaveBeenCalled());
  await waitForUpdate();
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
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
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

describe('UiMenuSection and UiMenuSeparator', () => {
  it('titles a section, as a heading', async () => {
    const rendered = await renderOpenMenu();

    const title = rendered.menu.getByRole('heading', { name: 'Sort by' });
    expect(title.className).toContain('px-4');
    // The untitled section has no heading.
    expect(rendered.menu.getAllByRole('heading')).toHaveLength(1);
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
