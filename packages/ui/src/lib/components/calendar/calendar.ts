import {
  FormatWidth,
  formatDate,
  getLocaleDateFormat,
  getLocaleFirstDayOfWeek,
} from '@angular/common';
import {
  Component,
  LOCALE_ID,
  ViewEncapsulation,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';
import { UiButton } from '../button/button';
import { UiIcon } from '../icon/icon';

/** A day of the week, numbered as `Date.getDay()` numbers it: 0 is Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * What the calendar shows: a month's days, a year's months, or the years.
 * Tapping the title steps out (days, then months, then years); picking a
 * year or a month steps back in.
 */
type CalendarView = 'days' | 'months' | 'years';

/** Where tapping the title goes from each view. */
const STEP_OUT: Readonly<Record<CalendarView, CalendarView>> = {
  days: 'months',
  months: 'years',
  // The years list steps back in to the months, which is where its
  // up-pointing chevron says the title goes.
  years: 'months',
};

/**
 * One day, month or year the calendar offers, with what it shows and says.
 * `value` is its position in time: a day's midnight in ms, a month's count
 * from year 0 (see monthIndex), or a year.
 */
type CalendarCell = {
  readonly value: number;
  /** What the cell shows: the day's number, the month's short name, the year. */
  readonly text: string;
  /** What a screen reader says for it: the whole date, month or year. */
  readonly label: string;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly markClass: string;
  readonly textClass: string;
};

type DayCell = CalendarCell & { readonly date: Date };

/** Rows of the day grid: six weeks hold any month, so its height never changes. */
const WEEKS = 6;

/** Years in each row of the years list. */
const YEARS_PER_ROW = 3;

/** A row of the years list's height in px, as its class sets it. */
const YEAR_ROW_HEIGHT = 52;

/**
 * The body's height in px, as its class sets it: the weekday row and six
 * weeks. Every view fills the same height, so the calendar (and a sheet
 * that holds it) doesn't jump as it changes view.
 */
const BODY_HEIGHT = 296;

/**
 * How many years the list reaches either side of today when `min` or `max`
 * doesn't bound it.
 */
const YEAR_SPAN = 100;

/**
 * The pieces of a date pattern: a quoted literal, a field (a run of one
 * letter, such as `MMMM`), or other literal text.
 */
const PATTERN_PIECE = /'(?:[^']|'')*'|([A-Za-z])\1*|[^'A-Za-z]+/g;

/**
 * The locale's long date pattern without the fields in `drop`, and the
 * literal text that follows each of them. Angular has no month-and-year
 * format, and a fixed `LLLL y` reads `11月 2026` in Japanese, so this takes
 * the locale's own order instead: without the day, `MMMM d, y` is `MMMM y`,
 * `y年M月d日` is `y年M月` and `d 'de' MMMM 'de' y` is `MMMM 'de' y`. The
 * month becomes its standalone form (`L`), the one a month takes without a
 * day: languages such as Russian and Polish write a month differently
 * before a day.
 */
const patternWithout = (locale: string, drop: string): string => {
  let pattern = '';
  let dropping = false;
  const long = getLocaleDateFormat(locale, FormatWidth.Long);
  for (const [piece, field] of long.matchAll(PATTERN_PIECE)) {
    if (field) dropping = drop.includes(field);
    if (!dropping) pattern += field === 'M' ? 'L'.repeat(piece.length) : piece;
  }
  return pattern.replace(/^[\s,]+|[\s,]+$/g, '');
};

/**
 * Local midnight of a calendar day. A month or day past its range rolls
 * over, as with `Date`: day 0 is the last day of the month before.
 * `setFullYear` rather than `new Date(year, month, day)`, which reads a year
 * below 100 as one in the 1900s.
 */
const dayOf = (year: number, month: number, day: number): Date => {
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, month, day);
  return date;
};

/**
 * The calendar day a date falls on, at local midnight.
 */
