import { DatePipe } from '@angular/common';
import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiCalendar } from '../components/ui/calendar';

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
  imports: [LYNX_ELEMENTS, UiCalendar, DatePipe],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-8 p-6 flex">
        <view class="flex-col gap-1 flex">
          <text class="text-2xl font-bold text-foreground">Calendar</text>
          <text class="text-sm text-muted-foreground">
            A month of days to pick one from. Tap the title to choose the month,
            and again to choose the year.
          </text>
        </view>

        <!-- The platform's own look: iOS's inline date picker on iOS (and
             in the web preview), Material 3's date picker on Android -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            The platform's look
          </text>
          <ui-calendar variant="glass" [(value)]="native" />
        </view>

        <!-- Pick any day -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Any day</text>
          <ui-calendar [(value)]="day" />
          <text class="text-xs text-muted-foreground">
            Chosen: {{ day() ? (day() | date: 'fullDate') : 'none' }}
          </text>
        </view>

        <!-- Only the next two weeks -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Delivery in the next two weeks
          </text>
          <ui-calendar
            [(value)]="delivery"
            [min]="tomorrow"
            [max]="inTwoWeeks"
          />
          <text class="text-xs text-muted-foreground">
            Delivery:
            {{ delivery() ? (delivery() | date: 'mediumDate') : 'none' }}
          </text>
        </view>

        <!-- A birthday decades back, weeks starting on Monday -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Birthday, weeks from Monday
          </text>
          <ui-calendar [(value)]="birthday" [max]="today" [weekStartsOn]="1" />
          <text class="text-xs text-muted-foreground">
            Born: {{ birthday() | date: 'longDate' }}
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

  protected readonly day = signal<Date | null>(null);
  protected readonly native = signal<Date | null>(null);
  protected readonly delivery = signal<Date | null>(null);
  protected readonly birthday = signal<Date | null>(new Date(1990, 2, 14));
}
