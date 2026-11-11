import { formatDate } from '@angular/common';
import {
  Component,
  LOCALE_ID,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '@blotch/dolan/utils/cn';
import { UiBottomSheet } from '../bottom-sheet/bottom-sheet';
import { UiButton } from '../button/button';
import { type Weekday, UiCalendar } from '../calendar/calendar';
import { UiIcon } from '../icon/icon';

/**
 * A field that shows a day and opens a bottom sheet with a calendar to pick
 * another, as ui-select opens one with its options.
 *
 * The host is the field's column, its label above the field, as ui-select's
 * is, and takes the app's class: Angular gives a component's host every
 * static attribute the app writes on it, so a class passed on to an element
 * inside as well would apply twice. The placeholder is shown in a text and
 * the accessibility label belongs to the trigger, so the host drops its
 * copies of both: an element with the attribute is a second match for
 * getByPlaceholderText or getByLabelText.
 */
@Component({
  selector: 'ui-date-picker',
  imports: [LYNX_ELEMENTS, UiBottomSheet, UiButton, UiCalendar, UiIcon],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'hostClass()',
    '[attr.placeholder]': 'null',
    '[attr.accessibility-label]': 'null',
  },
  template: `
    <!-- The trigger carries the label as its accessibility-label, so screen
         readers read it with the field. Hidden here, or VoiceOver and
         TalkBack would stop on it a second time. -->
    @if (label()) {
      <text
        class="text-sm font-medium text-foreground"
        accessibility-elements-hidden="true"
        >{{ label() }}</text
      >
    }
    <view [class]="fieldClass()">
      <!-- One accessibility element, a button, as ui-select's trigger: named
           by the label, with the day it shows as its value, so VoiceOver
           says "Ends on, Nov 20, 2026, button". The sheet sits beside it
           rather than inside, so a tap in the sheet doesn't reach it. -->
      <view
        class="flex-1 flex-row items-center gap-2 px-3 py-2 flex justify-between"
        accessibility-element="true"
        accessibility-traits="button"
        [accessibility-label]="triggerLabel()"
        [accessibility-value]="triggerValue()"
        [lynxAccessibilityTraits]="{ disabled: disabled() }"
        (bindtap)="toggle()"
      >
        <text [class]="valueTextClass()">{{ displayText() }}</text>
        <ui-icon name="calendar" size="xs" color="var(--muted-foreground)" />
      </view>
      <!-- The calendar is made as the sheet opens and dropped once it has
           closed, so each opening starts at the chosen day's month, among
           the days, wherever it was left. -->
      <ui-bottom-sheet
        [open]="sheetOpen()"
        (openChange)="sheetOpen.set($event)"
        (closed)="calendarShown.set(false)"
      >
        @if (calendarShown()) {
          <view class="flex-col gap-2 px-4 pb-4 flex">
            <ui-calendar
              [value]="value()"
              [min]="min()"
              [max]="max()"
              [weekStartsOn]="weekStartsOn()"
              [previousMonthLabel]="previousMonthLabel()"
              [nextMonthLabel]="nextMonthLabel()"
              [previousYearLabel]="previousYearLabel()"
              [nextYearLabel]="nextYearLabel()"
              (changed)="pick($event)"
            />
            @if (clearable() && value()) {
              <ui-button
                variant="ghost"
                class="w-full"
                (pressed)="pick(null)"
                >{{ clearLabel() }}</ui-button
              >
            }
          </view>
        }
      </ui-bottom-sheet>
    </view>
  `,
})
export class UiDatePicker {
  /** The chosen day, or null while none is. Supports `[(value)]`. */
  readonly value = model<Date | null>(null);
  /**
   * The field's name, shown above it and read by screen readers as the
   * trigger's label.
   */
  readonly label = input<string>('');
  /** Shown in the field while no day is chosen. */
  readonly placeholder = input('Select date');
  /**
   * What a screen reader calls the field when it's shown without a label,
   * such as beside a label of the app's own. `label` wins when both are set.
   */
  readonly accessibilityLabel = input<string>('', {
    alias: 'accessibility-label',
  });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });
  /** The first day that can be picked. */
  readonly min = input<Date | null>(null);
  /** The last day that can be picked. */
  readonly max = input<Date | null>(null);
  /** The weekday in the calendar's first column; the locale's without one. */
  readonly weekStartsOn = input<Weekday | undefined>(undefined);
  /**
   * How the field writes the day: an Angular date format (`'mediumDate'`,
   * `'fullDate'`, `'d MMM'`…), in the app's `LOCALE_ID`.
   */
  readonly format = input('mediumDate');
  readonly previousMonthLabel = input('Previous month');
  readonly nextMonthLabel = input('Next month');
  readonly previousYearLabel = input('Previous year');
  readonly nextYearLabel = input('Next year');
  /** Offers a button in the sheet that clears the day, while one is chosen. */
  readonly clearable = input(false, { transform: booleanAttribute });
  readonly clearLabel = input('Clear');

  /** Emits the day the user picked, or null when they cleared it. */
  readonly changed = output<Date | null>();

  readonly #locale = inject(LOCALE_ID);

  // Drives the bottom sheet's `open` model. Bound both ways by hand rather
  // than with `[(open)]`: for a two-way binding Angular also compiles a
  // fallback that assigns the field, which never runs for a signal and so
  // shows as an uncovered branch in an app's coverage report.
  protected readonly sheetOpen = signal(false);

  /** Whether the sheet holds its calendar: from opening until it has closed. */
  protected readonly calendarShown = signal(false);

  protected readonly displayText = computed(() => {
    const value = this.value();
    return value
      ? formatDate(value, this.format(), this.#locale)
      : this.placeholder();
  });

  /**
   * The field's name for screen readers: the label, the accessibility label,
   * or, with neither, the text the field shows, so the button still says
   * what it holds.
   */
  protected readonly triggerLabel = computed(
    () => this.label() || this.accessibilityLabel() || this.displayText(),
  );

  /**
   * What the field shows, read after its name. Left out when the name is
   * that text already, or a screen reader would say it twice.
   */
  protected readonly triggerValue = computed(() =>
    this.label() || this.accessibilityLabel() ? this.displayText() : null,
  );

  protected readonly hostClass = computed(() =>
    cn('flex-col gap-1.5 flex', this.userClass()),
  );

  protected readonly fieldClass = computed(() =>
    cn(
      'h-10 flex-row rounded-md border border-input bg-background flex',
      this.disabled() && 'opacity-50',
    ),
  );

  protected readonly valueTextClass = computed(() =>
    cn(
      'flex-1 text-sm',
      this.value() ? 'text-foreground' : 'text-muted-foreground',
    ),
  );

  /**
   * Opens the sheet, or closes it while it's open.
   */
  toggle(): void {
    if (this.sheetOpen()) this.close();
    else this.open();
  }

  /**
   * Opens the sheet, unless the field is disabled.
   */
  open(): void {
    if (this.disabled()) return;
    this.calendarShown.set(true);
    this.sheetOpen.set(true);
  }

  /**
   * Closes the sheet without changing the day.
   */
  close(): void {
    this.sheetOpen.set(false);
  }

  /**
   * Sets the day (null clears it), tells the app, and closes the sheet.
   */
  protected pick(day: Date | null): void {
    this.value.set(day);
    this.changed.emit(day);
    this.close();
  }
}
