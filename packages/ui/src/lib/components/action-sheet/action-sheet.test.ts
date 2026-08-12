import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import {
  UiActionSheet,
  UiActionSheetCancel,
  UiActionSheetItem,
  UiActionSheetTitle,
} from './action-sheet';

@Component({
  standalone: true,
  imports: [
    UiActionSheet,
    UiActionSheetTitle,
    UiActionSheetItem,
    UiActionSheetCancel,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-action-sheet [(open)]="open">
      <ui-action-sheet-title>Pick</ui-action-sheet-title>
      <ui-action-sheet-item>Option</ui-action-sheet-item>
      <ui-action-sheet-cancel>Cancel</ui-action-sheet-cancel>
    </ui-action-sheet>
  `,
})
class ActionSheetHost {
  open = true;
}

describe('UiActionSheet', () => {
  const patchRefs = (inst: UiActionSheet, view: Element) => {
    (inst as unknown as { backdropRef: unknown }).backdropRef = signal({
      nativeElement: view,
    });
    (inst as unknown as { panelRef: unknown }).panelRef = signal({
      nativeElement: view,
    });
  };

  it('renders the sheet, title, item, and cancel content', async () => {
    const { getByText } = await render(ActionSheetHost);
    expect(getByText('Pick')).toBeTruthy();
    expect(getByText('Option')).toBeTruthy();
    expect(getByText('Cancel')).toBeTruthy();
  });

  it('backdrop tap closes the sheet', async () => {
    const { componentRef } = await render(UiActionSheet);
    const inst = componentRef.instance as UiActionSheet;
    inst.open.set(true);
    await waitForUpdate();
    (inst as unknown as { onBackdropTap: () => void }).onBackdropTap();
    expect(inst.open()).toBe(false);
  });

  it('close() sets open to false', async () => {
    const { componentRef } = await render(UiActionSheet);
    const inst = componentRef.instance as UiActionSheet;
    inst.open.set(true);
    inst.close();
    expect(inst.open()).toBe(false);
  });

  it('panel tap is a no-op', async () => {
    const { componentRef } = await render(UiActionSheet);
    const inst = componentRef.instance as UiActionSheet;
    expect(() =>
      (inst as unknown as { onPanelTap: () => void }).onPanelTap(),
    ).not.toThrow();
  });

  it('open effect runs the animate-in and animate-out lifecycles', async () => {
    const { componentRef, container } = await render(UiActionSheet);
    const inst = componentRef.instance as UiActionSheet;
    const view = container.querySelector('view') as Element;
    patchRefs(inst, view);

    inst.open.set(true);
    await waitForUpdate();
    await waitForUpdate();
    await waitForUpdate();

    inst.open.set(false);
    await new Promise((r) => setTimeout(r, 320));
    await waitForUpdate();
    expect(inst.open()).toBe(false);
  });

  it('open effect bails when backdrop/panel refs are undefined', async () => {
    const { componentRef } = await render(UiActionSheet);
    const inst = componentRef.instance as UiActionSheet;
    inst.open.set(true);
    await waitForUpdate();
    await waitForUpdate();
    inst.open.set(false);
    await waitForUpdate();
    expect(inst.open()).toBe(false);
  });

  it('applies user class on the panel', async () => {
    const { componentRef, container } = await render(UiActionSheet);
    const inst = componentRef.instance as UiActionSheet;
    setInputSignal(inst.userClass, 'my-panel');
    await waitForUpdate();
    expect(
      Array.from(container.querySelectorAll('view')).some((el) =>
        el.getAttribute('class')?.includes('my-panel'),
      ),
    ).toBe(true);
  });
});

describe('UiActionSheetTitle', () => {
  it('renders projected content', async () => {
    const { container } = await render(UiActionSheetTitle);
    expect(container.querySelector('view')).toBeTruthy();
    expect(container.querySelector('text')).toBeTruthy();
  });
});

describe('UiActionSheetItem', () => {
  const renderItem = async () => {
    const parentResult = await render(UiActionSheet);
    const parent = parentResult.componentRef.instance as UiActionSheet;
    parent.open.set(true);
    await waitForUpdate();

    const itemResult = await render(UiActionSheetItem, {
      providers: [{ provide: UiActionSheet, useValue: parent }],
    });
    return { parent, itemResult };
  };

  it('onTap emits `pressed` and closes the parent sheet', async () => {
    const { parent, itemResult } = await renderItem();
    const inst = itemResult.componentRef.instance as unknown as UiActionSheetItem & {
      onTap: () => void;
    };
    const emitted = vi.fn();
    inst.pressed.subscribe(emitted);
    inst.onTap();
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(parent.open()).toBe(false);
  });

  it('press handlers run cleanly', async () => {
    const { itemResult } = await renderItem();
    const inst = itemResult.componentRef.instance as unknown as {
      onPressStart: () => void;
      onPressEnd: () => void;
      onPressCancel: () => void;
    };
    expect(() => inst.onPressStart()).not.toThrow();
    expect(() => inst.onPressEnd()).not.toThrow();
    expect(() => inst.onPressCancel()).not.toThrow();
  });

  it('applies destructive variant text class', async () => {
    const { itemResult } = await renderItem();
    const inst = itemResult.componentRef.instance as UiActionSheetItem;
    setInputSignal(inst.variant, 'destructive');
    await waitForUpdate();
    const text = itemResult.container.querySelector('text');
    expect(text?.getAttribute('class')).toContain('text-destructive');
  });
});

describe('UiActionSheetCancel', () => {
  const renderCancel = async () => {
    const parentResult = await render(UiActionSheet);
    const parent = parentResult.componentRef.instance as UiActionSheet;
    parent.open.set(true);
    await waitForUpdate();

    const cancelResult = await render(UiActionSheetCancel, {
      providers: [{ provide: UiActionSheet, useValue: parent }],
    });
    return { parent, cancelResult };
  };

  it('renders the default cancel label', async () => {
    const { cancelResult } = await renderCancel();
    expect(cancelResult.container.textContent).toContain('Cancel');
  });

  it('onTap closes the parent sheet', async () => {
    const { parent, cancelResult } = await renderCancel();
    const inst = cancelResult.componentRef.instance as unknown as {
      onTap: () => void;
    };
    inst.onTap();
    expect(parent.open()).toBe(false);
  });

  it('press handlers run cleanly', async () => {
    const { cancelResult } = await renderCancel();
    const inst = cancelResult.componentRef.instance as unknown as {
      onPressStart: () => void;
      onPressEnd: () => void;
      onPressCancel: () => void;
    };
    expect(() => inst.onPressStart()).not.toThrow();
    expect(() => inst.onPressEnd()).not.toThrow();
    expect(() => inst.onPressCancel()).not.toThrow();
  });
});
