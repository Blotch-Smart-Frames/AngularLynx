import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import { Component, LOCALE_ID, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate as nextUpdate,
  within,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DURATION } from '../../utils/animate';
import { UiDatePicker } from './date-picker';

registerLocaleData(localeDe);

@Component({
  imports: [UiDatePicker, LYNX_ELEMENTS],
  template: `
    <ui-date-picker
      #picker
      label="Ends on"
      class="w-48"
      [(value)]="value"
      [placeholder]="placeholder()"
      [disabled]="disabled()"
      [clearable]="clearable()"
      [min]="min()"
      [max]="max()"
      [weekStartsOn]="weekStartsOn()"
      [format]="format()"
      (changed)="changed($event)"
    />
    <text class="open-from-code" (bindtap)="picker.open()">Choose</text>
  `,
})
class PickerHost {
  readonly value = signal<Date | null>(null);
  readonly placeholder = signal('Pick a day');
  readonly disabled = signal(false);
  readonly clearable = signal(false);
  readonly min = signal<Date | null>(null);
  readonly max = signal<Date | null>(null);
  readonly weekStartsOn = signal<1 | undefined>(undefined);
  readonly format = signal('mediumDate');
  readonly changed = vi.fn((_day: Date | null) => {});
}

// Every test runs on a fake clock, so the test decides when the sheet's
// timers fire, and on Wednesday, 11 November 2026, the day the calendar
// marks as today.

/**
 * The testing library's waitForUpdate on the fake clock. It waits on a
 * zero-delay timer, which the fake clock runs once it moves.
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
  vi.setSystemTime(new Date(2026, 10, 11, 9, 30));
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * Waits out the sheet's open sequence: the overlay shows on one tick, and
 * the panel slides in on the next.
 */
const waitForOpen = async () => {
  for (let i = 0; i < 3; i++) await waitForUpdate();
};

/**
 * Waits for the sheet's close sequence to finish and the overlay to hide.
 */
const waitForClose = async (overlay: Element) => {
  await vi.advanceTimersByTimeAsync(CLOSED);
  await waitForUpdate();
  expect(overlay.getAttribute('visible')).toBe('false');
};

const renderPicker = async (setup: (host: PickerHost) => void = () => {}) => {
  const result = await render(PickerHost);
  const host = result.componentRef.instance as PickerHost;
  setup(host);
  await waitForUpdate();
  const overlay = result.container.querySelector<HTMLElement>('overlay')!;
  return {
    ...result,
    host,
    overlay,
    field: result.container.querySelector('.border-input')!,
    trigger: () => result.getByRole('button', { name: 'Ends on' }),
    triggerText: () => result.container.querySelector('.border-input text')!,
    /** Taps the trigger and waits for the sheet to open. */
    openSheet: async () => {
      fireEvent.tap(result.getByRole('button', { name: 'Ends on' }));
      await waitForOpen();
      expect(overlay.getAttribute('visible')).toBe('true');
      return within(overlay);
    },
  };
};