const startOfDay = (date: Date): Date =>
  dayOf(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * A date's month counted from January of year 0, so stepping through
 * months, and across years, is adding to one number.
 */
const monthIndex = (date: Date): number =>
  date.getFullYear() * 12 + date.getMonth();

/**
 * The first day of a month, given its monthIndex.
 */
const firstDayOf = (index: number): Date =>
  dayOf(Math.floor(index / 12), index % 12, 1);

/**
 * The classes of a cell's round mark and its text: filled while selected,
 * ringed when it's today (or this month, or this year), and faded while it
 * can't be picked. The ring rather than a color alone marks today, since the
 * default theme's primary color is almost its foreground.
 */
const cellClasses = (
  width: string,
  selected: boolean,
  current: boolean,
  disabled: boolean,
): Pick<CalendarCell, 'markClass' | 'textClass'> => ({
  markClass: cn(
    'h-[40px] items-center rounded-full flex justify-center',
    width,
    selected ? 'bg-primary' : current && 'border border-primary',
    disabled && 'opacity-40',
  ),
  textClass: cn(
    'text-[16px]',
    selected
      ? 'font-semibold text-primary-foreground'
      : current
        ? 'font-semibold text-primary'
        : 'text-foreground',
  ),
});

/**
 * Splits cells into rows of `size`.
 */
const rowsOf = <T>(cells: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(cells.length / size) }, (_, row) =>
    cells.slice(row * size, row * size + size),
  );

/**
 * A month calendar for picking a day, laid out as iOS's inline date picker
 * and Material 3's date picker are: the month's title with previous and next
 * buttons, the weekdays, then the days.
 *
 * Tapping the title steps out to the year's months, and again to a list of
 * years, so a day decades away (a birthday) takes a few taps rather than
 * dozens: title, title, the year, the month, the day. Tapping a month the
 * same year away is two. The arrows page through whatever the view shows:
 * months among the days, years among the months. The years list scrolls,
 * and opens at the year being shown.
 *
 * Every word comes from the app's `LOCALE_ID` through Angular's locale data
 * (`formatDate`), which needs no `Intl`: Lynx has none where Angular runs.
 *
 * The host is the calendar's column, and takes the app's class: Angular gives
 * a component's host every static attribute the app writes on it.
 */
