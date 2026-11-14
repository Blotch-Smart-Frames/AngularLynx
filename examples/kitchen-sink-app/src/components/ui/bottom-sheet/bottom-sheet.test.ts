import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate as nextUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DURATION, EASING } from '@blotch/dolan/utils/animate';
import { fireLynxEvent } from '@blotch/dolan/testing/fire-lynx-event';
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

const renderSheet = async () => {
  const result = await render(BottomSheetHost);
  const { container } = result;
  const panel = container.querySelector('.rounded-t-2xl')!;
  // The grabber pill is the panel's one capsule.
  const grabber = panel.querySelector('.rounded-full')!;
  return {
    ...result,
    host: result.componentRef.instance as BottomSheetHost,
    overlay: container.querySelector('overlay')!,
    backdrop: container.querySelector('overlay > view')!,
    panel,
    grabber,
    // The strip around the grabber pill, which takes the drag.
    handle: grabber.parentElement!,
  };
};

// Every test runs on a fake clock (see the beforeEach below), so the test
// decides when time passes. On real time, a busy machine fired the sheet's
// timers late, and a test looked before they had.

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
 * Enough for the zero-delay steps of the open or close sequence, which the
 * fake clock runs a millisecond apart.
 */
const STEPS = 5;
/**
 * A frame, which the sheet waits for between some of its steps, and before
 * it moves (see afterFrame). The fake clock draws one every 16ms from its
 * start, so the next is at most that far away.
 */
const FRAME = 16;
/**
 * How long the sheet takes to close: its steps and a frame, then its slide
 * out, or a frame and its shrink into its control, and 20ms more.
 */
const CLOSED = STEPS + 2 * FRAME + DURATION.normal + 20;

/**
 * A timing function as the DOM writes it back: `0.0` as `0`.
 */
const css = (easing: string) => easing.replace(/\b0\.0\b/g, '0');

/**
 * The panel's slide in and out, as a `transition`, glass or not.
 */
const slideIn = (glass = false) => {
  const timing = `${DURATION.slow}ms ${EASING.sheet}`;
  return glass
    ? `transform ${timing}`
    : `transform ${timing}, opacity ${timing}`;
};
const slideOut = (glass = false) => {
  const timing = `${DURATION.normal}ms ${css(EASING.accelerate)}`;
  return glass
    ? `transform ${timing}`
    : `transform ${timing}, opacity ${timing}`;
};
/** The backdrop's fade in and out, as a `transition`. */
const FADE_IN = `opacity ${DURATION.normal}ms ${css(EASING.decelerate)}`;
const FADE_OUT = `opacity ${DURATION.normal}ms ${css(EASING.accelerate)}`;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * Opens the sheet and waits out its open sequence: the overlay shows on one
 * tick, and the panel slides in once that's drawn.
 */
const openSheet = async (host: BottomSheetHost) => {
  host.open.set(true);
  for (let i = 0; i < 3; i++) await waitForUpdate();
  await after(FRAME + 4);
};

/**
 * Waits for the frame after which the sheet starts to move, and draws it.
 */
const nextFrame = () => after(FRAME + 4);

/**
 * Waits for the close sequence to finish: the panel slides out, then the
 * overlay hides and `closed` fires.
 */
const waitForClose = async (host: { readonly closed: () => void }) => {
  await after(CLOSED);
  expect(host.closed).toHaveBeenCalled();
};

/**
 * The panel's live drag offset, from its inline transform.
 */
const transformOf = (panel: Element) =>
  (panel as HTMLElement).style.getPropertyValue('transform');

/**
 * One of an element's inline styles.
 */
const style = (element: Element, property: string) =>
  (element as HTMLElement).style.getPropertyValue(property);

/**
 * The touch fields a handle's touch event carries.
 */
const touchAt = (clientY: number) => ({
  eventType: 'catchEvent',
  touches: [{ clientY }],
});

