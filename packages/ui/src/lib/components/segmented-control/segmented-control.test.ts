import { Component, inject, signal } from '@angular/core';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { provideIconTheme } from '../icon/icon-theme';
import {
  type SegmentedHost,
  segmentPlace,
  UI_SEGMENTED_HOST,
  UiSegmentedControl,
  UiSegmentedIndicator,
} from './segmented-control';

/**
 * The control, as its segmented control reads it. Named, as a provider's
 * factory in a component must be.
 */
const testHost = (): SegmentedHost => inject(SegmentedControlHost);

/**
 * A segmented control of an app's own, built on UiSegmentedControl the way
 * ui-tabs-list and ui-toggle-group are: a track with the indicator first,
 * and segments that report their width and their touches.
 */
@Component({
  selector: 'test-segmented-control',
  imports: [LYNX_ELEMENTS, UiSegmentedIndicator],
  providers: [
    UiSegmentedControl,
    { provide: UI_SEGMENTED_HOST, useFactory: testHost },
  ],
  template: `
    <view [class]="control.trackClass()" (bindmouseleave)="control.cancel()">
      @if (control.underlay()) {
        <ui-segmented-indicator />
      }
      @for (value of values(); track value) {
        <view
          [class]="control.segmentHostClass"
          (bindlayoutchange)="control.measure(value, $event)"
        >
          <view
            [class]="
              control.segmentClass(value, { first: $first, last: $last })
            "
            [style]="control.segmentStyle(value)"
            (bindtouchstart)="control.press(value, $event)"
            (bindtouchmove)="control.move($event)"
            (bindtouchend)="control.release()"
            (bindtouchcancel)="control.cancel()"
            (bindmousedown)="control.press(value, $event)"
            (bindmousemove)="control.move($event)"
            (bindmouseup)="control.release()"
            (bindmouseleave)="control.leave(value)"
            (bindtap)="tap(value)"
          >
            @if (control.stateLayerClass(value); as stateLayer) {
              <view [class]="stateLayer"></view>
            }
            <text [class]="control.labelClass(value)">{{ value }}</text>
          </view>
        </view>
      }
    </view>
  `,
})
class SegmentedControlHost implements SegmentedHost {
  readonly control = inject(UiSegmentedControl);

  readonly values = signal(['Day', 'Week', 'Month']);
  readonly selected = signal<string[]>(['Week']);
  readonly isSegmented = signal(true);
  readonly isMultiple = signal(false);
  readonly isDisabled = signal(false);
  /** What the control asked to select, in order. */
  readonly selections: string[] = [];

  readonly segmented = this.isSegmented.asReadonly();
  readonly segmentValues = this.values.asReadonly();
  readonly selectedValues = this.selected.asReadonly();
  readonly multiple = this.isMultiple.asReadonly();
  readonly disabled = this.isDisabled.asReadonly();

  select(value: string): void {
    this.selections.push(value);
    this.selected.set([value]);
  }

  tap(value: string): void {
    if (!this.control.tap(value)) return;
    this.selected.update((selected) =>
      this.isMultiple()
        ? selected.includes(value)
          ? selected.filter((other) => other !== value)
          : [...selected, value]
        : [value],
    );
  }
}

/** Accessibility settings a test can change, as the host app would. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

const IOS_26 = { platform: 'iOS', osVersion: '26.0' };
const IOS_18 = { platform: 'iOS', osVersion: '18.6' };
const ANDROID = { platform: 'Android', osVersion: '15' };

/** Each segment's width, in px, as Lynx lays the 300px track out. */
const WIDTHS: Readonly<Record<string, number>> = {
  Day: 100,
  Week: 100,
  Month: 100,
};

/**
 * Waits `ms` of real time, then lets the update it led to apply.
 */
const after = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await waitForUpdate();
};

/**
 * Long enough for the lens to settle after a tap (the slide, 350ms, then
 * its shrink, 150ms). Chained timers can each fire a clock tick late on
 * Windows, so it leaves room.
 */
const SETTLED = 700;

/**
 * Renders the control on a platform (none gives Material), in a light or a
 * dark theme.
 */
