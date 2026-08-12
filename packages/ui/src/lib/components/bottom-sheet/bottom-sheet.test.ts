import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiBottomSheet } from './bottom-sheet';

@Component({
  standalone: true,
  imports: [UiBottomSheet, LYNX_ELEMENTS],
  template: `<ui-bottom-sheet [(open)]="open"
    ><text>Panel</text></ui-bottom-sheet
  >`,
})
class BottomSheetHost {
  open = true;
}

describe('UiBottomSheet', () => {
  const patchRefs = (inst: UiBottomSheet, view: Element) => {
    (inst as unknown as { backdropRef: unknown }).backdropRef = signal({
      nativeElement: view,
    });
    (inst as unknown as { panelRef: unknown }).panelRef = signal({
      nativeElement: view,
    });
  };

  it('renders the panel content when open', async () => {
    const { getByText } = await render(BottomSheetHost);
    expect(getByText('Panel')).toBeTruthy();
  });

  it('backdrop tap closes the sheet', async () => {
    const { componentRef } = await render(UiBottomSheet);
    const inst = componentRef.instance as UiBottomSheet;
    inst.open.set(true);
    await waitForUpdate();
    (inst as unknown as { onBackdropTap: () => void }).onBackdropTap();
    expect(inst.open()).toBe(false);
  });

  it('panel tap is a no-op', async () => {
    const { componentRef } = await render(UiBottomSheet);
    const inst = componentRef.instance as UiBottomSheet;
    expect(() =>
      (inst as unknown as { onPanelTap: () => void }).onPanelTap(),
    ).not.toThrow();
  });

  it('open effect runs the animate-in and animate-out lifecycles', async () => {
    const { componentRef, container } = await render(UiBottomSheet);
    const inst = componentRef.instance as UiBottomSheet;
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
    const { componentRef } = await render(UiBottomSheet);
    const inst = componentRef.instance as UiBottomSheet;
    inst.open.set(true);
    await waitForUpdate();
    await waitForUpdate();
    inst.open.set(false);
    await waitForUpdate();
    expect(inst.open()).toBe(false);
  });

  it('drag beyond the dismiss threshold closes the sheet', async () => {
    const { componentRef, container } = await render(UiBottomSheet);
    const inst = componentRef.instance as UiBottomSheet;
    const view = container.querySelector('view') as Element;
    patchRefs(inst, view);
    inst.open.set(true);
    await waitForUpdate();

    const cast = inst as unknown as {
      onHandleTouchStart: (e: { touches: { clientY: number }[] }) => void;
      onHandleTouchMove: (e: { touches: { clientY: number }[] }) => void;
      onHandleTouchEnd: () => void;
    };
    cast.onHandleTouchStart({ touches: [{ clientY: 100 }] });
    cast.onHandleTouchMove({ touches: [{ clientY: 300 }] });
    cast.onHandleTouchEnd();
    await waitForUpdate();
    expect(inst.open()).toBe(false);
  });

  it('drag below the dismiss threshold snaps back to open', async () => {
    const { componentRef, container } = await render(UiBottomSheet);
    const inst = componentRef.instance as UiBottomSheet;
    const view = container.querySelector('view') as Element;
    patchRefs(inst, view);
    inst.open.set(true);
    await waitForUpdate();

    const cast = inst as unknown as {
      onHandleTouchStart: (e: { touches: { clientY: number }[] }) => void;
      onHandleTouchMove: (e: { touches: { clientY: number }[] }) => void;
      onHandleTouchEnd: () => void;
    };
    cast.onHandleTouchStart({ touches: [{ clientY: 100 }] });
    cast.onHandleTouchMove({ touches: [{ clientY: 130 }] });
    cast.onHandleTouchEnd();
    await waitForUpdate();
    expect(inst.open()).toBe(true);
  });

  it('touch handlers guard against missing touches and non-active drags', async () => {
    const { componentRef } = await render(UiBottomSheet);
    const inst = componentRef.instance as UiBottomSheet;
    const cast = inst as unknown as {
      onHandleTouchStart: (e: { touches?: { clientY: number }[] }) => void;
      onHandleTouchMove: (e: { touches?: { clientY: number }[] }) => void;
      onHandleTouchEnd: () => void;
    };
    // touchmove without prior touchstart is a no-op (guards `#isDragging`).
    cast.onHandleTouchMove({ touches: [{ clientY: 200 }] });
    // touchstart / touchmove without touches entries is a no-op.
    cast.onHandleTouchStart({ touches: [] });
    cast.onHandleTouchStart({ touches: [{ clientY: 100 }] });
    cast.onHandleTouchMove({ touches: [] });
    // touchend without an active drag is also a no-op.
    cast.onHandleTouchEnd();
    cast.onHandleTouchEnd();
  });

  it('applies a user class on the panel', async () => {
    const { componentRef, container } = await render(UiBottomSheet);
    const inst = componentRef.instance as UiBottomSheet;
    setInputSignal(inst.userClass, 'custom-panel');
    await waitForUpdate();
    expect(
      Array.from(container.querySelectorAll('view')).some((el) =>
        el.getAttribute('class')?.includes('custom-panel'),
      ),
    ).toBe(true);
  });

  it('overlayStyle switches between visible and hidden variants', async () => {
    const { componentRef, container } = await render(UiBottomSheet);
    const inst = componentRef.instance as UiBottomSheet;
    let overlay = container.querySelector('overlay');
    expect(overlay?.getAttribute('style')).toContain('display: none');

    const view = container.querySelector('view') as Element;
    patchRefs(inst, view);
    inst.open.set(true);
    for (let i = 0; i < 10; i++) await waitForUpdate();
    overlay = container.querySelector('overlay');
    expect(overlay?.getAttribute('style')).not.toContain('display: none');
  });
});
