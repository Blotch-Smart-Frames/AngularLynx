import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate as nextUpdate,
  within,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DURATION } from '@blotch/dolan/utils/animate';
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
    // The host is the field's column; the row inside the field takes the taps.
    column: container.querySelector('.border-input')!.parentElement!,
    field: container.querySelector('.border-input')!,
    trigger: container.querySelector('.border-input')!.firstElementChild!,
    triggerText: () => container.querySelector('.border-input text')!,
    // An item's tappable row, found by its label in the sheet.
    item: (label: string) => within(overlay).getByText(label).parentElement!,
  };
};

// Every test runs on a fake clock (see the beforeEach below), so the test
// decides when time passes. On real time, a busy machine fired the sheet's
// close timers late, and a test looked before they had.

/**
 * The testing library's waitForUpdate on the fake clock. It waits on a
 * zero-delay timer, which Node runs a millisecond later; the fake clock puts
 * a zero-delay timer set by another timer a millisecond later too, so this
 * lets one pass.
 */
const waitForUpdate = async () => {
  const update = nextUpdate();
  await vi.advanceTimersByTimeAsync(1);
  await update;
};

/**
 * How long the sheet takes to close: a zero-delay step, then its slide out
 * and 20ms more.
 */
const CLOSED = DURATION.normal + 30;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * Waits out the sheet's open sequence: the overlay shows on one tick, and the
 * panel slides in on the next.
 */
const waitForOpen = async () => {
  for (let i = 0; i < 3; i++) await waitForUpdate();
};

/**
 * Waits for the sheet's close sequence to finish: the panel slides out, then
 * the overlay hides.
 */
const waitForClose = async (overlay: Element) => {
  await vi.advanceTimersByTimeAsync(CLOSED);
  await waitForUpdate();
  expect(overlay.getAttribute('visible')).toBe('false');
};

describe('UiSelect', () => {
  it('shows the placeholder, muted, until a value is chosen', async () => {
    const { triggerText, column } = await renderSelect();
    expect(triggerText().textContent).toBe('Pick a fruit');
    expect(triggerText().classList).toContain('text-muted-foreground');
    expect(column.classList).toContain('w-48');
  });

  // Static attributes land on a component's host too (issue #181): the
  // width applies once, to the column, the placeholder is only shown, and
  // the accessibility label is only the trigger's.
  it('puts its class on one element, and its placeholder only in its text', async () => {
    @Component({
      imports: [UiSelect, UiSelectItem],
      template: `
        <ui-select
          placeholder="Pick a fruit"
          accessibility-label="Fruit"
          class="w-48"
        >
          <ui-select-item value="apple" label="Apple" class="font-bold" />
        </ui-select>
      `,
    })
    class StaticAttributesHost {}

    const {
      container,
      getByText,
      getAllByAccessibilityLabel,
      queryAllByPlaceholderText,
    } = await render(StaticAttributesHost);
    expect([...container.querySelectorAll('.w-48')]).toEqual([
      container.querySelector('.border-input')!.parentElement,
    ]);
    expect(getAllByAccessibilityLabel('Fruit')).toEqual([
      container.querySelector('.border-input')!.firstElementChild,
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

describe('UiSelect accessibility', () => {
  @Component({
    imports: [UiSelect, UiSelectItem],
    template: `
      <ui-select
        label="Country"
        placeholder="Choose your country"
        [disabled]="disabled()"
        [(value)]="country"
      >
        <ui-select-item value="de" label="Germany" />
        <ui-select-item value="jp" label="Japan" />
      </ui-select>
    `,
  })
  class LabeledHost {
    readonly country = signal('');
    readonly disabled = signal(false);
  }

  it('shows its label above the field, and names the trigger with it', async () => {
    const { container, getByRole, getByText } = await render(LabeledHost);
    const label = getByText('Country');
    // Above the field, in its column, and hidden: the trigger reads it.
    const field = container.querySelector('.border-input')!;
    expect(label.parentElement).toBe(field.parentElement);
    expect(
      label.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(label.getAttribute('accessibility-elements-hidden')).toBe('true');

    const trigger = getByRole('button', { name: 'Country' });
    expect(trigger.getAttribute('accessibility-element')).toBe('true');
    expect(trigger.getAttribute('accessibility-value')).toBe(
      'Choose your country',
    );
  });

  it('opens from the trigger, and marks the chosen item selected', async () => {
    const { componentRef, getByRole, findByRole, queryByRole } =
      await render(LabeledHost);
    expect(queryByRole('button', { selected: true })).toBeNull();

    fireEvent.tap(getByRole('button', { name: 'Country' }));
    await waitForOpen();
    fireEvent.tap(await findByRole('button', { name: 'Germany' }));
    await waitForUpdate();

    expect((componentRef.instance as LabeledHost).country()).toBe('de');
    expect(
      getByRole('button', { name: 'Germany', selected: true }),
    ).toBeTruthy();
    expect(
      getByRole('button', { name: 'Japan', selected: false }),
    ).toBeTruthy();
    expect(
      getByRole('button', { name: 'Country' }).getAttribute(
        'accessibility-value',
      ),
    ).toBe('Germany');
  });

  it('is dimmed to screen readers while disabled', async () => {
    const { componentRef, getByRole } = await render(LabeledHost);
    const trigger = getByRole('button', { name: 'Country' });
    expect(trigger.getAttribute('accessibility-traits')).toBe('button');

    (componentRef.instance as LabeledHost).disabled.set(true);
    await waitForUpdate();
    expect(trigger.getAttribute('accessibility-traits')).toBe(
      'button,disabled',
    );
  });

  it('takes its name from accessibility-label when shown without a label', async () => {
    @Component({
      imports: [UiSelect, UiSelectItem],
      template: `
        <ui-select accessibility-label="Fruit" value="apple">
          <ui-select-item value="apple" label="Apple" />
        </ui-select>
      `,
    })
    class UnlabeledHost {}

    const { getByRole, queryByText } = await render(UnlabeledHost);
    expect(queryByText('Fruit')).toBeNull();
    expect(
      getByRole('button', { name: 'Fruit' }).getAttribute(
        'accessibility-value',
      ),
    ).toBe('Apple');
  });

  it('is named by what it shows without either, with no value read twice', async () => {
    const { getByRole } = await renderSelect();
    const trigger = getByRole('button', { name: 'Pick a fruit' });
    expect(trigger.hasAttribute('accessibility-value')).toBe(false);
  });
});
