import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiToggle, UiToggleGroup, UiToggleGroupItem } from './toggle';

@Component({
  standalone: true,
  imports: [UiToggle, LYNX_ELEMENTS],
  template: `<ui-toggle><text>Bold</text></ui-toggle>`,
})
class ToggleHost {}

describe('UiToggle', () => {
  it('renders projected content', async () => {
    const { getByText } = await render(ToggleHost);
    expect(getByText('Bold')).toBeTruthy();
  });

  it('onTap flips the pressed model', async () => {
    const { componentRef } = await render(UiToggle);
    const inst = componentRef.instance as unknown as UiToggle & {
      onTap: () => void;
    };
    inst.onTap();
    expect(inst.pressed()).toBe(true);
    inst.onTap();
    expect(inst.pressed()).toBe(false);
  });

  it('onTap is a no-op when disabled', async () => {
    const { componentRef } = await render(UiToggle);
    const inst = componentRef.instance as unknown as UiToggle & {
      onTap: () => void;
    };
    setInputSignal(inst.disabled, true);
    await waitForUpdate();
    inst.onTap();
    expect(inst.pressed()).toBe(false);
  });

  it('press handlers run cleanly (enabled + disabled)', async () => {
    const { componentRef } = await render(UiToggle);
    const inst = componentRef.instance as unknown as UiToggle & {
      onPressStart: () => void;
      onPressEnd: () => void;
      onPressCancel: () => void;
    };
    expect(() => inst.onPressStart()).not.toThrow();
    expect(() => inst.onPressEnd()).not.toThrow();
    expect(() => inst.onPressCancel()).not.toThrow();
    setInputSignal((inst as unknown as UiToggle).disabled, true);
    await waitForUpdate();
    expect(() => inst.onPressStart()).not.toThrow();
    expect(() => inst.onPressEnd()).not.toThrow();
    expect(() => inst.onPressCancel()).not.toThrow();
  });

  it('applies the accent background when pressed', async () => {
    const { componentRef, container } = await render(UiToggle);
    const inst = componentRef.instance as UiToggle;
    inst.pressed.set(true);
    await waitForUpdate();
    const view = container.querySelector('view');
    expect(view?.getAttribute('class')).toContain('bg-accent');
  });

  it('applies outline variant and small size classes', async () => {
    const { componentRef, container } = await render(UiToggle);
    const inst = componentRef.instance as UiToggle;
    setInputSignal(inst.variant, 'outline');
    setInputSignal(inst.size, 'sm');
    await waitForUpdate();
    const view = container.querySelector('view');
    expect(view?.getAttribute('class')).toContain('border-border');
    expect(view?.getAttribute('class')).toContain('h-9');
  });

  it('applies large size classes', async () => {
    const { componentRef, container } = await render(UiToggle);
    const inst = componentRef.instance as UiToggle;
    setInputSignal(inst.size, 'lg');
    await waitForUpdate();
    expect(container.querySelector('view')?.getAttribute('class')).toContain('h-11');
  });
});

describe('UiToggleGroup', () => {
  it('single mode replaces selection and allows deselection', async () => {
    const { componentRef } = await render(UiToggleGroup);
    const inst = componentRef.instance as UiToggleGroup;
    inst.toggle('a');
    expect(inst.value()).toEqual(['a']);
    inst.toggle('b');
    expect(inst.value()).toEqual(['b']);
    // Tap active item again to deselect (unique to single-mode).
    inst.toggle('b');
    expect(inst.value()).toEqual([]);
  });

  it('multiple mode toggles individual items', async () => {
    const { componentRef } = await render(UiToggleGroup);
    const inst = componentRef.instance as UiToggleGroup;
    setInputSignal(inst.type, 'multiple');
    await waitForUpdate();
    inst.toggle('a');
    inst.toggle('b');
    expect(inst.value()).toEqual(['a', 'b']);
    inst.toggle('a');
    expect(inst.value()).toEqual(['b']);
  });

  it('toggle() is a no-op when the group is disabled', async () => {
    const { componentRef } = await render(UiToggleGroup);
    const inst = componentRef.instance as UiToggleGroup;
    setInputSignal(inst.disabled, true);
    await waitForUpdate();
    inst.toggle('a');
    expect(inst.value()).toEqual([]);
  });

  it('isSelected reflects the current value list', async () => {
    const { componentRef } = await render(UiToggleGroup);
    const inst = componentRef.instance as UiToggleGroup;
    inst.toggle('a');
    expect(inst.isSelected('a')).toBe(true);
    expect(inst.isSelected('b')).toBe(false);
  });
});

describe('UiToggleGroupItem', () => {
  const renderItem = async (
    parentValue: string[] = [],
    parentDisabled = false,
  ) => {
    const parentResult = await render(UiToggleGroup);
    const parent = parentResult.componentRef.instance as UiToggleGroup;
    if (parentValue.length) parent.value.set(parentValue);
    if (parentDisabled) setInputSignal(parent.disabled, true);
    await waitForUpdate();

    const itemResult = await render(UiToggleGroupItem, {
      providers: [{ provide: UiToggleGroup, useValue: parent }],
    });
    const item = itemResult.componentRef.instance as UiToggleGroupItem;
    setInputSignal(item.itemValue, 'a');
    await waitForUpdate();
    return { parent, item, itemResult };
  };

  it('onTap delegates to the parent group', async () => {
    const { parent, item } = await renderItem();
    (item as unknown as { onTap: () => void }).onTap();
    expect(parent.value()).toEqual(['a']);
  });

  it('highlights when selected', async () => {
    const { itemResult } = await renderItem(['a']);
    const view = itemResult.container.querySelector('view');
    expect(view?.getAttribute('class')).toContain('bg-accent');
  });

  it('press handlers run cleanly (enabled + disabled)', async () => {
    const { item } = await renderItem();
    const cast = item as unknown as {
      onPressStart: () => void;
      onPressEnd: () => void;
      onPressCancel: () => void;
    };
    expect(() => cast.onPressStart()).not.toThrow();
    expect(() => cast.onPressEnd()).not.toThrow();

    const disabled = await renderItem([], true);
    const cast2 = disabled.item as unknown as {
      onPressStart: () => void;
      onPressEnd: () => void;
      onPressCancel: () => void;
    };
    expect(() => cast2.onPressStart()).not.toThrow();
    expect(() => cast2.onPressEnd()).not.toThrow();
    expect(() => cast2.onPressCancel()).not.toThrow();
  });
});
