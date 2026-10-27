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
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import {
  type LynxMainThread,
  lynxMainThread,
} from '../../../test-utils/lynx-main-thread';
import {
  UiActionSheet,
  UiActionSheetCancel,
  UiActionSheetItem,
  UiActionSheetTitle,
} from './action-sheet';

@Component({
  imports: [
    UiActionSheet,
    UiActionSheetTitle,
    UiActionSheetItem,
    UiActionSheetCancel,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-action-sheet [(open)]="open" class="pb-8" (closed)="closed()">
      <ui-action-sheet-title class="py-4">Pick</ui-action-sheet-title>
      <ui-action-sheet-item (pressed)="shared()">Share</ui-action-sheet-item>
      <ui-action-sheet-item
        variant="destructive"
        class="bg-muted"
        (pressed)="deleted()"
      >
        Delete
      </ui-action-sheet-item>
      <ui-action-sheet-cancel class="mt-2" />
    </ui-action-sheet>
  `,
})
class ActionSheetHost {
  readonly open = signal(false);
  readonly closed = vi.fn();
  readonly shared = vi.fn();
  readonly deleted = vi.fn();
}

/**
 * A cancel button given its own label.
 */
@Component({
  imports: [UiActionSheet, UiActionSheetCancel],
  template: `
    <ui-action-sheet>
      <ui-action-sheet-cancel label="Dismiss" />
    </ui-action-sheet>
  `,
})
class CancelLabelHost {}

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

const renderSheet = async () => {
  const result = await render(ActionSheetHost);
  const { container } = result;
  return {
    ...result,
    host: result.componentRef.instance as ActionSheetHost,
    overlay: container.querySelector('overlay')!,
    backdrop: container.querySelector('overlay > view')!,
    panel: container.querySelector('[accessibility-exclusive-focus]')!,
    // A button's pressable tile: the view around its label.
    button: (label: string) => result.getByText(label).parentElement!,
  };
};

/**
 * Opens the action sheet and waits out its open sequence: the overlay shows
 * on one tick, and the panel slides in on the next.
 */
const openSheet = async (host: ActionSheetHost) => {
  host.open.set(true);
  for (let i = 0; i < 3; i++) await waitForUpdate();
};

/**
 * Waits for the close sequence to finish: the panel slides out, then the
 * overlay hides and `closed` fires. Polled rather than timed, since the
 * sequence only starts on the update after `open` changes.
 */
const waitForClose = async (host: ActionSheetHost) => {
  await vi.waitFor(() => expect(host.closed).toHaveBeenCalled());
  await waitForUpdate();
};

/**
 * The scale a button's inline style holds, if any.
 */
const scaleOf = (element: Element) =>
  (element as HTMLElement).style.getPropertyValue('transform');

/**
 * Presses a button and lets go every way Lynx reports it, checking that it
 * scales down while pressed and back up once released.
 */
const expectPressFeedback = (button: Element) => {
  fireEvent.touchstart(button);
  expect(scaleOf(button)).toBe('scale(0.985)');
  fireEvent.touchend(button);
  expect(scaleOf(button)).toBe('scale(1)');

  // A scroll that takes the touch over cancels it: the button scales back.
  fireEvent.touchstart(button);
  fireEvent.touchcancel(button);
  expect(scaleOf(button)).toBe('scale(1)');

  // On web, the mouse drives the same feedback.
  fireEvent.mousedown(button);
  expect(scaleOf(button)).toBe('scale(0.985)');
  fireEvent.mouseup(button);
  expect(scaleOf(button)).toBe('scale(1)');

  fireEvent.mousedown(button);
  fireLynxEvent(button, 'mouseleave');
  expect(scaleOf(button)).toBe('scale(1)');
};

describe('UiActionSheet', () => {
  // Watched per test: the testing library resets the main thread after each.
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => animate.mockRestore());

  it('stays hidden until opened, then shows its title and buttons', async () => {
    const { host, overlay, getByText } = await renderSheet();
    expect(overlay.getAttribute('style')).toContain('display: none');
    expect(overlay.getAttribute('visible')).toBe('false');

    await openSheet(host);
    expect(overlay.getAttribute('style')).not.toContain('display: none');
    expect(overlay.getAttribute('visible')).toBe('true');
    expect(getByText('Pick')).toBeTruthy();
    expect(getByText('Share')).toBeTruthy();
    expect(getByText('Delete')).toBeTruthy();
    expect(getByText('Cancel')).toBeTruthy();
  });

  it("merges the class into the panel's own", async () => {
    const { panel } = await renderSheet();
    expect(panel.classList).toContain('pb-8');
    expect(panel.classList).not.toContain('pb-6');
    expect(panel.classList).toContain('px-4');
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
    // this close: an action sheet that starts closed hasn't closed before.
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
    // Destroyed during the close animation, as an `@if` around the action
    // sheet would do. Its close timer (DURATION.normal + 20) used to fire
    // anyway and emit `closed` from the destroyed output.
    unmount();
    await new Promise((resolve) => setTimeout(resolve, DURATION.normal + 50));
    const warnings = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    expect(warnings.filter((message) => message.includes('NG0953'))).toEqual(
      [],
    );
    expect(host.closed).not.toHaveBeenCalled();
  });
});

describe('UiActionSheetTitle', () => {
  it('shows its text muted, with the class on its container', async () => {
    const { getByText } = await renderSheet();
    const title = getByText('Pick');
    expect(title.classList).toContain('text-muted-foreground');
    expect(title.parentElement?.classList).toContain('py-4');
    expect(title.parentElement?.classList).not.toContain('py-3');
  });
});

describe('UiActionSheetItem', () => {
  it('reports the press and closes the action sheet when tapped', async () => {
    const { host, button } = await renderSheet();
    await openSheet(host);

    fireEvent.tap(button('Share'));
    expect(host.shared).toHaveBeenCalledOnce();
    expect(host.deleted).not.toHaveBeenCalled();
    expect(host.open()).toBe(false);
  });

  it('colors its label by variant', async () => {
    const { getByText } = await renderSheet();
    expect(getByText('Share').classList).toContain('text-primary');
    expect(getByText('Delete').classList).toContain('text-destructive');
  });

  it("merges the class into its tile's own", async () => {
    const { button } = await renderSheet();
    expect(button('Delete').classList).toContain('bg-muted');
    expect(button('Delete').classList).toContain('border-t');
  });

  it('scales down while pressed, and back on release', async () => {
    const { button } = await renderSheet();
    expectPressFeedback(button('Share'));
  });
});

describe('UiActionSheetCancel', () => {
  it('closes the action sheet when tapped', async () => {
    const { host, button } = await renderSheet();
    await openSheet(host);

    fireEvent.tap(button('Cancel'));
    expect(host.open()).toBe(false);
  });

  it('shows Cancel, or the label it is given', async () => {
    expect((await renderSheet()).getByText('Cancel')).toBeTruthy();
    const { getByText } = await render(CancelLabelHost);
    expect(getByText('Dismiss')).toBeTruthy();
  });

  it("merges the class into its tile's own", async () => {
    const { button } = await renderSheet();
    expect(button('Cancel').classList).toContain('mt-2');
    expect(button('Cancel').classList).toContain('bg-card');
  });

  it('scales down while pressed, and back on release', async () => {
    const { button } = await renderSheet();
    expectPressFeedback(button('Cancel'));
  });
});
