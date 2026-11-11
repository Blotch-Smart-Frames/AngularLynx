import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import localeJa from '@angular/common/locales/ja';
import { Component, LOCALE_ID, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
  within,
} from '@blotch/angular-lynx-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiCalendar, type Weekday } from './calendar';

registerLocaleData(localeDe);
registerLocaleData(localeJa);

@Component({
  imports: [UiCalendar],
  template: `
    <ui-calendar
      class="mt-2"
      [(value)]="value"
      [min]="min()"
      [max]="max()"
      [weekStartsOn]="weekStartsOn()"
      (changed)="changed($event)"
    />
  `,
})
class CalendarHost {
  readonly value = signal<Date | null>(null);
  readonly min = signal<Date | null>(null);
  readonly max = signal<Date | null>(null);
  readonly weekStartsOn = signal<Weekday | undefined>(undefined);
  readonly changed = vi.fn((_day: Date) => {});
}

/**
 * The narrow weekday names over the columns, hidden from screen readers.
 */
const weekdayNames = (container: Element) =>
  [...container.querySelectorAll('[accessibility-elements-hidden] text')].map(
    (text) => text.textContent,
  );

const renderCalendar = async (
  setup: (host: CalendarHost) => void = () => {},
) => {
  const result = await render(CalendarHost);
  const host = result.componentRef.instance as CalendarHost;
  setup(host);
  await waitForUpdate();
  return {
    ...result,
    host,
    /**
     * The title, which steps out to the months and then the years, checked
     * to read `name`. The first button: a year in the years list can share
     * its name.
     */
    title: (name: string) => {
      const title = result.container.querySelector<HTMLElement>(
        '[accessibility-traits="button"]',
      )!;
      expect(title.getAttribute('accessibility-label')).toBe(name);
      return title;
    },
    /** The narrow weekday names over the columns. */
    weekdays: () => weekdayNames(result.container),
  };
};

/**
 * Whether an element is drawn: Angular leaves a hidden view where each
 * `@if` and `@for` block starts.
 */
const isShown = (element: Element) =>
  element.getAttribute('style') !== 'display: none;';

/**
 * The elements drawn inside one, leaving out Angular's hidden anchors.
 */
const shownChildren = (element: Element) =>
  [...element.children].filter(isShown);

/**
 * The rows of days under the weekdays.
 */
const dayRows = (container: Element) =>
  shownChildren(container.querySelector('.h-\\[296px\\]')!).slice(1);

/**
 * The mark (the round fill or ring) inside a day, month or year button.
 */
const markOf = (button: HTMLElement) => button.querySelector('view')!;

/**
 * The text inside a day, month or year button.
 */
const textOf = (button: HTMLElement) => button.querySelector('text')!;

