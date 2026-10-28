import { Component, signal, viewChild } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { DURATION } from '../../utils/animate';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import {
  type LynxMainThread,
  lynxMainThread,
} from '../../../test-utils/lynx-main-thread';
import { UiIcon } from '../icon/icon';
import {
  UiNavDrawer,
  UiNavDrawerContent,
  UiNavDrawerFooter,
  UiNavDrawerHeader,
  UiNavDrawerItem,
  UiNavDrawerTrigger,
} from './nav-drawer';

@Component({
  imports: [
    UiNavDrawer,
    UiNavDrawerHeader,
    UiNavDrawerContent,
    UiNavDrawerItem,
    UiNavDrawerFooter,
    UiNavDrawerTrigger,
    UiIcon,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-nav-drawer-trigger class="ml-2" (pressed)="open.set(true)" />
    @if (shown()) {
      <ui-nav-drawer
        [(open)]="open"
        [side]="side()"
        class="shadow-lg"
        (closed)="closes.set(closes() + 1)"
      >
        <ui-nav-drawer-header class="gap-3">
          <text>Menu</text>
        </ui-nav-drawer-header>
        <ui-nav-drawer-content class="pt-2">
          <ui-nav-drawer-item
            [active]="active() === 'home'"
            (pressed)="presses.set(presses() + 1)"
          >
            <text class="text-foreground">Home</text>
          </ui-nav-drawer-item>
          <!-- A group: items nested in other elements count too. -->
          <view class="group">
            <ui-nav-drawer-item #settings [active]="active() === 'settings'">
              <text class="text-foreground">Settings</text>
            </ui-nav-drawer-item>
          </view>
          <ui-nav-drawer-item
            [variant]="deleteVariant()"
            [autoClose]="false"
            class="mt-4"
          >
            <ui-icon name="trash" size="sm" />
            <text class="text-foreground">Delete account</text>
          </ui-nav-drawer-item>
        </ui-nav-drawer-content>
        <ui-nav-drawer-footer class="gap-4">
          <text>Version 1</text>
        </ui-nav-drawer-footer>
      </ui-nav-drawer>
    }
    <!-- What the trash icon looks like plain, and in the destructive color. -->
    <ui-icon name="trash" size="sm" class="plain-trash" />
    <ui-icon
      name="trash"
      size="sm"
      color="var(--destructive)"
      class="destructive-trash"
    />
  `,
})
class NavDrawerHost {
  readonly open = signal(false);
  readonly side = signal<'left' | 'right'>('left');
  readonly active = signal('settings');
  readonly deleteVariant = signal<'default' | 'destructive'>('destructive');
  // Takes the drawer out of the tree, as an `@if` or a route change would.
  readonly shown = signal(true);
  readonly closes = signal(0);
  readonly presses = signal(0);
  readonly drawer = viewChild.required(UiNavDrawer);
  readonly settings = viewChild.required<UiNavDrawerItem>('settings');
}

const renderDrawer = async () => {
  const result = await render(NavDrawerHost);
  const { container, getByText } = result;
  const panel = () =>
    container.querySelector('[accessibility-exclusive-focus]')!;
  return {
    ...result,
    host: result.componentRef.instance as NavDrawerHost,
    overlay: () => container.querySelector('overlay')!,
    panel,
    backdrop: () => panel().parentElement!,
    scrollView: () => container.querySelector('scroll-view')!,
    trigger: () => container.querySelector('[accessibility-element]')!,
    // An item's own view, which holds its projected label.
    item: (label: string) => getByText(label).parentElement!,
    svg: (selector: string) => container.querySelector(`svg${selector}`)!,
  };
};

/**
 * Waits for the drawer's open or close sequence, which runs on timers, then
 * renders what it changed.
 */
const after = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await waitForUpdate();
};

/**
 * Long enough for the open sequence. The sequence is chained timers, and on
 * Windows each can fire up to a clock tick (about 16ms) late, so 50ms was too
 * short for the dialogs' sequences on CI's Windows runner.
 */
const OPENED = 150;
/** Long enough for the close animation and the hide after it, as above. */
const CLOSED = DURATION.normal + 150;

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;
/** `__ElementAnimate`'s first argument for canceling an animation. */
const CANCEL = 3;

/**
 * The scale a pressable view's inline style holds, if any.
 */
const scaleOf = (view: Element) =>
  (view as HTMLElement).style.getPropertyValue('transform');

describe('UiNavDrawer', () => {
  // Watched per test: the testing library resets the main thread after each.
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => animate.mockRestore());

  it('renders each part with its projected content', async () => {
    const { getByText, trigger } = await renderDrawer();
    expect(getByText('Menu')).toBeTruthy();
    expect(getByText('Home')).toBeTruthy();
    expect(getByText('Settings')).toBeTruthy();
    expect(getByText('Version 1')).toBeTruthy();
    expect(trigger().querySelector('svg')).toBeTruthy();
  });

  it("merges each part's class with its own, the given class winning", async () => {
    const { container, panel, scrollView, item, trigger } =
      await renderDrawer();
    expect(panel().classList).toContain('bg-background');
    expect(panel().classList).toContain('shadow-lg');
    expect(scrollView().classList).toContain('h-full');
    expect(scrollView().classList).toContain('pt-2');
    expect(item('Delete account').classList).toContain('mt-4');
    expect(trigger().classList).toContain('h-10');
    expect(trigger().classList).toContain('ml-2');
    // Each part's own view, not its host element, which keeps the bare class.
    const header = container.querySelector('.border-b');
    expect(header?.classList).toContain('gap-3');
    expect(header?.classList).not.toContain('gap-1.5');
    const footer = container.querySelector('.border-t');
    expect(footer?.classList).toContain('gap-4');
    expect(footer?.classList).not.toContain('gap-2');
  });

  it('stays hidden until it is opened', async () => {
    const { host, overlay, panel } = await renderDrawer();
    await after(CLOSED);
    expect(overlay().getAttribute('style')).toContain('display: none');
    expect(panel().getAttribute('accessibility-exclusive-focus')).toBe('false');
    expect(animate).not.toHaveBeenCalled();
    // Starting closed isn't closing: `closed` waits for a real close.
    expect(host.closes()).toBe(0);
  });

  it('opens when the trigger is tapped', async () => {
    const { host, trigger, overlay } = await renderDrawer();
    fireEvent.tap(trigger());
    await after(OPENED);
    expect(host.open()).toBe(true);
    expect(overlay().getAttribute('style')).not.toContain('display: none');
  });

  it('slides in from the left and back out', async () => {
    const { host, overlay, backdrop, panel } = await renderDrawer();
    expect(panel().getAttribute('style')).toContain('left: 0');
    expect(panel().classList).toContain('border-r');

    host.open.set(true);
    await after(OPENED);
    expect(animate).toHaveBeenCalledWith(backdrop(), [
      START,
      expect.any(String),
      [{ opacity: 0 }, { opacity: 1 }],
      expect.objectContaining({ duration: DURATION.normal }),
    ]);
    expect(animate).toHaveBeenCalledWith(panel(), [
      START,
      expect.any(String),
      [
        { transform: 'translateX(-100%)', opacity: 0.8 },
        { transform: 'translateX(0%)', opacity: 1 },
      ],
      expect.objectContaining({ duration: DURATION.slow }),
    ]);

    host.open.set(false);
    await after(CLOSED);
    expect(animate).toHaveBeenCalledWith(backdrop(), [
      START,
      expect.any(String),
      [{ opacity: 1 }, { opacity: 0 }],
      expect.any(Object),
    ]);
    expect(animate).toHaveBeenCalledWith(panel(), [
      START,
      expect.any(String),
      [
        { transform: 'translateX(0%)', opacity: 1 },
        { transform: 'translateX(-100%)', opacity: 0.8 },
      ],
      expect.any(Object),
    ]);
    expect(overlay().getAttribute('style')).toContain('display: none');
    expect(host.closes()).toBe(1);
  });

  it('slides in from the right and back out', async () => {
    const { host, panel } = await renderDrawer();
    host.side.set('right');
    await waitForUpdate();
    expect(panel().getAttribute('style')).toContain('right: 0');
    expect(panel().classList).toContain('border-l');

    host.open.set(true);
    await after(OPENED);
    expect(animate).toHaveBeenCalledWith(panel(), [
      START,
      expect.any(String),
      [
        { transform: 'translateX(100%)', opacity: 0.8 },
        { transform: 'translateX(0%)', opacity: 1 },
      ],
      expect.any(Object),
    ]);

    host.open.set(false);
    await after(CLOSED);
    expect(animate).toHaveBeenCalledWith(panel(), [
      START,
      expect.any(String),
      [
        { transform: 'translateX(0%)', opacity: 1 },
        { transform: 'translateX(100%)', opacity: 0.8 },
      ],
      expect.any(Object),
    ]);
  });

  it('cancels the previous animations when it opens again', async () => {
    const { host, backdrop, panel } = await renderDrawer();
    host.open.set(true);
    await after(OPENED);
    host.open.set(false);
    await after(CLOSED);
    animate.mockClear();

    host.open.set(true);
    await after(OPENED);
    // The close animations hold their last frame (fill: forwards) until
    // they're canceled, which would hide the panel being opened.
    expect(animate).toHaveBeenCalledWith(backdrop(), [
      CANCEL,
      expect.any(String),
    ]);
    expect(animate).toHaveBeenCalledWith(panel(), [CANCEL, expect.any(String)]);
  });

  it('moves a screen reader into the panel and keeps it there while open', async () => {
    const { host, panel } = await renderDrawer();
    const invoke = vi.spyOn(host.drawer().panelRef().nativeElement, 'invoke');
    host.open.set(true);
    await after(OPENED);
    expect(invoke).toHaveBeenCalledWith('requestAccessibilityFocus');
    expect(panel().getAttribute('accessibility-exclusive-focus')).toBe('true');
  });

  it('closes when the backdrop is tapped', async () => {
    const { host, backdrop } = await renderDrawer();
    host.open.set(true);
    await after(OPENED);
    fireEvent.tap(backdrop());
    expect(host.open()).toBe(false);
    await after(CLOSED);
    expect(host.closes()).toBe(1);
  });

  it('stays open when the panel is tapped', async () => {
    const { host, panel } = await renderDrawer();
    host.open.set(true);
    await after(OPENED);
    // The panel catches its taps, so they don't reach the backdrop.
    fireEvent.tap(panel(), { eventType: 'catchEvent' });
    await waitForUpdate();
    expect(host.open()).toBe(true);
  });

  it('stops its close sequence when it is destroyed while closing', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { host } = await renderDrawer();
    host.open.set(true);
    await after(OPENED);
    host.open.set(false);
    await after(0);
    // Destroyed during the close animation. Its close timer
    // (DURATION.normal + 20) used to fire anyway and emit `closed` from the
    // destroyed output, which Angular warns about in dev builds.
    host.shown.set(false);
    await waitForUpdate();
    await after(CLOSED);
    const warnings = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    expect(warnings.filter((message) => message.includes('NG0953'))).toEqual(
      [],
    );
    expect(host.closes()).toBe(0);
  });
});

describe('UiNavDrawerContent', () => {
  it('scrolls the active item into view when the drawer opens', async () => {
    const { host } = await renderDrawer();
    const scroll = vi.spyOn(
      host.settings().containerRef()!.nativeElement,
      'invoke',
    );
    host.open.set(true);
    await after(OPENED);
    // Instantly and centered, so the drawer slides in already scrolled.
    expect(scroll).toHaveBeenCalledWith(
      'scrollIntoView',
      expect.objectContaining({ block: 'center', behavior: 'auto' }),
    );
  });

  it('scrolls the active item into view once its content is laid out', async () => {
    const { host, scrollView } = await renderDrawer();
    host.open.set(true);
    await after(OPENED);
    const scroll = vi.spyOn(
      host.settings().containerRef()!.nativeElement,
      'invoke',
    );
    fireEvent.contentsizechanged(scrollView());
    expect(scroll).toHaveBeenCalledWith('scrollIntoView', expect.any(Object));
  });

  it("doesn't scroll while the drawer is closed", async () => {
    const { host, scrollView } = await renderDrawer();
    const scroll = vi.spyOn(
      host.settings().containerRef()!.nativeElement,
      'invoke',
    );
    // Content collapsing as the overlay hides relays out too.
    fireEvent.contentsizechanged(scrollView());
    await after(OPENED);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("doesn't scroll when no item is active", async () => {
    const { host } = await renderDrawer();
    host.active.set('');
    const scroll = vi.spyOn(
      host.settings().containerRef()!.nativeElement,
      'invoke',
    );
    host.open.set(true);
    await after(OPENED);
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('UiNavDrawerItem', () => {
  it('marks the active item with the accent background', async () => {
    const { host, item } = await renderDrawer();
    expect(item('Settings').classList).toContain('bg-accent');
    expect(item('Home').classList).toContain('bg-transparent');

    host.active.set('home');
    await waitForUpdate();
    expect(item('Home').classList).toContain('bg-accent');
    expect(item('Settings').classList).toContain('bg-transparent');
  });

  it('emits pressed and closes the drawer when tapped', async () => {
    const { host, item } = await renderDrawer();
    host.open.set(true);
    await waitForUpdate();
    fireEvent.tap(item('Home'));
    expect(host.presses()).toBe(1);
    expect(host.open()).toBe(false);
  });

  it('leaves the drawer open when tapped without autoClose', async () => {
    const { host, item } = await renderDrawer();
    host.open.set(true);
    await waitForUpdate();
    fireEvent.tap(item('Delete account'));
    expect(host.open()).toBe(true);
  });

  it('scales down while pressed, and back on release', async () => {
    const { item } = await renderDrawer();
    const view = item('Home');

    fireEvent.touchstart(view);
    expect(scaleOf(view)).toBe('scale(0.985)');
    fireEvent.touchend(view);
    expect(scaleOf(view)).toBe('scale(1)');

    // A scroll that takes the touch over cancels it.
    fireEvent.touchstart(view);
    fireEvent.touchcancel(view);
    expect(scaleOf(view)).toBe('scale(1)');

    // The mouse, on the web.
    fireEvent.mousedown(view);
    expect(scaleOf(view)).toBe('scale(0.985)');
    fireEvent.mouseup(view);
    expect(scaleOf(view)).toBe('scale(1)');
    fireEvent.mousedown(view);
    fireLynxEvent(view, 'mouseleave');
    expect(scaleOf(view)).toBe('scale(1)');
  });

  it('turns its label and icons destructive', async () => {
    const { host, item, svg } = await renderDrawer();
    const icon = () => item('Delete account').querySelector('svg')!;
    // Labels styled text-foreground follow the redirected variable.
    expect(item('Delete account').classList).toContain(
      '[--foreground:var(--destructive)]',
    );
    expect(icon().getAttribute('content')).toBe(
      svg('.destructive-trash').getAttribute('content'),
    );

    host.deleteVariant.set('default');
    await waitForUpdate();
    expect(item('Delete account').classList).not.toContain(
      '[--foreground:var(--destructive)]',
    );
    expect(icon().getAttribute('content')).toBe(
      svg('.plain-trash').getAttribute('content'),
    );
  });
});

describe('UiNavDrawerTrigger', () => {
  it('is a labeled button for screen readers', async () => {
    const { trigger, getByRole } = await renderDrawer();
    expect(getByRole('button', { name: 'Open navigation menu' })).toBe(
      trigger(),
    );
  });

  it('scales down while pressed, and back on release', async () => {
    const { trigger } = await renderDrawer();
    const view = trigger();

    fireEvent.touchstart(view);
    expect(scaleOf(view)).toBe('scale(0.97)');
    fireEvent.touchend(view);
    expect(scaleOf(view)).toBe('scale(1)');

    fireEvent.touchstart(view);
    fireEvent.touchcancel(view);
    expect(scaleOf(view)).toBe('scale(1)');

    fireEvent.mousedown(view);
    expect(scaleOf(view)).toBe('scale(0.97)');
    fireEvent.mouseup(view);
    expect(scaleOf(view)).toBe('scale(1)');
    fireEvent.mousedown(view);
    fireLynxEvent(view, 'mouseleave');
    expect(scaleOf(view)).toBe('scale(1)');
  });
});