const renderControl = async (
  platform?: { platform: string; osVersion: string },
  scheme: 'light' | 'dark' = 'light',
) => {
  vi.stubGlobal('SystemInfo', platform);
  const result = await render(SegmentedControlHost, {
    providers: [
      { provide: LynxAccessibilitySettings, useValue: settings },
      provideIconTheme({ colorScheme: scheme }),
    ],
  });
  const host = result.componentRef.instance as SegmentedControlHost;
  /**
   * A segment's own view, which takes its touches.
   */
  const segment = (label: string) => result.getByText(label).parentElement!;
  /**
   * A segment's slot in the track, which reports its width.
   */
  const slot = (label: string) => segment(label).parentElement!;
  const track = () => slot('Day').parentElement!;
  /**
   * What the track draws under the segments, if anything.
   */
  const underlay = () => {
    const first = track().firstElementChild!;
    return first.classList.contains('h-full') ? first : null;
  };
  /**
   * The indicator's frame, which moves between the segments.
   */
  const frame = () =>
    underlay()!.querySelector<HTMLElement>(
      '.bottom-0.top-0:not(.w-\\[1px\\])',
    )!;
  /**
   * The opaque thumb in the frame, beside the lens. (Angular's `@if` leaves
   * a hidden anchor view there too.)
   */
  const thumb = () =>
    Array.from(frame().children).find(
      (child) =>
        child.classList.contains('absolute') && child.localName !== 'blur-view',
    ) as HTMLElement;
  /**
   * The glass lens, while it's drawn.
   */
  const lens = () => frame().querySelector<HTMLElement>('blur-view');
  const separators = () =>
    Array.from(underlay()!.querySelectorAll<HTMLElement>('.w-\\[1px\\]'));
  /**
   * Reports every segment's width, as Lynx does after laying them out.
   */
  const measure = async (widths: Record<string, number> = WIDTHS) => {
    for (const [label, width] of Object.entries(widths)) {
      fireEvent.layoutchange(slot(label), { detail: { width, height: 32 } });
    }
    await waitForUpdate();
    // The indicator is placed at once, and slides from the next change on.
    await after(0);
  };
  /**
   * A touch event's fields, with the finger at `pageX` if given.
   */
  const touch = (pageX?: number) =>
    pageX === undefined ? {} : { touches: [{ pageX }] };
  return {
    ...result,
    host,
    segment,
    slot,
    track,
    underlay,
    frame,
    thumb,
    lens,
    separators,
    measure,
    press: async (label: string, pageX?: number) => {
      fireEvent.touchstart(segment(label), touch(pageX));
      await waitForUpdate();
    },
    move: async (label: string, pageX?: number) => {
      fireEvent.touchmove(segment(label), touch(pageX));
      await waitForUpdate();
    },
    release: async (label: string) => {
      fireEvent.touchend(segment(label));
      await waitForUpdate();
    },
    tap: async (label: string) => {
      fireEvent.tap(segment(label));
      await waitForUpdate();
    },
    update: async (change: () => void) => {
      change();
      await waitForUpdate();
    },
  };
};

beforeEach(() => {
  // The indicator's selector isn't a Lynx element, so the renderer falls
  // back to a <view> for it and warns.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  settings.reduceMotion.set(false);
  settings.reduceTransparency.set(false);
  settings.increaseContrast.set(false);
});

