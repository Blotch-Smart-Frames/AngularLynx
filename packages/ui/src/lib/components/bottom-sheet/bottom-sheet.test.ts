import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
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
import { UiGlass } from '../glass/glass';
import {
  type BottomSheetVariant,
  type SheetDetent,
  UiBottomSheet,
  UiSheetSource,
} from './bottom-sheet';

@Component({
  imports: [UiBottomSheet, LYNX_ELEMENTS],
  template: `
    <ui-bottom-sheet [(open)]="open" class="max-h-96" (closed)="closed()">
      <text>Panel</text>
    </ui-bottom-sheet>
  `,
})
class BottomSheetHost {
  readonly open = signal(false);
  readonly closed = vi.fn();
}

/**
 * The Lynx function an element's `invoke()` calls to run one of its UI
 * methods, such as moving a screen reader's focus. The testing library
 * defines it on the global object.
 */
type InvokeUIMethod = {
  __InvokeUIMethod: (
    element: Element,
    method: string,
    params: Record<string, unknown>,
    callback: (result: { code: number }) => void,
  ) => void;
};

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;
/** `__ElementAnimate`'s first argument for canceling an animation. */
const CANCEL = 3;

const renderSheet = async () => {
  const result = await render(BottomSheetHost);
  const { container } = result;
  return {
    ...result,
    host: result.componentRef.instance as BottomSheetHost,
    overlay: container.querySelector('overlay')!,
    backdrop: container.querySelector('overlay > view')!,
    panel: container.querySelector('.rounded-t-2xl')!,
    // The strip around the grabber pill, which takes the drag.
    handle: container.querySelector('.bg-muted')!.parentElement!,
  };
};

/**
 * Opens the sheet and waits out its open sequence: the overlay shows on one
 * tick, and the panel slides in on the next.
 */
const openSheet = async (host: BottomSheetHost) => {
  host.open.set(true);
  for (let i = 0; i < 3; i++) await waitForUpdate();
};

/**
 * Waits for the close sequence to finish: the panel slides out, then the
 * overlay hides and `closed` fires. Polled rather than timed, since the
 * sequence only starts on the update after `open` changes.
 */
const waitForClose = async (host: BottomSheetHost) => {
  await vi.waitFor(() => expect(host.closed).toHaveBeenCalled());
  await waitForUpdate();
};

/**
 * The panel's live drag offset, from its inline transform.
 */
const transformOf = (panel: Element) =>
  (panel as HTMLElement).style.getPropertyValue('transform');

/**
 * The touch fields a handle's touch event carries.
 */
const touchAt = (clientY: number) => ({
  eventType: 'catchEvent',
  touches: [{ clientY }],
});

