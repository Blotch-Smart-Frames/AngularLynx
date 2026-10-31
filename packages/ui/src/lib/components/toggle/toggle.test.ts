import { Component, signal, viewChild } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { UiIcon } from '../icon/icon';
import { ICON_LIGHT_COLORS, UI_ICON_COLOR } from '../icon/icon-theme';
import {
  type ToggleGroupVariant,
  type ToggleSize,
  type ToggleVariant,
  UiToggle,
  UiToggleGroup,
  UiToggleGroupItem,
} from './toggle';

@Component({
  imports: [UiToggle, LYNX_ELEMENTS],
  template: `
    <ui-toggle
      [(pressed)]="bold"
      [variant]="variant()"
      [size]="size()"
      [disabled]="disabled()"
      class="w-20"
      ><text>Bold</text></ui-toggle
    >
  `,
})
class ToggleHost {
  readonly bold = signal(false);
  readonly variant = signal<ToggleVariant>('default');
  readonly size = signal<ToggleSize>('default');
  readonly disabled = signal(false);
}

@Component({
  imports: [UiToggleGroup, UiToggleGroupItem, LYNX_ELEMENTS],
  template: `
    <ui-toggle-group
      [type]="type()"
      [(value)]="align"
      [variant]="variant()"
      [size]="size()"
      [disabled]="disabled()"
      class="w-full"
    >
      <ui-toggle-group-item value="left" class="flex-1"
        ><text>Left</text></ui-toggle-group-item
      >
      <ui-toggle-group-item value="center"
        ><text>Center</text></ui-toggle-group-item
      >
      <ui-toggle-group-item value="right"
        ><text>Right</text></ui-toggle-group-item
      >
    </ui-toggle-group>
  `,
})
class ToggleGroupHost {
  readonly type = signal<'single' | 'multiple'>('single');
  readonly align = signal<string[]>([]);
  readonly variant = signal<ToggleGroupVariant>('default');
  readonly size = signal<ToggleSize>('default');
  readonly disabled = signal(false);
  readonly group = viewChild.required(UiToggleGroup);
}

/**
 * The toggle or toggle group item a label is projected into: its host, which
 * takes the presses.
 */
const viewOf = (label: Element) => label.parentElement!;

/**
 * The scale a view's inline style holds, if any.
 */
const scaleOf = (view: Element) =>
  (view as HTMLElement).style.getPropertyValue('transform');

/**
 * Presses and releases a view by touch, by mouse, and by a touch a scroll
 * takes over, checking it scales down while pressed and back after each.
 */
const expectPressFeedback = (view: Element) => {
  fireEvent.touchstart(view);
  expect(scaleOf(view)).toBe('scale(0.97)');
  fireEvent.touchend(view);
  expect(scaleOf(view)).toBe('scale(1)');

  fireEvent.touchstart(view);
  fireEvent.touchcancel(view);
  expect(scaleOf(view)).toBe('scale(1)');

  // Lynx on the web fires mouse events for a cursor, never touch ones.
  fireEvent.mousedown(view);
  expect(scaleOf(view)).toBe('scale(0.97)');
  fireEvent.mouseup(view);
  expect(scaleOf(view)).toBe('scale(1)');

  fireEvent.mousedown(view);
  fireLynxEvent(view, 'mouseleave');
  expect(scaleOf(view)).toBe('scale(1)');
};

/**
 * Presses a disabled view by touch and by mouse: it shouldn't scale.
 */
const expectNoPressFeedback = (view: Element) => {
  fireEvent.touchstart(view);
  fireEvent.mousedown(view);
  expect(scaleOf(view)).toBe('');
  fireEvent.touchend(view);
  fireEvent.mouseup(view);
  expect(scaleOf(view)).toBe('');
};