// The calendar marks today and opens at today's month, so every test runs on
// Wednesday, 11 November 2026. Only Date is faked: the testing library's
// updates run on the real timers.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 9, 30));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('UiCalendar', () => {
  it("opens at today's month, with today ringed", async () => {
    const { getByRole, getByText, title, weekdays } = await renderCalendar();
    expect(title('November 2026')).toBeTruthy();
    expect(getByText('November 2026')).toBeTruthy();
    expect(weekdays()).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);

    const today = getByRole('button', { name: 'Wednesday, November 11, 2026' });
    expect(textOf(today).textContent).toBe('11');
    expect(markOf(today).classList).toContain('border-primary');
    expect(textOf(today).classList).toContain('text-primary');
    expect(
      getByRole('button', {
        name: 'Thursday, November 12, 2026',
      }).querySelector('.border-primary'),
    ).toBeNull();
  });

  it('lays the days out a week to a row, under their weekdays', async () => {
    const { container } = await renderCalendar((host) =>
      // February 2026 starts on a Sunday and has exactly four weeks.
      host.value.set(new Date(2026, 1, 10)),
    );
    const rows = dayRows(container);
    // Six rows whatever the month, so the calendar's height never changes.
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(shownChildren(row)).toHaveLength(7);
    }
    const days = rows.flatMap((row) =>
      within(row as HTMLElement).queryAllByRole('button'),
    );
    expect(days).toHaveLength(28);
    expect(days[0]!.getAttribute('accessibility-label')).toBe(
      'Sunday, February 1, 2026',
    );
    expect(days[0]!.parentElement).toBe(rows[0]);
    expect(days[27]!.parentElement).toBe(rows[3]);
    expect(within(rows[4] as HTMLElement).queryAllByRole('button')).toEqual([]);
  });

  it('leaves the days before the first of the month empty', async () => {
    const { container, getByRole } = await renderCalendar((host) =>
      host.weekStartsOn.set(1),
    );
    // November 2026 starts on a Sunday: the last column when weeks start on
    // a Monday.
    const firstRow = dayRows(container)[0]!;
    expect(shownChildren(firstRow)[6]).toBe(
      getByRole('button', { name: 'Sunday, November 1, 2026' }),
    );
    expect(firstRow.querySelectorAll('[accessibility-label]')).toHaveLength(1);
  });

  it('starts its weeks on the weekday given', async () => {
    const { weekdays } = await renderCalendar((host) =>
      host.weekStartsOn.set(1),
    );
    expect(weekdays()).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  });

  it('opens at the chosen day, filled and selected', async () => {
    const { getByRole, title } = await renderCalendar((host) =>
      host.value.set(new Date(1992, 2, 14, 18, 45)),
    );
    expect(title('March 1992')).toBeTruthy();
    const chosen = getByRole('button', {
      name: 'Saturday, March 14, 1992',
      selected: true,
    });
    expect(markOf(chosen).classList).toContain('bg-primary');
    expect(textOf(chosen).classList).toContain('text-primary-foreground');
    expect(
      getByRole('button', { name: 'Friday, March 13, 1992', selected: false }),
    ).toBeTruthy();
  });

  it('chooses a day when it is tapped', async () => {
    const { host, getByRole } = await renderCalendar();
    fireEvent.tap(getByRole('button', { name: 'Friday, November 20, 2026' }));
    await waitForUpdate();

    // At local midnight.
    expect(host.value()).toEqual(new Date(2026, 10, 20));
    expect(host.changed).toHaveBeenCalledWith(new Date(2026, 10, 20));
    expect(
      getByRole('button', {
        name: 'Friday, November 20, 2026',
        selected: true,
      }),
    ).toBeTruthy();
  });

  it('follows a value the app sets to another month', async () => {
    const { host, title } = await renderCalendar();
    host.value.set(new Date(2027, 4, 1));
    await waitForUpdate();
    expect(title('May 2027')).toBeTruthy();
  });

  it('pages through the months with its arrows', async () => {
    const { getByRole, title } = await renderCalendar();
    fireEvent.tap(getByRole('button', { name: 'Next month' }));
    await waitForUpdate();
    expect(title('December 2026')).toBeTruthy();
    fireEvent.tap(getByRole('button', { name: 'Next month' }));
    await waitForUpdate();
    expect(title('January 2027')).toBeTruthy();

    fireEvent.tap(getByRole('button', { name: 'Previous month' }));
    fireEvent.tap(getByRole('button', { name: 'Previous month' }));
    fireEvent.tap(getByRole('button', { name: 'Previous month' }));
    await waitForUpdate();
    expect(title('October 2026')).toBeTruthy();
  });

  it('names its arrows as the app translates them', async () => {
    @Component({
      imports: [UiCalendar],
      template: `
        <ui-calendar
          previousMonthLabel="Back a month"
          nextMonthLabel="On a month"
          previousYearLabel="Back a year"
          nextYearLabel="On a year"
        />
      `,
    })
    class TranslatedHost {}

    const { getByRole } = await render(TranslatedHost);
    expect(getByRole('button', { name: 'Back a month' })).toBeTruthy();
    expect(getByRole('button', { name: 'On a month' })).toBeTruthy();

    fireEvent.tap(getByRole('button', { name: 'November 2026' }));
    await waitForUpdate();
    expect(getByRole('button', { name: 'Back a year' })).toBeTruthy();
    expect(getByRole('button', { name: 'On a year' })).toBeTruthy();
  });

  it('puts its class on its own column, once', async () => {
    const { container } = await renderCalendar();
    expect([...container.querySelectorAll('.mt-2')]).toEqual([
      container.querySelector('.flex-col')!,
    ]);
  });
});

