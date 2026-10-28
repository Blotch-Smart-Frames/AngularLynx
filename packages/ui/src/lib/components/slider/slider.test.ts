import { Component, type Provider, signal } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormField, form } from '@angular/forms/signals';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { provideGlass } from '../glass/glass-design';
import { provideIconTheme } from '../icon/icon-theme';
import { UiSlider, type SliderVariant } from './slider';

@Component({
  imports: [LYNX_ELEMENTS, UiSlider],
  template: `
    <view>
      <ui-slider
        [(value)]="value"
        [min]="min()"
        [max]="max()"
        [step]="step()"
        [disabled]="disabled()"
        [variant]="variant()"
        [valueText]="valueText()"
        accessibility-label="Volume"
        class="mt-2"
        (changed)="changes.push($event)"
        (touch)="touches = touches + 1"
      />
    </view>
  `,
})
class SliderHost {
  readonly value = signal(50);
  readonly min = signal<number | undefined>(0);
  readonly max = signal<number | undefined>(100);
  readonly step = signal(1);
  readonly disabled = signal(false);
  readonly variant = signal<SliderVariant>('default');
  readonly valueText = signal<((value: number) => string) | undefined>(
    undefined,
  );
  readonly changes: number[] = [];
  touches = 0;
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

/** The width the slider is laid out at. */
const WIDTH = 300;

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

const style = (element: Element, name: string) =>
  (element as HTMLElement).style.getPropertyValue(name);

/**
 * Renders the slider on a platform (none for no SystemInfo) and lays it out
 * at WIDTH, as Lynx reports its size after the first frame.
 */
const renderSlider = async (
  platform?: { platform: string; osVersion: string },
  providers: Provider[] = [],
) => {
  vi.stubGlobal('SystemInfo', platform);
  const result = await render(SliderHost, {
    providers: [
      { provide: LynxAccessibilitySettings, useValue: settings },
      ...providers,
    ],
  });
  const host = result.componentRef.instance as SliderHost;
  const slider = result.getByRole('slider', { name: 'Volume' });
  const [track, fill] = Array.from(slider.children);
  const thumb = slider.lastElementChild!;
  fireEvent.layoutchange(slider, { detail: { width: WIDTH, height: 20 } });
  await waitForUpdate();
  const update = async (change: () => void) => {
    change();
    await waitForUpdate();
  };
  /**
   * Touches the slider at x (from its left edge, as Lynx gives it).
   */
  const touch = async (kind: 'touchstart' | 'touchmove', x: number, y = 10) => {
    fireEvent[kind](slider, { touches: [{ x, y }] });
    await waitForUpdate();
  };
  const lift = async (kind: 'touchend' | 'touchcancel' = 'touchend') => {
    fireEvent[kind](slider);
    await waitForUpdate();
  };
  const tap = async () => {
    fireEvent.tap(slider);
    await waitForUpdate();
  };
  return {
    ...result,
    host,
    slider,
    track: track!,
    fill: fill!,
    thumb,
    update,
    touch,
    lift,
    tap,
  };
};

describe('UiSlider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    settings.reduceMotion.set(false);
    settings.reduceTransparency.set(false);
  });

  it('shows its value on a track in the theme colors', async () => {
    const { slider, track, fill, thumb } = await renderSlider();

    expect(slider.classList).toContain('mt-2');
    expect(style(slider, 'height')).toBe('20px');
    expect(track.classList).toContain('bg-secondary');
    expect(fill.classList).toContain('bg-primary');
    expect(thumb.classList).toContain('border-primary');
    // The thumb's 20px travel inset: 10 + 0.5 × (300 − 20).
    expect(style(thumb, 'transform')).toBe('translateX(150px)');
    expect(style(fill, 'width')).toBe('150px');
  });

  it('reads as an adjustable element with its value and actions', async () => {
    const { slider } = await renderSlider();

    expect(slider.getAttribute('accessibility-traits')).toBe('adjustable');
    expect(slider.getAttribute('accessibility-role-description')).toBe(
      'slider',
    );
    expect(slider.getAttribute('accessibility-value')).toBe('50%');
    expect(slider.getAttribute('accessibility-actions')).toBe(
      JSON.stringify(['Increase', 'Decrease']),
    );
    // Sideways swipes are the slider's, not the scroll view's.
    expect(slider.getAttribute('consume-slide-event')).toBe(
      JSON.stringify([
        [-45, 45],
        [135, 180],
        [-180, -135],
      ]),
    );
  });

  it('follows a drag of the thumb, keeping where the finger holds it', async () => {
    const { host, thumb, touch, lift, tap } = await renderSlider();

    // Picked up 4px right of its center, at 150.
    await touch('touchstart', 154);
    // Not yet a drag: the finger has to move past the slop.
    await touch('touchmove', 157);
    expect(host.value()).toBe(50);

    await touch('touchmove', 200);
    await touch('touchmove', 182);
    // The center goes to 178: (178 − 10) / 280 = 60%.
    expect(host.value()).toBe(60);
    expect(style(thumb, 'transform')).toBe('translateX(178px)');
    expect(style(thumb, 'transition')).not.toContain('transform');
    expect(host.changes).toEqual([]);

    await lift();
    expect(host.changes).toEqual([60]);
    expect(host.touches).toBe(1);

    // Lynx may send a tap after a short drag: it doesn't move the thumb.
    await tap();
    expect(host.changes).toEqual([60]);
  });

  it('pulls the thumb under a finger that drags beside it', async () => {
    const { host, touch, lift } = await renderSlider();

    await touch('touchstart', 220);
    await touch('touchmove', 234);
    expect(host.value()).toBe(80);
    await lift();
    expect(host.changes).toEqual([80]);
  });

  it('moves to a tap on the track, but not to one on the thumb', async () => {
    const { host, slider, thumb, touch, lift, tap } = await renderSlider();

    await touch('touchstart', 150);
    await lift();
    await tap();
    expect(host.changes).toEqual([]);

    await touch('touchstart', 38);
    await lift();
    await tap();
    expect(host.value()).toBe(10);
    // It glides there, where a drag or a new layout moves it at once.
    expect(style(thumb, 'transition')).toContain('transform');
    fireEvent.layoutchange(slider, { detail: { width: WIDTH } });
    await waitForUpdate();
    expect(style(thumb, 'transition')).not.toContain('transform');
    expect(host.changes).toEqual([10]);
    expect(host.touches).toBe(1);
  });

  it('leaves a press that moves up or down to the scroll view', async () => {
    const { host, touch, lift, tap } = await renderSlider();

    await touch('touchstart', 220, 10);
    await touch('touchmove', 222, 30);
    await touch('touchmove', 260, 30);
    expect(host.value()).toBe(50);
    await lift();
    await tap();
    expect(host.value()).toBe(50);
    expect(host.changes).toEqual([]);
  });

  it('keeps the value a drag reached when a scroll takes the touch', async () => {
    const { host, touch, lift, tap } = await renderSlider();

    await touch('touchstart', 150);
    await touch('touchmove', 94);
    expect(host.value()).toBe(30);
    await lift('touchcancel');
    expect(host.changes).toEqual([30]);

    // A canceled press is no tap, even beside the thumb.
    await touch('touchstart', 250);
    await lift('touchcancel');
    await tap();
    expect(host.value()).toBe(30);
  });

  it('ignores events without a position, and moves with no press', async () => {
    const { host, slider, touch } = await renderSlider();

    fireEvent.touchstart(slider, { touches: [] });
    await touch('touchmove', 250);
    fireEvent.touchend(slider);
    fireEvent.mousemove(slider, { buttons: 0 });
    await waitForUpdate();
    expect(host.value()).toBe(50);

    await touch('touchstart', 150);
    fireEvent.touchmove(slider, { touches: [{}] });
    await waitForUpdate();
    expect(host.value()).toBe(50);
  });

  it('steps by a tenth of its range for a screen reader', async () => {
    const { host, slider, tap } = await renderSlider();

    fireLynxEvent(slider, 'accessibilityaction', {
      detail: { name: 'Increase' },
    });
    await waitForUpdate();
    expect(host.value()).toBe(60);
    expect(slider.getAttribute('accessibility-value')).toBe('60%');

    fireLynxEvent(slider, 'accessibilityaction', {
      detail: { name: 'Decrease' },
    });
    fireLynxEvent(slider, 'accessibilityaction', { detail: {} });
    await waitForUpdate();
    expect(host.value()).toBe(50);
    expect(host.changes).toEqual([60, 50]);

    // At the end of the range, it stays there.
    host.value.set(0);
    await waitForUpdate();
    fireLynxEvent(slider, 'accessibilityaction', {
      detail: { name: 'Decrease' },
    });
    await waitForUpdate();
    expect(host.value()).toBe(0);
    host.value.set(50);
    await waitForUpdate();

    // A screen reader's double tap has no press before it.
    await tap();
    expect(host.value()).toBe(50);
  });

  it('keeps to its range and steps', async () => {
    const { host, slider, thumb, update } = await renderSlider();

    await update(() => host.value.set(140));
    expect(style(thumb, 'transform')).toBe('translateX(290px)');
    expect(slider.getAttribute('accessibility-value')).toBe('100%');

    await update(() => {
      host.min.set(0);
      host.max.set(1);
      host.step.set(0.05);
      host.value.set(0.33);
    });
    expect(slider.getAttribute('accessibility-value')).toBe('35%');
    fireLynxEvent(slider, 'accessibilityaction', {
      detail: { name: 'Increase' },
    });
    await waitForUpdate();
    expect(host.value()).toBe(0.45);

    // A range of four steps moves one at a time.
    await update(() => {
      host.max.set(4);
      host.step.set(1);
      host.value.set(2);
    });
    fireLynxEvent(slider, 'accessibilityaction', {
      detail: { name: 'Increase' },
    });
    await waitForUpdate();
    expect(host.value()).toBe(3);

    // No range, no step, or no min and max: all still draw.
    await update(() => {
      host.min.set(undefined);
      host.max.set(undefined);
      host.step.set(0);
      host.value.set(42);
    });
    expect(slider.getAttribute('accessibility-value')).toBe('42%');
    await update(() => {
      host.min.set(10);
      host.max.set(5);
    });
    expect(style(thumb, 'transform')).toBe('translateX(10px)');
    expect(slider.getAttribute('accessibility-value')).toBe('0%');
  });

  it('says a value the way it is given', async () => {
    const { host, slider, update } = await renderSlider();

    await update(() => host.valueText.set((value) => `${value} dB`));
    expect(slider.getAttribute('accessibility-value')).toBe('50 dB');
  });

  it('dims and ignores the user while disabled', async () => {
    const { host, slider, touch, lift, tap, update } = await renderSlider();

    await update(() => host.disabled.set(true));
    expect(style(slider, 'opacity')).toBe('0.5');
    expect(slider.getAttribute('accessibility-traits')).toBe(
      'adjustable,disabled',
    );

    await touch('touchstart', 250);
    await touch('touchmove', 280);
    await lift();
    await tap();
    fireLynxEvent(slider, 'accessibilityaction', {
      detail: { name: 'Increase' },
    });
    await waitForUpdate();
    expect(host.value()).toBe(50);
    expect(host.changes).toEqual([]);
  });

  it('reads a layout from older Android, and waits for one with a width', async () => {
    const { slider, thumb } = await renderSlider();

    fireEvent.layoutchange(slider, { params: { width: 200 } });
    await waitForUpdate();
    expect(style(thumb, 'transform')).toBe('translateX(100px)');
    fireEvent.layoutchange(slider, { detail: {} });
    await waitForUpdate();
    expect(style(thumb, 'transform')).toBe('translateX(100px)');
  });

  it('goes to its start when it is narrower than its thumb', async () => {
    const { host, slider, thumb, touch, lift, tap } = await renderSlider();

    fireEvent.layoutchange(slider, { detail: { width: 12 } });
    await waitForUpdate();
    expect(style(thumb, 'transform')).toBe('translateX(10px)');
    await touch('touchstart', 40);
    await lift();
    await tap();
    expect(host.value()).toBe(0);
  });

  it('drags with the mouse on the web, measuring where the slider is', async () => {
    let left = 16;
    const invoke = vi
      .spyOn(globalThis as unknown as InvokeUIMethod, '__InvokeUIMethod')
      .mockImplementation((_element, method, _params, callback) => {
        callback({
          code: 0,
          data: method === 'boundingClientRect' ? { left, width: WIDTH } : {},
        });
      });
    const { host, slider, tap } = await renderSlider(WEB);
    const mouse = async (
      kind: 'mousedown' | 'mousemove' | 'mouseup',
      x: number,
      buttons = 1,
    ) => {
      fireEvent[kind](slider, { x, y: 10, buttons });
      await waitForUpdate();
    };

    // Lynx for Web gives x from the <lynx-view>, where the slider starts 16px
    // in: the thumb's center, 150 in the slider, is at 166.
    await mouse('mousedown', 166);
    expect(invoke).toHaveBeenCalledWith(
      slider,
      'boundingClientRect',
      {},
      expect.any(Function),
    );
    await mouse('mousemove', 194);
    expect(host.value()).toBe(60);
    // A move with no button held: the button came up outside the slider.
    await mouse('mousemove', 250, 0);
    expect(host.changes).toEqual([60]);
    await mouse('mousemove', 250);
    expect(host.value()).toBe(60);

    // The browser's click after a mouse press beside the thumb moves it.
    await mouse('mousedown', 54);
    await mouse('mouseup', 54);
    await tap();
    expect(host.value()).toBe(10);

    // In a scaled preview, the measurement is in screen pixels.
    left = 8;
    invoke.mockImplementation((_element, _method, _params, callback) => {
      callback({ code: 0, data: { left, width: WIDTH / 2 } });
    });
    await mouse('mousedown', 16 + 150);
    await mouse('mouseup', 16 + 150);
    await tap();
    expect(host.value()).toBe(50);
  });

  it('waits for the measurement on the web before it follows a drag', async () => {
    let answer: (() => void) | undefined;
    vi.spyOn(
      globalThis as unknown as InvokeUIMethod,
      '__InvokeUIMethod',
    ).mockImplementation((_element, _method, _params, callback) => {
      answer = () => callback({ code: 0, data: { left: 0, width: 0 } });
    });
    const { host, touch, lift } = await renderSlider(WEB);

    await touch('touchstart', 150);
    await touch('touchmove', 178);
    expect(host.value()).toBe(50);
    answer!();
    await waitForUpdate();
    expect(host.value()).toBe(60);
    await lift();

    // A measurement that comes after its press has ended is dropped.
    await touch('touchstart', 220);
    await lift();
    answer!();
    await waitForUpdate();
    expect(host.value()).toBe(60);
  });

  describe('glass', () => {
    const renderGlass = async (
      platform: { platform: string; osVersion: string },
      providers: Provider[] = [],
    ) => {
      const rendered = await renderSlider(platform, providers);
      await rendered.update(() => rendered.host.variant.set('glass'));
      const lens = rendered.slider.querySelector('blur-view');
      return { ...rendered, lens };
    };

    it("draws iOS 26's slider, whose thumb turns to glass while it's held", async () => {
      const { slider, track, fill, thumb, lens, touch, lift } =
        await renderGlass(IOS_26);

      expect(style(slider, 'height')).toBe('34px');
      expect(style(track, 'height')).toBe('6px');
      expect(style(fill, 'background-color')).toBe('rgb(0, 136, 255)');
      expect(style(thumb, 'width')).toBe('37px');
      expect(style(thumb, 'box-shadow')).not.toBe('');
      // The lens hides under the thumb, a little smaller.
      expect(lens?.getAttribute('blur-effect')).toBe('glass');
      expect(lens?.getAttribute('glass-style')).toBe('clear');
      expect(style(lens!, 'width')).toBe('33px');

      await touch('touchstart', 150);
      expect(style(lens!, 'width')).toBe('59px');
      expect(style(lens!, 'height')).toBe('38px');
      expect(style(lens!, 'left')).toBe('-29.5px');
      expect(style(thumb, 'opacity')).toBe('0');

      await lift();
      expect(style(thumb, 'width')).toBe('37px');
      expect(style(thumb, 'opacity')).toBe('1');
    });

    it("takes iOS's dark colors in a dark app", async () => {
      const { track, fill } = await renderGlass(IOS_26, [
        provideIconTheme({ colorScheme: 'dark' }),
      ]);

      expect(style(fill, 'background-color')).toBe('rgb(0, 145, 255)');
      expect(style(track, 'background-color')).toBe('rgba(255, 255, 255, 0.1)');
    });

    it('grows a solid thumb instead under Reduce Transparency on the web', async () => {
      settings.reduceTransparency.set(true);
      const { thumb, lens, touch } = await renderGlass(WEB);

      await touch('touchstart', 150);
      expect(style(thumb, 'width')).toBe('59px');
      expect(style(thumb, 'opacity')).toBe('1');
      expect(style(lens!, 'width')).toBe('33px');
    });

    it("draws iOS 15 to 25's slider before iOS 26", async () => {
      const { slider, track, fill, thumb, lens, touch } =
        await renderGlass(IOS_18);

      expect(lens).toBeNull();
      expect(style(slider, 'height')).toBe('31px');
      expect(style(track, 'height')).toBe('4px');
      expect(style(fill, 'background-color')).toBe('rgb(0, 122, 255)');
      expect(style(thumb, 'width')).toBe('28px');
      await touch('touchstart', 150);
      expect(style(thumb, 'width')).toBe('28px');
    });

    it("draws Material 3 Expressive's slider on Android", async () => {
      const { host, slider, track, fill, thumb, touch, lift, update } =
        await renderGlass(ANDROID);

      expect(slider.querySelector('blur-view')).toBeNull();
      expect(style(slider, 'height')).toBe('44px');
      expect(fill.classList).toContain('bg-primary');
      expect(track.classList).toContain('bg-secondary');
      // The handle at 150, with 2 + 6px clear each side of it.
      expect(style(thumb, 'width')).toBe('4px');
      expect(style(fill, 'width')).toBe('142px');
      expect(style(track, 'left')).toBe('158px');
      expect(style(track, 'width')).toBe('142px');
      const stop = slider.children[2]!;
      expect(style(stop, 'opacity')).toBe('1');

      // Held, the handle narrows, and the track follows a drag at once.
      await touch('touchstart', 150);
      expect(style(thumb, 'width')).toBe('2px');
      await touch('touchmove', 164);
      expect(style(track, 'transition')).toBe('none');
      await lift();
      fireLynxEvent(slider, 'accessibilityaction', {
        detail: { name: 'Decrease' },
      });
      await waitForUpdate();
      expect(style(track, 'transition')).toContain('left');

      // Near the end, the stop goes under the handle's gap.
      await update(() => host.value.set(98));
      expect(style(stop, 'opacity')).toBe('0');
      await update(() => host.disabled.set(true));
      expect(style(slider, 'opacity')).toBe('0.38');
    });

    it('draws glass on Android when the app opts in', async () => {
      const { lens } = await renderGlass(ANDROID, [
        provideGlass({ android: 'glass' }),
      ]);

      expect(lens).not.toBeNull();
    });

    it('moves without animating under Reduce Motion', async () => {
      settings.reduceMotion.set(true);
      const { thumb, fill, touch } = await renderGlass(IOS_26);

      expect(style(thumb, 'transition')).toBe('none');
      expect(style(fill, 'transition')).toBe('none');
      await touch('touchstart', 150);
      expect(style(thumb, 'transition')).toBe('none');
    });
  });

  describe('forms', () => {
    it('binds to a reactive form control', async () => {
      @Component({
        imports: [ReactiveFormsModule, UiSlider],
        template: `<ui-slider
          [formControl]="volume"
          accessibility-label="Volume"
        />`,
      })
      class ReactiveHost {
        readonly volume = new FormControl(20, { nonNullable: true });
      }
      const { componentRef, getByRole } = await render(ReactiveHost);
      const host = componentRef.instance as ReactiveHost;
      const slider = getByRole('slider', { name: 'Volume' });

      expect(slider.getAttribute('accessibility-value')).toBe('20%');
      fireLynxEvent(slider, 'accessibilityaction', {
        detail: { name: 'Increase' },
      });
      await waitForUpdate();
      expect(host.volume.value).toBe(30);
      expect(host.volume.touched).toBe(true);

      host.volume.disable();
      await waitForUpdate();
      expect(slider.getAttribute('accessibility-traits')).toBe(
        'adjustable,disabled',
      );
    });

    it('binds to ngModel', async () => {
      @Component({
        imports: [FormsModule, UiSlider],
        template: `<ui-slider
          [(ngModel)]="volume"
          accessibility-label="Volume"
        />`,
      })
      class ModelHost {
        volume = 40;
      }
      const { componentRef, getByRole } = await render(ModelHost);
      const host = componentRef.instance as ModelHost;

      fireLynxEvent(
        getByRole('slider', { name: 'Volume' }),
        'accessibilityaction',
        {
          detail: { name: 'Increase' },
        },
      );
      await waitForUpdate();
      expect(host.volume).toBe(50);
    });

    it('binds to a Signal Forms field', async () => {
      @Component({
        imports: [FormField, UiSlider],
        template: `<ui-slider
          [formField]="settings.volume"
          accessibility-label="Volume"
        />`,
      })
      class SignalHost {
        readonly model = signal({ volume: 70 });
        readonly settings = form(this.model);
      }
      const { componentRef, getByRole } = await render(SignalHost);
      const host = componentRef.instance as SignalHost;
      const slider = getByRole('slider', { name: 'Volume' });

      expect(slider.getAttribute('accessibility-value')).toBe('70%');
      fireLynxEvent(slider, 'accessibilityaction', {
        detail: { name: 'Decrease' },
      });
      await waitForUpdate();
      expect(host.model().volume).toBe(60);
    });
  });
});