describe('UiDatePicker', () => {
  it('shows the placeholder, muted, until a day is chosen', async () => {
    const { triggerText, trigger } = await renderPicker();
    expect(triggerText().textContent).toBe('Pick a day');
    expect(triggerText().classList).toContain('text-muted-foreground');
    expect(trigger().getAttribute('accessibility-value')).toBe('Pick a day');
  });

  it("shows the chosen day in the field's format", async () => {
    const { host, triggerText, trigger } = await renderPicker((host) =>
      host.value.set(new Date(2026, 10, 20)),
    );
    expect(triggerText().textContent).toBe('Nov 20, 2026');
    expect(triggerText().classList).toContain('text-foreground');
    expect(trigger().getAttribute('accessibility-value')).toBe('Nov 20, 2026');

    host.format.set('fullDate');
    await waitForUpdate();
    expect(triggerText().textContent).toBe('Friday, November 20, 2026');
  });

  it("writes the day in the app's locale", async () => {
    @Component({
      imports: [UiDatePicker],
      template: `<ui-date-picker [value]="day" />`,
    })
    class GermanHost {
      readonly day = new Date(2026, 10, 20);
    }

    const { getByText } = await render(GermanHost, {
      providers: [{ provide: LOCALE_ID, useValue: 'de' }],
    });
    expect(getByText('20.11.2026')).toBeTruthy();
  });

  // Static attributes land on a component's host too (issue #181): the
  // width applies once, to the column, the placeholder is only shown, and
  // the accessibility label is only the trigger's.
  it('puts its class on one element, and its placeholder only in its text', async () => {
    @Component({
      imports: [UiDatePicker],
      template: `
        <ui-date-picker
          placeholder="Pick a day"
          accessibility-label="Due"
          class="w-48"
        />
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
    expect(getAllByAccessibilityLabel('Due')).toEqual([
      container.querySelector('.border-input')!.firstElementChild,
    ]);
    expect(queryAllByPlaceholderText('Pick a day')).toEqual([]);
    expect(getByText('Pick a day')).toBeTruthy();
  });

  it("opens a calendar at the chosen day's month, and picks the day tapped", async () => {
    const { host, overlay, triggerText, openSheet } = await renderPicker(
      (host) => host.value.set(new Date(2026, 1, 3)),
    );
    // No calendar until the sheet opens.
    expect(within(overlay).queryByText('February 2026')).toBeNull();

    const sheet = await openSheet();
    expect(sheet.getByText('February 2026')).toBeTruthy();
    expect(
      sheet.getByRole('button', {
        name: 'Tuesday, February 3, 2026',
        selected: true,
      }),
    ).toBeTruthy();

    fireEvent.tap(
      sheet.getByRole('button', { name: 'Friday, February 20, 2026' }),
    );
    expect(host.value()).toEqual(new Date(2026, 1, 20));
    expect(host.changed).toHaveBeenCalledWith(new Date(2026, 1, 20));
    await waitForUpdate();
    expect(triggerText().textContent).toBe('Feb 20, 2026');

    // The sheet closes, and its calendar goes with it.
    await waitForClose(overlay);
    expect(within(overlay).queryByText('February 2026')).toBeNull();
  });

  it('opens at the chosen month again, wherever the calendar was left', async () => {
    const { overlay, openSheet } = await renderPicker();
    let sheet = await openSheet();
    fireEvent.tap(sheet.getByRole('button', { name: 'Next month' }));
    await waitForUpdate();
    expect(sheet.getByText('December 2026')).toBeTruthy();

    // Closed from the backdrop, without a day.
    fireEvent.tap(overlay.querySelector('view')!);
    await waitForClose(overlay);

    sheet = await openSheet();
    expect(sheet.getByText('November 2026')).toBeTruthy();
  });

  it('passes its range, week start and labels to the calendar', async () => {
    @Component({
      imports: [UiDatePicker],
      template: `
        <ui-date-picker
          label="Ends on"
          [min]="min"
          [max]="max"
          [weekStartsOn]="1"
          previousMonthLabel="Back a month"
          nextMonthLabel="On a month"
          previousYearLabel="Back a year"
          nextYearLabel="On a year"
        />
      `,
    })
    class RangeHost {
      readonly min = new Date(2026, 10, 5);
      readonly max = new Date(2026, 10, 25);
    }

    const { container, getByRole } = await render(RangeHost);
    fireEvent.tap(getByRole('button', { name: 'Ends on' }));
    await waitForOpen();
    const sheet = within(container.querySelector<HTMLElement>('overlay')!);

    expect(
      sheet
        .getByRole('button', { name: 'Wednesday, November 4, 2026' })
        .getAttribute('accessibility-traits'),
    ).toBe('button,disabled');
    expect(
      sheet
        .getByRole('button', { name: 'Wednesday, November 25, 2026' })
        .getAttribute('accessibility-traits'),
    ).toBe('button');
    // Weeks start on Monday.
    expect(
      container.querySelector('overlay [accessibility-elements-hidden] text')!
        .textContent,
    ).toBe('M');
    expect(
      sheet
        .getByRole('button', { name: 'Back a month' })
        .getAttribute('accessibility-traits'),
    ).toBe('button,disabled');
    expect(sheet.getByRole('button', { name: 'On a month' })).toBeTruthy();

    fireEvent.tap(sheet.getByRole('button', { name: 'November 2026' }));
    await waitForUpdate();
    expect(sheet.getByRole('button', { name: 'Back a year' })).toBeTruthy();
    expect(sheet.getByRole('button', { name: 'On a year' })).toBeTruthy();
  });

  it('closes when the trigger is tapped again', async () => {
    const { overlay, trigger, openSheet } = await renderPicker();
    await openSheet();
    fireEvent.tap(trigger());
    await waitForClose(overlay);
  });

  it('opens from code with open()', async () => {
    const { overlay, getByText } = await renderPicker();
    fireEvent.tap(getByText('Choose'));
    await waitForOpen();
    expect(overlay.getAttribute('visible')).toBe('true');
  });

  it("dims, and doesn't open, while disabled", async () => {
    const { host, overlay, field, trigger, getByText } = await renderPicker();
    host.disabled.set(true);
    await waitForUpdate();
    expect(field.classList).toContain('opacity-50');
    expect(trigger().getAttribute('accessibility-traits')).toBe(
      'button,disabled',
    );

    fireEvent.tap(trigger());
    fireEvent.tap(getByText('Choose'));
    await waitForOpen();
    expect(overlay.getAttribute('visible')).toBe('false');
  });
});

describe('UiDatePicker clearable', () => {
  it('offers Clear in the sheet while a day is chosen, which clears it and closes', async () => {
    const { host, overlay, triggerText, openSheet } = await renderPicker(
      (host) => {
        host.clearable.set(true);
        host.value.set(new Date(2026, 10, 20));
      },
    );
    const sheet = await openSheet();
    fireEvent.tap(sheet.getByText('Clear'));
    expect(host.value()).toBeNull();
    expect(host.changed).toHaveBeenCalledWith(null);
    await waitForUpdate();
    expect(triggerText().textContent).toBe('Pick a day');
    await waitForClose(overlay);
  });

  it('offers no Clear without a day, or unless clearable', async () => {
    const { host, overlay, openSheet } = await renderPicker((host) =>
      host.clearable.set(true),
    );
    let sheet = await openSheet();
    expect(sheet.queryByText('Clear')).toBeNull();
    fireEvent.tap(overlay.querySelector('view')!);
    await waitForClose(overlay);

    host.clearable.set(false);
    host.value.set(new Date(2026, 10, 20));
    await waitForUpdate();
    sheet = await openSheet();
    expect(sheet.queryByText('Clear')).toBeNull();
  });

  it('names Clear as the app translates it', async () => {
    @Component({
      imports: [UiDatePicker],
      template: `
        <ui-date-picker
          label="Due on"
          clearable
          clearLabel="Remove the day"
          [value]="day"
        />
      `,
    })
    class TranslatedHost {
      readonly day = new Date(2026, 10, 20);
    }

    const { container, getByRole } = await render(TranslatedHost);
    fireEvent.tap(getByRole('button', { name: 'Due on' }));
    await waitForOpen();
    expect(
      within(container.querySelector<HTMLElement>('overlay')!).getByText(
        'Remove the day',
      ),
    ).toBeTruthy();
  });
});

describe('UiDatePicker accessibility', () => {
  it('shows its label above the field, and names the trigger with it', async () => {
    const { container, getByText, trigger } = await renderPicker();
    const label = getByText('Ends on');
    const field = container.querySelector('.border-input')!;
    expect(label.parentElement).toBe(field.parentElement);
    expect(
      label.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(label.getAttribute('accessibility-elements-hidden')).toBe('true');
    expect(trigger().getAttribute('accessibility-element')).toBe('true');
    expect(trigger().getAttribute('accessibility-traits')).toBe('button');
  });

  it('takes its name from accessibility-label when shown without a label', async () => {
    @Component({
      imports: [UiDatePicker],
      template: `<ui-date-picker accessibility-label="Due" [value]="day" />`,
    })
    class UnlabeledHost {
      readonly day = new Date(2026, 10, 20);
    }

    const { getByRole } = await render(UnlabeledHost);
    expect(
      getByRole('button', { name: 'Due' }).getAttribute('accessibility-value'),
    ).toBe('Nov 20, 2026');
  });

  it('is named by what it shows without either, with no value read twice', async () => {
    @Component({
      imports: [UiDatePicker],
      template: `<ui-date-picker />`,
    })
    class BareHost {}

    const { getByRole } = await render(BareHost);
    const trigger = getByRole('button', { name: 'Select date' });
    expect(trigger.hasAttribute('accessibility-value')).toBe(false);
  });
});
