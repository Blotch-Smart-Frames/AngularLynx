import { Component, type Provider, signal } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormField, form } from '@angular/forms/signals';
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
import {
  type LynxMainThread,
  lynxMainThread,
} from '../../../test-utils/lynx-main-thread';
import { provideGlass } from '../glass/glass-design';
import { provideIconTheme } from '../icon/icon-theme';
import { UiSwitch, type SwitchVariant } from './switch';

@Component({
  imports: [LYNX_ELEMENTS, UiSwitch],
  template: `
    <view>
      <ui-switch
        [(checked)]="checked"
        [disabled]="disabled()"
        [variant]="variant()"
        accessibility-label="Wi-Fi"
        class="ml-2"
        (changed)="changes.push($event)"
      />
    </view>
  `,
})
class SwitchHost {
  readonly checked = signal(false);
  readonly disabled = signal(false);
  readonly variant = signal<SwitchVariant>('default');
  readonly changes: boolean[] = [];
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
const WEB = { platform: 'web', osVersion: '' };

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;
/** `__ElementAnimate`'s first argument for canceling one. */
const CANCEL = 3;

const style = (element: Element, name: string) =>
  (element as HTMLElement).style.getPropertyValue(name);

/**
 * Renders the switch on a platform (none for no SystemInfo).
 */
const renderSwitch = async (
  platform?: { platform: string; osVersion: string },
  providers: Provider[] = [],
) => {
  vi.stubGlobal('SystemInfo', platform);
  const result = await render(SwitchHost, {
    providers: [
      { provide: LynxAccessibilitySettings, useValue: settings },
      ...providers,
    ],
  });
  const host = result.componentRef.instance as SwitchHost;
  const track = () => result.getByRole('button', { name: 'Wi-Fi' });
  /**
   * What paints the track, under the thumb.
   */
  const fill = () => track().firstElementChild!;
  const thumb = () => track().lastElementChild!;
  const update = async (change: () => void) => {
    change();
    await waitForUpdate();
  };
  const touch = async (kind: 'touchstart' | 'touchmove', x: number, y = 10) => {
    fireEvent[kind](track(), { touches: [{ x, y }] });
    await waitForUpdate();
  };
  const lift = async (kind: 'touchend' | 'touchcancel' = 'touchend') => {
    fireEvent[kind](track());
    await waitForUpdate();
  };
  const tap = async () => {
    fireEvent.tap(track());
    await waitForUpdate();
  };
  return { ...result, host, track, fill, thumb, update, touch, lift, tap };
};

describe('UiSwitch', () => {
  // Watched per test: the testing library resets the main thread after each.
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    settings.reduceMotion.set(false);
    settings.reduceTransparency.set(false);
  });

  it('renders off, with the thumb at the left and the given class', async () => {
    const { track, fill, thumb } = await renderSwitch();
    expect(fill().classList).toContain('bg-input');
    expect(track().classList).toContain('ml-2');
    expect(style(track(), 'width')).toBe('44px');
    expect(thumb().classList).toContain('bg-background');
    // Centered 12px in: 2px from the edge for a 20px thumb.
    expect(style(thumb(), 'transform')).toBe('translateX(12px)');
    expect(style(thumb(), 'left')).toBe('-10px');
  });

  it('reads as a switch with its label and state', async () => {
    const { host, track, update } = await renderSwitch();
    expect(track().getAttribute('accessibility-value')).toBe('Off');
    expect(track().getAttribute('accessibility-role-description')).toBe(
      'switch',
    );
    // Sideways swipes are the switch's, not the scroll view's.
    expect(track().getAttribute('consume-slide-event')).toContain('[-45,45]');
    await update(() => host.checked.set(true));
    expect(track().getAttribute('accessibility-value')).toBe('On');
  });

  it('turns on and off on tap, emitting `changed`', async () => {
    const { host, fill, thumb, tap } = await renderSwitch();

    await tap();
    expect(host.checked()).toBe(true);
    expect(fill().classList).toContain('bg-primary');
    expect(style(thumb(), 'transform')).toBe('translateX(32px)');

    await tap();
    expect(host.checked()).toBe(false);
    expect(host.changes).toEqual([true, false]);
  });