describe('UiToggle', () => {
  const renderToggle = async () => {
    const result = await render(ToggleHost);
    return {
      ...result,
      host: result.componentRef.instance as ToggleHost,
      toggle: () => viewOf(result.getByText('Bold')),
    };
  };

  // Angular gives a component's host every static attribute written on it,
  // so a toggle that also styled a view inside its host applied the class
  // twice (issue #181).
  it('puts its class on one element, the toggle', async () => {
    const { container, toggle } = await renderToggle();
    expect([...container.querySelectorAll('.w-20')]).toEqual([toggle()]);
  });

  it('renders its content unpressed, with the given class', async () => {
    const { toggle } = await renderToggle();
    expect(toggle().classList).toContain('bg-transparent');
    expect(toggle().classList).toContain('h-10');
    expect(toggle().classList).toContain('w-20');
    expect(toggle().classList).not.toContain('opacity-50');
  });

  it('flips `pressed` and its highlight on each tap', async () => {
    const { host, toggle } = await renderToggle();
    fireEvent.tap(toggle());
    await waitForUpdate();
    expect(host.bold()).toBe(true);
    expect(toggle().classList).toContain('bg-accent');

    fireEvent.tap(toggle());
    await waitForUpdate();
    expect(host.bold()).toBe(false);
    expect(toggle().classList).toContain('bg-transparent');
  });

  it('highlights when the app presses it', async () => {
    const { host, toggle } = await renderToggle();
    host.bold.set(true);
    await waitForUpdate();
    expect(toggle().classList).toContain('bg-accent');
  });

  it("dims and ignores taps while it's disabled", async () => {
    const { host, toggle } = await renderToggle();
    host.disabled.set(true);
    await waitForUpdate();
    expect(toggle().classList).toContain('opacity-50');
    fireEvent.tap(toggle());
    expect(host.bold()).toBe(false);
  });

  it('applies the classes for its variant and size', async () => {
    const { host, toggle } = await renderToggle();
    host.variant.set('outline');
    host.size.set('sm');
    await waitForUpdate();
    expect(toggle().classList).toContain('border-border');
    expect(toggle().classList).toContain('h-9');

    host.size.set('lg');
    await waitForUpdate();
    expect(toggle().classList).toContain('h-11');
  });

  it('scales down while pressed, and back on release or cancel', async () => {
    const { toggle } = await renderToggle();
    expectPressFeedback(toggle());
  });

  it("doesn't react to presses while it's disabled", async () => {
    const { host, toggle } = await renderToggle();
    host.disabled.set(true);
    await waitForUpdate();
    expectNoPressFeedback(toggle());
  });
});

describe('UiToggleGroup', () => {
  const renderGroup = async () => {
    const result = await render(ToggleGroupHost);
    return {
      ...result,
      host: result.componentRef.instance as ToggleGroupHost,
      group: () => result.container.querySelector('.gap-1')!,
      item: (label: string) => viewOf(result.getByText(label)),
    };
  };

  /**
   * Taps an item, then lets the selection reach its highlight.
   */
  const tap = async (item: Element) => {
    fireEvent.tap(item);
    await waitForUpdate();
  };

  it('lays its items out in a row, with the given class', async () => {
    const { group } = await renderGroup();
    expect(group().classList).toContain('flex-row');
    expect(group().classList).toContain('w-full');
  });

  // Angular gives a component's host every static attribute written on it,
  // so a group or item that also styled a view inside its host applied the
  // class twice (issue #181).
  it('puts a class written on the group or an item on that one element', async () => {
    const { container, group, item } = await renderGroup();
    expect([...container.querySelectorAll('.w-full')]).toEqual([group()]);
    expect([...container.querySelectorAll('.flex-1')]).toEqual([item('Left')]);
  });

  it('selects one item at a time, and deselects it on a second tap', async () => {
    const { host, item } = await renderGroup();
    await tap(item('Left'));
    expect(host.align()).toEqual(['left']);
    expect(item('Left').classList).toContain('bg-accent');

    await tap(item('Center'));
    expect(host.align()).toEqual(['center']);
    expect(item('Left').classList).toContain('bg-transparent');
    expect(item('Center').classList).toContain('bg-accent');

    // Unlike a radio group, a single toggle group can have nothing selected.
    await tap(item('Center'));
    expect(host.align()).toEqual([]);
    expect(item('Center').classList).toContain('bg-transparent');
  });

  it('toggles each item on its own when it allows multiple', async () => {
    const { host, item } = await renderGroup();
    host.type.set('multiple');
    await waitForUpdate();

    await tap(item('Left'));
    await tap(item('Right'));
    expect(host.align()).toEqual(['left', 'right']);

    await tap(item('Left'));
    expect(host.align()).toEqual(['right']);
    expect(item('Left').classList).toContain('bg-transparent');
    expect(item('Right').classList).toContain('bg-accent');
  });

  it('highlights the items the app selects', async () => {
    const { host, item } = await renderGroup();
    host.align.set(['right']);
    await waitForUpdate();
    expect(item('Right').classList).toContain('bg-accent');
    expect(item('Left').classList).toContain('bg-transparent');
  });

  it('dims every item and ignores taps while disabled', async () => {
    const { host, item } = await renderGroup();
    host.disabled.set(true);
    await waitForUpdate();
    for (const label of ['Left', 'Center', 'Right']) {
      expect(item(label).classList).toContain('opacity-50');
      await tap(item(label));
    }
    expect(host.align()).toEqual([]);
  });

  it("ignores toggle() from code while it's disabled", async () => {
    const { host } = await renderGroup();
    host.disabled.set(true);
    await waitForUpdate();
    host.group().toggle('left');
    expect(host.align()).toEqual([]);
  });

  it("styles every item with the group's variant and size, and its own class", async () => {
    const { host, item } = await renderGroup();
    expect(item('Left').classList).toContain('h-10');
    expect(item('Left').classList).toContain('flex-1');
    expect(item('Left').classList).not.toContain('opacity-50');

    host.variant.set('outline');
    host.size.set('sm');
    await waitForUpdate();
    for (const label of ['Left', 'Center', 'Right']) {
      expect(item(label).classList).toContain('border-border');
      expect(item(label).classList).toContain('h-9');
    }
  });

  it('scales an item down while pressed, and back on release or cancel', async () => {
    const { item } = await renderGroup();
    expectPressFeedback(item('Center'));
  });

  it("doesn't react to presses while the group is disabled", async () => {
    const { host, item } = await renderGroup();
    host.disabled.set(true);
    await waitForUpdate();
    expectNoPressFeedback(item('Center'));
  });
});

