import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
  within,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { UiSelect, UiSelectItem } from './select';

@Component({
  imports: [UiSelect, UiSelectItem, LYNX_ELEMENTS],
  template: `
    <ui-select
      #select
      [(value)]="value"
      [placeholder]="placeholder()"
      [disabled]="disabled()"
      class="w-48"
      (changed)="changed($event)"
    >
      <ui-select-item value="apple" label="Apple" />
      <ui-select-item value="pear" label="Pear" class="font-bold" />
    </ui-select>
    <text class="open-from-code" (bindtap)="select.open()">Choose</text>
  `,
})
class SelectHost {
  readonly value = signal('');
  readonly placeholder = signal('Pick a fruit');
  readonly disabled = signal(false);
  readonly changed = vi.fn((_value: string) => {});
}

const renderSelect = async () => {
  const result = await render(SelectHost);
  const { container } = result;
  const overlay = container.querySelector<HTMLElement>('overlay')!;
  return {
    ...result,
    host: result.componentRef.instance as SelectHost,
    overlay,
    // The field is the host; the row inside it takes the taps.
    field: container.querySelector('.border-input')!,
    trigger: container.querySelector('.border-input')!.firstElementChild!,
    triggerText: () => container.querySelector('.border-input text')!,
    // An item's tappable row, found by its label in the sheet.
    item: (label: string) => within(overlay).getByText(label).parentElement!,
  };
};

/**
 * Waits out the sheet's open sequence: the overlay shows on one tick, and the
 * panel slides in on the next.
 */
const waitForOpen = async () => {
  for (let i = 0; i < 3; i++) await waitForUpdate();
};

/**
 * Waits for the sheet's close sequence to finish: the panel slides out, then
 * the overlay hides. Polled rather than timed, since the sequence only starts
 * on the update after the sheet is told to close.
 */
const waitForClose = (overlay: Element) =>
  vi.waitFor(() => expect(overlay.getAttribute('visible')).toBe('false'));

describe('UiSelect', () => {
  it('shows the placeholder, muted, until a value is chosen', async () => {
    const { triggerText, field } = await renderSelect();
    expect(triggerText().textContent).toBe('Pick a fruit');
    expect(triggerText().classList).toContain('text-muted-foreground');
    expect(field.classList).toContain('w-48');
  });

  // Static attributes land on a component's host too (issue #181): the
  // width applies once, to the field, and the placeholder is only shown.
  it('puts its class on one element, and its placeholder only in its text', async () => {
    @Component({
      imports: [UiSelect, UiSelectItem],
      template: `
        <ui-select placeholder="Pick a fruit" class="w-48">
          <ui-select-item value="apple" label="Apple" class="font-bold" />
        </ui-select>
      `,
    })
    class StaticAttributesHost {}

    const { container, getByText, queryAllByPlaceholderText } =
      await render(StaticAttributesHost);
    expect([...container.querySelectorAll('.w-48')]).toEqual([
      container.querySelector('.border-input'),
    ]);
    expect(queryAllByPlaceholderText('Pick a fruit')).toEqual([]);
    expect(getByText('Pick a fruit')).toBeTruthy();
    expect([...container.querySelectorAll('.font-bold')]).toEqual([
      getByText('Apple').parentElement,
    ]);
  });

  it("shows the chosen item's label", async () => {
    const { host, triggerText } = await renderSelect();
    host.value.set('pear');
    await waitForUpdate();
    expect(triggerText().textContent).toBe('Pear');
    expect(triggerText().classList).toContain('text-foreground');
  });

  it('shows a value that no item has as it is', async () => {
    const { host, triggerText } = await renderSelect();
    host.value.set('kiwi');
    await waitForUpdate();
    expect(triggerText().textContent).toBe('kiwi');
  });

  it('opens its list when the trigger is tapped, and closes it from the sheet', async () => {
    const { overlay, trigger } = await renderSelect();
    expect(overlay.getAttribute('visible')).toBe('false');

    fireEvent.tap(trigger);
    await waitForOpen();
    expect(overlay.getAttribute('visible')).toBe('true');

    // Tapping the backdrop closes the sheet, which the select keeps track of:
    // the next tap on the trigger opens it again.
    fireEvent.tap(overlay.querySelector('view')!);
    await waitForClose(overlay);
    expect(overlay.getAttribute('visible')).toBe('false');
    fireEvent.tap(trigger);
    await waitForOpen();
    expect(overlay.getAttribute('visible')).toBe('true');
  });

  it('closes its list when the trigger is tapped again', async () => {
    const { overlay, trigger } = await renderSelect();
    fireEvent.tap(trigger);
    await waitForOpen();
    fireEvent.tap(trigger);
    await waitForClose(overlay);
    expect(overlay.getAttribute('visible')).toBe('false');
  });

  it('opens from code with open()', async () => {
    const { overlay, getByText } = await renderSelect();
    fireEvent.tap(getByText('Choose'));
    await waitForOpen();
    expect(overlay.getAttribute('visible')).toBe('true');
  });

  it("dims and doesn't open while disabled", async () => {
    const { host, overlay, field, trigger, getByText } = await renderSelect();
    host.disabled.set(true);
    await waitForUpdate();
    expect(field.classList).toContain('opacity-50');

    fireEvent.tap(trigger);
    fireEvent.tap(getByText('Choose'));
    await waitForOpen();
    expect(overlay.getAttribute('visible')).toBe('false');
  });
});

describe('UiSelectItem', () => {
  it('chooses its value when tapped, and closes the list', async () => {
    const { host, overlay, trigger, triggerText, item } = await renderSelect();
    fireEvent.tap(trigger);
    await waitForOpen();

    fireEvent.tap(item('Apple'));
    expect(host.value()).toBe('apple');
    expect(host.changed).toHaveBeenCalledWith('apple');
    await waitForUpdate();
    expect(triggerText().textContent).toBe('Apple');
    await waitForClose(overlay);
    expect(overlay.getAttribute('visible')).toBe('false');
  });

  it('marks the chosen item with a highlight and a check', async () => {
    const { host, item } = await renderSelect();
    host.value.set('pear');
    await waitForUpdate();
    expect(item('Pear').classList).toContain('bg-accent');
    expect(item('Pear').querySelector('svg')).not.toBeNull();
    expect(item('Apple').classList).not.toContain('bg-accent');
    expect(item('Apple').querySelector('svg')).toBeNull();
  });

  it("adds the class to the item's own", async () => {
    const { item } = await renderSelect();
    expect(item('Pear').classList).toContain('font-bold');
    expect(item('Pear').classList).toContain('px-4');
  });
});
