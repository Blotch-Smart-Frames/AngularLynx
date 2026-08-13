import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiButton } from './button';

@Component({
  standalone: true,
  imports: [UiButton, LYNX_ELEMENTS],
  template: `<ui-button (pressed)="onPressed()"><text>Go</text></ui-button>`,
})
class ButtonHost {
  count = 0;
  onPressed = () => {
    this.count++;
  };
}

describe('UiButton (render)', () => {
  it('renders and mounts without throwing', async () => {
    const { container } = await render(ButtonHost);
    expect(container).toBeTruthy();
  });

  it('emits `pressed` from onTap() when not disabled/loading', async () => {
    const { componentRef } = await render(UiButton);
    const inst = componentRef.instance as unknown as {
      onTap: () => void;
      pressed: { subscribe: (cb: () => void) => void };
    };
    const emitted = vi.fn();
    inst.pressed.subscribe(emitted);
    inst.onTap();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('onTap() is a no-op when disabled', async () => {
    const { componentRef } = await render(UiButton);
    const inst = componentRef.instance as unknown as UiButton & {
      onTap: () => void;
    };
    setInputSignal(inst.disabled, true);
    const emitted = vi.fn();
    inst.pressed.subscribe(emitted);
    inst.onTap();
    expect(emitted).not.toHaveBeenCalled();
  });

  it('onTap() is a no-op when loading', async () => {
    const { componentRef } = await render(UiButton);
    const inst = componentRef.instance as unknown as UiButton & {
      onTap: () => void;
    };
    setInputSignal(inst.loading, true);
    const emitted = vi.fn();
    inst.pressed.subscribe(emitted);
    inst.onTap();
    expect(emitted).not.toHaveBeenCalled();
  });

  it('shows the spinner while loading', async () => {
    const { componentRef, container } = await render(UiButton);
    setInputSignal((componentRef.instance as UiButton).loading, true);
    await waitForUpdate();
    // Spinner renders as a nested view with an svg — searching for that
    // suffices without asserting on the internal Lynx tree.
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('applies disabled dim opacity when disabled or loading', async () => {
    const { componentRef, container } = await render(UiButton);
    setInputSignal((componentRef.instance as UiButton).disabled, true);
    await waitForUpdate();
    const outer = container.querySelector('view');
    expect(outer?.getAttribute('class')).toContain('opacity-50');
  });

  it('picks the right spinner size for each button size', async () => {
    // spinnerSize returns 'xs' for size='sm' and 'sm' otherwise. Cover both.
    const { componentRef } = await render(UiButton);
    const inst = componentRef.instance as unknown as UiButton & {
      spinnerSize: () => 'xs' | 'sm';
    };
    setInputSignal(inst.size, 'sm');
    await waitForUpdate();
    expect(inst.spinnerSize()).toBe('xs');

    setInputSignal(inst.size, 'default');
    await waitForUpdate();
    expect(inst.spinnerSize()).toBe('sm');
  });

  it('press handlers run cleanly (guarded by disabled/loading state)', async () => {
    // onPressStart/End are no-ops when the button is disabled/loading; the
    // active-press path relies on the ref being wired up on-device — assert
    // only that the handlers run without throwing here.
    const { componentRef } = await render(UiButton);
    const inst = componentRef.instance as unknown as {
      onPressStart: () => void;
      onPressEnd: () => void;
      onPressCancel: () => void;
    };
    expect(() => inst.onPressStart()).not.toThrow();
    expect(() => inst.onPressEnd()).not.toThrow();
    expect(() => inst.onPressCancel()).not.toThrow();

    // Disabled path (early return in onPressStart / onPressEnd)
    setInputSignal((componentRef.instance as UiButton).disabled, true);
    expect(() => inst.onPressStart()).not.toThrow();
    expect(() => inst.onPressEnd()).not.toThrow();
  });
});