@Component({
  imports: [UiToggleGroup, UiToggleGroupItem, UiIcon, LYNX_ELEMENTS],
  template: `
    <ui-toggle-group
      [variant]="variant()"
      [type]="type()"
      [value]="range()"
      (valueChange)="range.set($event)"
      [disabled]="disabled()"
    >
      @for (option of options(); track option) {
        <ui-toggle-group-item
          [value]="option"
          [accessibility-label]="option"
          [class]="option === 'Month' ? 'flex-[2]' : ''"
          ><text class="text-foreground">{{
            option
          }}</text></ui-toggle-group-item
        >
      }
      <ui-toggle-group-item value="Star"
        ><ui-icon name="star"
      /></ui-toggle-group-item>
    </ui-toggle-group>
  `,
})
class SegmentedGroupHost {
  readonly variant = signal<ToggleGroupVariant>('segmented');
  readonly type = signal<'single' | 'multiple'>('single');
  readonly range = signal<string[]>(['Week']);
  readonly options = signal(['Day', 'Week', 'Month']);
  readonly disabled = signal(false);
}

@Component({
  imports: [UiToggleGroup, UiToggleGroupItem, LYNX_ELEMENTS],
  template: `
    <ui-toggle-group variant="segmented">
      <ui-toggle-group-item value="bold" accessibility-label="Bold"
        ><text>B</text></ui-toggle-group-item
      >
    </ui-toggle-group>
  `,
})
class StaticLabelHost {}

/**
 * A group inside something that colors its icons, such as glass.
 */
@Component({
  imports: [UiToggleGroup, UiToggleGroupItem, UiIcon, LYNX_ELEMENTS],
  providers: [
    { provide: UI_ICON_COLOR, useValue: signal('var(--primary)').asReadonly() },
  ],
  template: `
    <ui-toggle-group [variant]="variant()">
      <ui-toggle-group-item value="star"
        ><ui-icon name="star"
      /></ui-toggle-group-item>
    </ui-toggle-group>
  `,
})
class TintedGroupHost {
  readonly variant = signal<ToggleGroupVariant>('default');
}

