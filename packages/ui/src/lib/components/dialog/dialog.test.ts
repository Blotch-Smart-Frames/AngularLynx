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
import {
  type LynxMainThread,
  lynxMainThread,
} from '../../../test-utils/lynx-main-thread';
import {
  UiDialog,
  UiDialogDescription,
  UiDialogFooter,
  UiDialogHeader,
  UiDialogTitle,
} from './dialog';

@Component({
  imports: [
    UiDialog,
    UiDialogHeader,
    UiDialogTitle,
    UiDialogDescription,
    UiDialogFooter,
    LYNX_ELEMENTS,
  ],
  template: `
    @if (shown()) {
      <ui-dialog
        [(open)]="open"
        class="max-w-sm"
        (closed)="closes.set(closes() + 1)"
      >
        <ui-dialog-header class="gap-2">
          <ui-dialog-title class="text-xl">Title</ui-dialog-title>
          <ui-dialog-description class="italic">
            Description
          </ui-dialog-description>
        </ui-dialog-header>
        <ui-dialog-footer class="justify-start">
          <text>Actions</text>
        </ui-dialog-footer>
      </ui-dialog>
    }
  `,
})
class DialogHost {
  readonly open = signal(false);
  // Takes the dialog out of the tree, as an `@if` or a route change would.
  readonly shown = signal(true);
  readonly closes = signal(0);
  readonly dialog = viewChild.required(UiDialog);
}

const renderDialog = async () => {
  const result = await render(DialogHost);
  const panel = () =>
    result.container.querySelector('[accessibility-exclusive-focus]')!;
  return {
    ...result,
    host: result.componentRef.instance as DialogHost,
    overlay: () => result.container.querySelector('overlay')!,
    panel,
    backdrop: () => panel().parentElement!,
  };
};

/**
 * Waits for the dialog's open or close sequence, which runs on timers, then
 * renders what it changed.
 */
const after = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await waitForUpdate();
};

/**
 * Long enough for the open sequence, including the panel's 30ms stagger. The
 * sequence is chained timers, and on Windows each can fire up to a clock
 * tick (about 16ms) late, so 50ms was too short on CI's Windows runner.
 */
const OPENED = 150;
/** Long enough for the close animation and the hide after it, as above. */
const CLOSED = DURATION.normal + 150;

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;
/** `__ElementAnimate`'s first argument for canceling an animation. */
const CANCEL = 3;

describe('UiDialog', () => {
  // Watched per test: the testing library resets the main thread after each.
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => animate.mockRestore());

  it('renders each part with its projected content', async () => {
    const { getByText } = await renderDialog();
    expect(getByText('Title')).toBeTruthy();
    expect(getByText('Description')).toBeTruthy();
    expect(getByText('Actions')).toBeTruthy();
  });

  it("merges each part's class with its own, the given class winning", async () => {
    const { container, getByText, panel } = await renderDialog();
    expect(panel().classList).toContain('bg-background');
    expect(panel().classList).toContain('max-w-sm');
    expect(getByText('Title').classList).toContain('font-semibold');
    expect(getByText('Title').classList).toContain('text-xl');
    expect(getByText('Description').classList).toContain('text-sm');
    expect(getByText('Description').classList).toContain('italic');
    // Each part's own view, not its host element, which keeps the bare class.
    const header = container.querySelector('.flex-col.gap-2');
    expect(header?.classList).not.toContain('gap-1.5');
    const footer = container.querySelector('.pt-4');
    expect(footer?.classList).toContain('justify-start');
    expect(footer?.classList).not.toContain('justify-end');
  });

  it('stays hidden until it is opened', async () => {
    const { host, overlay, panel } = await renderDialog();
    await after(CLOSED);
    expect(overlay().getAttribute('style')).toContain('display: none');
    expect(panel().getAttribute('accessibility-exclusive-focus')).toBe('false');
    expect(animate).not.toHaveBeenCalled();
    // Starting closed isn't closing: `closed` waits for a real close.
    expect(host.closes()).toBe(0);
  });

  it('shows the overlay and animates the backdrop, then the panel, in', async () => {
    const { host, overlay, backdrop, panel } = await renderDialog();
    host.open.set(true);
    await after(OPENED);
    expect(overlay().getAttribute('style')).not.toContain('display: none');
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
        { transform: 'scale(0.9) translateY(10px)', opacity: 0 },
        { transform: 'scale(1) translateY(0px)', opacity: 1 },
      ],
      expect.objectContaining({ duration: DURATION.slow }),
    ]);
  });

  it('moves a screen reader into the panel and keeps it there while open', async () => {
    const { host, panel } = await renderDialog();
    const invoke = vi.spyOn(host.dialog().panelRef().nativeElement, 'invoke');
    host.open.set(true);
    await after(OPENED);
    expect(invoke).toHaveBeenCalledWith('requestAccessibilityFocus');
    expect(panel().getAttribute('accessibility-exclusive-focus')).toBe('true');
  });

  it('animates out, then hides and emits closed', async () => {
    const { host, overlay, backdrop, panel } = await renderDialog();
    host.open.set(true);
    await after(OPENED);
    animate.mockClear();

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
        { transform: 'scale(1) translateY(0px)', opacity: 1 },
        { transform: 'scale(0.95) translateY(10px)', opacity: 0 },
      ],
      expect.any(Object),
    ]);
    expect(overlay().getAttribute('style')).toContain('display: none');
    expect(panel().getAttribute('accessibility-exclusive-focus')).toBe('false');
    expect(host.closes()).toBe(1);
  });

  it('cancels the previous animations when it opens again', async () => {
    const { host, backdrop, panel } = await renderDialog();
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

  it('closes when the backdrop is tapped', async () => {
    const { host, backdrop } = await renderDialog();
    host.open.set(true);
    await after(OPENED);
    fireEvent.tap(backdrop());
    expect(host.open()).toBe(false);
    await after(CLOSED);
    expect(host.closes()).toBe(1);
  });

  it('stays open when the panel is tapped', async () => {
    const { host, panel } = await renderDialog();
    host.open.set(true);
    await after(OPENED);
    // The panel catches its taps, so they don't reach the backdrop.
    fireEvent.tap(panel(), { eventType: 'catchEvent' });
    await waitForUpdate();
    expect(host.open()).toBe(true);
  });

  it('stops its close sequence when it is destroyed while closing', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { host } = await renderDialog();
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
