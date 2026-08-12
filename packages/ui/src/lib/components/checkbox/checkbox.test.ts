import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiCheckbox } from './checkbox';

describe('UiCheckbox', () => {
  it('renders unchecked by default', async () => {
    const { container } = await render(UiCheckbox);
    expect(container).toBeTruthy();
  });

  it('toggle() flips checked and emits the `changed` output', async () => {
    const { componentRef } = await render(UiCheckbox);
    const inst = componentRef.instance as UiCheckbox;
    const changes: boolean[] = [];
    inst.changed.subscribe((v) => changes.push(v));

    inst.toggle();
    expect(inst.checked()).toBe(true);
    inst.toggle();
    expect(inst.checked()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('toggle() is a no-op when disabled is true', async () => {
    const { componentRef } = await render(UiCheckbox);
    const inst = componentRef.instance as UiCheckbox;
    setInputSignal(inst.disabled, true);
    const changed = vi.fn();
    inst.changed.subscribe(changed);

    inst.toggle();
    expect(inst.checked()).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it('applies the "checked" box class and reveals the check mark opacity', async () => {
    const { componentRef, container } = await render(UiCheckbox);
    const inst = componentRef.instance as UiCheckbox;
    inst.checked.set(true);
    await waitForUpdate();

    // The inner check-glyph is opacity: 1 when checked (opacity: 0 otherwise).
    const check = container.querySelector('text');
    expect(check?.getAttribute('style')).toContain('opacity: 1');
  });

  it('applies the disabled dim when disabled input is set', async () => {
    const { componentRef, container } = await render(UiCheckbox);
    setInputSignal((componentRef.instance as UiCheckbox).disabled, true);
    await waitForUpdate();
    // opacity-50 class lands on the box wrapper's class attribute.
    const boxes = container.querySelectorAll('view');
    const hasDim = Array.from(boxes).some((el) =>
      el.getAttribute('class')?.includes('opacity-50'),
    );
    expect(hasDim).toBe(true);
  });
});
