import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiButtonGroup, UiButtonGroupItem } from './button-group';

@Component({
  standalone: true,
  imports: [UiButtonGroup, UiButtonGroupItem, LYNX_ELEMENTS],
  template: `
    <ui-button-group [orientation]="orientation">
      <ui-button-group-item (pressed)="onPressed()"
        ><text>A</text></ui-button-group-item
      >
      <ui-button-group-item [disabled]="disabled" (pressed)="onPressed()"
        ><text>B</text></ui-button-group-item
      >
    </ui-button-group>
  `,
})
class ButtonGroupHost {
  orientation: 'horizontal' | 'vertical' = 'horizontal';
  disabled = false;
  onPressed = () => {};
}

describe('UiButtonGroup (render)', () => {
  it('renders horizontally by default', async () => {
    const { container } = await render(ButtonGroupHost);
    expect(container).toBeTruthy();
    const flexRow = container.querySelector('.flex-row');
    expect(flexRow).toBeTruthy();
  });

  it('switches to vertical layout when orientation is flipped', async () => {
    const { componentRef, container } = await render(UiButtonGroup);
    setInputSignal(
      (componentRef.instance as UiButtonGroup).orientation,
      'vertical',
    );
    await waitForUpdate();
    expect(container.querySelector('.flex-col')).toBeTruthy();
  });

  it('applies a user class from the alias input', async () => {
    const { componentRef, container } = await render(UiButtonGroup);
    setInputSignal(
      (componentRef.instance as UiButtonGroup).userClass,
      'w-full',
    );
    await waitForUpdate();
    const outer = container.querySelector('view');
    expect(outer?.getAttribute('class')).toContain('w-full');
  });
});

describe('UiButtonGroupItem', () => {
  const renderItem = async (
    variant: 'default' | 'outline' = 'default',
    size: 'default' | 'sm' | 'lg' = 'default',
    disabledGroup = false,
  ) => {
    const parentResult = await render(UiButtonGroup);
    const parent = parentResult.componentRef.instance as UiButtonGroup;
    setInputSignal(parent.variant, variant);
    setInputSignal(parent.size, size);
    setInputSignal(parent.disabled, disabledGroup);
    await waitForUpdate();

    const itemResult = await render(UiButtonGroupItem, {
      providers: [{ provide: UiButtonGroup, useValue: parent }],
    });
    await waitForUpdate();
    return { parent, itemResult };
  };

  it('onTap emits `pressed` when neither the group nor the item is disabled', async () => {
    const { itemResult } = await renderItem();
    const inst = itemResult.componentRef.instance as unknown as UiButtonGroupItem & {
      onTap: () => void;
    };
    const emitted = vi.fn();
    inst.pressed.subscribe(emitted);
    inst.onTap();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('onTap is a no-op when the group is disabled', async () => {
    const { itemResult } = await renderItem('default', 'default', true);
    const inst = itemResult.componentRef.instance as unknown as UiButtonGroupItem & {
      onTap: () => void;
    };
    const emitted = vi.fn();
    inst.pressed.subscribe(emitted);
    inst.onTap();
    expect(emitted).not.toHaveBeenCalled();
  });

  it('onTap is a no-op when the item itself is disabled', async () => {
    const { itemResult } = await renderItem();
    const inst = itemResult.componentRef.instance as unknown as UiButtonGroupItem & {
      onTap: () => void;
    };
    setInputSignal(inst.disabled, true);
    await waitForUpdate();
    const emitted = vi.fn();
    inst.pressed.subscribe(emitted);
    inst.onTap();
    expect(emitted).not.toHaveBeenCalled();
  });

  it('press handlers run cleanly on both enabled and disabled paths', async () => {
    const { itemResult } = await renderItem();
    const inst = itemResult.componentRef.instance as unknown as {
      onPressStart: () => void;
      onPressEnd: () => void;
      onPressCancel: () => void;
      disabled: unknown;
    };
    expect(() => inst.onPressStart()).not.toThrow();
    expect(() => inst.onPressEnd()).not.toThrow();
    expect(() => inst.onPressCancel()).not.toThrow();
    setInputSignal(
      (inst as unknown as UiButtonGroupItem).disabled,
      true,
    );
    await waitForUpdate();
    expect(() => inst.onPressStart()).not.toThrow();
    expect(() => inst.onPressEnd()).not.toThrow();
  });

  it('renders label with `outline` group variant classes', async () => {
    // Covers the `outline` branch of both buttonGroupItemVariants and
    // buttonGroupTextVariants.
    const { itemResult } = await renderItem('outline', 'lg');
    const view = itemResult.container.querySelector('view');
    expect(view?.getAttribute('class')).toContain('bg-background');
  });

  it('renders with size sm variant classes', async () => {
    const { itemResult } = await renderItem('default', 'sm');
    const view = itemResult.container.querySelector('view');
    expect(view?.getAttribute('class')).toContain('h-9');
  });
});