describe('UiBottomSheet', () => {
  // Watched per test: the testing library resets the main thread after each.
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => animate.mockRestore());

  it('stays hidden until opened, then shows the panel and its content', async () => {
    const { host, overlay, getByText } = await renderSheet();
    expect(overlay.getAttribute('style')).toContain('display: none');
    expect(overlay.getAttribute('visible')).toBe('false');

    await openSheet(host);
    expect(overlay.getAttribute('style')).not.toContain('display: none');
    expect(overlay.getAttribute('visible')).toBe('true');
    expect(getByText('Panel')).toBeTruthy();
  });

  it("adds the class to the panel's own", async () => {
    const { panel } = await renderSheet();
    expect(panel.classList).toContain('max-h-96');
    expect(panel.classList).toContain('bg-background');
  });

  // Angular gives a component's host every static attribute written on it
  // (issue #181): the class also styled the sheet's host, in the page.
  it('puts its class on the panel alone', async () => {
    const { container, panel } = await renderSheet();
    expect([...container.querySelectorAll('.max-h-96')]).toEqual([panel]);
  });

  it('fades the backdrop in and slides the panel up when opened', async () => {
    const { host, backdrop, panel } = await renderSheet();
    await openSheet(host);
    expect(animate).toHaveBeenCalledWith(backdrop, [
      START,
      expect.any(String),
      [{ opacity: 0 }, { opacity: 1 }],
      expect.objectContaining({ duration: DURATION.normal }),
    ]);
    expect(animate).toHaveBeenCalledWith(panel, [
      START,
      expect.any(String),
      [
        { transform: 'translateY(100%)', opacity: 0.8 },
        { transform: 'translateY(0%)', opacity: 1 },
      ],
      expect.objectContaining({ duration: DURATION.slow }),
    ]);
  });

  it('moves a screen reader into the panel and keeps it there while open', async () => {
    const invoke = vi.spyOn(
      globalThis as unknown as InvokeUIMethod,
      '__InvokeUIMethod',
    );
    const { host, panel } = await renderSheet();
    expect(panel.getAttribute('accessibility-exclusive-focus')).toBe('false');

    await openSheet(host);
    expect(invoke).toHaveBeenCalledWith(
      panel,
      'requestAccessibilityFocus',
      expect.anything(),
      expect.any(Function),
    );
    expect(panel.getAttribute('accessibility-exclusive-focus')).toBe('true');
    invoke.mockRestore();
  });

  it('closes when the backdrop is tapped, sliding the panel down', async () => {
    const { host, overlay, backdrop, panel } = await renderSheet();
    await openSheet(host);

    fireEvent.tap(backdrop);
    expect(host.open()).toBe(false);
    await waitForClose(host);
    expect(animate).toHaveBeenCalledWith(backdrop, [
      START,
      expect.any(String),
      [{ opacity: 1 }, { opacity: 0 }],
      expect.objectContaining({ duration: DURATION.normal }),
    ]);
    expect(animate).toHaveBeenCalledWith(panel, [
      START,
      expect.any(String),
      [
        { transform: 'translateY(0%)', opacity: 1 },
        { transform: 'translateY(100%)', opacity: 0.8 },
      ],
      expect.objectContaining({ duration: DURATION.normal }),
    ]);
    // Once the slide is over, the overlay hides and `closed` fires, only for
    // this close: a sheet that starts closed hasn't closed before.
    expect(overlay.getAttribute('style')).toContain('display: none');
    expect(host.closed).toHaveBeenCalledOnce();
  });

  it("closes on Android's back button", async () => {
    const { host, overlay } = await renderSheet();
    await openSheet(host);
    // While an overlay shows, it takes the press and fires requestclose.
    fireLynxEvent(overlay, 'requestclose');
    expect(host.open()).toBe(false);
    await waitForClose(host);
    expect(host.closed).toHaveBeenCalledOnce();
  });

  it('stays open when the panel is tapped', async () => {
    const { host, panel } = await renderSheet();
    await openSheet(host);
    // The panel catches its taps, so they never reach the backdrop.
    fireEvent.tap(panel, { eventType: 'catchEvent' });
    expect(host.open()).toBe(true);
  });

  it('stops its close timers when it is destroyed while closing', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { host, unmount } = await renderSheet();
    await openSheet(host);
    host.open.set(false);
    await waitForUpdate();
    // Destroyed during the close animation, as an `@if` around the sheet
    // would do. Its close timer (DURATION.normal + 20) used to fire anyway
    // and emit `closed` from the destroyed output.
    unmount();
    await new Promise((resolve) => setTimeout(resolve, DURATION.normal + 50));
    const warnings = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    expect(warnings.filter((message) => message.includes('NG0953'))).toEqual(
      [],
    );
    expect(host.closed).not.toHaveBeenCalled();
  });

  describe('dragged by its handle', () => {
    it('follows the finger down, lightening the backdrop as it goes', async () => {
      const { host, backdrop, panel, handle } = await renderSheet();
      await openSheet(host);
      animate.mockClear();

      fireEvent.touchstart(handle, touchAt(100));
      // The open slide holds the panel in place until it's canceled.
      expect(animate).toHaveBeenCalledWith(panel, [CANCEL, expect.any(String)]);
      fireEvent.touchmove(handle, touchAt(200));
      await waitForUpdate();
      expect(transformOf(panel)).toBe('translateY(100px)');
      // 100px of the 500px over which the backdrop clears: 4/5 of its dim.
      expect(backdrop.getAttribute('style')).toContain('rgba(0, 0, 0, 0.4)');
    });

    it('closes when released past the threshold, sliding on from the finger', async () => {
      const { host, panel, handle } = await renderSheet();
      await openSheet(host);

      fireEvent.touchstart(handle, touchAt(100));
      fireEvent.touchmove(handle, touchAt(300));
      fireEvent.touchend(handle, { eventType: 'catchEvent' });
      expect(host.open()).toBe(false);
      await waitForClose(host);
      expect(animate).toHaveBeenCalledWith(panel, [
        START,
        expect.any(String),
        [
          { transform: 'translateY(200px)', opacity: 1 },
          { transform: 'translateY(600px)', opacity: 0.8 },
        ],
        expect.objectContaining({ duration: DURATION.normal }),
      ]);
      expect(host.closed).toHaveBeenCalledOnce();
      // Hidden, it waits below the screen, and opens again back in place.
      expect(transformOf(panel)).toBe('translateY(110%)');
      await openSheet(host);
      expect(transformOf(panel)).toBe('translateY(0px)');
    });

    it('springs back when released or canceled short of the threshold', async () => {
      const { host, panel, handle } = await renderSheet();
      await openSheet(host);

      fireEvent.touchstart(handle, touchAt(100));
      fireEvent.touchmove(handle, touchAt(130));
      fireEvent.touchend(handle, { eventType: 'catchEvent' });
      await waitForUpdate();
      expect(host.open()).toBe(true);
      expect(animate).toHaveBeenCalledWith(panel, [
        START,
        expect.any(String),
        [{ transform: 'translateY(30px)' }, { transform: 'translateY(0px)' }],
        expect.objectContaining({ duration: DURATION.fast }),
      ]);
      expect(transformOf(panel)).toBe('translateY(0px)');

      // A scroll that takes the touch over cancels it the same way.
      fireEvent.touchstart(handle, touchAt(100));
      fireEvent.touchmove(handle, touchAt(150));
      fireEvent.touchcancel(handle, { eventType: 'catchEvent' });
      await waitForUpdate();
      expect(host.open()).toBe(true);
      expect(transformOf(panel)).toBe('translateY(0px)');
    });

    it("doesn't move up past where it's docked", async () => {
      const { host, panel, handle } = await renderSheet();
      await openSheet(host);
      fireEvent.touchstart(handle, touchAt(100));
      fireEvent.touchmove(handle, touchAt(40));
      await waitForUpdate();
      expect(transformOf(panel)).toBe('translateY(0px)');
    });

    it('ignores touches without a position, and moves outside a drag', async () => {
      const { host, panel, handle } = await renderSheet();
      await openSheet(host);

      // A move or release with no drag under way does nothing.
      fireEvent.touchmove(handle, touchAt(300));
      fireEvent.touchend(handle, { eventType: 'catchEvent' });
      // Nor does a touch whose position is missing.
      fireEvent.touchstart(handle, { eventType: 'catchEvent' });
      fireEvent.touchmove(handle, touchAt(300));
      fireEvent.touchstart(handle, { eventType: 'catchEvent', touches: [] });
      fireEvent.touchmove(handle, touchAt(300));
      await waitForUpdate();
      expect(transformOf(panel)).toBe('translateY(0px)');

      fireEvent.touchstart(handle, touchAt(100));
      fireEvent.touchmove(handle, { eventType: 'catchEvent', touches: [] });
      await waitForUpdate();
      expect(transformOf(panel)).toBe('translateY(0px)');
      expect(host.open()).toBe(true);
    });
  });

  describe('dragged by mouse', () => {
    /**
     * Presses the handle, which catches its own mousedown.
     */
    const press = (handle: Element, y: number) =>
      fireEvent.mousedown(handle, { eventType: 'catchEvent', y });
    /**
     * Moves the mouse, which the backdrop sees anywhere in the sheet.
     */
    const move = (backdrop: Element, y: number, buttons = 1) =>
      fireEvent.mousemove(backdrop, { y, buttons });

    it('closes when released past the threshold', async () => {
      const { host, backdrop, panel, handle } = await renderSheet();
      await openSheet(host);

      press(handle, 100);
      move(backdrop, 300);
      await waitForUpdate();
      expect(transformOf(panel)).toBe('translateY(200px)');
      fireEvent.mouseup(backdrop);
      expect(host.open()).toBe(false);
    });

    it('springs back when released short of the threshold', async () => {
      const { host, backdrop, panel, handle } = await renderSheet();
      await openSheet(host);

      press(handle, 100);
      move(backdrop, 130);
      fireEvent.mouseup(backdrop);
      await waitForUpdate();
      expect(host.open()).toBe(true);
      expect(transformOf(panel)).toBe('translateY(0px)');
    });

    it('ignores the backdrop click that follows a moved drag', async () => {
      const { host, backdrop, handle } = await renderSheet();
      await openSheet(host);

      // A drag released above the panel: the browser's click lands on the
      // backdrop, and must not close the sheet that just snapped back.
      press(handle, 100);
      move(backdrop, 40);
      fireEvent.mouseup(backdrop);
      fireEvent.tap(backdrop);
      expect(host.open()).toBe(true);

      // Only that one click is ignored: the next backdrop tap closes it.
      fireEvent.tap(backdrop);
      expect(host.open()).toBe(false);
    });

    it('a new press clears an ignore no click consumed', async () => {
      const { host, backdrop, handle } = await renderSheet();
      await openSheet(host);

      // Released over the panel, so its catchtap ate the click.
      press(handle, 100);
      move(backdrop, 120);
      fireEvent.mouseup(backdrop);
      // A real backdrop click starts with a mousedown on the backdrop.
      fireEvent.mousedown(backdrop);
      fireEvent.tap(backdrop);
      expect(host.open()).toBe(false);
    });

    it('a press without a move, or a touch drag, leaves the backdrop tap alone', async () => {
      const { host, backdrop, handle } = await renderSheet();
      await openSheet(host);

      press(handle, 100);
      fireEvent.mouseup(backdrop);
      // A moved touch is never followed by a tap, so nothing is ignored.
      fireEvent.touchstart(handle, touchAt(100));
      fireEvent.touchmove(handle, touchAt(120));
      fireEvent.touchend(handle, { eventType: 'catchEvent' });
      fireEvent.tap(backdrop);
      expect(host.open()).toBe(false);
    });

    it('ends a drag whose release it never saw', async () => {
      const { host, backdrop, handle } = await renderSheet();
      await openSheet(host);

      press(handle, 100);
      move(backdrop, 300);
      // The button came up outside the window; the cursor is back without it.
      move(backdrop, 120, 0);
      // Released 200px down, past the threshold, so it closes.
      expect(host.open()).toBe(false);
    });

    it('a move outside a drag leaves the sheet in place', async () => {
      const { host, backdrop, panel } = await renderSheet();
      await openSheet(host);
      // The cursor passing over an open sheet with a button held elsewhere.
      move(backdrop, 300);
      await waitForUpdate();
      expect(transformOf(panel)).toBe('translateY(0px)');
    });
  });
});

