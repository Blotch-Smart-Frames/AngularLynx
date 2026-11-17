import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { EVENTS } from './event-data';

@Component({
  selector: 'app-event-detail',
  imports: [LYNX_ELEMENTS, RouterLink],
  template: `
    <scroll-view class="h-full" scroll-orientation="vertical">
      <view
        class="px-6 pb-6"
        style="padding-top: calc(24px + env(safe-area-inset-top));"
      >
        @if (event(); as event) {
          <view
            class="mb-4 h-[140px] flex-col rounded-xl p-4 flex justify-end"
            [style.background-color]="event.color"
          >
            <text class="text-[28px] font-bold text-white">
              {{ event.title }}
            </text>
            <text class="text-[13px] text-white">{{ event.venue }}</text>
          </view>
        } @else {
          <text class="mb-4 text-[28px] font-bold text-zinc-900">
            No event called {{ id() }}
          </text>
        }

        <text class="mb-5 text-[15px] text-zinc-700">
          {{ seat() ? 'Your seat: ' + seat() : 'No seat chosen yet' }}
        </text>

        <view
          class="items-center rounded-xl border border-zinc-200 bg-white p-4 flex"
          routerLink="/"
        >
          <text class="text-[15px] font-semibold text-zinc-900">
            All events
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class EventDetail {
  /** The link's path segment, such as jazz-night. */
  readonly id = input.required<string>();
  /** The link's ?seat=, if it has one. */
  readonly seat = input<string>();

  readonly event = computed(() =>
    EVENTS.find((event) => event.id === this.id()),
  );
}