describe('UiCalendar min and max', () => {
  it("fades the days outside them, which can't be chosen", async () => {
    const { host, getByRole } = await renderCalendar((host) => {
      host.min.set(new Date(2026, 10, 5, 12));
      host.max.set(new Date(2026, 10, 25, 8));
    });
    const before = getByRole('button', { name: 'Wednesday, November 4, 2026' });
    const after = getByRole('button', { name: 'Thursday, November 26, 2026' });
    for (const day of [before, after]) {
      expect(day.getAttribute('accessibility-traits')).toBe('button,disabled');
      expect(markOf(day).classList).toContain('opacity-40');
    }
    // Compared by day, whatever the time.
    const first = getByRole('button', { name: 'Thursday, November 5, 2026' });
    const last = getByRole('button', { name: 'Wednesday, November 25, 2026' });
    for (const day of [first, last]) {
      expect(day.getAttribute('accessibility-traits')).toBe('button');
      expect(markOf(day).classList).not.toContain('opacity-40');
    }

    fireEvent.tap(before);
    fireEvent.tap(after);
    await waitForUpdate();
    expect(host.value()).toBeNull();
    expect(host.changed).not.toHaveBeenCalled();

    fireEvent.tap(last);
    await waitForUpdate();
    expect(host.value()).toEqual(new Date(2026, 10, 25));
  });

  it("disables the arrows that would leave them, and doesn't page past them", async () => {
    const { getByRole, title } = await renderCalendar((host) => {
      host.min.set(new Date(2026, 9, 20));
      host.max.set(new Date(2026, 11, 3));
    });
    const previous = getByRole('button', { name: 'Previous month' });
    const next = getByRole('button', { name: 'Next month' });
    expect(previous.getAttribute('accessibility-traits')).toBe('button');

    fireEvent.tap(previous);
    await waitForUpdate();
    expect(title('October 2026')).toBeTruthy();
    expect(previous.getAttribute('accessibility-traits')).toBe(
      'button,disabled',
    );
    expect(previous.classList).toContain('opacity-50');
    fireEvent.tap(previous);
    await waitForUpdate();
    expect(title('October 2026')).toBeTruthy();

    fireEvent.tap(next);
    fireEvent.tap(next);
    await waitForUpdate();
    expect(title('December 2026')).toBeTruthy();
    expect(next.getAttribute('accessibility-traits')).toBe('button,disabled');
    fireEvent.tap(next);
    await waitForUpdate();
    expect(title('December 2026')).toBeTruthy();
  });

  it('opens at the nearest month inside them', async () => {
    const { host, title } = await renderCalendar((host) =>
      host.min.set(new Date(2027, 1, 1)),
    );
    expect(title('February 2027')).toBeTruthy();

    host.min.set(null);
    host.max.set(new Date(2025, 6, 9));
    await waitForUpdate();
    expect(title('July 2025')).toBeTruthy();
  });
});