@Component({
  imports: [UiBottomSheet, LYNX_ELEMENTS],
  template: `
    <ui-bottom-sheet
      [(open)]="open"
      [variant]="variant()"
      [detents]="detents()"
      [(detent)]="detent"
      (closed)="closed()"
    >
      <text>Panel</text>
    </ui-bottom-sheet>
  `,
})
class DetentHost {
  readonly open = signal(false);
  readonly variant = signal<BottomSheetVariant>('glass');
  readonly detents = signal<readonly SheetDetent[]>(['medium', 'large']);
  readonly detent = signal<SheetDetent | undefined>(undefined);
  readonly closed = vi.fn();
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

/** The phone the tests lay the sheet out on: an iPhone 18 Pro. */
const SCREEN = 874;
/** The screen below its status bar, which the large detent fills. */
const LARGE = 812;
/** Half the screen, the medium detent. */
const MEDIUM = SCREEN / 2;
/** The panel's height when it fits its content. */
const FIT = 300;

/**
 * Renders the host on a platform, as `SystemInfo` reports it, with the
 * sheet's elements found the same way in every look.
 */
const renderDetents = async (
  platform: { platform: string; osVersion: string } = IOS_26,
  setUp: (host: DetentHost) => void = () => {},
) => {
  vi.stubGlobal('SystemInfo', platform);
  const result = await render(DetentHost, {
    providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
  });
  const host = result.componentRef.instance as DetentHost;
  setUp(host);
  await waitForUpdate();
  const backdrop = result.container.querySelector('overlay > view')!;
  const panel = backdrop.children[1] as HTMLElement;
  // The grabber is the panel's one capsule: the glass is a rounded shape.
  const grabber = panel.querySelector('.rounded-full')!;
  return {
    ...result,
    host,
    overlay: result.container.querySelector('overlay')!,
    backdrop,
    large: backdrop.children[0],
    panel,
    grabber,
    handle: grabber.parentElement!,
    glass: () => panel.querySelector('blur-view'),
    opaque: () => panel.querySelector('.bg-background.absolute') as HTMLElement,
  };
};

type Rendered = Awaited<ReturnType<typeof renderDetents>>;

/**
 * Lays the screen out as Lynx reports it after the first frame: the screen,
 * the part below the status bar, and the panel at its content's height.
 */
const layOut = async (sheet: Rendered, panel = FIT) => {
  fireEvent.layoutchange(sheet.backdrop, { detail: { height: SCREEN } });
  fireEvent.layoutchange(sheet.large, { detail: { height: LARGE } });
  fireEvent.layoutchange(sheet.panel, { detail: { height: panel } });
  await waitForUpdate();
};

const style = (element: Element, property: string) =>
  (element as HTMLElement).style.getPropertyValue(property);

/**
 * Waits for a settle at a detent to finish.
 */
const settled = async () => {
  await new Promise((resolve) => setTimeout(resolve, DURATION.slow + 40));
  await waitForUpdate();
};

/**
 * Drags the handle from `from` to `to`, a screen y each, and lets go.
 */
const drag = async (sheet: Rendered, from: number, to: number) => {
  fireEvent.touchstart(sheet.handle, touchAt(from));
  fireEvent.touchmove(sheet.handle, touchAt(to));
  await waitForUpdate();
  fireEvent.touchend(sheet.handle, { eventType: 'catchEvent' });
  await waitForUpdate();
};

const tapGrabber = async (sheet: Rendered) => {
  fireEvent.tap(sheet.handle, { eventType: 'catchEvent' });
  await waitForUpdate();
};

describe('UiBottomSheet detents and glass variant', () => {
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => {
    animate.mockRestore();
    vi.unstubAllGlobals();
    settings.reduceMotion.set(false);
  });

  describe('on iOS 26 (Liquid Glass)', () => {
    it('waits below the screen, clear, until it opens', async () => {
      const sheet = await renderDetents();
      expect(style(sheet.panel, 'transform')).toBe('translateY(110%)');
      expect(sheet.backdrop.getAttribute('style')).toContain(
        'rgba(0, 0, 0, 0)',
      );
    });

    it('opens at its first detent as inset glass, with concentric corners', async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);

      expect(sheet.host.detent()).toBe('medium');
      // Inset 8px from the sides and bottom; its top halfway up the screen.
      expect(style(sheet.panel, 'bottom')).toBe('8px');
      expect(style(sheet.panel, 'left')).toBe('8px');
      expect(style(sheet.panel, 'right')).toBe('8px');
      expect(style(sheet.panel, 'height')).toBe(`${MEDIUM - 8}px`);
      // The display's 62px corners, less the inset.
      expect(sheet.glass()?.getAttribute('blur-effect')).toBe('glass');
      expect(style(sheet.glass()!, 'border-radius')).toBe('54px');
      expect(style(sheet.opaque(), 'opacity')).toBe('0');
      expect(sheet.backdrop.getAttribute('style')).toContain(
        'rgba(0, 0, 0, 0.2)',
      );
      expect(sheet.grabber.classList).toContain('w-[60px]');
      // Glass slides up without fading.
      expect(animate).toHaveBeenCalledWith(sheet.panel, [
        START,
        expect.any(String),
        [{ transform: 'translateY(110%)' }, { transform: 'translateY(0%)' }],
        expect.objectContaining({ duration: DURATION.slow }),
      ]);
    });

    it('turns opaque and meets the edges at full height', async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);

      sheet.host.detent.set('large');
      await waitForUpdate();
      // The frame transitions there, and the opaque layer fades in.
      expect(style(sheet.panel, 'transition')).toContain('height');
      expect(style(sheet.panel, 'height')).toBe(`${LARGE}px`);
      expect(style(sheet.panel, 'left')).toBe('0px');
      expect(style(sheet.panel, 'bottom')).toBe('0px');
      expect(style(sheet.opaque(), 'opacity')).toBe('1');
      expect(style(sheet.opaque(), 'transition')).toContain('opacity');
      expect(style(sheet.opaque(), 'border-bottom-left-radius')).toBe('55px');

      await settled();
      // At rest, its bottom corners meet the screen's edge square.
      expect(style(sheet.panel, 'transition')).toBe('');
      expect(style(sheet.opaque(), 'border-top-left-radius')).toBe('55px');
      expect(style(sheet.opaque(), 'border-bottom-left-radius')).toBe('0px');
      expect(style(sheet.opaque(), 'transition')).toBe('none');
      expect(sheet.host.detent()).toBe('large');
    });

    it('follows a drag between detents, less inset and more opaque as it grows', async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);

      // Halfway from medium to large.
      const halfway = (LARGE - MEDIUM) / 2;
      fireEvent.touchstart(sheet.handle, touchAt(MEDIUM));
      fireEvent.touchmove(sheet.handle, touchAt(MEDIUM - halfway));
      await waitForUpdate();
      expect(style(sheet.panel, 'left')).toBe('4px');
      expect(style(sheet.panel, 'height')).toBe(`${MEDIUM + halfway - 4}px`);
      expect(style(sheet.opaque(), 'opacity')).toBe('0.5');
      expect(style(sheet.panel, 'transition')).toBe('');
      // It goes no higher than the large detent.
      fireEvent.touchmove(sheet.handle, touchAt(0));
      await waitForUpdate();
      expect(style(sheet.panel, 'height')).toBe(`${LARGE}px`);

      // Let go past the threshold: on to the large detent.
      fireEvent.touchend(sheet.handle, { eventType: 'catchEvent' });
      await waitForUpdate();
      expect(sheet.host.detent()).toBe('large');
    });

    it('settles back at its detent after a short drag', async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);

      await drag(sheet, MEDIUM, MEDIUM - 30);
      expect(sheet.host.detent()).toBe('medium');
      expect(style(sheet.panel, 'transition')).toContain('height');
      expect(style(sheet.panel, 'height')).toBe(`${MEDIUM - 8}px`);
    });

    it('opens at the detent the app sets, and drags down to the next', async () => {
      const sheet = await renderDetents(IOS_26, (host) =>
        host.detent.set('large'),
      );
      await layOut(sheet);
      await openSheet(sheet.host);
      expect(style(sheet.panel, 'height')).toBe(`${LARGE}px`);

      await drag(sheet, 100, 400);
      expect(sheet.host.detent()).toBe('medium');
      await settled();
      expect(style(sheet.panel, 'height')).toBe(`${MEDIUM - 8}px`);
    });

    it('closes when dragged down past its shortest detent, sliding on from the finger', async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);

      await drag(sheet, MEDIUM, MEDIUM + 150);
      expect(sheet.host.open()).toBe(false);
      await vi.waitFor(() => expect(sheet.host.closed).toHaveBeenCalled());
      // Past the screen's height, and without fading the glass.
      expect(animate).toHaveBeenCalledWith(sheet.panel, [
        START,
        expect.any(String),
        [
          { transform: 'translateY(150px)' },
          { transform: `translateY(${SCREEN}px)` },
        ],
        expect.objectContaining({ duration: DURATION.normal }),
      ]);
      // Closed, it has no detent, and opens again at its first.
      await waitForUpdate();
      expect(sheet.host.detent()).toBeUndefined();
      await openSheet(sheet.host);
      expect(sheet.host.detent()).toBe('medium');
    });

    it('springs back up to its shortest detent short of closing', async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);
      animate.mockClear();

      await drag(sheet, MEDIUM, MEDIUM + 40);
      expect(sheet.host.open()).toBe(true);
      expect(animate).toHaveBeenCalledWith(sheet.panel, [
        START,
        expect.any(String),
        [{ transform: 'translateY(40px)' }, { transform: 'translateY(0px)' }],
        expect.objectContaining({ duration: DURATION.fast }),
      ]);
      expect(sheet.host.detent()).toBe('medium');
    });

    it('slides down without fading when closed at rest', async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);

      fireEvent.tap(sheet.backdrop);
      await vi.waitFor(() => expect(sheet.host.closed).toHaveBeenCalled());
      expect(animate).toHaveBeenCalledWith(sheet.panel, [
        START,
        expect.any(String),
        [{ transform: 'translateY(0%)' }, { transform: 'translateY(110%)' }],
        expect.objectContaining({ duration: DURATION.normal }),
      ]);
    });

    it('moves to the next detent when the grabber is tapped, and back from the last', async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);
      // A button that says what it is, for VoiceOver and TalkBack.
      expect(sheet.handle.getAttribute('accessibility-traits')).toBe('button');
      expect(sheet.handle.getAttribute('accessibility-label')).toBe(
        'Sheet grabber',
      );

      await tapGrabber(sheet);
      expect(sheet.host.detent()).toBe('large');
      await tapGrabber(sheet);
      expect(sheet.host.detent()).toBe('medium');
    });

    it("doesn't take the click that follows a mouse drag released on the grabber", async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);

      fireEvent.mousedown(sheet.handle, { eventType: 'catchEvent', y: MEDIUM });
      fireEvent.mousemove(sheet.backdrop, { y: MEDIUM - 20, buttons: 1 });
      fireEvent.mouseup(sheet.backdrop);
      await tapGrabber(sheet);
      expect(sheet.host.detent()).toBe('medium');
      // Only that one: the next tap moves it.
      await tapGrabber(sheet);
      expect(sheet.host.detent()).toBe('large');
    });

    it('ignores a detent it was not given, and one set during a drag', async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);

      sheet.host.detent.set('fit');
      await waitForUpdate();
      expect(style(sheet.panel, 'height')).toBe(`${MEDIUM - 8}px`);

      fireEvent.touchstart(sheet.handle, touchAt(MEDIUM));
      sheet.host.detent.set('large');
      await waitForUpdate();
      expect(style(sheet.panel, 'transition')).toBe('');
      expect(style(sheet.panel, 'height')).toBe(`${MEDIUM - 8}px`);
    });

    it("keeps a drag that interrupts a settle going when the settle's time is up", async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);

      await tapGrabber(sheet);
      fireEvent.touchstart(sheet.handle, touchAt(100));
      await settled();
      // Still following the finger, halfway back down to medium: no
      // transition came back.
      const halfway = (LARGE - MEDIUM) / 2;
      fireEvent.touchmove(sheet.handle, touchAt(100 + halfway));
      await waitForUpdate();
      expect(style(sheet.panel, 'transition')).toBe('');
      expect(style(sheet.panel, 'height')).toBe(`${LARGE - halfway - 4}px`);
    });

    it('fits its content at a fit detent, and transitions from it', async () => {
      const sheet = await renderDetents(IOS_26, (host) =>
        host.detents.set(['fit', 'large']),
      );
      await layOut(sheet);
      await openSheet(sheet.host);
      expect(sheet.host.detent()).toBe('fit');
      expect(style(sheet.panel, 'height')).toBe('');

      // A transition can't start from the content's height, so the sheet
      // pins it for a frame first.
      await tapGrabber(sheet);
      expect(style(sheet.panel, 'height')).toBe(`${FIT}px`);
      await vi.waitFor(() =>
        expect(style(sheet.panel, 'height')).toBe(`${LARGE}px`),
      );
      await settled();
      // A layout at the large detent's height isn't its content's.
      fireEvent.layoutchange(sheet.panel, { detail: { height: LARGE } });

      await tapGrabber(sheet);
      expect(style(sheet.panel, 'height')).toBe(`${FIT}px`);
      await settled();
      expect(style(sheet.panel, 'height')).toBe('');
    });

    it('settles at the nearest detent a long drag passes, past the ones between', async () => {
      const sheet = await renderDetents(IOS_26, (host) =>
        host.detents.set(['fit', 'medium', 'large']),
      );
      await layOut(sheet);
      await openSheet(sheet.host);

      // From its content's height to just short of the large detent.
      await drag(sheet, SCREEN - FIT, 100);
      expect(sheet.host.detent()).toBe('large');
    });

    it('lets a drag take over from the pinned content height', async () => {
      const sheet = await renderDetents(IOS_26, (host) =>
        host.detents.set(['fit', 'large']),
      );
      await layOut(sheet);
      await openSheet(sheet.host);

      await tapGrabber(sheet);
      fireEvent.touchstart(sheet.handle, touchAt(500));
      await new Promise((resolve) => setTimeout(resolve, 40));
      await waitForUpdate();
      expect(style(sheet.panel, 'transition')).toBe('');
      expect(style(sheet.panel, 'height')).toBe(`${FIT}px`);
    });

    it('waits for the screen to be laid out before opening at a detent', async () => {
      const sheet = await renderDetents();
      sheet.host.open.set(true);
      for (let i = 0; i < 3; i++) await waitForUpdate();
      expect(style(sheet.panel, 'transform')).toBe('translateY(110%)');

      await layOut(sheet);
      await vi.waitFor(() =>
        expect(style(sheet.panel, 'height')).toBe(`${MEDIUM - 8}px`),
      );
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
    });

    it('opens at its content height if the screen is never laid out', async () => {
      const sheet = await renderDetents();
      sheet.host.open.set(true);
      await vi.waitFor(() =>
        expect(style(sheet.panel, 'transform')).toBe('translateY(0px)'),
      );
      expect(style(sheet.panel, 'height')).toBe('');
      // Partial until it knows the screen.
      expect(style(sheet.panel, 'left')).toBe('8px');
    });

    it('treats no detents as fitting its content', async () => {
      const sheet = await renderDetents(IOS_26, (host) => host.detents.set([]));
      await openSheet(sheet.host);
      expect(sheet.host.detent()).toBe('fit');
      expect(sheet.handle.hasAttribute('accessibility-label')).toBe(false);
      // Not resizable: a tap on the grabber does nothing.
      await tapGrabber(sheet);
      expect(sheet.host.detent()).toBe('fit');
    });

    it('fills the screen at a fit detent whose content is taller than it', async () => {
      const sheet = await renderDetents(IOS_26, (host) =>
        host.detents.set(['fit']),
      );
      await layOut(sheet, 900);
      await openSheet(sheet.host);
      expect(style(sheet.opaque(), 'opacity')).toBe('1');
    });

    it('under Reduce Motion, appears and moves between detents at once', async () => {
      settings.reduceMotion.set(true);
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);
      const animated = () =>
        animate.mock.calls.filter(
          ([element, [kind]]) => element === sheet.panel && kind === START,
        );
      // It fades in with the backdrop, and doesn't slide.
      expect(animated()).toEqual([]);

      await tapGrabber(sheet);
      expect(style(sheet.panel, 'transition')).toBe('');
      expect(style(sheet.panel, 'height')).toBe(`${LARGE}px`);

      // Straight back after a short drag down, and away without sliding.
      await tapGrabber(sheet);
      await drag(sheet, MEDIUM, MEDIUM + 40);
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
      fireEvent.tap(sheet.backdrop);
      await vi.waitFor(() => expect(sheet.host.closed).toHaveBeenCalled());
      expect(animated()).toEqual([]);
    });
  });

  describe('on iOS 15 to 25', () => {
    it("draws the opaque sheet of its time, which doesn't inset", async () => {
      const sheet = await renderDetents(IOS_18);
      await layOut(sheet);
      await openSheet(sheet.host);

      expect(sheet.glass()).toBeNull();
      expect(sheet.panel.classList).toContain('rounded-t-[10px]');
      expect(sheet.panel.classList).toContain('bg-background');
      expect(style(sheet.panel, 'left')).toBe('0px');
      expect(style(sheet.panel, 'height')).toBe(`${MEDIUM}px`);
      expect(sheet.grabber.classList).toContain('w-[36px]');
      expect(sheet.backdrop.getAttribute('style')).toContain(
        'rgba(0, 0, 0, 0.2)',
      );
      // An opaque sheet slides up as the default does.
      expect(animate).toHaveBeenCalledWith(sheet.panel, [
        START,
        expect.any(String),
        [
          { transform: 'translateY(100%)', opacity: 0.8 },
          { transform: 'translateY(0%)', opacity: 1 },
        ],
        expect.objectContaining({ duration: DURATION.slow }),
      ]);
    });

    it('fades in and out with the backdrop under Reduce Motion', async () => {
      settings.reduceMotion.set(true);
      const sheet = await renderDetents(IOS_18);
      await layOut(sheet);
      await openSheet(sheet.host);
      fireEvent.tap(sheet.backdrop);
      await vi.waitFor(() => expect(sheet.host.closed).toHaveBeenCalled());

      const panelStarts = animate.mock.calls.filter(
        ([element, [kind]]) => element === sheet.panel && kind === START,
      );
      expect(panelStarts).toEqual([]);
      expect(animate).toHaveBeenCalledWith(sheet.backdrop, [
        START,
        expect.any(String),
        [{ opacity: 1 }, { opacity: 0 }],
        expect.objectContaining({ duration: DURATION.normal }),
      ]);
    });
  });

  describe('on Android (Material 3)', () => {
    it('draws a Material 3 bottom sheet', async () => {
      const sheet = await renderDetents(ANDROID);
      await layOut(sheet);
      await openSheet(sheet.host);

      expect(sheet.glass()).toBeNull();
      expect(sheet.panel.classList).toContain('rounded-t-[28px]');
      expect(sheet.panel.classList).toContain('bg-secondary');
      expect(style(sheet.panel, 'box-shadow')).not.toBe('');
      expect(sheet.handle.classList).toContain('py-[22px]');
      expect(sheet.grabber.classList).toContain('w-[32px]');
      expect(sheet.backdrop.getAttribute('style')).toContain(
        'rgba(0, 0, 0, 0.32)',
      );
    });

    it('slides on from the finger, fading, when dragged closed', async () => {
      const sheet = await renderDetents(ANDROID);
      await layOut(sheet);
      await openSheet(sheet.host);

      await drag(sheet, MEDIUM, MEDIUM + 200);
      await vi.waitFor(() => expect(sheet.host.closed).toHaveBeenCalled());
      expect(animate).toHaveBeenCalledWith(sheet.panel, [
        START,
        expect.any(String),
        [
          { transform: 'translateY(200px)', opacity: 1 },
          { transform: `translateY(${SCREEN}px)`, opacity: 0.8 },
        ],
        expect.objectContaining({ duration: DURATION.normal }),
      ]);
    });
  });

  it('keeps the default look with detents', async () => {
    const sheet = await renderDetents(IOS_26, (host) =>
      host.variant.set('default'),
    );
    await layOut(sheet);
    await openSheet(sheet.host);
    expect(sheet.glass()).toBeNull();
    expect(sheet.panel.classList).toContain('rounded-t-2xl');
    expect(style(sheet.panel, 'height')).toBe(`${MEDIUM}px`);
    expect(sheet.backdrop.getAttribute('style')).toContain(
      'rgba(0, 0, 0, 0.5)',
    );
  });
});

