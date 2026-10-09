import { signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiTextarea } from './textarea';

describe('UiTextarea', () => {
  it('renders with default configuration', async () => {
    const { container } = await render(UiTextarea);
    expect(container).toBeTruthy();
  });

  it('onInput() updates the model and emits `changed`', async () => {
    const { componentRef } = await render(UiTextarea);
    const inst = componentRef.instance as unknown as UiTextarea & {
      onInput: (e: { detail: { value: string } }) => void;
    };
    const emitted: string[] = [];
    inst.changed.subscribe((v) => emitted.push(v));
    inst.onInput({ detail: { value: 'hello' } });
    expect(inst.value()).toBe('hello');
    expect(emitted).toEqual(['hello']);
  });

  it('onInput() is a no-op when disabled', async () => {
    const { componentRef } = await render(UiTextarea);
    const inst = componentRef.instance as unknown as UiTextarea & {
      onInput: (e: { detail: { value: string } }) => void;
    };
    setInputSignal(inst.disabled, true);
    const emitted = vi.fn();
    inst.changed.subscribe(emitted);
    inst.onInput({ detail: { value: 'blocked' } });
    expect(inst.value()).toBe('');
    expect(emitted).not.toHaveBeenCalled();
  });

  it('onFocus/onBlur emit and update state', async () => {
    const { componentRef } = await render(UiTextarea);
    const inst = componentRef.instance as unknown as UiTextarea & {
      onFocus: () => void;
      onBlur: () => void;
    };
    const focused = vi.fn();
    const blurred = vi.fn();
    inst.focused.subscribe(focused);
    inst.blurred.subscribe(blurred);
    inst.onFocus();
    inst.onBlur();
    expect(focused).toHaveBeenCalledTimes(1);
    expect(blurred).toHaveBeenCalledTimes(1);
  });

  it('error input triggers the shake effect', async () => {
    // Same pattern as UiInput: JIT + jsdom doesn't populate template-ref
    // viewChild queries. Monkey-patch containerRef so the effect body's `el`
    // check passes and the shake path executes.
    const { componentRef, container } = await render(UiTextarea);
    const inst = componentRef.instance as UiTextarea;
    const view = container.querySelector('view') as Element;
    (inst as unknown as { containerRef: unknown }).containerRef = signal({
      nativeElement: view,
    });
    setInputSignal(inst.error, 'Too short');
    await waitForUpdate();
    await waitForUpdate();
    expect(container.textContent).toContain('Too short');
    // Clear then re-trigger to cover the cancel path.
    setInputSignal(inst.error, '');
    await waitForUpdate();
    await waitForUpdate();
    setInputSignal(inst.error, 'Retry');
    await waitForUpdate();
    await waitForUpdate();
    expect(container.textContent).toContain('Retry');
  });

  it('renders helper text when no error is present', async () => {
    const { componentRef, container } = await render(UiTextarea);
    const inst = componentRef.instance as UiTextarea;
    setInputSignal(inst.helperText, 'Notes here');
    await waitForUpdate();
    expect(container.textContent).toContain('Notes here');
  });

  it('renders the label when provided', async () => {
    const { componentRef, container } = await render(UiTextarea);
    const inst = componentRef.instance as UiTextarea;
    setInputSignal(inst.label, 'Description');
    await waitForUpdate();
    expect(container.textContent).toContain('Description');
  });

  it('computes a min-height wrapper style when only minLines is set', async () => {
    // Exercises the `max != null ? ... : ''` false branch of wrapperStyle.
    const { componentRef, container } = await render(UiTextarea);
    const inst = componentRef.instance as UiTextarea;
    setInputSignal(inst.minLines, 5);
    await waitForUpdate();
    // 5 * 20 + 20 = 120px
    const wrapper = container.querySelector('[style*="min-height"]');
    expect(wrapper?.getAttribute('style')).toContain('min-height: 120px');
    expect(wrapper?.getAttribute('style')).not.toContain('max-height');
  });

  it('adds max-height to wrapper style when maxLines is set', async () => {
    const { componentRef, container } = await render(UiTextarea);
    const inst = componentRef.instance as UiTextarea;
    setInputSignal(inst.maxLines, 4);
    await waitForUpdate();
    const wrapper = container.querySelector('[style*="max-height"]');
    expect(wrapper?.getAttribute('style')).toContain('max-height: 100px');
  });

  it('makes the wrapper a stacking context so the field scrolls with it', async () => {
    // On Lynx a z-indexed element inside a scroll-view only follows the scroll
    // when an ancestor inside the scroll content is a stacking context. Without
    // z-0 on the wrapper, the native field (and its placeholder) stays fixed on
    // screen while the page scrolls.
    const { container } = await render(UiTextarea);
    const wrapper = container.querySelector(
      '[class*="rounded-xl"][class*="bg-muted"]',
    );
    expect(wrapper?.getAttribute('class')?.split(/\s+/)).toContain('z-0');
  });

  it('applies the disabled dim class when disabled', async () => {
    // Covers the true branch of `disabled() && 'opacity-50'` in textareaWrapperClass.
    const { componentRef, container } = await render(UiTextarea);
    const inst = componentRef.instance as UiTextarea;
    setInputSignal(inst.disabled, true);
    await waitForUpdate();
    const wrapper = container.querySelector(
      '[class*="rounded-xl"][class*="bg-muted"]',
    );
    expect(wrapper?.getAttribute('class')).toContain('opacity-50');
  });
});
