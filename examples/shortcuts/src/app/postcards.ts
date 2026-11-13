import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LYNX_ELEMENTS, LynxShortcuts } from '@blotch/angular-lynx';

const PLACES = ['Lisbon', 'Kyoto', 'Oaxaca', 'Bergen', 'Hobart', 'Tbilisi'];

@Component({
  selector: 'app-postcards',
  imports: [LYNX_ELEMENTS, RouterLink],
  template: `
    <scroll-view class="h-full" scroll-orientation="vertical">
      <!-- Apps draw under the status bar, so the page starts below it. -->
      <view
        class="px-6 pb-6"
        style="padding-top: calc(24px + env(safe-area-inset-top));"
      >
        <text class="mb-1 text-[28px] font-bold text-zinc-900">Postcards</text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Ask Siri to "Refresh Postcards" or "Show stamps in Postcards". On
          Android, hold the app's icon.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text class="text-[13px] text-zinc-500">Last refreshed</text>
          <text class="mt-1 text-[17px] font-semibold text-zinc-900">
            {{ refreshedBy() }}
          </text>
          <text class="mt-1 text-[13px] text-zinc-500">
            {{ refreshes() }} {{ refreshes() === 1 ? 'time' : 'times' }} so far
          </text>
        </view>

        @for (place of places(); track place) {
          <view class="mb-3 rounded-xl border border-zinc-200 bg-white p-4">
            <text class="text-[15px] font-semibold text-zinc-900">
              {{ place }}
            </text>
            <text class="mt-1 text-[13px] text-zinc-500"
              >Wish you were here</text
            >
          </view>
        }

        <view
          class="mb-3 mt-2 items-center rounded-xl bg-zinc-900 p-4 flex"
          (bindtap)="refresh('a tap')"
        >
          <text class="text-[15px] font-semibold text-white">Refresh</text>
        </view>
        <view
          class="items-center rounded-xl border border-zinc-200 bg-white p-4 flex"
          routerLink="/stamps"
        >
          <text class="text-[15px] font-semibold text-zinc-900">
            Show stamps
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class Postcards {
  readonly places = signal(PLACES);
  readonly refreshes = signal(0);
  readonly refreshedBy = signal('Not yet');

  constructor() {
    // "refresh" is the shortcut's id in angular.json. The handler goes with
    // this screen: on another screen, the shortcut waits for it.
    inject(LynxShortcuts).on('refresh', () => this.refresh('the shortcut'));
  }

  /**
   * Stands in for loading the postcards again: it deals them in a new order.
   */
  refresh(by: string): void {
    this.places.update((places) => [...places.slice(1), places[0]!]);
    this.refreshes.update((count) => count + 1);
    this.refreshedBy.set(`By ${by}`);
  }
}