/** Accessibility settings a test can change, as the host app would. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

const IOS_26 = { platform: 'iOS', osVersion: '26.0' };
const ANDROID = { platform: 'Android', osVersion: '15' };

describe('UiToggleGroup, segmented', () => {
  // The indicator's and the icon's selectors aren't Lynx elements, so the
  // renderer falls back to a <view> for them and warns.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    settings.reduceMotion.set(false);
  });

  const renderSegmented = async (
    platform: { platform: string; osVersion: string } = IOS_26,
  ) => {
    vi.stubGlobal('SystemInfo', platform);
    const result = await render(SegmentedGroupHost, {
      providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
    });
    const track = () => viewOf(result.getByText('Day')).parentElement!;
    /**
     * An item, the track's flex item: around its label, or the last, around
     * the star icon.
     */
    const item = (label: string) =>
      label === 'Star'
        ? (track().lastElementChild as HTMLElement)
        : viewOf(result.getByText(label));
    /**
     * The indicator's frame, which moves between the items.
     */
    const frame = () =>
      track().querySelector<HTMLElement>('.h-full .bottom-0.top-0');
    const measure = async () => {
      for (const label of ['Day', 'Week', 'Month', 'Star']) {
        fireEvent.layoutchange(item(label), {
          detail: { width: label === 'Month' ? 160 : 80 },
        });
      }
      await waitForUpdate();
    };
    return {
      ...result,
      host: result.componentRef.instance as SegmentedGroupHost,
      item,
      track,
      frame,
      measure,
      tap: async (label: string) => {
        fireEvent.tap(item(label));
        await waitForUpdate();
      },
    };
  };

  it("draws the platform's segmented control, its items sharing the track", async () => {
    const { track, item, frame } = await renderSegmented();
    expect(track().classList).toContain('rounded-full');
    expect(track().classList).toContain('bg-muted');
    expect(item('Day').classList).toContain('flex-1');
    // An item's own class sizes it in the track.
    expect(item('Month').classList).toContain('flex-[2]');
    expect(item('Month').classList).not.toContain('flex-1');
    expect(item('Day').classList).toContain('justify-center');
    expect(frame()).not.toBeNull();
  });

  it('keeps one item selected: tapping it again leaves it selected', async () => {
    const { host, tap } = await renderSegmented();
    await tap('Day');
    expect(host.range()).toEqual(['Day']);
    await tap('Day');
    expect(host.range()).toEqual(['Day']);
  });

  // The accessibility label names one element, the item (issue #181).
  it('names one element with an accessibility label written on an item', async () => {
    const { getAllByAccessibilityLabel } = await render(StaticLabelHost);
    expect(getAllByAccessibilityLabel('Bold')).toHaveLength(1);
  });

  it('marks the selected item selected for screen readers', async () => {
    const { getByRole, tap } = await renderSegmented();
    expect(getByRole('button', { name: 'Week', selected: true })).toBeTruthy();
    expect(getByRole('button', { name: 'Day', selected: false })).toBeTruthy();
    await tap('Day');
    expect(getByRole('button', { name: 'Day', selected: true })).toBeTruthy();
  });

  it('moves the indicator to the item it was dragged to', async () => {
    const { host, item, frame, measure } = await renderSegmented();
    await measure();
    expect(frame()!.style.left).toBe('80px');

    fireEvent.touchstart(item('Week'), { touches: [{ pageX: 120 }] });
    fireEvent.touchmove(item('Week'), { touches: [{ pageX: 220 }] });
    fireEvent.touchend(item('Week'));
    // Lynx may send a tap as the finger lifts: the drag chose already.
    fireEvent.tap(item('Week'));
    await waitForUpdate();
    expect(host.range()).toEqual(['Month']);
    expect(frame()!.style.left).toBe('160px');
    expect(frame()!.style.width).toBe('160px');
  });

  it('lets go of a drag the touch is taken from, or the mouse leaves', async () => {
    const { host, item, track, frame, measure } = await renderSegmented();
    await measure();

    fireEvent.touchstart(item('Week'), { touches: [{ pageX: 120 }] });
    fireEvent.touchmove(item('Week'), { touches: [{ pageX: 220 }] });
    fireEvent.touchcancel(item('Week'));
    await waitForUpdate();
    expect(frame()!.style.left).toBe('80px');

    fireEvent.mousedown(item('Week'), { pageX: 120 });
    fireEvent.mousemove(item('Week'), { pageX: 220 });
    fireLynxEvent(item('Week'), 'mouseleave');
    await waitForUpdate();
    expect(frame()!.style.left).toBe('180px');
    fireLynxEvent(track(), 'mouseleave');
    await waitForUpdate();
    expect(frame()!.style.left).toBe('80px');

    fireEvent.mousedown(item('Week'), { pageX: 120 });
    fireEvent.mousemove(item('Day'), { pageX: 20 });
    fireEvent.mouseup(item('Day'));
    await waitForUpdate();
    expect(host.range()).toEqual(['Day']);
  });

  it("ignores touches while it's disabled", async () => {
    const { host, item, frame, measure } = await renderSegmented();
    await measure();
    host.disabled.set(true);
    await waitForUpdate();
    fireEvent.touchstart(item('Week'), { touches: [{ pageX: 120 }] });
    fireEvent.touchmove(item('Week'), { touches: [{ pageX: 220 }] });
    fireEvent.touchend(item('Week'));
    fireEvent.tap(item('Day'));
    await waitForUpdate();
    expect(host.range()).toEqual(['Week']);
    expect(frame()!.style.left).toBe('80px');
  });

  it('gives each pressed item its own thumb in a multiple selection', async () => {
    const { host, item, frame, tap } = await renderSegmented();
    host.type.set('multiple');
    await waitForUpdate();
    expect(frame()).toBeNull();
    expect(item('Week').classList).toContain('bg-background');

    await tap('Day');
    expect(host.range()).toEqual(['Week', 'Day']);
    expect(item('Day').classList).toContain('bg-background');
    await tap('Day');
    expect(host.range()).toEqual(['Week']);
  });

  it("is Material's connected button group on Android, its icons in the fill's content color", async () => {
    const { host, item, getByText, container, tap } =
      await renderSegmented(ANDROID);
    expect(item('Week').classList).toContain('bg-primary');
    expect(item('Week').style.transition).toContain('background-color');
    expect(item('Day').classList).toContain('bg-secondary');
    const star = () =>
      container.querySelector('svg')!.getAttribute('content') ?? '';
    expect(star()).toContain(ICON_LIGHT_COLORS['secondary-foreground']);

    await tap('Star');
    expect(host.range()).toEqual(['Star']);
    expect(star()).toContain(ICON_LIGHT_COLORS['primary-foreground']);

    // A press shows Material's state layer.
    fireEvent.touchstart(item('Day'), { touches: [{ pageX: 20 }] });
    await waitForUpdate();
    expect(item('Day').querySelector('.opacity-10')).not.toBeNull();
    fireEvent.touchend(item('Day'));
    await waitForUpdate();
    expect(item('Day').querySelector('.opacity-10')).toBeNull();
    expect(getByText('Day')).toBeTruthy();
  });

  it("rounds the group's ends on Android, as items come and go", async () => {
    const { host, item } = await renderSegmented(ANDROID);
    expect(item('Day').classList).toContain('rounded-l-[20px]');
    expect(item('Month').classList).toContain('rounded-[8px]');
    expect(item('Star').classList).toContain('rounded-r-[20px]');

    // The items before a new one are redrawn before it has a value, so each
    // finds its place from the items rather than their values.
    host.options.set(['Day', 'Week', 'Month', 'Year']);
    await waitForUpdate();
    expect(item('Year').classList).toContain('rounded-[8px]');
    expect(item('Star').classList).toContain('rounded-r-[20px]');

    host.options.set(['Month']);
    await waitForUpdate();
    expect(item('Month').classList).toContain('rounded-l-[20px]');
  });

  it('leaves an icon the color around the group in the other variants', async () => {
    vi.stubGlobal('SystemInfo', IOS_26);
    const tinted = await render(TintedGroupHost);
    const star = () =>
      tinted.container.querySelector('svg')!.getAttribute('content') ?? '';
    expect(star()).toContain(ICON_LIGHT_COLORS['primary']);

    // A segmented control on iOS leaves it alone too.
    (tinted.componentRef.instance as TintedGroupHost).variant.set('segmented');
    await waitForUpdate();
    expect(star()).toContain(ICON_LIGHT_COLORS['primary']);
    tinted.unmount();

    // With nothing around it, an icon takes its own default.
    const plain = await renderSegmented();
    expect(
      plain.container.querySelector('svg')!.getAttribute('content'),
    ).toContain(ICON_LIGHT_COLORS['foreground']);
  });

  it('goes back to the toggle look when the variant changes', async () => {
    const { host, item, frame } = await renderSegmented();
    host.variant.set('outline');
    await waitForUpdate();
    expect(frame()).toBeNull();
    expect(item('Week').classList).toContain('border-border');
    expect(item('Week').classList).toContain('bg-accent');
  });
});
