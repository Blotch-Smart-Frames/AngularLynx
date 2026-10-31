import { Component, signal, viewChild } from '@angular/core';
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
import {
  type AlertDialogFooterOrientation,
  type AlertDialogVariant,
  UiAlertDialog,
  UiAlertDialogAction,
  UiAlertDialogDescription,
  UiAlertDialogFooter,
  UiAlertDialogHeader,
  UiAlertDialogTitle,
} from './alert-dialog';

@Component({
  imports: [
    UiAlertDialog,
    UiAlertDialogHeader,
    UiAlertDialogTitle,
    UiAlertDialogDescription,
    UiAlertDialogFooter,
    LYNX_ELEMENTS,
  ],
  template: `
    @if (shown()) {
      <ui-alert-dialog
        [(open)]="open"
        class="max-w-sm"
        (closed)="closes.set(closes() + 1)"
      >
        <ui-alert-dialog-header class="gap-2">
          <ui-alert-dialog-title class="text-xl">Sure?</ui-alert-dialog-title>
          <ui-alert-dialog-description class="italic">
            Cannot undo
          </ui-alert-dialog-description>
        </ui-alert-dialog-header>
        <ui-alert-dialog-footer class="justify-start">
          <text>Buttons</text>
        </ui-alert-dialog-footer>
      </ui-alert-dialog>
    }
  `,
})
class AlertDialogHost {
  readonly open = signal(false);
  // Takes the alert dialog out of the tree, as an `@if` or a route change
  // would.
  readonly shown = signal(true);
  readonly closes = signal(0);
  readonly dialog = viewChild.required(UiAlertDialog);
}

const renderAlertDialog = async () => {
  const result = await render(AlertDialogHost);
  const panel = () =>
    result.container.querySelector('[accessibility-exclusive-focus]')!;
  return {
    ...result,
    host: result.componentRef.instance as AlertDialogHost,
    overlay: () => result.container.querySelector('overlay')!,
    panel,
    backdrop: () => panel().parentElement!,
  };
};

