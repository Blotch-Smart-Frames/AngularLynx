import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import {
  type ButtonGroupOrientation,
  type ButtonGroupSize,
  type ButtonGroupVariant,
  UiButtonGroup,
  UiButtonGroupItem,
  buttonGroupItemVariants,
} from './button-group';

@Component({
  imports: [UiButtonGroup, UiButtonGroupItem],
  template: `
    <ui-button-group
      [orientation]="orientation()"
      [variant]="variant()"
      [size]="size()"
      [disabled]="groupDisabled()"
      class="w-full"
    >
      <ui-button-group-item class="flex-1" (pressed)="presses.push('Copy')"
        >Copy</ui-button-group-item
      >
      <ui-button-group-item
        [disabled]="pasteDisabled()"
        (pressed)="presses.push('Paste')"
        >Paste</ui-button-group-item
      >
    </ui-button-group>
  `,
})
class ButtonGroupHost {
  readonly orientation = signal<ButtonGroupOrientation>('horizontal');
  readonly variant = signal<ButtonGroupVariant>('default');
  readonly size = signal<ButtonGroupSize>('default');
  readonly groupDisabled = signal(false);
  readonly pasteDisabled = signal(false);
  readonly presses: string[] = [];
}

const renderGroup = async () => {
  const result = await render(ButtonGroupHost);
  return {
    ...result,
    host: result.componentRef.instance as ButtonGroupHost,
    // The group's own background shows through the seams between items.
    group: () => result.container.querySelector('.bg-border')!,
    // An item's view (the one that takes presses) holds its label.
    item: (label: string) => result.getByText(label).parentElement!,
  };
};

/**
 * The scale an item's inline style holds, if any.
 */
const scaleOf = (view: Element) =>
  (view as HTMLElement).style.getPropertyValue('transform');

describe('UiButtonGroup', () => {
  it('lays its items out in a row, or in a column when vertical', async () => {
    const { host, group } = await renderGroup();
    expect(group().classList).toContain('flex-row');
    expect(group().classList).toContain('w-full');

    host.orientation.set('vertical');
    await waitForUpdate();
    expect(group().classList).toContain('flex-col');
    expect(group().classList).not.toContain('flex-row');
  });

  it("styles every item and label with the group's variant and size", async () => {
    const { host, item, getByText } = await renderGroup();
    expect(item('Copy').classList).toContain('bg-secondary');
    expect(item('Copy').classList).toContain('h-10');
    expect(item('Copy').classList).toContain('flex-1');
    expect(getByText('Copy').classList).toContain('text-secondary-foreground');
    expect(getByText('Copy').classList).toContain('text-sm');

    host.variant.set('outline');
    host.size.set('sm');
    await waitForUpdate();
    for (const label of ['Copy', 'Paste']) {
      expect(item(label).classList).toContain('bg-background');
      expect(item(label).classList).toContain('h-9');
      expect(getByText(label).classList).toContain('text-foreground');
      expect(getByText(label).classList).toContain('text-xs');
    }

    host.size.set('lg');
    await waitForUpdate();
    expect(item('Paste').classList).toContain('h-11');
    expect(getByText('Paste').classList).toContain('text-base');
  });
});

describe('UiButtonGroupItem', () => {
  it('emits `pressed` when tapped', async () => {
    const { host, item } = await renderGroup();
    fireEvent.tap(item('Copy'));
    fireEvent.tap(item('Paste'));
    expect(host.presses).toEqual(['Copy', 'Paste']);
    expect(item('Copy').classList).not.toContain('opacity-50');
  });

  it('dims and ignores taps when disabled itself, leaving the others working', async () => {
    const { host, item } = await renderGroup();
    host.pasteDisabled.set(true);
    await waitForUpdate();
    expect(item('Paste').classList).toContain('opacity-50');
    expect(item('Copy').classList).not.toContain('opacity-50');

    fireEvent.tap(item('Paste'));
    fireEvent.tap(item('Copy'));
    expect(host.presses).toEqual(['Copy']);
  });

  it('dims and ignores taps on every item when the group is disabled', async () => {
    const { host, item } = await renderGroup();
    host.groupDisabled.set(true);
    await waitForUpdate();
    for (const label of ['Copy', 'Paste']) {
      expect(item(label).classList).toContain('opacity-50');
      fireEvent.tap(item(label));
    }
    expect(host.presses).toEqual([]);
  });

  it('scales down while pressed by touch, and back on release', async () => {
    const { item } = await renderGroup();
    fireEvent.touchstart(item('Copy'));
    expect(scaleOf(item('Copy'))).toBe('scale(0.97)');
    fireEvent.touchend(item('Copy'));
    expect(scaleOf(item('Copy'))).toBe('scale(1)');

    // A scroll that takes the touch over cancels it: the item scales back
    // rather than staying pressed.
    fireEvent.touchstart(item('Copy'));
    fireEvent.touchcancel(item('Copy'));
    expect(scaleOf(item('Copy'))).toBe('scale(1)');
  });

  it('scales down while pressed by mouse, and back on release or leave', async () => {
    // Lynx on the web fires mouse events for a cursor, never touch ones.
    const { item } = await renderGroup();
    fireEvent.mousedown(item('Copy'));
    expect(scaleOf(item('Copy'))).toBe('scale(0.97)');
    fireEvent.mouseup(item('Copy'));
    expect(scaleOf(item('Copy'))).toBe('scale(1)');

    fireEvent.mousedown(item('Copy'));
    fireLynxEvent(item('Copy'), 'mouseleave');
    expect(scaleOf(item('Copy'))).toBe('scale(1)');
  });

  it("doesn't react to presses while it or its group is disabled", async () => {
    const { host, item } = await renderGroup();
    host.pasteDisabled.set(true);
    host.groupDisabled.set(true);
    await waitForUpdate();
    for (const label of ['Copy', 'Paste']) {
      fireEvent.touchstart(item(label));
      fireEvent.mousedown(item(label));
      expect(scaleOf(item(label))).toBe('');
      fireEvent.touchend(item(label));
      fireEvent.mouseup(item(label));
      expect(scaleOf(item(label))).toBe('');
    }
  });
});

describe('buttonGroupItemVariants', () => {
  it('returns default variant and size classes', () => {
    const result = buttonGroupItemVariants();
    expect(result).toContain('bg-secondary');
    expect(result).toContain('h-10');
    expect(result).toContain('px-4');
  });

  it('returns outline variant classes', () => {
    const result = buttonGroupItemVariants({ variant: 'outline' });
    expect(result).toContain('bg-background');
  });

  it('returns small size classes', () => {
    const result = buttonGroupItemVariants({ size: 'sm' });
    expect(result).toContain('h-9');
    expect(result).toContain('px-3');
  });

  it('returns large size classes', () => {
    const result = buttonGroupItemVariants({ size: 'lg' });
    expect(result).toContain('h-11');
    expect(result).toContain('px-6');
  });

  it('always includes base layout classes', () => {
    const result = buttonGroupItemVariants({ variant: 'outline', size: 'lg' });
    expect(result).toContain('flex');
    expect(result).toContain('items-center');
    expect(result).toContain('justify-center');
  });
});