  it('springs the thumb across the track, squishing it halfway', async () => {
    const { thumb, tap } = await renderSwitch();

    await tap();
    expect(animate).toHaveBeenCalledWith(thumb(), [
      START,
      expect.any(String),
      [
        { transform: 'translateX(12px) scale(1)' },
        { transform: 'translateX(22px) scale(1.1)' },
        { transform: 'translateX(32px) scale(1)' },
      ],
      expect.objectContaining({ fill: 'none' }),
    ]);

    // Turning it back off cuts the first spring short and springs it back.
    await tap();
    expect(animate).toHaveBeenCalledWith(thumb(), [CANCEL, expect.any(String)]);
    expect(animate).toHaveBeenLastCalledWith(thumb(), [
      START,
      expect.any(String),
      [
        { transform: 'translateX(32px) scale(1)' },
        { transform: 'translateX(22px) scale(1.1)' },
        { transform: 'translateX(12px) scale(1)' },
      ],
      expect.objectContaining({ fill: 'none' }),
    ]);
  });

  it('follows its checked binding', async () => {
    const { host, thumb, update } = await renderSwitch();
    await update(() => host.checked.set(true));
    expect(style(thumb(), 'transform')).toBe('translateX(32px)');
  });

  it('toggles when its thumb is dragged across, as on iOS', async () => {
    const { host, fill, thumb, touch, lift, tap } = await renderSwitch();

    await touch('touchstart', 12);
    // Not yet a drag: the finger has to move past the slop.
    await touch('touchmove', 16);
    expect(style(thumb(), 'transform')).toBe('translateX(12px)');

    await touch('touchmove', 25);
    expect(style(thumb(), 'transform')).toBe('translateX(25px)');
    // Past the middle, the track shows it on before it's let go.
    expect(fill().classList).toContain('bg-primary');
    expect(host.checked()).toBe(false);

    // Dragged past the end, the thumb stays on the track.
    await touch('touchmove', 80);
    expect(style(thumb(), 'transform')).toBe('translateX(32px)');

    await lift();
    expect(host.checked()).toBe(true);
    expect(host.changes).toEqual([true]);
    expect(animate).toHaveBeenLastCalledWith(thumb(), [
      START,
      expect.any(String),
      [
        { transform: 'translateX(32px) scale(1)' },
        { transform: 'translateX(32px) scale(1.1)' },
        { transform: 'translateX(32px) scale(1)' },
      ],
      expect.objectContaining({ fill: 'none' }),
    ]);

    // Lynx may send a tap after a short drag: it doesn't toggle it back.
    await tap();
    expect(host.checked()).toBe(true);
  });

  it('springs back when a drag is let go on the side it started', async () => {
    const { host, touch, lift } = await renderSwitch();

    await touch('touchstart', 12);
    await touch('touchmove', 20);
    await lift('touchcancel');
    expect(host.checked()).toBe(false);
    expect(host.changes).toEqual([]);
  });

  it('leaves a press that moves up or down to the scroll view', async () => {
    const { host, touch, lift, tap } = await renderSwitch();

    await touch('touchstart', 12, 10);
    await touch('touchmove', 14, 30);
    await touch('touchmove', 40, 30);
    await lift('touchcancel');
    expect(host.checked()).toBe(false);

    // A tap after it is a tap again.
    await touch('touchstart', 12);
    await lift();
    await tap();
    expect(host.checked()).toBe(true);
  });

  it('ignores events without a position, and moves with no press', async () => {
    const { host, track, touch } = await renderSwitch();

    fireEvent.touchstart(track(), { touches: [] });
    await touch('touchmove', 40);
    fireEvent.touchend(track());
    fireEvent.mousemove(track(), { buttons: 0 });
    await waitForUpdate();
    expect(host.checked()).toBe(false);

    await touch('touchstart', 12);
    fireEvent.touchmove(track(), { touches: [{}] });
    await waitForUpdate();
    expect(host.checked()).toBe(false);
  });

  it('drags with the mouse on the web', async () => {
    const { host, track, tap } = await renderSwitch(WEB);
    const mouse = (
      kind: 'mousedown' | 'mousemove' | 'mouseup',
      x: number,
      buttons = 1,
    ) => {
      fireEvent[kind](track(), { x, y: 10, buttons });
      return waitForUpdate();
    };

    // Lynx for Web gives x from the <lynx-view>: only the distance counts.
    await mouse('mousedown', 120);
    await mouse('mousemove', 150);
    // A move with no button held: the button came up outside the switch.
    await mouse('mousemove', 150, 0);
    expect(host.checked()).toBe(true);
    // The browser's click after the drag isn't a tap.
    await tap();
    expect(host.checked()).toBe(true);

    await mouse('mousedown', 150);
    await mouse('mouseup', 150);
    await tap();
    expect(host.checked()).toBe(false);
  });