/**
 * A glass sheet presented by a control marked `uiSheetSource`: a glass
 * button, or one that isn't glass.
 */
@Component({
  imports: [UiBottomSheet, UiSheetSource, UiGlass, LYNX_ELEMENTS],
  template: `
    @if (glassSource()) {
      <blur-view ui-glass class="source" [uiSheetSource]="sheet">
        <text>Add</text>
      </blur-view>
    } @else if (withSource()) {
      <view class="source" [uiSheetSource]="sheet"><text>Add</text></view>
    }
    <ui-bottom-sheet
      #sheet
      [(open)]="open"
      [variant]="variant()"
      [detents]="detents()"
      (closed)="closed()"
    >
      <text>Panel</text>
    </ui-bottom-sheet>
  `,
})
class SourceHost {
  readonly open = signal(false);
  readonly variant = signal<BottomSheetVariant>('glass');
  readonly detents = signal<readonly SheetDetent[]>(['medium']);
  readonly glassSource = signal(true);
  readonly withSource = signal(true);
  readonly closed = vi.fn();
}

/** The phone's width, beside SCREEN. */
const WIDTH = 402;
/** Where the control sits: a 44px circle near the top right. */
const SOURCE = { left: 340, top: 60, width: 44, height: 44 };
/** Where the sheet starts from and ends at: the control, as its style puts it. */
const SOURCE_FRAME = {
  left: '340px',
  right: `${WIDTH - 340 - 44}px`,
  bottom: `${SCREEN - 60 - 44}px`,
  height: '44px',
};

