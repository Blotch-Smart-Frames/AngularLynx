import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="items-center p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">Home Page</text>
        <text class="mb-6 text-[13px] text-zinc-500 text-center">
          This page is the "home" project in angular.json.
        </text>

        <view
          class="mb-5 items-center rounded-2xl border border-zinc-200 bg-white px-10 py-6"
        >
          <text class="text-[48px] font-bold text-indigo-500">{{
            count()
          }}</text>
          <text class="uppercase mt-1 text-[13px] tracking-[1px] text-zinc-400">
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