@Component({
  selector: 'ui-calendar',
  imports: [LYNX_ELEMENTS, UiButton, UiIcon],
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'hostClass()' },
  template: `
    <view class="h-[48px] flex-row items-center flex justify-between">
      <!-- The title is one button: VoiceOver reads its label, not the
           chevron beside it. It stays the same element from view to view, so
           a screen reader's focus stays on it as the view changes. -->
      <view
        class="h-[44px] flex-row items-center gap-1 rounded-md px-2 flex"
        accessibility-element="true"
        accessibility-traits="button"
        [accessibility-label]="title()"
        (bindtap)="stepOut()"
      >
        <text class="text-[16px] font-semibold text-foreground">{{
          title()
        }}</text>
        <ui-icon [name]="titleIcon()" size="xs" />
      </view>
      @if (view() !== 'years') {
        <view class="flex-row flex">
          <ui-button
            variant="ghost"
            size="icon"
            class="h-[40px] w-[40px]"
            [accessibility-label]="previousLabel()"
            [disabled]="!canGoBack()"
            [lynxAccessibilityTraits]="{ disabled: !canGoBack() }"
            (pressed)="page(-1)"
          >
            <ui-icon name="chevron-left" size="sm" />
          </ui-button>
          <ui-button
            variant="ghost"
            size="icon"
            class="h-[40px] w-[40px]"
            [accessibility-label]="nextLabel()"
            [disabled]="!canGoForward()"
            [lynxAccessibilityTraits]="{ disabled: !canGoForward() }"
            (pressed)="page(1)"
          >
            <ui-icon name="chevron-right" size="sm" />
          </ui-button>
        </view>
      }
    </view>
    @switch (view()) {
      @case ('days') {
        <view class="h-[296px] flex-col flex">
          <!-- Hidden from screen readers: each day says its weekday. -->
          <view
            class="h-[32px] flex-row items-center flex"
            accessibility-elements-hidden="true"
          >
            @for (name of weekdays(); track $index) {
              <text
                class="flex-1 text-[13px] font-medium text-muted-foreground text-center"
                >{{ name }}</text
              >
            }
          </view>
          <!-- Seven columns of equal width, each cell flex-1: Lynx has no
               grid layout or positional selectors. A day outside the month
               is an empty cell that holds its column. -->
          @for (week of weeks(); track $index) {
            <view class="h-[44px] flex-row flex">
              @for (day of week; track $index) {
                @if (day) {
                  <view
                    class="flex-1 items-center flex justify-center"
                    accessibility-element="true"
                    accessibility-traits="button"
                    [accessibility-label]="day.label"
                    [lynxAccessibilityTraits]="{
                      selected: day.selected,
                      disabled: day.disabled,
                    }"
                    (bindtap)="pickDay(day)"
                  >
                    <view [class]="day.markClass">
                      <text [class]="day.textClass">{{ day.text }}</text>
                    </view>
                  </view>
                } @else {
                  <view class="flex-1"></view>
                }
              }
            </view>
          }
        </view>
      }
      @case ('months') {
        <view class="h-[296px] flex-col flex">
          @for (row of monthRows(); track $index) {
            <view class="flex-1 flex-row flex">
              @for (month of row; track month.value) {
                <view
                  class="flex-1 items-center flex justify-center"
                  accessibility-element="true"
                  accessibility-traits="button"
                  [accessibility-label]="month.label"
                  [lynxAccessibilityTraits]="{
                    selected: month.selected,
                    disabled: month.disabled,
                  }"
                  (bindtap)="pickMonth(month)"
                >
                  <view [class]="month.markClass">
                    <text [class]="month.textClass">{{ month.text }}</text>
                  </view>
                </view>
              }
            </view>
          }
        </view>
      }
      @default {
        <!-- Created each time the years show, so it opens scrolled to the
             year being shown: initial-scroll-offset applies only once. -->
        <scroll-view
          scroll-orientation="vertical"
          class="h-[296px]"
          [initial-scroll-offset]="yearsOffset()"
        >
          @for (row of yearRows(); track $index) {
            <view class="h-[52px] flex-row flex">
              @for (year of row; track $index) {
                @if (year) {
                  <view
                    class="flex-1 items-center flex justify-center"
                    accessibility-element="true"
                    accessibility-traits="button"
                    [accessibility-label]="year.label"
                    [lynxAccessibilityTraits]="{ selected: year.selected }"
                    (bindtap)="pickYear(year)"
                  >
                    <view [class]="year.markClass">
                      <text [class]="year.textClass">{{ year.text }}</text>
                    </view>
                  </view>
                } @else {
                  <view class="flex-1"></view>
                }
              }
            </view>
          }
        </scroll-view>
      }
    }
  `,
})
export class UiCalendar {
  /** The chosen day, at local midnight, or null while none is. */
  readonly value = model<Date | null>(null);
  /** The first day that can be picked. Earlier days show faded. */
  readonly min = input<Date | null>(null);
  /** The last day that can be picked. Later days show faded. */
  readonly max = input<Date | null>(null);
  /**
   * The weekday in the first column (0 is Sunday). Without one, the
   * locale's: Sunday in `en-US`, Monday in most of Europe.
   */
  readonly weekStartsOn = input<Weekday | undefined>(undefined);
  /** What a screen reader says for the arrow to the month before. */
  readonly previousMonthLabel = input('Previous month');
  /** What a screen reader says for the arrow to the month after. */
  readonly nextMonthLabel = input('Next month');
  /** What a screen reader says for the arrow to the year before, among the months. */
  readonly previousYearLabel = input('Previous year');
  /** What a screen reader says for the arrow to the year after, among the months. */
  readonly nextYearLabel = input('Next year');
  readonly userClass = input<string>('', { alias: 'class' });

  /** Emits the day the user tapped. */
  readonly changed = output<Date>();

  readonly #locale = inject(LOCALE_ID);
  /** Today, which the calendar marks. Read once, as the calendar is created. */
  readonly #today = startOfDay(new Date());
  /** The locale's month-and-year pattern, such as `LLLL y` (see patternWithout). */
  readonly #monthYearPattern = patternWithout(this.#locale, 'dE');
  /** The locale's year pattern: `y`, or `y年` in Japanese. */
  readonly #yearPattern = patternWithout(this.#locale, 'dEM');

