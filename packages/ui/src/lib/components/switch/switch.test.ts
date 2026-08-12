import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiSwitch } from './switch';

describe('UiSwitch', () => {
  it('renders in the off position by default', async () => {
    const { container } = await render(UiSwitch);
    expect(container).toBeTruthy();
  });

  it('toggle() flips checked and emits `changed`', async () => {
    const { componentRef } = await render(UiSwitch);
    const inst = componentRef.instance as UiSwitch;
    const emitted: boolean[] = [];
    inst.changed.subscribe((v) => emitted.push(v));

    inst.toggle();
    expect(inst.checked()).toBe(true);
    inst.toggle();
    expect(inst.checked()).toBe(false);
    expect(emitted).toEqual([true, false]);
  });

  it('toggle() is a no-op when disabled', async () => {
    const { componentRef } = await render(UiSwitch);
    const inst = componentRef.instance as UiSwitch;
    setInputSignal(inst.disabled, true);
    const listener = vi.fn();
    inst.changed.subscribe(listener);

    inst.toggle();
    expect(inst.checked()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('positions the thumb differently in ON vs OFF state', async () => {
    const { componentRef, container } = await render(UiSwitch);
    const inst = componentRef.instance as UiSwitch;
    let thumb = container.querySelectorAll('view')[1];
    expect(thumb?.getAttribute('style')).toContain('translateX(2px)');

    inst.checked.set(true);
    await waitForUpdate();
    thumb = container.querySelectorAll('view')[1];
    expect(thumb?.getAttribute('style')).toContain('translateX(22px)');
  });

  it('applies opacity-50 when disabled and includes a user class', async () => {
    // Covers the disabled=true branch of trackClass() (line 62) and the
    // userClass() concatenation. Without a render + detectChanges cycle the
    // computed never runs with disabled=true and the branch stays uncovered.
    const { componentRef, container } = await render(UiSwitch);
    const inst = componentRef.instance as UiSwitch;
    setInputSignal(inst.disabled, true);
    setInputSignal(inst.userClass, 'custom-cls');
    await waitForUpdate();
    const track = container.querySelectorAll('view')[0];
    const cls = track?.getAttribute('class') ?? '';
    expect(cls).toContain('opacity-50');
    expect(cls).toContain('custom-cls');
  });
});