  it('dims and ignores taps and drags while disabled', async () => {
    const { host, track, update, touch, lift, tap } = await renderSwitch();
    await update(() => host.disabled.set(true));
    expect(track().classList).toContain('opacity-50');
    expect(track().getAttribute('accessibility-traits')).toBe(
      'button,disabled',
    );

    await touch('touchstart', 12);
    await touch('touchmove', 40);
    await lift();
    await tap();
    expect(host.checked()).toBe(false);
    expect(host.changes).toEqual([]);
    expect(animate).not.toHaveBeenCalled();
  });

  it('jumps instead of springing under Reduce Motion', async () => {
    settings.reduceMotion.set(true);
    const { host, thumb, fill, tap } = await renderSwitch();

    await tap();
    expect(host.checked()).toBe(true);
    expect(animate).not.toHaveBeenCalled();
    expect(style(thumb(), 'transition')).toBe('none');
    expect(style(fill(), 'transition')).toBe('none');
  });

  describe('glass', () => {
    const renderGlass = async (
      platform: { platform: string; osVersion: string },
      providers: Provider[] = [],
    ) => {
      const rendered = await renderSwitch(platform, providers);
      await rendered.update(() => rendered.host.variant.set('glass'));
      const lens = () => rendered.track().querySelector('blur-view');
      return { ...rendered, lens };
    };

    it("draws iOS 26's switch, whose thumb turns to glass while it's touched", async () => {
      const { host, track, fill, thumb, lens, touch, lift, tap } =
        await renderGlass(IOS_26);

      expect(style(track(), 'width')).toBe('63px');
      expect(style(track(), 'height')).toBe('28px');
      expect(style(fill(), 'background-color')).toBe(
        'rgba(120, 120, 128, 0.43)',
      );
      expect(style(thumb(), 'width')).toBe('37px');
      expect(style(thumb(), 'transform')).toBe('translateX(20.5px)');
      // The lens hides under the thumb, a little smaller.
      expect(lens()?.getAttribute('blur-effect')).toBe('glass');
      expect(lens()?.getAttribute('glass-style')).toBe('clear');
      expect(style(lens()!, 'width')).toBe('33px');

      await touch('touchstart', 20);
      expect(style(lens()!, 'width')).toBe('59px');
      expect(style(lens()!, 'height')).toBe('38px');
      expect(style(lens()!, 'top')).toBe('-5px');
      expect(style(thumb(), 'opacity')).toBe('0');

      await lift();
      await tap();
      expect(host.checked()).toBe(true);
      expect(style(fill(), 'background-color')).toBe('rgb(52, 199, 89)');
      expect(style(thumb(), 'transform')).toBe('translateX(42.5px)');
      expect(style(thumb(), 'opacity')).toBe('1');
      expect(style(thumb(), 'transition')).toContain('transform');
      // No spring: the CSS transition slides it.
      expect(animate).not.toHaveBeenCalled();
    });

    it('slides the lens with a dragging finger', async () => {
      const { host, thumb, lens, touch, lift } = await renderGlass(IOS_26);

      await touch('touchstart', 20);
      await touch('touchmove', 30);
      expect(style(lens()!, 'transform')).toBe('translateX(30.5px)');
      expect(style(thumb(), 'transition')).not.toContain('transform');
      await touch('touchmove', 45);
      await lift();
      expect(host.checked()).toBe(true);
    });

    it("takes iOS's dark colors in a dark app", async () => {
      const { host, fill, update } = await renderGlass(IOS_26, [
        provideIconTheme({ colorScheme: 'dark' }),
      ]);

      expect(style(fill(), 'background-color')).toBe(
        'rgba(120, 120, 128, 0.58)',
      );
      await update(() => host.checked.set(true));
      expect(style(fill(), 'background-color')).toBe('rgb(48, 209, 88)');
    });

    it('grows a solid thumb instead under Reduce Transparency on the web', async () => {
      settings.reduceTransparency.set(true);
      const { thumb, lens, touch } = await renderGlass(WEB);

      await touch('touchstart', 20);
      expect(style(thumb(), 'width')).toBe('59px');
      expect(style(thumb(), 'opacity')).toBe('1');
      expect(style(lens()!, 'width')).toBe('33px');
    });

    it("draws iOS 15 to 25's switch before iOS 26, stretching from its end", async () => {
      const { host, track, fill, thumb, lens, touch, lift, update } =
        await renderGlass(IOS_18);

      expect(lens()).toBeNull();
      expect(style(track(), 'width')).toBe('51px');
      expect(style(track(), 'height')).toBe('31px');
      expect(style(thumb(), 'width')).toBe('27px');
      expect(style(thumb(), 'box-shadow')).not.toBe('');

      // Off, it stretches right from its 2px inset.
      await touch('touchstart', 20);
      expect(style(thumb(), 'width')).toBe('33px');
      expect(style(thumb(), 'left')).toBe('-13.5px');
      await lift();

      // On, left from the other end.
      await update(() => host.checked.set(true));
      expect(style(fill(), 'background-color')).toBe('rgb(52, 199, 89)');
      await touch('touchstart', 30);
      expect(style(thumb(), 'left')).toBe('-19.5px');
    });

    it("draws Material 3's switch on Android", async () => {
      const { host, track, fill, thumb, touch, lift, update } =
        await renderGlass(ANDROID);
      const outline = () => track().querySelector('.border-muted-foreground');
      /**
       * The state layer, 40dp across.
       */
      const halo = () =>
        Array.from(track().children).find(
          (child) => style(child, 'width') === '40px',
        )!;

      expect(track().querySelector('blur-view')).toBeNull();
      expect(style(track(), 'width')).toBe('52px');
      expect(style(track(), 'height')).toBe('32px');
      expect(fill().classList).toContain('bg-secondary');
      expect(outline()).not.toBeNull();
      // Off, a 16dp handle centered 16dp in.
      expect(thumb().classList).toContain('bg-muted-foreground');
      expect(style(thumb(), 'width')).toBe('16px');
      expect(style(thumb(), 'transform')).toBe('translateX(16px)');
      expect(style(halo(), 'opacity')).toBe('0');

      // Pressed, it grows to 28dp with its state layer.
      await touch('touchstart', 16);
      expect(style(thumb(), 'width')).toBe('28px');
      expect(style(halo(), 'opacity')).toBe('0.1');
      await lift();

      // On, a 24dp handle in the primary track, with no outline.
      await update(() => host.checked.set(true));
      expect(fill().classList).toContain('bg-primary');
      expect(outline()).toBeNull();
      expect(thumb().classList).toContain('bg-primary-foreground');
      expect(style(thumb(), 'width')).toBe('24px');
      expect(halo().classList).toContain('bg-primary');

      await update(() => host.disabled.set(true));
      expect(track().classList).toContain('opacity-[0.38]');
    });

    it('draws glass on Android when the app opts in', async () => {
      const { lens } = await renderGlass(ANDROID, [
        provideGlass({ android: 'glass' }),
      ]);

      expect(lens()).not.toBeNull();
    });

    it('morphs without animating under Reduce Motion', async () => {
      settings.reduceMotion.set(true);
      const { thumb, lens, touch } = await renderGlass(IOS_26);

      expect(style(thumb(), 'transition')).toBe('none');
      await touch('touchstart', 20);
      expect(style(lens()!, 'transition')).toBe('none');
    });
  });