describe('UiSegmentedControl', () => {
  describe('the track', () => {
    it("is iOS 26's capsule, iOS 13's rounded track before, and Material's group on Android", async () => {
      const glass = await renderControl(IOS_26);
      expect(glass.track().classList).toContain('rounded-full');
      expect(glass.track().classList).toContain('bg-muted');
      expect(glass.track().classList).toContain('h-[32px]');
      glass.unmount();

      const frosted = await renderControl(IOS_18);
      expect(frosted.track().classList).toContain('rounded-[9px]');
      expect(frosted.track().classList).toContain('bg-muted');
      frosted.unmount();

      const material = await renderControl(ANDROID);
      expect(material.track().classList).toContain('gap-[2px]');
      expect(material.track().classList).toContain('h-[40px]');
      expect(material.track().classList).not.toContain('bg-muted');
      // Material's segments fill themselves: nothing under them.
      expect(material.underlay()).toBeNull();
    });

    it('dims a disabled control, which ignores touches', async () => {
      const { host, track, press, tap, update, measure } =
        await renderControl(IOS_26);
      await measure();
      await update(() => host.isDisabled.set(true));
      expect(track().classList).toContain('opacity-50');

      await press('Week', 150);
      await tap('Month');
      expect(host.selected()).toEqual(['Week']);
    });
  });

  describe('the indicator', () => {
    it('takes an equal share of the track until the segments are measured', async () => {
      const { frame } = await renderControl(IOS_26);
      expect(frame().style.left).toBe(`${100 / 3}%`);
      expect(frame().style.width).toBe(`${100 / 3}%`);
      expect(frame().style.opacity).toBe('1');
      expect(frame().style.transition).toBe('none');
    });

    it('sits on the measured selected segment, placed without sliding', async () => {
      const { frame, measure } = await renderControl(IOS_26);
      await measure({ Day: 80, Week: 120, Month: 100 });
      expect(frame().style.left).toBe('80px');
      expect(frame().style.width).toBe('120px');
    });

    it('slides to a new selection once placed, unless Reduce Motion is on', async () => {
      const { host, frame, measure, update } = await renderControl(IOS_26);
      await measure();

      await update(() => host.selected.set(['Month']));
      expect(frame().style.left).toBe('200px');
      expect(frame().style.transition).toContain('left 350ms');

      await update(() => settings.reduceMotion.set(true));
      await update(() => host.selected.set(['Day']));
      expect(frame().style.left).toBe('0px');
      expect(frame().style.transition).toBe('none');
    });

    it('slides on the gentler curve of the design before iOS 26', async () => {
      const { host, frame, measure, update } = await renderControl(IOS_18);
      await measure();
      await update(() => host.selected.set(['Month']));
      expect(frame().style.transition).toContain('left 250ms');
    });

    it('fades out while nothing is selected', async () => {
      const { host, frame, measure, update } = await renderControl(IOS_26);
      await measure();
      await update(() => host.selected.set([]));
      expect(frame().style.opacity).toBe('0');
      // It stays where an equal share would put the first segment.
      expect(frame().style.left).toBe('0%');
    });

    it('takes a width only from a layoutchange that reports one, and only when it changed', async () => {
      const { frame, slot, measure } = await renderControl(IOS_26);
      // Older Android puts the size in `params`.
      fireLynxEvent(slot('Day'), 'layoutchange', { params: { width: 90 } });
      fireLynxEvent(slot('Week'), 'layoutchange', { detail: {} });
      await waitForUpdate();
      expect(frame().style.width).toBe(`${100 / 3}%`);

      await measure({ Day: 90, Week: 110, Month: 100 });
      expect(frame().style.left).toBe('90px');
      // The same width again changes nothing.
      fireEvent.layoutchange(slot('Week'), { detail: { width: 110 } });
      await waitForUpdate();
      expect(frame().style.width).toBe('110px');
    });

    it('follows a segment that grows, as after a rotation', async () => {
      const { frame, measure } = await renderControl(IOS_26);
      await measure();
      await measure({ Day: 150, Week: 150, Month: 150 });
      expect(frame().style.left).toBe('150px');
      expect(frame().style.width).toBe('150px');
    });

    it("draws iOS 26's thumb as a white capsule, and iOS 13's with round corners and a drop shadow", async () => {
      const glass = await renderControl(IOS_26);
      expect(glass.thumb().classList).toContain('rounded-full');
      expect(glass.thumb().classList).toContain('bg-background');
      expect(glass.thumb().style.left).toBe('2px');
      expect(glass.thumb().style.getPropertyValue('box-shadow')).toBe(
        '0 1px 2px rgba(0, 0, 0, 0.1)',
      );
      glass.unmount();

      const frosted = await renderControl(IOS_18);
      expect(frosted.thumb().classList).toContain('rounded-[7px]');
      expect(frosted.thumb().style.getPropertyValue('box-shadow')).toContain(
        '0 3px 8px',
      );
    });

    it("draws a dark theme's thumb in UIKit's gray", async () => {
      const { thumb } = await renderControl(IOS_26, 'dark');
      expect(thumb().classList).not.toContain('bg-background');
      expect(thumb().style.getPropertyValue('background-color')).toBe(
        'rgb(90, 90, 95)',
      );
    });

    it('gives the thumb an edge under Increase Contrast', async () => {
      const { thumb, update } = await renderControl(IOS_26);
      await update(() => settings.increaseContrast.set(true));
      expect(thumb().classList).toContain('border-foreground');
    });

    it('is hidden from screen readers, which read the segments', async () => {
      const { underlay } = await renderControl(IOS_26);
      expect(underlay()!.getAttribute('accessibility-elements-hidden')).toBe(
        'true',
      );
    });
  });

  describe('the glass lens', () => {
    it('lifts the thumb into glass as a tap moves it, and settles back', async () => {
      const { frame, thumb, lens, measure, segment, host, componentRef } =
        await renderControl(IOS_26);
      await measure();
      expect(lens()).toBeNull();

      fireEvent.tap(segment('Month'));
      // Checked before the next tick, when the lens opens.
      componentRef.changeDetectorRef.detectChanges();
      expect(host.selected()).toEqual(['Month']);
      // Drawn at the thumb's size under the thumb first, so it grows from
      // there.
      expect(lens()!.style.left).toBe('2px');
      expect(thumb().style.opacity).toBe('1');

      await after(0);
      expect(lens()!.style.left).toBe('-10px');
      expect(lens()!.style.top).toBe('-3px');
      expect(thumb().style.opacity).toBe('0');
      expect(frame().style.left).toBe('200px');

      await after(SETTLED);
      expect(lens()).toBeNull();
      expect(thumb().style.opacity).toBe('1');
    });

    it("doesn't lift for a tap on the selected segment", async () => {
      const { lens, measure, tap } = await renderControl(IOS_26);
      await measure();
      await tap('Week');
      expect(lens()).toBeNull();
    });

    it("doesn't lift under Reduce Motion or Reduce Transparency, or before iOS 26", async () => {
      const glass = await renderControl(IOS_26);
      await glass.measure();
      await glass.update(() => settings.reduceMotion.set(true));
      await glass.tap('Month');
      expect(glass.lens()).toBeNull();
      // The thumb fades and shrinks at once, too.
      expect(glass.thumb().style.transition).toBe('none');

      await glass.update(() => {
        settings.reduceMotion.set(false);
        settings.reduceTransparency.set(true);
      });
      await glass.tap('Day');
      expect(glass.lens()).toBeNull();
      glass.unmount();

      const frosted = await renderControl(IOS_18);
      await frosted.measure();
      await frosted.tap('Month');
      expect(frosted.lens()).toBeNull();
    });

    it('grows the lens again if it moves again before settling', async () => {
      const { lens, measure, tap } = await renderControl(IOS_26);
      await measure();
      await tap('Month');
      await after(0);
      // The slide is over and the lens is shrinking back under the thumb.
      await after(400);
      expect(lens()!.style.left).toBe('2px');

      await tap('Day');
      expect(lens()!.style.left).toBe('-10px');
      await after(SETTLED);
      expect(lens()).toBeNull();
    });
  });

  describe('dragging', () => {
    it('lifts the selected thumb under the finger, follows it, and selects where it lets go', async () => {
      const {
        host,
        frame,
        lens,
        segment,
        measure,
        press,
        move,
        release,
        tap,
        getByText,
      } = await renderControl(IOS_26);
      await measure();

      await press('Week', 150);
      await after(0);
      expect(lens()!.style.left).toBe('-10px');

      await move('Week', 230);
      // It follows the finger at once, kept its width.
      expect(frame().style.left).toBe('180px');
      expect(frame().style.width).toBe('100px');
      expect(frame().style.transition).toBe('none');
      // The label under it reads as selected as it passes.
      expect(getByText('Month').classList).toContain('font-medium');
      expect(getByText('Week').classList).not.toContain('font-medium');
      // The segment it left isn't dimmed as pressed.
      expect(segment('Week').classList).not.toContain('opacity-60');

      await release('Week');
      expect(host.selections).toEqual(['Month']);
      expect(frame().style.left).toBe('200px');
      expect(frame().style.transition).toContain('left 350ms');

      // The tap Lynx may send as the finger lifts doesn't reselect Week.
      await tap('Week');
      expect(host.selected()).toEqual(['Month']);

      await after(SETTLED);
      expect(lens()).toBeNull();
    });

    it('stays within the track', async () => {
      const { frame, measure, press, move } = await renderControl(IOS_26);
      await measure();
      await press('Week', 150);
      await move('Week', -500);
      expect(frame().style.left).toBe('0px');
      await move('Week', 900);
      expect(frame().style.left).toBe('200px');
    });

    it('leaves a press that barely moved to the tap, and the drag back where it started selects nothing', async () => {
      const { host, frame, measure, press, move, release, tap } =
        await renderControl(IOS_26);
      await measure();

      await press('Week', 150);
      await move('Week', 153);
      await release('Week');
      expect(host.selections).toEqual([]);
      expect(frame().style.left).toBe('100px');
      // The tap then goes through, on the segment that's selected already.
      await tap('Week');
      expect(host.selected()).toEqual(['Week']);

      await press('Week', 150);
      await move('Week', 180);
      await release('Week');
      expect(host.selections).toEqual([]);
    });

    it('goes back to the selected segment when the touch is taken away, or the mouse leaves', async () => {
      const { host, frame, track, segment, measure, press, move } =
        await renderControl(IOS_26);
      await measure();

      await press('Week', 150);
      await move('Week', 260);
      fireEvent.touchcancel(segment('Week'));
      await waitForUpdate();
      expect(frame().style.left).toBe('100px');
      expect(host.selections).toEqual([]);

      // In the web preview, with the mouse.
      fireEvent.mousedown(segment('Week'), { pageX: 150 });
      fireEvent.mousemove(segment('Month'), { pageX: 260 });
      await waitForUpdate();
      expect(frame().style.left).toBe('200px');
      // Leaving one segment for another doesn't end the drag.
      fireLynxEvent(segment('Week'), 'mouseleave');
      await waitForUpdate();
      expect(frame().style.left).toBe('200px');
      fireLynxEvent(track(), 'mouseleave');
      await waitForUpdate();
      expect(frame().style.left).toBe('100px');
    });

    it('lets go of a pressed segment that the pointer leaves, or whose touch is taken away', async () => {
      const { segment, measure, press } = await renderControl(IOS_26);
      await measure();
      await press('Day', 50);
      // Leaving another segment leaves Day pressed.
      fireLynxEvent(segment('Month'), 'mouseleave');
      await waitForUpdate();
      expect(segment('Day').classList).toContain('opacity-60');
      fireLynxEvent(segment('Day'), 'mouseleave');
      await waitForUpdate();
      expect(segment('Day').classList).not.toContain('opacity-60');

      await press('Day', 50);
      fireEvent.touchcancel(segment('Day'));
      await waitForUpdate();
      expect(segment('Day').classList).not.toContain('opacity-60');
    });

    it('selects with the mouse in the web preview', async () => {
      const { host, segment, measure } = await renderControl(IOS_26);
      await measure();
      fireEvent.mousedown(segment('Week'), { pageX: 150 });
      fireEvent.mousemove(segment('Day'), { pageX: 40 });
      fireEvent.mouseup(segment('Day'));
      await waitForUpdate();
      expect(host.selections).toEqual(['Day']);
    });

    it("doesn't take hold of an unselected segment, or one that can't be measured or placed", async () => {
      const { host, frame, segment, measure, press, move, release, update } =
        await renderControl(IOS_26);

      // Not measured yet.
      await press('Week', 150);
      await move('Week', 260);
      await release('Week');
      expect(host.selections).toEqual([]);

      await measure();
      // A press with no position, as a synthetic event might be.
      await press('Week');
      await move('Week', 260);
      expect(frame().style.left).toBe('100px');
      await release('Week');

      // An unselected segment dims while pressed instead.
      await press('Day', 50);
      expect(segment('Day').classList).toContain('opacity-60');
      await move('Day', 260);
      expect(frame().style.left).toBe('100px');
      await release('Day');
      expect(segment('Day').classList).not.toContain('opacity-60');

      // A move with no position is ignored.
      await press('Week', 150);
      await move('Week');
      expect(frame().style.left).toBe('100px');
      await release('Week');

      await update(() => host.isMultiple.set(true));
      await press('Week', 150);
      await move('Week', 260);
      await release('Week');
      expect(host.selections).toEqual([]);
    });

    it('lets go of a drag whose segments change under it', async () => {
      const { host, frame, measure, press, move, release, update } =
        await renderControl(IOS_26);
      await measure();

      // A segment that hasn't been measured joins: there's no layout.
      await press('Week', 150);
      await update(() => host.values.set(['Day', 'Week', 'Month', 'Year']));
      await move('Week', 260);
      await release('Week');
      expect(host.selections).toEqual([]);

      // The dragged segment's place is gone.
      await update(() => host.values.set(['Day', 'Week', 'Month']));
      await update(() => host.selected.set(['Month']));
      await press('Month', 250);
      await update(() => host.values.set(['Day']));
      await move('Day', 50);
      await release('Day');
      expect(host.selections).toEqual([]);
      expect(frame()).not.toBeNull();
    });

    it("shrinks iOS 13's thumb while it's held", async () => {
      const { thumb, measure, press, release } = await renderControl(IOS_18);
      await measure();
      await press('Week', 150);
      expect(thumb().style.transform).toBe('scale(0.95)');
      await release('Week');
      expect(thumb().style.transform).toBe('scale(1)');
    });
  });

  describe('segments', () => {
    it('share the track, positioned so the web paints them over the indicator', async () => {
      const { slot } = await renderControl(IOS_26);
      expect(slot('Day').classList).toContain('flex-1');
      expect(slot('Day').classList).toContain('relative');
    });

    it('label as UIKit does: medium when selected on iOS 26, semibold before', async () => {
      const glass = await renderControl(IOS_26);
      const label = (label: string) => glass.getByText(label);
      expect(label('Week').classList).toContain('font-medium');
      expect(label('Week').classList).toContain('text-[13px]');
      expect(label('Day').classList).not.toContain('font-medium');
      glass.unmount();

      const frosted = await renderControl(IOS_18);
      expect(frosted.getByText('Week').classList).toContain('font-semibold');
    });

    it('separate unselected neighbors with a hairline before iOS 26, measured first', async () => {
      const { host, separators, measure, update } = await renderControl(IOS_18);
      expect(separators()).toEqual([]);

      await measure();
      // Between Day and Week, and between Week and Month: both beside Week.
      expect(separators().map((line) => line.style.left)).toEqual([
        '99.5px',
        '199.5px',
      ]);
      expect(separators().map((line) => line.style.opacity)).toEqual([
        '0',
        '0',
      ]);

      await update(() => host.selected.set(['Day']));
      expect(separators().map((line) => line.style.opacity)).toEqual([
        '0',
        '0.3',
      ]);
      expect(separators()[1]!.style.transition).toContain('opacity');

      await update(() => settings.reduceMotion.set(true));
      expect(separators()[1]!.style.transition).toBe('none');
    });

    it('draw no separators on iOS 26', async () => {
      const { separators, measure } = await renderControl(IOS_26);
      await measure();
      expect(separators()).toEqual([]);
    });

    it("are Material's connected buttons: the selected one filled and round", async () => {
      const { host, segment, update, getByText } = await renderControl(ANDROID);
      expect(segment('Week').classList).toContain('bg-primary');
      expect(segment('Week').classList).toContain('rounded-full');
      // Text written `text-foreground` takes the fill's content color.
      expect(segment('Week').classList).toContain(
        '[--foreground:var(--primary-foreground)]',
      );
      expect(getByText('Week').classList).toContain('text-primary-foreground');
      expect(segment('Day').classList).toContain('bg-secondary');
      expect(getByText('Day').classList).toContain('text-secondary-foreground');
      expect(segment('Day').style.transition).toContain('background-color');

      await update(() => settings.reduceMotion.set(true));
      expect(segment('Day').style.transition).toBe('none');

      await update(() => settings.increaseContrast.set(true));
      expect(segment('Day').classList).toContain('border-secondary-foreground');
      expect(segment('Week').classList).toContain('border-primary');

      // They don't dim while pressed: a state layer shows instead.
      fireEvent.touchstart(segment('Day'), { touches: [{ pageX: 50 }] });
      await waitForUpdate();
      expect(segment('Day').classList).not.toContain('opacity-60');
      expect(segment('Day').querySelector('.opacity-10')).not.toBeNull();
      fireEvent.touchend(segment('Day'));
      await waitForUpdate();
      expect(segment('Day').querySelector('.opacity-10')).toBeNull();

      // Nothing slides on Material, so a tap just selects.
      await update(() => host.selected.set(['Month']));
      expect(segment('Month').classList).toContain('bg-primary');
    });

    it("round the group's ends on Material's end segments, so Increase Contrast's outline follows them", async () => {
      const { host, segment, track, update } = await renderControl(ANDROID);
      await update(() => settings.increaseContrast.set(true));
      expect(segment('Day').classList).toContain('rounded-l-[20px]');
      expect(segment('Day').classList).toContain('rounded-r-[8px]');
      expect(segment('Day').classList).toContain('border-secondary-foreground');
      expect(segment('Month').classList).toContain('rounded-l-[8px]');
      expect(segment('Month').classList).toContain('rounded-r-[20px]');
      // The track doesn't clip the ends, which would cut their outlines.
      expect(track().classList).not.toContain('rounded-full');
      expect(track().classList).not.toContain('overflow-hidden');

      // An unselected segment between them has small corners all round, and
      // the selected one is round wherever it is.
      await update(() => host.selected.set(['Day']));
      expect(segment('Week').classList).toContain('rounded-[8px]');
      expect(segment('Day').classList).toContain('rounded-full');
      expect(segment('Day').classList).not.toContain('rounded-l-[20px]');

      // A lone segment is round at both ends.
      await update(() => host.values.set(['Week']));
      expect(segment('Week').classList).toContain('rounded-full');
      expect(segment('Week').classList).toContain('bg-secondary');
    });

    it("give icons Material's content color, and leave them alone elsewhere", async () => {
      const material = await renderControl(ANDROID);
      const control = material.host.control;
      expect(control.iconColor('Week')).toBe('var(--primary-foreground)');
      expect(control.iconColor('Day')).toBe('var(--secondary-foreground)');
      material.unmount();

      const glass = await renderControl(IOS_26);
      expect(glass.host.control.iconColor('Week')).toBeUndefined();
    });

    it('in a multiple selection, each draw their own thumb, and nothing slides', async () => {
      const { host, segment, underlay, update, measure, separators, tap } =
        await renderControl(IOS_18);
      await update(() => {
        host.isMultiple.set(true);
        host.selected.set(['Day', 'Month']);
      });
      await measure();
      expect(host.control.slides()).toBe(false);
      // Separators, but no indicator.
      expect(
        underlay()!.querySelector('.bottom-0.top-0:not(.w-\\[1px\\])'),
      ).toBeNull();
      expect(separators().map((line) => line.style.opacity)).toEqual([
        '0',
        '0',
      ]);

      expect(segment('Day').classList).toContain('m-[2px]');
      expect(segment('Day').classList).toContain('bg-background');
      expect(segment('Day').classList).toContain('rounded-[7px]');
      expect(segment('Day').style.getPropertyValue('box-shadow')).toContain(
        '0 3px 8px',
      );
      expect(segment('Week').classList).toContain('m-[2px]');
      expect(segment('Week').classList).not.toContain('bg-background');
      expect(segment('Week').style.getPropertyValue('box-shadow')).toBe('');

      await tap('Week');
      expect(host.selected()).toEqual(['Day', 'Month', 'Week']);
      expect(segment('Week').classList).toContain('bg-background');
    });

    it('in a dark multiple selection, take the dark thumb color', async () => {
      const { host, segment, update } = await renderControl(IOS_26, 'dark');
      await update(() => host.isMultiple.set(true));
      expect(segment('Week').style.getPropertyValue('background-color')).toBe(
        'rgb(90, 90, 95)',
      );
    });

    it("draw nothing of a segmented control's while the host isn't one", async () => {
      const { host, underlay, update } = await renderControl(IOS_26);
      await update(() => host.isSegmented.set(false));
      expect(underlay()).toBeNull();
      expect(host.control.enabled()).toBe(false);
      expect(host.control.slides()).toBe(false);
    });
  });
});

describe('segmentPlace', () => {
  it("finds a segment's place among its host's segments, and no end for one that isn't there", () => {
    const segments = ['Day', 'Week', 'Month'];
    expect(segmentPlace(segments, 'Day')).toEqual({ first: true, last: false });
    expect(segmentPlace(segments, 'Week')).toEqual({
      first: false,
      last: false,
    });
    expect(segmentPlace(segments, 'Month')).toEqual({
      first: false,
      last: true,
    });
    expect(segmentPlace(['Day'], 'Day')).toEqual({ first: true, last: true });
    expect(segmentPlace([], 'Day')).toEqual({ first: false, last: false });
  });
});