/**
 * Waits for the alert dialog's open or close sequence, which runs on timers, then
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

/** Accessibility settings a test can change, as the host app would. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

// Watched per test: the testing library resets the main thread after each.
let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
beforeEach(() => {
  animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
});
afterEach(() => {
  animate.mockRestore();
  vi.unstubAllGlobals();
  settings.reduceMotion.set(false);
});

describe('UiAlertDialog', () => {
  it('renders each part with its projected content', async () => {
    const { getByText } = await renderAlertDialog();
    expect(getByText('Sure?')).toBeTruthy();
    expect(getByText('Cannot undo')).toBeTruthy();
    expect(getByText('Buttons')).toBeTruthy();
  });

  it("merges each part's class with its own, the given class winning", async () => {
    const { container, getByText, panel } = await renderAlertDialog();
    expect(panel().classList).toContain('bg-background');
    expect(panel().classList).toContain('max-w-sm');
    expect(getByText('Sure?').classList).toContain('font-semibold');
    expect(getByText('Sure?').classList).toContain('text-xl');
    expect(getByText('Cannot undo').classList).toContain('text-sm');
    expect(getByText('Cannot undo').classList).toContain('italic');
    const header = container.querySelector('.flex-col.gap-2');
    expect(header?.classList).not.toContain('gap-1.5');
    const footer = container.querySelector('.pt-4');
    expect(footer?.classList).toContain('justify-start');
    expect(footer?.classList).not.toContain('justify-end');
  });

  // Angular gives a component's host every static attribute written on it
  // (issue #181), so each class also styled a host: the dialog's in the page,
  // where it is written, and each part's around its own view or text.
  it('puts each class on one element: the panel, or the part', async () => {
    const { container, getByText, panel } = await renderAlertDialog();
    expect([...container.querySelectorAll('.max-w-sm')]).toEqual([panel()]);
    // The header's: the footer has a gap-2 of its own.
    expect(container.querySelectorAll('.flex-col.gap-2')).toHaveLength(1);
    expect(container.querySelectorAll('.justify-start')).toHaveLength(1);
    expect([...container.querySelectorAll('.text-xl')]).toEqual([
      getByText('Sure?'),
    ]);
    expect([...container.querySelectorAll('.italic')]).toEqual([
      getByText('Cannot undo'),
    ]);
  });

  it('stays hidden until it is opened', async () => {
    const { host, overlay, panel } = await renderAlertDialog();
    await after(CLOSED);
    expect(overlay().getAttribute('style')).toContain('display: none');
    expect(panel().getAttribute('accessibility-exclusive-focus')).toBe('false');
    expect(animate).not.toHaveBeenCalled();
    // Starting closed isn't closing: `closed` waits for a real close.
    expect(host.closes()).toBe(0);
  });

  it('shows the overlay and animates the backdrop, then the panel, in', async () => {
    const { host, overlay, backdrop, panel } = await renderAlertDialog();
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
    const { host, panel } = await renderAlertDialog();
    const invoke = vi.spyOn(host.dialog().panelRef().nativeElement, 'invoke');
    host.open.set(true);
    await after(OPENED);
    expect(invoke).toHaveBeenCalledWith('requestAccessibilityFocus');
    expect(panel().getAttribute('accessibility-exclusive-focus')).toBe('true');
  });

  it('animates out, then hides and emits closed', async () => {
    const { host, overlay, backdrop, panel } = await renderAlertDialog();
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
    const { host, backdrop, panel } = await renderAlertDialog();
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

  it('stays open when the backdrop or the panel is tapped', async () => {
    const { host, backdrop, panel } = await renderAlertDialog();
    host.open.set(true);
    await after(OPENED);
    // Unlike a dialog, an alert dialog waits for an answer from its actions.
    fireEvent.tap(backdrop());
    // The panel catches its taps, so they don't reach the backdrop either.
    fireEvent.tap(panel(), { eventType: 'catchEvent' });
    await waitForUpdate();
    expect(host.open()).toBe(true);
  });

  it('only fades its panel under Reduce Motion', async () => {
    const result = await render(AlertDialogHost, {
      providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
    });
    const host = result.componentRef.instance as AlertDialogHost;
    const panel = result.container.querySelector(
      '[accessibility-exclusive-focus]',
    )!;
    settings.reduceMotion.set(true);
    host.open.set(true);
    await after(OPENED);
    expect(animate).toHaveBeenCalledWith(panel, [
      START,
      expect.any(String),
      [{ opacity: 0 }, { opacity: 1 }],
      expect.any(Object),
    ]);

    host.open.set(false);
    await after(CLOSED);
    expect(animate).toHaveBeenCalledWith(panel, [
      START,
      expect.any(String),
      [{ opacity: 1 }, { opacity: 0 }],
      expect.any(Object),
    ]);
  });

  it('stops its close sequence when it is destroyed while closing', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { host } = await renderAlertDialog();
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

@Component({
  imports: [
    UiAlertDialog,
    UiAlertDialogHeader,
    UiAlertDialogTitle,
    UiAlertDialogDescription,
    UiAlertDialogFooter,
    UiAlertDialogAction,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-alert-dialog
      [variant]="variant()"
      [(open)]="open"
      class="tall"
      (closed)="closes.set(closes() + 1)"
    >
      <ui-alert-dialog-header>
        <ui-alert-dialog-title>Delete Photo?</ui-alert-dialog-title>
        <ui-alert-dialog-description>
          It's deleted from all your devices.
        </ui-alert-dialog-description>
      </ui-alert-dialog-header>
      <ui-alert-dialog-footer [orientation]="orientation()">
        <ui-alert-dialog-action
          variant="cancel"
          (pressed)="choices.push('cancel')"
        >
          Cancel
        </ui-alert-dialog-action>
        @if (withSave()) {
          <ui-alert-dialog-action
            [preferred]="savePreferred()"
            (pressed)="choices.push('save')"
          >
            Save
          </ui-alert-dialog-action>
        }
        <ui-alert-dialog-action
          variant="destructive"
          class="wide"
          [preferred]="deletePreferred()"
          [accessibilityLabel]="deleteLabel()"
          (pressed)="choices.push('delete')"
        >
          Delete
        </ui-alert-dialog-action>
      </ui-alert-dialog-footer>
    </ui-alert-dialog>
  `,
})
class GlassAlertHost {
  readonly variant = signal<AlertDialogVariant>('glass');
  readonly open = signal(false);
  readonly orientation = signal<AlertDialogFooterOrientation>('auto');
  readonly withSave = signal(false);
  readonly savePreferred = signal(false);
  readonly deletePreferred = signal(false);
  readonly deleteLabel = signal<string | undefined>(undefined);
  readonly closes = signal(0);
  readonly choices: string[] = [];
}

const IOS_26 = { platform: 'iOS', osVersion: '26.0' };
const IOS_18 = { platform: 'iOS', osVersion: '18.6' };

/**
 * Renders the glass alert on a platform, as `SystemInfo` reports it, or with
 * none, which is Material's design.
 */