describe('UiBottomSheet', () => {
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
    // On the card color: a tone above the page in the dark, which with the
    // backdrop's dimming is its edge.
    expect(panel.classList).toContain('bg-card');
  });

  // Android draws a border on one side of a rounded element as a straight
  // strip, clear of the corners: it sat across the top of the sheet.
  it('has no border along its rounded top', async () => {
    const { panel } = await renderSheet();
    expect(panel.classList).toContain('rounded-t-2xl');
    expect(panel.classList).not.toContain('border-t');
  });

  it('draws a 36×5 grabber in a faint gray that shows on the sheet', async () => {
    // The muted color barely showed on white.
    const { grabber } = await renderSheet();
    for (const name of ['h-[5px]', 'w-[36px]', 'bg-foreground', 'opacity-20']) {
      expect(grabber.classList).toContain(name);
    }
    expect(grabber.classList).not.toContain('bg-muted');
  });

  // Angular gives a component's host every static attribute written on it
  // (issue #181): the class also styled the sheet's host, in the page.
  it('puts its class on the panel alone', async () => {
    const { container, panel } = await renderSheet();
    expect([...container.querySelectorAll('.max-h-96')]).toEqual([panel]);
  });

  it('fades the backdrop in and slides the panel up when opened', async () => {
    const { host, backdrop, panel } = await renderSheet();
    // Below the screen, a little faded, over a clear backdrop.
    expect(style(panel, 'transform')).toBe('translateY(110%)');
    expect(style(panel, 'opacity')).toBe('0.8');
    expect(style(backdrop, 'opacity')).toBe('0');

    // The overlay shows, then once that's drawn, they move.
    host.open.set(true);
    for (let i = 0; i < 3; i++) await waitForUpdate();
    expect(style(panel, 'transition')).toBe('');
    await nextFrame();
    expect(style(backdrop, 'transition')).toBe(FADE_IN);
    expect(style(backdrop, 'opacity')).toBe('1');
    expect(style(panel, 'transition')).toBe(slideIn());
    expect(style(panel, 'transform')).toBe('translateY(0px)');
    expect(style(panel, 'opacity')).toBe('1');
    // Once they're there, nothing moves them.
    await after(DURATION.slow + 20);
    expect(style(panel, 'transition')).toBe('');
    expect(style(backdrop, 'transition')).toBe('');
  });

  // Core Animation runs them, on iOS, so they keep moving while Angular
  // works.
  it("moves the panel and backdrop on the platform's animators", async () => {
    const { panel, backdrop } = await renderSheet();
    expect(panel.getAttribute('enable-new-animator')).toBe('false');
    expect(backdrop.getAttribute('enable-new-animator')).toBe('false');
    // Android animates a transform only on a view of its own.
    expect(panel.getAttribute('flatten')).toBe('false');
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
    await waitForUpdate();
    await nextFrame();
    expect(style(backdrop, 'transition')).toBe(FADE_OUT);
    expect(style(backdrop, 'opacity')).toBe('0');
    expect(style(panel, 'transition')).toBe(slideOut());
    expect(style(panel, 'transform')).toBe('translateY(110%)');
    expect(style(panel, 'opacity')).toBe('0.8');
    await waitForClose(host);
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
    await vi.advanceTimersByTimeAsync(CLOSED);
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

      fireEvent.touchstart(handle, touchAt(100));
      fireEvent.touchmove(handle, touchAt(200));
      await waitForUpdate();
      expect(transformOf(panel)).toBe('translateY(100px)');
      // At once: the drag ends the open slide, whose transition goes.
      expect(style(panel, 'transition')).toBe('');
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
      expect(transformOf(panel)).toBe('translateY(200px)');
      await waitForUpdate();
      await nextFrame();
      // On down from where the finger let go, past any sheet's height.
      expect(style(panel, 'transition')).toBe(slideOut());
      expect(transformOf(panel)).toBe('translateY(600px)');
      await waitForClose(host);
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
      expect(transformOf(panel)).toBe('translateY(30px)');
      fireEvent.touchend(handle, { eventType: 'catchEvent' });
      await waitForUpdate();
      expect(host.open()).toBe(true);
      // Back from where the finger let go, on a spring.
      expect(style(panel, 'transition')).toBe(
        `transform ${DURATION.fast}ms ${EASING.spring}`,
      );
      expect(transformOf(panel)).toBe('translateY(0px)');

      // A scroll that takes the touch over cancels it the same way. Taken
      // as it springs back, it moves from there with the finger.
      fireEvent.touchstart(handle, touchAt(100));
      await after(DURATION.fast + 20);
      expect(style(panel, 'transition')).toBe('');
      fireEvent.touchmove(handle, touchAt(150));
      fireEvent.touchcancel(handle, { eventType: 'catchEvent' });
      await waitForUpdate();
      expect(host.open()).toBe(true);
      expect(transformOf(panel)).toBe('translateY(0px)');
      await after(DURATION.fast + 20);
      expect(style(panel, 'transition')).toBe('');
    });

    it('draws each move as the finger makes it, and keeps it through an update', async () => {
      const { host, backdrop, panel, handle } = await renderSheet();
      await openSheet(host);

      // The move draws the sheet itself: nothing waits for Angular to check
      // the sheet between the move and the look.
      fireEvent.touchstart(handle, touchAt(100));
      fireEvent.touchmove(handle, touchAt(150));
      expect(transformOf(panel)).toBe('translateY(50px)');
      // 50px of the 500px over which the backdrop clears.
      expect(backdrop.getAttribute('style')).toContain('rgba(0, 0, 0, 0.45)');
      // The update the drag's start asked for draws where the finger is, not
      // where the drag began.
      await waitForUpdate();
      expect(transformOf(panel)).toBe('translateY(50px)');
    });

    it("closed mid-drag, as by Android's back button, slides on from the finger", async () => {
      const { host, panel, handle } = await renderSheet();
      await openSheet(host);

      fireEvent.touchstart(handle, touchAt(100));
      fireEvent.touchmove(handle, touchAt(180));
      host.open.set(false);
      await waitForUpdate();
      expect(transformOf(panel)).toBe('translateY(80px)');
      await nextFrame();
      expect(style(panel, 'transition')).toBe(slideOut());
      expect(transformOf(panel)).toBe('translateY(600px)');
      await waitForClose(host);
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
/** The phone's width, beside SCREEN. */
const WIDTH = 402;

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
  fireEvent.layoutchange(sheet.backdrop, {
    detail: { height: SCREEN, width: WIDTH },
  });
  fireEvent.layoutchange(sheet.large, { detail: { height: LARGE } });
  fireEvent.layoutchange(sheet.panel, { detail: { height: panel } });
  await waitForUpdate();
};

/**
 * Waits for a settle at a detent to finish.
 */
const settled = async () => {
  // The settle's transition, and 20ms more.
  await after(DURATION.slow + 20);
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
  afterEach(() => {
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
      // Glass slides up without fading, and the backdrop dims through its
      // color: glass under a fading parent draws washed out, or not at all.
      expect(style(sheet.panel, 'transition')).toBe(slideIn(true));
      expect(style(sheet.panel, 'opacity')).toBe('1');
      expect(style(sheet.backdrop, 'opacity')).toBe('1');
      expect(style(sheet.backdrop, 'transition')).toBe(
        `background-color ${DURATION.normal}ms ${css(EASING.decelerate)}`,
      );
    });

    it('turns opaque and meets the edges at full height', async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);

      sheet.host.detent.set('large');
      await waitForUpdate();
      // Laid out at the new height at once, and drawn where it was: moved
      // down by the difference, and narrowed to the inset it had.
      expect(style(sheet.panel, 'transition')).toBe('');
      expect(style(sheet.panel, 'height')).toBe(`${LARGE}px`);
      expect(style(sheet.panel, 'left')).toBe('0px');
      expect(style(sheet.panel, 'bottom')).toBe('0px');
      expect(style(sheet.panel, 'transform')).toBe(
        `translateY(${LARGE - MEDIUM}px) scaleX(${Math.round(((WIDTH - 16) / WIDTH) * 10000) / 10000})`,
      );
      expect(style(sheet.opaque(), 'opacity')).toBe('0');
      // Then up, by the transform alone, and the opaque layer fades in.
      await nextFrame();
      expect(style(sheet.panel, 'transition')).toBe(
        `transform ${DURATION.slow}ms ${EASING.sheet}`,
      );
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
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
      // Laid out where the finger left it until it's back down.
      await nextFrame();
      expect(style(sheet.panel, 'transition')).toBe(
        `transform ${DURATION.slow}ms ${EASING.sheet}`,
      );
      expect(style(sheet.panel, 'transform')).toMatch(/^translateY\(30px\)/);
      await settled();
      expect(style(sheet.panel, 'height')).toBe(`${MEDIUM - 8}px`);
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
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
      expect(style(sheet.panel, 'transform')).toBe('translateY(150px)');
      await nextFrame();
      // Past the screen's height, and without fading the glass.
      expect(style(sheet.panel, 'transition')).toBe(slideOut(true));
      expect(style(sheet.panel, 'transform')).toBe(`translateY(${SCREEN}px)`);
      expect(style(sheet.panel, 'opacity')).toBe('1');
      await waitForClose(sheet.host);
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

      await drag(sheet, MEDIUM, MEDIUM + 40);
      expect(sheet.host.open()).toBe(true);
      expect(style(sheet.panel, 'transition')).toBe(
        `transform ${DURATION.fast}ms ${EASING.spring}`,
      );
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
      expect(sheet.host.detent()).toBe('medium');
    });

    it('slides down without fading when closed at rest', async () => {
      const sheet = await renderDetents();
      await layOut(sheet);
      await openSheet(sheet.host);

      fireEvent.tap(sheet.backdrop);
      await waitForUpdate();
      await nextFrame();
      expect(style(sheet.panel, 'transition')).toBe(slideOut(true));
      expect(style(sheet.panel, 'transform')).toBe('translateY(110%)');
      expect(style(sheet.panel, 'opacity')).toBe('1');
      // The dim clears through the backdrop's color.
      expect(sheet.backdrop.getAttribute('style')).toContain(
        'rgba(0, 0, 0, 0)',
      );
      expect(style(sheet.backdrop, 'opacity')).toBe('1');
      await waitForClose(sheet.host);
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

      // A drag takes the sheet as it moves up, from its end.
      await tapGrabber(sheet);
      await nextFrame();
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

      // Laid out at the large detent at once, drawn at the content's height
      // (and its inset) until it moves up.
      await tapGrabber(sheet);
      expect(style(sheet.panel, 'height')).toBe(`${LARGE}px`);
      expect(style(sheet.panel, 'transform')).toMatch(
        new RegExp(`^translateY\\(${LARGE - FIT - 8}px\\) scaleX`),
      );
      await nextFrame();
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
      await settled();
      // A layout at the large detent's height isn't its content's.
      fireEvent.layoutchange(sheet.panel, { detail: { height: LARGE } });

      // Back down to the content's height, still laid out at the large
      // detent's until it's there.
      await tapGrabber(sheet);
      await nextFrame();
      expect(style(sheet.panel, 'height')).toBe(`${LARGE}px`);
      expect(style(sheet.panel, 'transform')).toMatch(
        new RegExp(`^translateY\\(${LARGE - FIT - 8}px\\)`),
      );
      await settled();
      expect(style(sheet.panel, 'height')).toBe('');
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
    });

    it("doesn't take the panel's layout during a drag for its content's height", async () => {
      const sheet = await renderDetents(IOS_26, (host) =>
        host.detents.set(['fit', 'large']),
      );
      await layOut(sheet);
      await openSheet(sheet.host);

      // A short drag up from the content's height, which the panel's layout
      // follows, and back there.
      fireEvent.touchstart(sheet.handle, touchAt(500));
      fireEvent.touchmove(sheet.handle, touchAt(480));
      fireEvent.layoutchange(sheet.panel, { detail: { height: FIT + 20 } });
      fireEvent.touchend(sheet.handle, { eventType: 'catchEvent' });
      await waitForUpdate();
      await settled();
      expect(sheet.host.detent()).toBe('fit');

      // The content's height is still its own: the move to the large detent
      // starts from it.
      await tapGrabber(sheet);
      expect(style(sheet.panel, 'transform')).toMatch(
        new RegExp(`^translateY\\(${LARGE - FIT - 8}px\\)`),
      );
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

      // A drag before the move starts: from where the sheet is drawn.
      fireEvent.tap(sheet.handle, { eventType: 'catchEvent' });
      fireEvent.touchstart(sheet.handle, touchAt(500));
      await vi.advanceTimersByTimeAsync(40);
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
      // It tries again a frame later.
      await after(FRAME);
      expect(style(sheet.panel, 'height')).toBe(`${MEDIUM - 8}px`);
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
    });

    it('opens at its content height if the screen is never laid out', async () => {
      const sheet = await renderDetents();
      sheet.host.open.set(true);
      // Ten tries, a frame apart, after the frame it waits for to show.
      await after(STEPS + 11 * FRAME + 4);
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
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
      // It doesn't slide: the backdrop's dim fades in.
      expect(style(sheet.panel, 'transition')).toBe('');
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');

      await tapGrabber(sheet);
      expect(style(sheet.panel, 'transition')).toBe('');
      expect(style(sheet.panel, 'height')).toBe(`${LARGE}px`);

      // Straight back after a short drag down, and away without sliding.
      await tapGrabber(sheet);
      await drag(sheet, MEDIUM, MEDIUM + 40);
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
      fireEvent.tap(sheet.backdrop);
      await waitForUpdate();
      await nextFrame();
      expect(style(sheet.panel, 'transition')).toBe('');
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
      await waitForClose(sheet.host);
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
      expect(style(sheet.panel, 'transition')).toBe(slideIn());
      expect(style(sheet.backdrop, 'transition')).toBe(FADE_IN);
    });

    it('fades in and out with the backdrop under Reduce Motion', async () => {
      settings.reduceMotion.set(true);
      const sheet = await renderDetents(IOS_18);
      await layOut(sheet);
      await openSheet(sheet.host);
      expect(style(sheet.panel, 'transition')).toBe('');
      expect(style(sheet.panel, 'opacity')).toBe('1');
      expect(style(sheet.backdrop, 'transition')).toBe(FADE_IN);
      fireEvent.tap(sheet.backdrop);
      await waitForUpdate();
      await nextFrame();
      expect(style(sheet.panel, 'transition')).toBe('');
      expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
      expect(style(sheet.backdrop, 'transition')).toBe(FADE_OUT);
      expect(style(sheet.backdrop, 'opacity')).toBe('0');
      await waitForClose(sheet.host);
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
      await nextFrame();
      expect(style(sheet.panel, 'transition')).toBe(slideOut());
      expect(style(sheet.panel, 'transform')).toBe(`translateY(${SCREEN}px)`);
      expect(style(sheet.panel, 'opacity')).toBe('0.8');
      await waitForClose(sheet.host);
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
      // A millisecond at a time, so that it answers the first measuring
      // before the sequence goes on to another, past the frame it waits for.
      for (let i = 0; i < STEPS + FRAME + 4 && answers.length === 0; i++) {
        await vi.advanceTimersByTimeAsync(1);
      }
      expect(answers.length).toBeGreaterThan(0);
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
  // A frame at the control's place, then the grow, and 120ms more.
  await after(FRAME + DURATION.slow + 120);
};

describe('UiBottomSheet grown out of its control', () => {
  beforeEach(() => {
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
    await after(FRAME);
    expect(style(sheet.panel, 'left')).toBe('8px');
    expect(frameOf(sheet.panel)).toEqual(MEDIUM_FRAME);
    expect(style(sheet.panel, 'transition')).toContain(
      `height ${DURATION.slow + 100}ms cubic-bezier(0.32, 0.72, 0, 1)`,
    );
    expect(style(sheet.content(), 'opacity')).toBe('1');
    // It grows rather than slides, and nothing fades: on Lynx's own
    // animator, which changes its frame on every frame.
    expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
    expect(style(sheet.backdrop, 'opacity')).toBe('1');
    expect(sheet.panel.getAttribute('enable-new-animator')).toBe('true');

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
    await after(FRAME);
    expect(frameOf(sheet.panel)).toEqual(SOURCE_FRAME);
    expect(style(sheet.panel, 'transition')).toContain(
      `height ${DURATION.normal}ms`,
    );
    expect(style(sheet.content(), 'opacity')).toBe('0');
    expect(style(sheet.source(), 'visibility')).toBe('hidden');
    expect(sheet.backdrop.getAttribute('style')).toContain('rgba(0, 0, 0, 0)');

    // The control shows in the update that hides the sheet's glass.
    await waitForClose(sheet.host);
    expect(sheet.overlay.getAttribute('visible')).toBe('false');
    expect(style(sheet.source(), 'visibility')).toBe('');
    expect(style(sheet.glass(), 'visibility')).toBe('hidden');
  });

  it("slides up and down when its control can't be measured", async () => {
    const sheet = await renderSource(IOS_26, { measurable: false });
    sheet.host.open.set(true);
    await sheet.measureSource();
    await after(STEPS);
    expect(style(sheet.panel, 'transition')).toBe(slideIn(true));
    expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
    expect(style(sheet.panel, 'left')).toBe('8px');

    sheet.host.open.set(false);
    await sheet.measureSource();
    await after(STEPS);
    expect(style(sheet.panel, 'transition')).toBe(slideOut(true));
    expect(style(sheet.panel, 'transform')).toBe('translateY(110%)');
    await waitForClose(sheet.host);
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
    await waitForUpdate();
    await nextFrame();
    expect(style(sheet.panel, 'transform')).toBe(`translateY(${SCREEN}px)`);
    await waitForClose(sheet.host);
    await waitForUpdate();
    expect(style(sheet.source(), 'visibility')).toBe('');
  });

  it('lets a drag that begins as it grows have it', async () => {
    const sheet = await renderSource();
    sheet.host.detents.set(['medium', 'large']);
    sheet.host.open.set(true);
    await atSource(sheet);
    await after(FRAME);
    expect(style(sheet.panel, 'left')).toBe('8px');

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
    await after(STEPS);
    expect(sheet.overlay.getAttribute('visible')).toBe('true');
    sheet.host.open.set(false);
    await waitForUpdate();
    await sheet.measureSource();
    await waitForClose(sheet.host);
    expect(style(sheet.source(), 'visibility')).toBe('');

    // Opened again before it starts to shrink into its control: it never
    // does, and grows again instead.
    sheet.host.open.set(true);
    await atSource(sheet);
    await grown();
    sheet.host.open.set(false);
    await waitForUpdate();
    sheet.host.open.set(true);
    await waitForUpdate();
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
    await after(STEPS);
    expect(style(sheet.panel, 'transition')).toBe(slideIn(true));
    expect(style(sheet.panel, 'transform')).toBe('translateY(0px)');
    // On the platform's animators again.
    expect(sheet.panel.getAttribute('enable-new-animator')).toBe('false');
  });
});