  describe('forms', () => {
    it('binds to a reactive form control', async () => {
      @Component({
        imports: [ReactiveFormsModule, UiSwitch],
        template: `<ui-switch
          [formControl]="wifi"
          accessibility-label="Wi-Fi"
        />`,
      })
      class ReactiveHost {
        readonly wifi = new FormControl(true, { nonNullable: true });
      }
      const { componentRef, getByRole } = await render(ReactiveHost);
      const host = componentRef.instance as ReactiveHost;
      const track = getByRole('button', { name: 'Wi-Fi' });

      expect(track.getAttribute('accessibility-value')).toBe('On');
      fireEvent.tap(track);
      await waitForUpdate();
      expect(host.wifi.value).toBe(false);
    });

    it('binds to ngModel', async () => {
      @Component({
        imports: [FormsModule, UiSwitch],
        template: `<ui-switch
          [(ngModel)]="wifi"
          accessibility-label="Wi-Fi"
        />`,
      })
      class ModelHost {
        wifi = false;
      }
      const { componentRef, getByRole } = await render(ModelHost);
      const host = componentRef.instance as ModelHost;

      fireEvent.tap(getByRole('button', { name: 'Wi-Fi' }));
      await waitForUpdate();
      expect(host.wifi).toBe(true);
    });

    it('binds to a Signal Forms field', async () => {
      @Component({
        imports: [FormField, UiSwitch],
        template: `<ui-switch
          [formField]="settings.wifi"
          accessibility-label="Wi-Fi"
        />`,
      })
      class SignalHost {
        readonly model = signal({ wifi: false });
        readonly settings = form(this.model);
      }
      const { componentRef, getByRole } = await render(SignalHost);
      const host = componentRef.instance as SignalHost;

      fireEvent.tap(getByRole('button', { name: 'Wi-Fi' }));
      await waitForUpdate();
      expect(host.model().wifi).toBe(true);
    });
  });
});
