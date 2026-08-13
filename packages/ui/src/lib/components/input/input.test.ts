import { signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiInput } from './input';

describe('UiInput', () => {
  it('renders with default configuration', async () => {
    const { container } = await render(UiInput);
    expect(container).toBeTruthy();
  });

  it('onInput() updates the model and emits `changed`', async () => {
    const { componentRef } = await render(UiInput);
    const inst = componentRef.instance as unknown as UiInput & {
      onInput: (e: { detail: { value: string } }) => void;
    };
    const emitted: string[] = [];
    inst.changed.subscribe((v) => emitted.push(v));
    inst.onInput({ detail: { value: 'hello' } });
    expect(inst.value()).toBe('hello');
    expect(emitted).toEqual(['hello']);
  });

  it('onInput() is a no-op when disabled', async () => {
    const { componentRef } = await render(UiInput);
    const inst = componentRef.instance as unknown as UiInput & {
      onInput: (e: { detail: { value: string } }) => void;
    };
    setInputSignal(inst.disabled, true);
    const emitted = vi.fn();
    inst.changed.subscribe(emitted);
    inst.onInput({ detail: { value: 'blocked' } });
    expect(inst.value()).toBe('');
    expect(emitted).not.toHaveBeenCalled();
  });

  it('onFocus() flips the focused state and emits `focused`', async () => {
    const { componentRef, container } = await render(UiInput);
    const inst = componentRef.instance as unknown as UiInput & {
      onFocus: () => void;
    };
    const emitted = vi.fn();
    inst.focused.subscribe(emitted);
    inst.onFocus();
    await waitForUpdate();
    expect(emitted).toHaveBeenCalledTimes(1);
    // Focus turns the overlay opacity to 1 via ringVisible().
    const overlay = container.querySelector('[style*="box-shadow"]');
    expect(overlay?.getAttribute('style')).toContain('opacity');
  });

  it('onBlur() clears focused state and emits `blurred`', async () => {
    const { componentRef } = await render(UiInput);
    const inst = componentRef.instance as unknown as UiInput & {
      onFocus: () => void;
      onBlur: () => void;
    };
    const emitted = vi.fn();
    inst.blurred.subscribe(emitted);
    inst.onFocus();
    inst.onBlur();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('error input triggers the shake animation via effect', async () => {
    // The effect reads error() + containerRef.nativeElement and calls shake().
    // Setting error to a non-empty value while it was empty exercises the branch.
    // JIT + jsdom doesn't populate template-ref viewChild queries, so we
    // monkey-patch containerRef with a signal returning a fake ElementRef so the
    // effect's `el` check passes and the shake path runs.
    const { componentRef, container } = await render(UiInput);
    const inst = componentRef.instance as UiInput;
    const view = container.querySelector('view') as Element;
    (inst as unknown as { containerRef: unknown }).containerRef = signal({
      nativeElement: view,
    });
    setInputSignal(inst.error, 'Required');
    await waitForUpdate();
    await waitForUpdate();
    // The error text should render and the destructive ring shadow should apply.
    expect(container.textContent).toContain('Required');

    // Re-trigger the shake (previous error cleared → then set) so `#shakeAnim`
    // is set once and canceled the next time — covers both branches of `?.`.
    setInputSignal(inst.error, '');
    await waitForUpdate();
    await waitForUpdate();
    setInputSignal(inst.error, 'Required again');
    await waitForUpdate();
    await waitForUpdate();
    expect(container.textContent).toContain('Required again');
  });

  it('renders helper text when no error is present', async () => {
    const { componentRef, container } = await render(UiInput);
    const inst = componentRef.instance as UiInput;
    setInputSignal(inst.helperText, 'Enter your name');
    await waitForUpdate();
    expect(container.textContent).toContain('Enter your name');
  });

  it('renders the label when provided', async () => {
    const { componentRef, container } = await render(UiInput);
    const inst = componentRef.instance as UiInput;
    setInputSignal(inst.label, 'Name');
    await waitForUpdate();
    expect(container.textContent).toContain('Name');
  });

  it('applies the disabled dim class when disabled', async () => {
    // Covers the true branch of `disabled() && 'opacity-50'` in inputWrapperClass.
    const { componentRef, container } = await render(UiInput);
    const inst = componentRef.instance as UiInput;
    setInputSignal(inst.disabled, true);
    await waitForUpdate();
    const wrapper = container.querySelector(
      '[class*="rounded-xl"][class*="bg-muted"]',
    );
    expect(wrapper?.getAttribute('class')).toContain('opacity-50');
  });
});