describe('UiCalendar months', () => {
  it('steps out to the months of the year when the title is tapped', async () => {
    const { getByRole, queryByRole, title } = await renderCalendar();
    fireEvent.tap(title('November 2026'));
    await waitForUpdate();

    expect(title('2026')).toBeTruthy();
    // The weekdays and days are gone.
    expect(
      queryByRole('button', { name: 'Wednesday, November 11, 2026' }),
    ).toBeNull();
    const november = getByRole('button', {
      name: 'November 2026',
      selected: true,
    });
    expect(textOf(november).textContent).toBe('Nov');
    expect(markOf(november).classList).toContain('bg-primary');
    expect(
      getByRole('button', { name: 'January 2026', selected: false }),
    ).toBeTruthy();
  });

  it('rings the current month, and returns to the days of the one tapped', async () => {
    const { getByRole, title } = await renderCalendar((host) =>
      host.value.set(new Date(2026, 1, 3)),
    );
    fireEvent.tap(title('February 2026'));
    await waitForUpdate();
    expect(
      markOf(getByRole('button', { name: 'November 2026' })).classList,
    ).toContain('border-primary');

    fireEvent.tap(getByRole('button', { name: 'August 2026' }));
    await waitForUpdate();
    expect(title('August 2026')).toBeTruthy();
    expect(
      getByRole('button', { name: 'Saturday, August 1, 2026' }),
    ).toBeTruthy();
  });

  it('pages through the years with its arrows', async () => {
    const { getByRole, title } = await renderCalendar();
    fireEvent.tap(title('November 2026'));
    await waitForUpdate();
    fireEvent.tap(getByRole('button', { name: 'Previous year' }));
    fireEvent.tap(getByRole('button', { name: 'Previous year' }));
    await waitForUpdate();
    expect(title('2024')).toBeTruthy();
    fireEvent.tap(getByRole('button', { name: 'Next year' }));
    await waitForUpdate();
    expect(title('2025')).toBeTruthy();

    fireEvent.tap(getByRole('button', { name: 'March 2025' }));
    await waitForUpdate();
    expect(title('March 2025')).toBeTruthy();
  });

  it("fades the months outside min and max, which can't be chosen, and stops at their years", async () => {
    const { getByRole, title } = await renderCalendar((host) => {
      host.min.set(new Date(2025, 3, 30));
      host.max.set(new Date(2027, 8, 1));
    });
    fireEvent.tap(title('November 2026'));
    await waitForUpdate();
    const previous = getByRole('button', { name: 'Previous year' });
    const next = getByRole('button', { name: 'Next year' });

    // Back a year, to November 2025.
    fireEvent.tap(previous);
    await waitForUpdate();
    expect(title('2025')).toBeTruthy();
    expect(previous.getAttribute('accessibility-traits')).toBe(
      'button,disabled',
    );
    const march = getByRole('button', { name: 'March 2025' });
    expect(march.getAttribute('accessibility-traits')).toBe('button,disabled');
    expect(markOf(march).classList).toContain('opacity-40');
    expect(
      getByRole('button', { name: 'April 2025' }).getAttribute(
        'accessibility-traits',
      ),
    ).toBe('button');
    fireEvent.tap(march);
    await waitForUpdate();
    expect(title('2025')).toBeTruthy();

    // On two years, which keeps November but stops at September 2027.
    fireEvent.tap(next);
    fireEvent.tap(next);
    await waitForUpdate();
    expect(title('2027')).toBeTruthy();
    expect(next.getAttribute('accessibility-traits')).toBe('button,disabled');
    expect(
      getByRole('button', { name: 'September 2027', selected: true }),
    ).toBeTruthy();
    expect(
      getByRole('button', { name: 'October 2027' }).getAttribute(
        'accessibility-traits',
      ),
    ).toBe('button,disabled');
  });
});