const renderGlassAlert = async (
  platform: { platform: string; osVersion: string } | null = IOS_26,
) => {
  vi.stubGlobal('SystemInfo', platform ?? undefined);
  const result = await render(GlassAlertHost, {
    providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
  });
  const host = result.componentRef.instance as GlassAlertHost;
  const panel = () =>
    result.container.querySelector('[accessibility-exclusive-focus]')!;
  const shell = () => panel().parentElement!;
  /**
   * An action's own element, from its label.
   */
  const action = (label: string) => result.getByText(label).parentElement!;
  const update = async (change: () => void) => {
    change();
    await waitForUpdate();
  };
  return {
    ...result,
    host,
    panel,
    shell,
    dim: () => shell().previousElementSibling!,
    action,
    footer: () => action('Cancel').parentElement!,
    style: (element: Element) => element.getAttribute('style') ?? '',
    update,
  };
};

describe('UiAlertDialog with variant="glass"', () => {
  describe('on iOS 26 and later', () => {
    it('draws a Liquid Glass panel with concentric corners', async () => {
      const { panel, style } = await renderGlassAlert();
      expect(panel().tagName.toLowerCase()).toBe('blur-view');
      expect(panel().getAttribute('blur-effect')).toBe('glass');
      // 40 = the 24px capsule buttons' radius + their 16px inset.
      expect(style(panel())).toContain('border-radius: 40px');
      expect(panel().classList).toContain('max-w-[320px]');
      expect(panel().classList).toContain('pt-[22px]');
      // The dialog's class still goes on the panel.
      expect(panel().classList).toContain('tall');
    });

    it('sets the title and message leading, in the glass colors', async () => {
      const { getByText, container } = await renderGlassAlert();
      expect(getByText('Delete Photo?').classList).toContain('text-[17px]');
      expect(getByText('Delete Photo?').classList).toContain(
        'text-glass-foreground',
      );
      expect(getByText('Delete Photo?').classList).not.toContain('text-center');
      expect(
        getByText("It's deleted from all your devices.").classList,
      ).toContain('text-glass-muted-foreground');
      expect(container.querySelector('.px-\\[14px\\]')).toBeTruthy();
    });

    it('puts two actions side by side on capsules, cancel first', async () => {
      const { action, footer, style } = await renderGlassAlert();
      expect(footer().classList).toContain('flex-row');
      expect(action('Cancel').classList).toContain('rounded-full');
      expect(action('Cancel').classList).toContain('flex-1');
      expect(action('Cancel').classList).toContain('h-[48px]');
      expect(style(action('Cancel'))).toContain('order: 0');
      expect(style(action('Delete'))).toContain('order: 1');
      // The capsule's fill: the glass's foreground, faintly.
      const fill = action('Cancel').firstElementChild!;
      expect(fill.classList).toContain('bg-glass-foreground');
      expect(style(fill)).toContain('opacity: 0.12');
      expect(action('Delete').lastElementChild!.classList).toContain(
        'text-destructive',
      );
    });

    it('stacks three actions, cancel at the bottom wherever it is written', async () => {
      const { host, action, footer, style, update } = await renderGlassAlert();
      await update(() => host.withSave.set(true));
      expect(footer().classList).toContain('flex-col');
      expect(action('Cancel').classList).not.toContain('flex-1');
      expect(style(action('Save'))).toContain('order: 0');
      expect(style(action('Delete'))).toContain('order: 1');
      expect(style(action('Cancel'))).toContain('order: 2');
    });

    it('lays its actions out as the footer says', async () => {
      const { host, footer, update } = await renderGlassAlert();
      await update(() => host.orientation.set('vertical'));
      expect(footer().classList).toContain('flex-col');
      await update(() => {
        host.withSave.set(true);
        host.orientation.set('horizontal');
      });
      expect(footer().classList).toContain('flex-row');
    });

    it('fills the preferred action with the tint, or the destructive color', async () => {
      const { host, action, update } = await renderGlassAlert();
      await update(() => {
        host.withSave.set(true);
        host.savePreferred.set(true);
      });
      expect(action('Save').classList).toContain('bg-glass-tint');
      expect(action('Save').lastElementChild!.classList).toContain(
        'text-glass-tint-foreground',
      );
      expect(action('Save').lastElementChild!.classList).toContain(
        'font-semibold',
      );
      // Its highlight is the tint's foreground, shown only under the finger.
      expect(action('Save').firstElementChild!.classList).toContain(
        'bg-glass-tint-foreground',
      );

      await update(() => host.deletePreferred.set(true));
      expect(action('Delete').classList).toContain('bg-destructive');
      expect(action('Delete').lastElementChild!.classList).toContain(
        'text-destructive-foreground',
      );
    });

    it('deepens a capsule while it is pressed, by touch or by mouse', async () => {
      const { host, action, style, update } = await renderGlassAlert();
      const fill = () => action('Cancel').firstElementChild!;
      await update(() => fireEvent.touchstart(action('Cancel')));
      expect(style(fill())).toContain('opacity: 0.2');
      await update(() => fireEvent.touchend(action('Cancel')));
      expect(style(fill())).toContain('opacity: 0.12');
      await update(() => fireLynxEvent(action('Cancel'), 'mousedown'));
      expect(style(fill())).toContain('opacity: 0.2');
      await update(() => fireLynxEvent(action('Cancel'), 'mouseleave'));
      expect(style(fill())).toContain('opacity: 0.12');
      await update(() => fireLynxEvent(action('Cancel'), 'mousedown'));
      await update(() => fireLynxEvent(action('Cancel'), 'mouseup'));
      expect(style(fill())).toContain('opacity: 0.12');
      await update(() => fireEvent.touchstart(action('Cancel')));
      await update(() => fireEvent.touchcancel(action('Cancel')));
      expect(style(fill())).toContain('opacity: 0.12');

      // A preferred capsule lightens under the finger instead.
      await update(() => host.deletePreferred.set(true));
      const highlight = () => action('Delete').firstElementChild!;
      expect(style(highlight())).toContain('opacity: 0');
      await update(() => fireEvent.touchstart(action('Delete')));
      expect(style(highlight())).toContain('opacity: 0.1');
    });

    it('scales its glass in from a little larger as it fades, and fades it out', async () => {
      const { host, shell, dim, update } = await renderGlassAlert();
      await update(() => host.open.set(true));
      await after(OPENED);
      expect(animate).toHaveBeenCalledWith(dim(), [
        START,
        expect.any(String),
        [{ opacity: 0 }, { opacity: 1 }],
        expect.any(Object),
      ]);
      // The view the glass is in, never the glass: on iOS a blur view loses
      // its material at less than full opacity.
      expect(animate).toHaveBeenCalledWith(shell(), [
        START,
        expect.any(String),
        [
          { transform: 'scale(1.15) translateY(0px)', opacity: 0 },
          { transform: 'scale(1) translateY(0px)', opacity: 1 },
        ],
        expect.objectContaining({ duration: DURATION.slow }),
      ]);
      animate.mockClear();

      await update(() => host.open.set(false));
      await after(CLOSED);
      expect(animate).toHaveBeenCalledWith(shell(), [
        START,
        expect.any(String),
        [
          { transform: 'scale(1) translateY(0px)', opacity: 1 },
          { transform: 'scale(1) translateY(0px)', opacity: 0 },
        ],
        expect.any(Object),
      ]);
      expect(animate).toHaveBeenCalledWith(dim(), [
        START,
        expect.any(String),
        [{ opacity: 1 }, { opacity: 0 }],
        expect.any(Object),
      ]);
      expect(host.closes()).toBe(1);
    });

    it('only fades under Reduce Motion', async () => {
      const { host, shell, update } = await renderGlassAlert();
      settings.reduceMotion.set(true);
      await update(() => host.open.set(true));
      await after(OPENED);
      expect(animate).toHaveBeenCalledWith(shell(), [
        START,
        expect.any(String),
        [{ opacity: 0 }, { opacity: 1 }],
        expect.any(Object),
      ]);
      await update(() => host.open.set(false));
      await after(CLOSED);
      expect(animate).toHaveBeenCalledWith(shell(), [
        START,
        expect.any(String),
        [{ opacity: 1 }, { opacity: 0 }],
        expect.any(Object),
      ]);
    });

    it('stays open when the dimmed screen or the panel is tapped', async () => {
      const { host, dim, panel, update } = await renderGlassAlert();
      await update(() => host.open.set(true));
      await after(OPENED);
      await update(() => fireEvent.tap(dim()));
      await update(() => fireEvent.tap(panel(), { eventType: 'catchEvent' }));
      expect(host.open()).toBe(true);
    });

    it('dims the screen at 20%, with no blur', async () => {
      const { dim } = await renderGlassAlert();
      expect(dim().classList).toContain('bg-black/20');
      expect(dim().tagName.toLowerCase()).toBe('view');
    });
  });

  describe('on iOS 15 to 25', () => {
    it("draws that era's frosted alert, 270pt wide with 14pt corners", async () => {
      const { panel, style, getByText } = await renderGlassAlert(IOS_18);
      expect(panel().getAttribute('blur-effect')).toBe('extra-light');
      expect(style(panel())).toContain('border-radius: 14px');
      expect(panel().classList).toContain('w-[270px]');
      expect(getByText('Delete Photo?').classList).toContain('text-center');
      expect(
        getByText("It's deleted from all your devices.").classList,
      ).toContain('text-[13px]');
    });

    it('parts its buttons with hairlines', async () => {
      const { host, action, footer, update } = await renderGlassAlert(IOS_18);
      // The footer's own line over the buttons.
      expect(footer().firstElementChild!.classList).toContain('h-[0.5px]');
      // Beside the second button in a row, but not the first.
      expect(action('Cancel').querySelector('.w-\\[0\\.5px\\]')).toBeNull();
      expect(action('Delete').querySelector('.w-\\[0\\.5px\\]')).toBeTruthy();
      expect(action('Delete').classList).toContain('h-[44px]');
      expect(action('Delete').classList).toContain('flex-1');

      // Above every button but the first in a stack.
      await update(() => host.withSave.set(true));
      expect(action('Save').querySelector('.h-\\[0\\.5px\\]')).toBeNull();
      expect(action('Delete').querySelector('.h-\\[0\\.5px\\]')).toBeTruthy();
      expect(action('Cancel').querySelector('.h-\\[0\\.5px\\]')).toBeTruthy();
      expect(action('Cancel').classList).not.toContain('flex-1');
    });

    it('sets the preferred action in bold, or else the cancel', async () => {
      const { host, getByText, update } = await renderGlassAlert(IOS_18);
      await update(() => host.withSave.set(true));
      expect(getByText('Cancel').classList).toContain('font-semibold');
      expect(getByText('Cancel').classList).toContain('text-glass-tint');
      expect(getByText('Save').classList).not.toContain('font-semibold');
      expect(getByText('Delete').classList).toContain('text-destructive');

      await update(() => host.savePreferred.set(true));
      expect(getByText('Save').classList).toContain('font-semibold');
      expect(getByText('Cancel').classList).not.toContain('font-semibold');
    });

    it('lights a button up while it is pressed', async () => {
      const { action, style, update } = await renderGlassAlert(IOS_18);
      const highlight = () => action('Delete').firstElementChild!;
      expect(style(highlight())).toContain('opacity: 0');
      await update(() => fireEvent.touchstart(action('Delete')));
      expect(style(highlight())).toContain('opacity: 0.1');
    });
  });

  describe('on Android', () => {
    it("draws Material 3's basic dialog", async () => {
      const { panel, style, getByText, dim, footer } =
        await renderGlassAlert(null);
      expect(style(panel())).toContain('border-radius: 28px');
      expect(panel().classList).toContain('bg-secondary');
      expect(panel().classList).toContain('p-[24px]');
      expect(panel().classList).toContain('min-w-[280px]');
      expect(getByText('Delete Photo?').classList).toContain('text-[24px]');
      expect(
        getByText("It's deleted from all your devices.").classList,
      ).toContain('text-[14px]');
      expect(dim().classList).toContain('bg-black/[0.32]');
      expect(footer().classList).toContain('justify-end');
    });

    it('keeps its text buttons in a row at the end, cancel first', async () => {
      const { host, action, footer, getByText, style, update } =
        await renderGlassAlert(null);
      await update(() => host.withSave.set(true));
      expect(footer().classList).toContain('flex-row');
      expect(style(action('Cancel'))).toContain('order: 0');
      expect(action('Save').classList).toContain('h-[40px]');
      expect(getByText('Save').classList).toContain('text-primary');
      expect(getByText('Delete').classList).toContain('text-destructive');
      // The state layer takes the label's color.
      expect(action('Save').firstElementChild!.classList).toContain(
        'bg-primary',
      );
      expect(action('Delete').firstElementChild!.classList).toContain(
        'bg-destructive',
      );
    });

    it('grows in and shrinks back as it fades', async () => {
      const { host, shell, update } = await renderGlassAlert(null);
      await update(() => host.open.set(true));
      await after(OPENED);
      expect(animate).toHaveBeenCalledWith(shell(), [
        START,
        expect.any(String),
        [
          { transform: 'scale(0.9) translateY(0px)', opacity: 0 },
          { transform: 'scale(1) translateY(0px)', opacity: 1 },
        ],
        expect.any(Object),
      ]);
      await update(() => host.open.set(false));
      await after(CLOSED);
      expect(animate).toHaveBeenCalledWith(shell(), [
        START,
        expect.any(String),
        [
          { transform: 'scale(1) translateY(0px)', opacity: 1 },
          { transform: 'scale(0.95) translateY(0px)', opacity: 0 },
        ],
        expect.any(Object),
      ]);
    });
  });

  it('emits the chosen action and closes, once', async () => {
    const { host, getByRole, action, update } = await renderGlassAlert();
    await update(() => host.open.set(true));
    await after(OPENED);
    expect(getByRole('button', { name: 'Delete' })).toBeTruthy();
    await update(() => fireEvent.tap(action('Delete')));
    // A second tap while it closes does nothing.
    await update(() => fireEvent.tap(action('Cancel')));
    expect(host.choices).toEqual(['delete']);
    expect(host.open()).toBe(false);
    await after(CLOSED);
    expect(host.closes()).toBe(1);
  });

  it('makes an action one element that says its accessibility label', async () => {
    const { host, getByRole, action, update } = await renderGlassAlert();
    // Open: a screen reader reaches nothing in the hidden overlay.
    await update(() => {
      host.open.set(true);
      host.deleteLabel.set('Delete the photo');
    });
    await after(OPENED);
    expect(getByRole('button', { name: 'Delete the photo' })).toBe(
      action('Delete'),
    );
    expect(
      action('Delete').lastElementChild!.getAttribute('accessibility-traits'),
    ).toBeNull();
  });

  it('draws its own panel again with variant="default", and its actions as the default buttons', async () => {
    const { host, panel, action, getByText, style, update } =
      await renderGlassAlert();
    await update(() => host.variant.set('default'));
    expect(panel().tagName.toLowerCase()).toBe('view');
    expect(panel().classList).toContain('bg-background');
    expect(action('Cancel').classList).toContain('border-border');
    expect(action('Delete').classList).toContain('bg-destructive');
    // The given class wins over the action's own.
    expect(action('Delete').classList).toContain('wide');
    expect(getByText('Cancel').classList).toContain('text-foreground');
    expect(getByText('Delete').classList).toContain(
      'text-destructive-foreground',
    );
    // Written order, no fill or hairline.
    expect(style(action('Cancel'))).not.toContain('order');
    expect(action('Cancel').querySelector('.absolute')).toBeNull();

    await update(() => host.withSave.set(true));
    expect(action('Save').classList).toContain('bg-primary');
    expect(getByText('Save').classList).toContain('text-primary-foreground');

    // A pressed button dims.
    await update(() => fireEvent.touchstart(action('Save')));
    expect(style(action('Save'))).toContain('opacity: 0.8');
    await update(() => fireEvent.touchend(action('Save')));
    expect(style(action('Save'))).not.toContain('opacity');
  });
});

@Component({
  imports: [
    UiAlertDialogHeader,
    UiAlertDialogTitle,
    UiAlertDialogDescription,
    UiAlertDialogFooter,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-alert-dialog-header>
      <ui-alert-dialog-title>Alone</ui-alert-dialog-title>
      <ui-alert-dialog-description
        >Outside a dialog</ui-alert-dialog-description
      >
    </ui-alert-dialog-header>
    <ui-alert-dialog-footer><text>Footer</text></ui-alert-dialog-footer>
  `,
})
class LoosePartsHost {}

it("draws an alert dialog's parts in the default look outside one", async () => {
  const { getByText } = await render(LoosePartsHost);
  expect(getByText('Alone').classList).toContain('text-lg');
  expect(getByText('Outside a dialog').classList).toContain('text-sm');
  expect(getByText('Footer').parentElement!.classList).toContain('pt-4');
  // The title is the header's own child: the header is its host.
  expect(getByText('Alone').parentElement!.classList).toContain('gap-1.5');
});
