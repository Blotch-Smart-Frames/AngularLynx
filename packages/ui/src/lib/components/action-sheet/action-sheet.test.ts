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
import { UiGlass } from '../glass/glass';
import {
  type LynxMainThread,
  lynxMainThread,
} from '../../../test-utils/lynx-main-thread';
import {
  UiActionSheet,
  UiActionSheetAnchor,
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
 * An action sheet opened from the button that presents it.
 */
@Component({
  imports: [
    UiActionSheet,
    UiActionSheetAnchor,
    UiActionSheetTitle,
    UiActionSheetItem,
    UiActionSheetCancel,
    UiGlass,
    LYNX_ELEMENTS,
  ],
  template: `
    @if (glassAnchor()) {
      <blur-view
        ui-glass
        class="share"
        [uiActionSheetAnchor]="sheet"
        (bindtap)="open.set(true)"
      >
        <text>Share</text>
      </blur-view>
    } @else if (anchored()) {
      <view
        class="share"
        [uiActionSheetAnchor]="sheet"
        (bindtap)="open.set(true)"
      >
        <text>Share</text>
      </view>
    }
    <ui-action-sheet #sheet [(open)]="open" (closed)="closed()">
      <ui-action-sheet-title>Delete this draft?</ui-action-sheet-title>
      <ui-action-sheet-item (pressed)="saved()"
        >Save Draft</ui-action-sheet-item
      >
      <ui-action-sheet-item variant="destructive" (pressed)="deleted()">
        Delete Draft
      </ui-action-sheet-item>
      <ui-action-sheet-cancel />
    </ui-action-sheet>
  `,
})
class AnchoredHost {
  readonly open = signal(false);
  readonly anchored = signal(true);
  readonly glassAnchor = signal(false);
  readonly closed = vi.fn();
  readonly saved = vi.fn();
  readonly deleted = vi.fn();
}

/**
 * A title on its own, outside any action sheet.
 */
@Component({
  imports: [UiActionSheetTitle],
  template: `<ui-action-sheet-title>Alone</ui-action-sheet-title>`,
})
class LoneTitleHost {}

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

  it("closes on Android's back button", async () => {
    const { host, overlay } = await renderSheet();
    await openSheet(host);

    fireLynxEvent(overlay, 'requestclose');
    expect(host.open()).toBe(false);
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

/**
 * The Lynx function that runs an element's UI methods, here measuring the
 * anchor and the popover (`boundingClientRect`) as on a phone.
 */
type MeasureUIMethod = {
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

/**
 * Renders the anchored sheet on a platform (none for Material), with the
 * safe area's markers a phone's screen, the popover's content 270 by 150,
 * and the anchor a button near the top.
 */
const renderAnchored = async (
  platform: { platform: string; osVersion: string } | null = {
    platform: 'iOS',
    osVersion: '26.0',
  },
) => {
  vi.stubGlobal('SystemInfo', platform ?? undefined);
  vi.spyOn(
    globalThis as unknown as MeasureUIMethod,
    '__InvokeUIMethod',
  ).mockImplementation((element, method, _params, callback) => {
    if (method !== 'boundingClientRect') {
      callback({ code: 0 });
      return;
    }
    const style = element.getAttribute('style') ?? '';
    const data = style.includes('safe-area-inset')
      ? { left: 0, top: 0, width: 402, height: 840 }
      : element.classList.contains('shrink-0')
        ? { left: 0, top: 0, width: 270, height: 150 }
        : { left: 16, top: 80, width: 80, height: 44 };
    callback({ code: 0, data });
  });
  const result = await render(AnchoredHost, {
    providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
  });
  const query = (selector: string) =>
    result.container.querySelector(selector) as HTMLElement | null;
  return {
    ...result,
    host: result.componentRef.instance as AnchoredHost,
    overlay: () => query('overlay')!,
    anchor: () => query('.share')!,
    popover: () => query('blur-view[ui-glass]:not(.share)'),
    content: () => query('.shrink-0')!,
    // A button's pressable row: the view around its label.
    button: (label: string) => result.getByText(label).parentElement!,
  };
};

type Anchored = Awaited<ReturnType<typeof renderAnchored>>;

/**
 * Opens the anchored sheet and waits until its popover has grown.
 */
const openAnchored = async (rendered: Anchored) => {
  fireEvent.tap(rendered.anchor());
  await vi.waitFor(() => expect(rendered.content().style.opacity).toBe('1'));
};

/**
 * Lets Lynx's timers run: the touch check waits for the next one.
 */
const nextTimer = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('UiActionSheet opened from its control', () => {
  beforeEach(() => {
    // The renderer warns that the components aren't Lynx elements.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('grows out of its control as Liquid Glass on iOS 26, leaving the screen undimmed', async () => {
    const rendered = await renderAnchored();
    await openAnchored(rendered);

    const popover = rendered.popover()!;
    expect(popover.getAttribute('blur-effect')).toBe('glass');
    expect(popover.style.width).toBe('270px');
    // The bottom sheet and its backdrop stay hidden.
    expect(rendered.overlay().getAttribute('visible')).toBe('false');
    // The control hides under the glass that grows out of it.
    expect(rendered.anchor().style.visibility).toBe('hidden');
    // Its title and actions, as iOS 26 lays them out, and no Cancel: a
    // touch outside cancels.
    expect(popover.contains(rendered.getByText('Delete this draft?'))).toBe(
      true,
    );
    expect(rendered.getByText('Delete this draft?').classList).toContain(
      'text-glass-muted-foreground',
    );
    expect(rendered.getByText('Save Draft').classList).toContain(
      'text-glass-foreground',
    );
    expect(rendered.getByText('Delete Draft').classList).toContain(
      'text-destructive',
    );
    expect(rendered.button('Save Draft').classList).toContain('min-h-[44px]');
    expect(rendered.button('Save Draft').classList).toContain('justify-center');
    expect(popover.contains(rendered.getByText('Cancel'))).toBe(false);
  });

  it("takes a glass control's glass over, shown as the control hides", async () => {
    const rendered = await renderAnchored();
    expect(rendered.anchor().hasAttribute('glass-effect-id')).toBe(false);
    rendered.host.glassAnchor.set(true);
    await waitForUpdate();
    const id = rendered.anchor().getAttribute('glass-effect-id');
    expect(id).toMatch(/^ui-action-sheet-\d+$/);

    await openAnchored(rendered);
    expect(rendered.popover()!.getAttribute('glass-effect-id')).toBe(id);
    expect(rendered.anchor().style.visibility).toBe('hidden');

    // A control that goes takes its glass with it.
    rendered.host.open.set(false);
    await vi.waitFor(() => expect(rendered.host.closed).toHaveBeenCalled());
    rendered.host.glassAnchor.set(false);
    await waitForUpdate();
    expect(rendered.anchor().tagName.toLowerCase()).toBe('view');
  });

  it('chooses an action, and closes', async () => {
    const rendered = await renderAnchored();
    await openAnchored(rendered);

    fireEvent.tap(rendered.button('Delete Draft'));
    expect(rendered.host.deleted).toHaveBeenCalledTimes(1);
    expect(rendered.host.open()).toBe(false);
    await vi.waitFor(() => expect(rendered.host.closed).toHaveBeenCalled());
    await waitForUpdate();
    expect(rendered.popover()).toBeNull();
    expect(rendered.anchor().style.visibility).toBe('');
    expect(rendered.host.closed).toHaveBeenCalledTimes(1);
  });

  it('lights a row up while it is pressed, rather than shrinking it', async () => {
    const rendered = await renderAnchored();
    await openAnchored(rendered);
    const row = rendered.button('Save Draft');
    const highlight = row.querySelector('.bg-glass-foreground') as HTMLElement;

    fireEvent.touchstart(row);
    await waitForUpdate();
    expect(highlight.style.opacity).toBe('0.1');
    expect(row.style.transform).toBe('');
    fireEvent.touchend(row);
    await waitForUpdate();
    expect(highlight.style.opacity).toBe('0');
    fireEvent.mousedown(row);
    await waitForUpdate();
    expect(highlight.style.opacity).toBe('0.1');
    fireLynxEvent(row, 'mouseleave');
    await waitForUpdate();
    expect(highlight.style.opacity).toBe('0');
  });

  it('closes on a touch outside it, without counting one on its control', async () => {
    const rendered = await renderAnchored();
    await openAnchored(rendered);

    // A touch on the control that presented it isn't outside it.
    fireLynxEvent(rendered.anchor(), 'touchstart', {}, 'bindEvent');
    fireLynxEvent(rendered.popover()!, 'touchstart', {}, 'global-bindEvent');
    await nextTimer();
    fireLynxEvent(rendered.anchor(), 'mousedown', {}, 'bindEvent');
    fireLynxEvent(rendered.popover()!, 'mousedown', {}, 'global-bindEvent');
    await nextTimer();
    expect(rendered.host.open()).toBe(true);

    fireLynxEvent(rendered.popover()!, 'touchstart', {}, 'global-bindEvent');
    await nextTimer();
    expect(rendered.host.open()).toBe(false);
  });

  it('is a Material 3 menu beside its control on Android', async () => {
    const rendered = await renderAnchored(null);
    await openAnchored(rendered);

    const popover = rendered.popover()!;
    expect(popover.style.width).toBe('280px');
    expect(popover.classList).toContain('bg-secondary');
    // Beside the control, which stays in view.
    expect(rendered.anchor().style.visibility).toBe('');
    expect(rendered.button('Save Draft').classList).toContain('min-h-[48px]');
    expect(rendered.button('Save Draft').classList).not.toContain(
      'justify-center',
    );
    expect(rendered.getByText('Save Draft').classList).toContain('text-[16px]');
    expect(
      rendered.getByText('Delete this draft?').parentElement?.classList,
    ).toContain('px-3');
  });

  it('rises from the bottom before iOS 26, as iPhone action sheets did', async () => {
    const rendered = await renderAnchored({
      platform: 'iOS',
      osVersion: '18.5',
    });
    fireEvent.tap(rendered.anchor());
    for (let i = 0; i < 3; i++) await waitForUpdate();

    expect(rendered.overlay().getAttribute('visible')).toBe('true');
    expect(rendered.popover()).toBeNull();
    expect(rendered.getByText('Save Draft').classList).toContain(
      'text-primary',
    );
    expect(rendered.anchor().style.visibility).toBe('');
  });

  it('rises from the bottom again once its control is gone', async () => {
    const rendered = await renderAnchored();
    rendered.host.anchored.set(false);
    await waitForUpdate();

    rendered.host.open.set(true);
    for (let i = 0; i < 3; i++) await waitForUpdate();
    expect(rendered.overlay().getAttribute('visible')).toBe('true');
    expect(rendered.popover()).toBeNull();
    // Its actions are back in the sheet's group, with Cancel below.
    expect(rendered.button('Save Draft').classList).toContain('border-t');
    expect(rendered.getByText('Cancel')).toBeTruthy();
  });

  it("doesn't report a close when its control comes or goes while it's closed", async () => {
    const rendered = await renderAnchored();
    // Opened and closed from the bottom once...
    rendered.host.anchored.set(false);
    await waitForUpdate();
    rendered.host.open.set(true);
    for (let i = 0; i < 3; i++) await waitForUpdate();
    rendered.host.open.set(false);
    await vi.waitFor(() => expect(rendered.host.closed).toHaveBeenCalled());

    // ...then given its control back, closed.
    rendered.host.anchored.set(true);
    await waitForUpdate();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(rendered.host.closed).toHaveBeenCalledTimes(1);
  });
});

describe('UiActionSheet accessibility', () => {
  it('reads its title as a heading and its actions as buttons', async () => {
    const { getByText } = await renderSheet();
    expect(getByText('Pick').getAttribute('accessibility-traits')).toBe(
      'header',
    );
    expect(getByText('Share').getAttribute('accessibility-traits')).toBe(
      'button',
    );
    expect(getByText('Cancel').getAttribute('accessibility-traits')).toBe(
      'button',
    );
  });

  it('draws a title outside an action sheet as in one', async () => {
    const { getByText } = await render(LoneTitleHost);
    expect(getByText('Alone').classList).toContain('text-muted-foreground');
  });
});