  protected readonly view = signal<CalendarView>('days');

  /** The first month that holds a day that can be picked (see monthIndex). */
  readonly #firstMonth = computed(() => {
    const min = this.min();
    return min ? monthIndex(min) : -Infinity;
  });

  /** The last month that holds a day that can be picked. */
  readonly #lastMonth = computed(() => {
    const max = this.max();
    return max ? monthIndex(max) : Infinity;
  });

  readonly #minTime = computed(() => {
    const min = this.min();
    return min ? startOfDay(min).getTime() : -Infinity;
  });

  readonly #maxTime = computed(() => {
    const max = this.max();
    return max ? startOfDay(max).getTime() : Infinity;
  });

  /**
   * The month shown (see monthIndex): the chosen day's, else today's, kept
   * between min and max. It follows a new value, or a new min or max, and
   * the arrows and the month and year lists move it in between.
   */
  protected readonly shownMonth = linkedSignal(() =>
    this.#clamp(monthIndex(this.value() ?? this.#today)),
  );

  readonly #weekStart = computed(
    () => this.weekStartsOn() ?? getLocaleFirstDayOfWeek(this.#locale),
  );

  /** How many months an arrow moves: one among the days, a year among the months. */
  readonly #step = computed(() => (this.view() === 'days' ? 1 : 12));

  protected readonly title = computed(() =>
    this.#format(
      firstDayOf(this.shownMonth()),
      this.view() === 'days' ? this.#monthYearPattern : this.#yearPattern,
    ),
  );

  /** Down while the title steps out; up in the years list, which it closes. */
  protected readonly titleIcon = computed(() =>
    this.view() === 'years' ? 'chevron-up' : 'chevron-down',
  );

  protected readonly previousLabel = computed(() =>
    this.view() === 'days'
      ? this.previousMonthLabel()
      : this.previousYearLabel(),
  );

  protected readonly nextLabel = computed(() =>
    this.view() === 'days' ? this.nextMonthLabel() : this.nextYearLabel(),
  );

  /**
   * Whether the arrow back leads anywhere: to a month that holds a day
   * after min, or among the months, to a year that does.
   */
  protected readonly canGoBack = computed(() => {
    const step = this.#step();
    return (
      Math.floor((this.shownMonth() - step) / step) >=
      Math.floor(this.#firstMonth() / step)
    );
  });

  protected readonly canGoForward = computed(() => {
    const step = this.#step();
    return (
      Math.floor((this.shownMonth() + step) / step) <=
      Math.floor(this.#lastMonth() / step)
    );
  });

  /** The weekdays' narrow names, from the first column on. */
  protected readonly weekdays = computed(() => {
    const start = this.#weekStart();
    // 1 January 2023 was a Sunday, so its week names each weekday in order.
    return Array.from({ length: 7 }, (_, column) =>
      this.#format(dayOf(2023, 0, 1 + ((start + column) % 7)), 'EEEEE'),
    );
  });

  /** The shown month's days, a week to a row, with null where it has none. */
  protected readonly weeks = computed(() => {
    const shown = this.shownMonth();
    const year = Math.floor(shown / 12);
    const month = shown % 12;
    const lead = (dayOf(year, month, 1).getDay() - this.#weekStart() + 7) % 7;
    const length = dayOf(year, month + 1, 0).getDate();
    const value = this.value();
    const selected = value ? startOfDay(value).getTime() : NaN;
    const today = this.#today.getTime();
    const min = this.#minTime();
    const max = this.#maxTime();
    const days = Array.from(
      { length: WEEKS * 7 },
      (_, cell): DayCell | null => {
        const day = cell - lead + 1;
        if (day < 1 || day > length) return null;
        const date = dayOf(year, month, day);
        const time = date.getTime();
        const disabled = time < min || time > max;
        return {
          value: time,
          date,
          text: this.#format(date, 'd'),
          label: this.#format(date, 'fullDate'),
          selected: time === selected,
          disabled,
          ...cellClasses(
            'w-[40px]',
            time === selected,
            time === today,
            disabled,
          ),
        };
      },
    );
    return rowsOf(days, 7);
  });

  /** The shown year's months, three to a row. */
  protected readonly monthRows = computed(() => {
    const shown = this.shownMonth();
    const year = Math.floor(shown / 12);
    const current = monthIndex(this.#today);
    const first = this.#firstMonth();
    const last = this.#lastMonth();
    const months = Array.from({ length: 12 }, (_, month): CalendarCell => {
      const index = year * 12 + month;
      const date = dayOf(year, month, 1);
      const disabled = index < first || index > last;
      return {
        value: index,
        text: this.#format(date, 'LLL'),
        label: this.#format(date, this.#monthYearPattern),
        selected: index === shown,
        disabled,
        ...cellClasses(
          'w-[88px]',
          index === shown,
          index === current,
          disabled,
        ),
      };
    });
    return rowsOf(months, 3);
  });

  /**
   * The years the list offers: from min's to max's, or a century either
   * side of today (and always the year shown).
   */
  readonly #yearRange = computed(() => {
    const shown = Math.floor(this.shownMonth() / 12);
    const thisYear = this.#today.getFullYear();
    const min = this.min();
    const max = this.max();
    return {
      first: min ? min.getFullYear() : Math.min(thisYear - YEAR_SPAN, shown),
      last: max ? max.getFullYear() : Math.max(thisYear + YEAR_SPAN, shown),
    };
  });

  /**
   * The years, a row at a time, the last row filled out with nulls so each
   * year keeps its column.
   */
  protected readonly yearRows = computed(() => {
    const shown = Math.floor(this.shownMonth() / 12);
    const thisYear = this.#today.getFullYear();
    const { first, last } = this.#yearRange();
    const count = last - first + 1;
    const cells = Array.from(
      { length: Math.ceil(count / YEARS_PER_ROW) * YEARS_PER_ROW },
      (_, offset): CalendarCell | null => {
        if (offset >= count) return null;
        const year = first + offset;
        const date = dayOf(year, 0, 1);
        return {
          value: year,
          text: this.#format(date, 'y'),
          label: this.#format(date, this.#yearPattern),
          selected: year === shown,
          disabled: false,
          ...cellClasses('w-[88px]', year === shown, year === thisYear, false),
        };
      },
    );
    return rowsOf(cells, YEARS_PER_ROW);
  });

  /** How far the years list starts scrolled: the shown year's row, centered. */
  protected readonly yearsOffset = computed(() => {
    const row = Math.floor(
      (Math.floor(this.shownMonth() / 12) - this.#yearRange().first) /
        YEARS_PER_ROW,
    );
    return Math.max(
      0,
      row * YEAR_ROW_HEIGHT - (BODY_HEIGHT - YEAR_ROW_HEIGHT) / 2,
    );
  });

  protected readonly hostClass = computed(() =>
    cn('flex-col flex', this.userClass()),
  );

  protected stepOut(): void {
    this.view.update((view) => STEP_OUT[view]);
  }

  /**
   * Moves the view a page back (-1) or on (1); see #step.
   */
  protected page(direction: -1 | 1): void {
    this.shownMonth.update((shown) =>
      this.#clamp(shown + direction * this.#step()),
    );
  }

  protected pickDay(day: DayCell): void {
    if (day.disabled) return;
    this.value.set(day.date);
    this.changed.emit(day.date);
  }

  protected pickMonth(month: CalendarCell): void {
    if (month.disabled) return;
    this.shownMonth.set(month.value);
    this.view.set('days');
  }

  /**
   * Shows the year's months, at the month shown before where it can.
   */
  protected pickYear(year: CalendarCell): void {
    this.shownMonth.update((shown) =>
      this.#clamp(year.value * 12 + (shown % 12)),
    );
    this.view.set('months');
  }

  /**
   * Keeps a monthIndex between the months of min and max.
   */
  #clamp(index: number): number {
    return Math.min(Math.max(index, this.#firstMonth()), this.#lastMonth());
  }

  #format(date: Date, pattern: string): string {
    return formatDate(date, pattern, this.#locale);
  }
}
