import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="min-h-full items-center p-6 justify-center">
        <view class="mb-8 items-center">
          <text
            class="uppercase mb-4 rounded-[20px] bg-indigo-50 px-3 py-1 text-[11px] font-bold tracking-[0.5px] text-indigo-500"
          >
            AngularLynx
          </text>
          <text class="mb-1.5 text-[32px] font-bold text-zinc-900">
            Hello, Lynx!
          </text>
          <text class="text-[15px] text-zinc-500 text-center">
            Tap the button to see signals in action.
          </text>
        </view>

        <view
          class="mb-6 items-center rounded-2xl border border-zinc-200 bg-white px-12 py-8"
        >
          <text class="text-[64px] font-bold text-indigo-500">{{
            count()
          }}</text>
          <text class="uppercase mt-1 text-sm tracking-[1px] text-zinc-400">
            taps
          </text>
        </view>

        <view
          class="items-center rounded-[10px] bg-indigo-500 px-8 py-3.5"
          (bindtap)="increment()"
        >
          <text class="text-base font-semibold text-white">
            Tap to increment
          </text>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly count = signal(0);

  increment(): void {
    this.count.update((n) => n + 1);
  }
}
