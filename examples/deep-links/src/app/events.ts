import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LYNX_ELEMENTS, LynxLinking } from '@blotch/angular-lynx';
import { EVENTS } from './event-data';

/** A link to this app, which it opens itself to show what a link does. */
const SAMPLE_LINK = 'tickets://events/film-club?seat=C7';

@Component({
  selector: 'app-events',
  imports: [LYNX_ELEMENTS, RouterLink],
  template: `
    <scroll-view class="h-full" scroll-orientation="vertical">
      <view
        class="px-6 pb-6"
        style="padding-top: calc(24px + env(safe-area-inset-top));"
      >
        <text class="mb-1 text-[28px] font-bold text-zinc-900">Tickets</text>
        <text class="mb-5 text-[13px] text-zinc-500">
          A link such as tickets://events/jazz-night opens the app on that
          event, whether it's running or not.
        </text>

        @for (event of events; track event.id) {
          <view
            class="mb-3 flex-row items-center rounded-xl border border-zinc-200 bg-white p-4 flex"
            [routerLink]="['/events', event.id]"
          >
            <view
              class="mr-3 h-[40px] w-[40px] rounded-lg"
              [style.background-color]="event.color"
            ></view>
            <view>
              <text class="text-[15px] font-semibold text-zinc-900">
                {{ event.title }}
              </text>
              <text class="mt-1 text-[13px] text-zinc-500">
                {{ event.venue }}
              </text>
            </view>
          </view>
        }

        <view
          class="mt-2 rounded-xl border border-zinc-200 bg-white p-4"
          (bindtap)="openSample()"
        >
          <text class="text-[15px] font-semibold text-zinc-900">
            Follow a link to Film Club
          </text>
          <text class="mt-1 text-[13px] text-zinc-500">
            {{ status() || sampleLink }}
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class Events {
  readonly #linking = inject(LynxLinking);

  protected readonly events = EVENTS;
  protected readonly sampleLink = SAMPLE_LINK;
  readonly status = signal('');

  /**
   * Hands the link to the system, which opens the app that claims its
   * scheme: this one. It arrives as any other link does.
   */
  openSample(): void {
    this.#linking
      .openURL(SAMPLE_LINK)
      .catch((error: Error) => this.status.set(error.message));
  }
}