describe('UiCalendar years', () => {
  /**
   * Steps out from the days to the years.
   */
  const showYears = async (
    title: (name: string) => HTMLElement,
    from: string,
  ) => {
    fireEvent.tap(title(from));
    await waitForUpdate();
    fireEvent.tap(title(from.split(' ')[1]!));
    await waitForUpdate();
  };

  it('lists a century either side of today, opening at the year shown', async () => {
    const { container, getByRole, queryByRole, title } = await renderCalendar();
    await showYears(title, 'November 2026');

    // The arrows go: the list scrolls instead.
    expect(queryByRole('button', { name: 'Previous year' })).toBeNull();
    expect(getByRole('button', { name: '1926' })).toBeTruthy();
    expect(getByRole('button', { name: '2126' })).toBeTruthy();
    expect(queryByRole('button', { name: '1925' })).toBeNull();
    expect(queryByRole('button', { name: '2127' })).toBeNull();

    const shown = getByRole('button', { name: '2026', selected: true });
    expect(markOf(shown).classList).toContain('bg-primary');
    // Its row, 2025 to 2027, is the 34th: 33 rows of 52px above it, less
    // what centers it in the 296px list.
    const list = container.querySelector('scroll-view')!;
    expect(list.getAttribute('initial-scroll-offset')).toBe(
      String(33 * 52 - (296 - 52) / 2),
    );
    // The title's chevron points up: tapping it goes back.
    expect(
      title('2026').querySelector('svg')!.getAttribute('content'),
    ).toContain('m18 15-6-6-6 6');
  });

  it('rings this year, and shows the months of the one tapped, at the shown month', async () => {
    const { getByRole, title } = await renderCalendar((host) =>
      host.value.set(new Date(1992, 2, 14)),
    );
    await showYears(title, 'March 1992');
    expect(markOf(getByRole('button', { name: '2026' })).classList).toContain(
      'border-primary',
    );

    fireEvent.tap(getByRole('button', { name: '1988' }));
    await waitForUpdate();
    expect(title('1988')).toBeTruthy();
    expect(
      getByRole('button', { name: 'March 1988', selected: true }),
    ).toBeTruthy();
  });

  it('goes back to the months when its title is tapped', async () => {
    const { getByRole, title } = await renderCalendar();
    await showYears(title, 'November 2026');
    fireEvent.tap(title('2026'));
    await waitForUpdate();
    expect(getByRole('button', { name: 'Previous year' })).toBeTruthy();
    expect(
      getByRole('button', { name: 'November 2026', selected: true }),
    ).toBeTruthy();
  });

  it('lists only the years of min to max, each in its column', async () => {
    const { container, getAllByRole, getByRole, title } = await renderCalendar(
      (host) => {
        host.min.set(new Date(2020, 4, 1));
        host.max.set(new Date(2030, 1, 1));
      },
    );
    await showYears(title, 'November 2026');
    const years = getAllByRole('button').map((year) =>
      year.getAttribute('accessibility-label'),
    );
    expect(years).toContain('2020');
    expect(years).toContain('2030');
    expect(years).not.toContain('2019');
    expect(years).not.toContain('2031');

    // Eleven years: the last row's two empty cells keep 2029 and 2030 in
    // their columns.
    const lastRow = getByRole('button', { name: '2029' }).parentElement!;
    expect(shownChildren(lastRow)).toHaveLength(3);
    // At the top, the list needs no scrolling to show the shown year.
    expect(
      container
        .querySelector('scroll-view')!
        .getAttribute('initial-scroll-offset'),
    ).toBe('0');

    // A year whose months start after min opens at its first one.
    fireEvent.tap(getByRole('button', { name: '2030' }));
    await waitForUpdate();
    expect(
      getByRole('button', { name: 'February 2030', selected: true }),
    ).toBeTruthy();
  });
});

describe('UiCalendar locales', () => {
  it("writes its title, weekdays and days in the app's locale", async () => {
    const { container, getByRole, getByText } = await render(CalendarHost, {
      providers: [{ provide: LOCALE_ID, useValue: 'ja' }],
    });
    // The locale's own order, not a fixed month-then-year.
    expect(getByText('2026年11月')).toBeTruthy();
    expect(weekdayNames(container)).toEqual([
      '日',
      '月',
      '火',
      '水',
      '木',
      '金',
      '土',
    ]);
    expect(getByRole('button', { name: '2026年11月11日水曜日' })).toBeTruthy();

    fireEvent.tap(getByRole('button', { name: '2026年11月' }));
    await waitForUpdate();
    expect(getByText('2026年')).toBeTruthy();
    expect(getByText('11月')).toBeTruthy();
  });

  it("starts its weeks on the locale's first day unless told otherwise", async () => {
    const { container, getByText } = await render(CalendarHost, {
      providers: [{ provide: LOCALE_ID, useValue: 'de' }],
    });
    expect(getByText('November 2026')).toBeTruthy();
    expect(weekdayNames(container)).toEqual([
      'M',
      'D',
      'M',
      'D',
      'F',
      'S',
      'S',
    ]);
  });
});
