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
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { DURATION } from '../../utils/animate';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
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

/**
 * A date picker's trigger: the button that draws the field and takes the
 * taps. It's the first button in the picker, as the calendar's, in the sheet,
 * come after it.
 */
const triggerOf = (container: Element) =>
  container.querySelector<HTMLElement>('[accessibility-traits^="button"]')!;

/**
 * Each way a press starts and ends: touches on a phone, and a mouse in the
 * web preview, which sends no touches for a cursor. A canceled touch (a
 * scroll taking over) and a cursor leaving release too.
 */
const PRESSES: readonly (readonly [
  down: (element: Element) => unknown,
  up: (element: Element) => unknown,
])[] = [
  [
    (element) => fireEvent.touchstart(element),
    (element) => fireEvent.touchend(element),
  ],
  [
    (element) => fireEvent.touchstart(element),
    (element) => fireEvent.touchcancel(element),
  ],
  [
    (element) => fireEvent.mousedown(element),
    (element) => fireEvent.mouseup(element),
  ],
  [
    (element) => fireEvent.mousedown(element),
    (element) => fireLynxEvent(element, 'mouseleave'),
  ],
];

const renderPicker = async (setup: (host: PickerHost) => void = () => {}) => {
  const result = await render(PickerHost);
  const host = result.componentRef.instance as PickerHost;
  setup(host);
  await waitForUpdate();
  const overlay = result.container.querySelector<HTMLElement>('overlay')!;
  // The trigger fills the field's row, which the host, the column, holds.
  const field = triggerOf(result.container).parentElement!;
  return {
    ...result,
    host,
    overlay,
    field,
    trigger: () => result.getByRole('button', { name: 'Ends on' }),
    triggerText: () => field.querySelector('text')!,
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
    const trigger = triggerOf(container);
    expect([...container.querySelectorAll('.w-48')]).toEqual([
      trigger.parentElement!.parentElement,
    ]);
    expect(getAllByAccessibilityLabel('Due')).toEqual([trigger]);
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

    // It can't be opened, so it doesn't answer a press either.
    fireEvent.touchstart(trigger());
    await waitForUpdate();
    expect(trigger().classList).not.toContain('opacity-70');
    fireEvent.touchend(trigger());

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

  // Android asks for 48dp touch targets and iOS for 44pt.
  it('makes the field 48px tall, with its text and icon centered', async () => {
    const { field, trigger } = await renderPicker();
    expect(field.classList).toContain('h-12');
    expect(field.classList).not.toContain('h-10');
    // The trigger fills the field's height and centers what it holds.
    expect([...trigger().classList]).toEqual(
      expect.arrayContaining(['flex-1', 'items-center']),
    );
    expect(trigger().parentElement).toBe(field);
  });

  it('draws the field as ui-select and ui-input draw theirs, with body-size text', async () => {
    // One shape for a form's fields: a filled box, not an outlined one.
    const { field, trigger, triggerText } = await renderPicker();
    for (const name of ['rounded-lg', 'bg-muted', 'px-4']) {
      expect(trigger().classList).toContain(name);
    }
    expect(field.classList).not.toContain('border');
    expect(trigger().classList).not.toContain('border');
    expect(triggerText().classList).toContain('text-base');
  });

  it('draws a 20px calendar icon in the muted foreground', async () => {
    const { trigger } = await renderPicker();
    const icon = trigger().querySelector('svg') as unknown as HTMLElement;
    expect(icon.style.width).toBe('20px');
    expect(icon.getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['muted-foreground'],
    );
  });

  it('dims the trigger under a finger or the mouse, from the press', async () => {
    // A phone's controls answer the touch, not the tap that follows it.
    const { trigger } = await renderPicker();
    expect(trigger().classList).not.toContain('opacity-70');
    for (const [down, up] of PRESSES) {
      down(trigger());
      await waitForUpdate();
      expect(trigger().classList).toContain('opacity-70');
      up(trigger());
      await waitForUpdate();
      expect(trigger().classList).not.toContain('opacity-70');
    }
  });

  // ui-button's default height is 48px, the touch target Android asks for
  // (iOS asks for 44), so Clear needs no height of its own.
  it('makes Clear a full-width button 48px tall', async () => {
    const { openSheet } = await renderPicker((host) => {
      host.clearable.set(true);
      host.value.set(new Date(2026, 10, 20));
    });
    const sheet = await openSheet();
    const clear = sheet.getByText('Clear').parentElement!;
    expect([...clear.classList]).toEqual(
      expect.arrayContaining(['h-12', 'w-full']),
    );
    expect(clear.classList).not.toContain('h-10');
    // 12px either side, so a 360px-wide phone's calendar is 336px: seven
    // 48px days. Clear sits in the same column as the calendar.
    expect(clear.parentElement!.classList).toContain('px-[12px]');
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
    // A phone's body size, in medium weight, as ui-input's label is.
    expect(label.classList).toContain('text-base');
    expect(label.classList).toContain('font-medium');
    const field = triggerOf(container).parentElement!;
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
