import { DatePipe } from '@angular/common';
import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiDatePicker } from '../components/ui/date-picker';

/**
 * Today, at midnight.
 */
const today = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

/**
 * A day a number of days from today.
 */
const daysFromToday = (days: number): Date => {
  const day = today();
  day.setDate(day.getDate() + days);
  return day;
};

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiDatePicker, DatePipe],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <view class="flex-col gap-1 flex">
          <text class="text-2xl font-bold text-foreground">Date Picker</text>
          <text class="text-sm text-muted-foreground">
            A field that opens a calendar in a bottom sheet to pick a day.
          </text>
        </view>

        <!-- A day that can be cleared -->
        <ui-date-picker
          label="Ends on"
          placeholder="Pick a day"
          clearable
          [(value)]="endsOn"
          (changed)="lastChange.set($event)"
        />

        <!-- Only the next two weeks -->
        <ui-date-picker
          label="Delivery"
          placeholder="In the next two weeks"
          format="EEEE d MMMM"
          [min]="tomorrow"
          [max]="inTwoWeeks"
          [(value)]="delivery"
        />

        <!-- A birthday decades back: tap the sheet's title to choose the
             month, and again for the year -->
        <ui-date-picker
          label="Birthday"
          format="longDate"
          [max]="today"
          [(value)]="birthday"
        />

        <ui-date-picker label="Signed on" [value]="signedOn" disabled />

        <view
          class="flex-col gap-1 rounded-md border border-border bg-muted p-4 flex"
        >
          <text class="mb-1 text-sm font-medium text-foreground">Values</text>
          <text class="text-xs text-muted-foreground">
            Ends on: {{ endsOn() ? (endsOn() | date: 'fullDate') : 'none' }}
          </text>
          <text class="text-xs text-muted-foreground">
            Delivery:
            {{ delivery() ? (delivery() | date: 'fullDate') : 'none' }}
          </text>
          <text class="text-xs text-muted-foreground">
            Birthday: {{ birthday() | date: 'fullDate' }}
          </text>
          <text class="text-xs text-muted-foreground">
            Last change:
            {{
              lastChange() === undefined
                ? 'none yet'
                : lastChange()
                  ? (lastChange() | date: 'mediumDate')
                  : 'cleared'
            }}
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  protected readonly today = today();
  protected readonly tomorrow = daysFromToday(1);
  protected readonly inTwoWeeks = daysFromToday(14);
  protected readonly signedOn = new Date(2024, 0, 15);

  protected readonly endsOn = signal<Date | null>(daysFromToday(30));
  protected readonly delivery = signal<Date | null>(null);
  protected readonly birthday = signal<Date | null>(new Date(1990, 2, 14));
  protected readonly lastChange = signal<Date | null | undefined>(undefined);
}
