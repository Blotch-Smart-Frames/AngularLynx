import { Component, signal } from '@angular/core';
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
import {
  type LynxMainThread,
  lynxMainThread,
} from '../../../test-utils/lynx-main-thread';
import { UiBottomSheet } from './bottom-sheet';

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
      // Hidden, it's back in place for the next open.
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
