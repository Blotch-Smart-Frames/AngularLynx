import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import {
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
  readonly variant = signal<ToggleVariant>('default');
  readonly size = signal<ToggleSize>('default');
  readonly disabled = signal(false);
}

/**
 * The view (the one that takes presses) a toggle or toggle group item
 * projects its label into.
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