/**
 * Renders the host on a platform, measuring the screen as
 * `boundingClientRect` would, and the control once the test lets the answer
 * through (see measureSource), or failing to measure it.
 */
const renderSource = async (
  platform: { platform: string; osVersion: string } = IOS_26,
  { measurable = true } = {},
) => {
  vi.stubGlobal('SystemInfo', platform);
  const answers: (() => void)[] = [];
  vi.spyOn(
    globalThis as unknown as InvokeUIMethod,
    '__InvokeUIMethod',
  ).mockImplementation((element, method, _params, callback) => {
    if (method !== 'boundingClientRect') {
      callback({ code: 0 });
      return;
    }
    const answer = callback as (result: {
      code: number;
      data?: unknown;
    }) => void;
    if (!element.classList.contains('source')) {
      answer({
        code: 0,
        data: { left: 0, top: 0, width: WIDTH, height: SCREEN },
      });
    } else if (measurable) {
      answers.push(() => answer({ code: 0, data: SOURCE }));
    } else {
      answers.push(() => answer({ code: 1 }));
    }
  });
  const result = await render(SourceHost, {
    providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
  });
  const host = result.componentRef.instance as SourceHost;
  const backdrop = result.container.querySelector('overlay > view')!;
  const panel = backdrop.children[1] as HTMLElement;
  fireEvent.layoutchange(backdrop, {
    detail: { height: SCREEN, width: WIDTH },
  });
  fireEvent.layoutchange(backdrop.children[0], { detail: { height: LARGE } });
  fireEvent.layoutchange(panel, { detail: { height: FIT } });
  await waitForUpdate();
  return {
    ...result,
    host,
    overlay: result.container.querySelector('overlay')!,
    backdrop,
    panel,
    source: () => result.container.querySelector('.source') as HTMLElement,
    glass: () => panel.querySelector('blur-view')!,
    // The handle and the content, which fade as the sheet grows.
    content: () => panel.querySelector('.grow') as HTMLElement,
    /**
     * Waits until the sheet measures its control, and answers. The sheet
     * then shows at the control's frame for a frame, which the test sees
     * right after the update.
     */
    measureSource: async () => {
      await vi.waitFor(() => expect(answers.length).toBeGreaterThan(0));
      for (const answer of answers.splice(0)) answer();
      await waitForUpdate();
    },
  };
};

type SourceRendered = Awaited<ReturnType<typeof renderSource>>;

/**
 * The panel's frame, from its inline style.
 */
const frameOf = (panel: Element) => ({
  left: style(panel, 'left'),
  right: style(panel, 'right'),
  bottom: style(panel, 'bottom'),
  height: style(panel, 'height'),
});

/**
 * Answers the sheet's measuring of its control, and checks it then shows at
 * the control's frame, to grow out of it or as it shrinks into it.
 */
const atSource = async (sheet: SourceRendered) => {
  await sheet.measureSource();
  expect(frameOf(sheet.panel)).toEqual(SOURCE_FRAME);
};

/** The frame of the sheet at rest at its medium detent. */
const MEDIUM_FRAME = {
  left: '8px',
  right: '8px',
  bottom: '8px',
  height: `${MEDIUM - 8}px`,
};

/**
 * Waits for a sheet growing out of its control to come to rest: the grow
 * takes longer than a settle between detents.
 */
const grown = async () => {
  await new Promise((resolve) => setTimeout(resolve, DURATION.slow + 140));
  await waitForUpdate();
};

describe('UiBottomSheet grown out of its control', () => {
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    // The renderer warns that the components aren't Lynx elements.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    settings.reduceMotion.set(false);
  });

  it('grows out of the control that presents it, which hides meanwhile', async () => {
    const sheet = await renderSource();
    // The control and the sheet's glass share an id, for the shell to pair
    // them; the sheet's glass is hidden until the control hides.
    const id = sheet.source().getAttribute('glass-effect-id');
    expect(id).toMatch(/^ui-sheet-\d+$/);
    expect(sheet.glass().getAttribute('glass-effect-id')).toBe(id);
    expect(style(sheet.glass(), 'visibility')).toBe('hidden');
    expect(style(sheet.source(), 'visibility')).toBe('');

    sheet.host.open.set(true);
    await atSource(sheet);
    expect(style(sheet.source(), 'visibility')).toBe('hidden');
    expect(style(sheet.glass(), 'visibility')).toBe('');
    expect(style(sheet.content(), 'opacity')).toBe('0');
    expect(style(sheet.panel, 'overflow')).toBe('hidden');
    // The backdrop dims through its color rather than fading in, which
    // would fade the glass in it too.
    expect(sheet.backdrop.getAttribute('style')).toContain(
      'rgba(0, 0, 0, 0.2)',
    );
    expect(style(sheet.backdrop, 'transition')).toContain('background-color');

    // On to its detent, on the sheet's curve, its content fading in.
    await vi.waitFor(() => expect(style(sheet.panel, 'left')).toBe('8px'));
    expect(frameOf(sheet.panel)).toEqual(MEDIUM_FRAME);
    expect(style(sheet.panel, 'transition')).toContain(
      `height ${DURATION.slow + 100}ms cubic-bezier(0.32, 0.72, 0, 1)`,
    );
    expect(style(sheet.content(), 'opacity')).toBe('1');
    // It grows rather than slides, and nothing fades.
    expect(animate).not.toHaveBeenCalledWith(sheet.panel, expect.anything());
    expect(animate).not.toHaveBeenCalledWith(sheet.backdrop, expect.anything());

    await grown();
    expect(style(sheet.panel, 'transition')).toBe('');
    expect(style(sheet.panel, 'overflow')).toBe('');
  });

  it('shrinks back into its control as it closes, which shows again', async () => {
    const sheet = await renderSource();
    sheet.host.open.set(true);
    await atSource(sheet);
    await grown();

    sheet.host.open.set(false);
    await sheet.measureSource();
    // Its height pinned for a frame, then into the control.
    await vi.waitFor(() => expect(frameOf(sheet.panel)).toEqual(SOURCE_FRAME));
    expect(style(sheet.panel, 'transition')).toContain(
      `height ${DURATION.normal}ms`,
    );
    expect(style(sheet.content(), 'opacity')).toBe('0');
    expect(style(sheet.source(), 'visibility')).toBe('hidden');
    expect(sheet.backdrop.getAttribute('style')).toContain('rgba(0, 0, 0, 0)');

    // The control shows in the update that hides the sheet's glass.
    await vi.waitFor(() => expect(sheet.host.closed).toHaveBeenCalled());
    await waitForUpdate();
    expect(sheet.overlay.getAttribute('visible')).toBe('false');
    expect(style(sheet.source(), 'visibility')).toBe('');
    expect(style(sheet.glass(), 'visibility')).toBe('hidden');
  });

  it("slides up and down when its control can't be measured", async () => {
    const sheet = await renderSource(IOS_26, { measurable: false });
    sheet.host.open.set(true);
    await sheet.measureSource();
    await vi.waitFor(() =>
      expect(animate).toHaveBeenCalledWith(sheet.panel, [
        START,
        expect.any(String),
        [{ transform: 'translateY(110%)' }, { transform: 'translateY(0%)' }],
        expect.anything(),
      ]),
    );
    expect(style(sheet.panel, 'left')).toBe('8px');

    sheet.host.open.set(false);
    await sheet.measureSource();
    await vi.waitFor(() =>
      expect(animate).toHaveBeenCalledWith(sheet.panel, [
        START,
        expect.any(String),
        [{ transform: 'translateY(0%)' }, { transform: 'translateY(110%)' }],
        expect.anything(),
      ]),
    );
    await vi.waitFor(() => expect(sheet.host.closed).toHaveBeenCalled());
  });

  it('goes on down from the finger when dragged closed', async () => {
    const sheet = await renderSource();
    sheet.host.open.set(true);
    await atSource(sheet);
    await grown();

    const handle = sheet.panel.querySelector('.rounded-full')!.parentElement!;
    fireEvent.touchstart(handle, touchAt(MEDIUM));
    fireEvent.touchmove(handle, touchAt(MEDIUM + 200));
    await waitForUpdate();
    fireEvent.touchend(handle, { eventType: 'catchEvent' });
    await vi.waitFor(() => expect(sheet.host.closed).toHaveBeenCalled());
    expect(animate).toHaveBeenCalledWith(sheet.panel, [
      START,
      expect.any(String),
      [
        { transform: 'translateY(200px)' },
        { transform: `translateY(${SCREEN}px)` },
      ],
      expect.anything(),
    ]);
    await waitForUpdate();
    expect(style(sheet.source(), 'visibility')).toBe('');
  });

  it('lets a drag that begins as it grows have it', async () => {
    const sheet = await renderSource();
    sheet.host.detents.set(['medium', 'large']);
    sheet.host.open.set(true);
    await atSource(sheet);
    await vi.waitFor(() => expect(style(sheet.panel, 'left')).toBe('8px'));

    const handle = sheet.panel.querySelector('.rounded-full')!.parentElement!;
    fireEvent.touchstart(handle, touchAt(MEDIUM));
    fireEvent.touchmove(handle, touchAt(MEDIUM - 100));
    await waitForUpdate();
    const dragged = style(sheet.panel, 'height');
    expect(dragged).not.toBe(MEDIUM_FRAME.height);
    await grown();
    // Still where the finger has it, not back at the detent.
    expect(style(sheet.panel, 'height')).toBe(dragged);
  });

  it('stops growing when it closes first, and shrinking when it opens again', async () => {
    const sheet = await renderSource();
    // Closed while it measures its control: it never shows.
    sheet.host.open.set(true);
    await vi.waitFor(() =>
      expect(sheet.overlay.getAttribute('visible')).toBe('true'),
    );
    sheet.host.open.set(false);
    await waitForUpdate();
    await sheet.measureSource();
    await vi.waitFor(() => expect(sheet.host.closed).toHaveBeenCalled());
    await waitForUpdate();
    expect(style(sheet.source(), 'visibility')).toBe('');

    // Opened again while it measures its control to shrink into it: it
    // grows again instead.
    sheet.host.open.set(true);
    await atSource(sheet);
    await grown();
    sheet.host.open.set(false);
    await waitForUpdate();
    sheet.host.open.set(true);
    await waitForUpdate();
    await sheet.measureSource();
    await sheet.measureSource();
    await grown();
    expect(sheet.overlay.getAttribute('visible')).toBe('true');
    expect(frameOf(sheet.panel)).toEqual(MEDIUM_FRAME);
  });

  it('appears as without one under Reduce Motion', async () => {
    settings.reduceMotion.set(true);
    const sheet = await renderSource();
    await openSheet(sheet.host);
    expect(style(sheet.source(), 'visibility')).toBe('');
    expect(sheet.content().getAttribute('style') ?? '').toBe('');
  });

  it('slides as without one before iOS 26', async () => {
    const sheet = await renderSource(IOS_18);
    await openSheet(sheet.host);
    expect(style(sheet.source(), 'visibility')).toBe('');
  });

  it("leaves a control that isn't glass unpaired, and lets go of one that goes", async () => {
    const sheet = await renderSource();
    sheet.host.glassSource.set(false);
    await waitForUpdate();
    expect(sheet.source().tagName.toLowerCase()).toBe('view');
    expect(sheet.source().hasAttribute('glass-effect-id')).toBe(false);

    // Without a control, the glass sheet slides up again.
    sheet.host.withSource.set(false);
    await waitForUpdate();
    await openSheet(sheet.host);
    await vi.waitFor(() =>
      expect(animate).toHaveBeenCalledWith(sheet.panel, [
        START,
        expect.any(String),
        [{ transform: 'translateY(110%)' }, { transform: 'translateY(0%)' }],
        expect.anything(),
      ]),
    );
  });
});
