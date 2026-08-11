import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Scroll View
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          A scrollable container for overflowing content.
        </text>

        <view
          class="rounded-xl border border-zinc-200 bg-white p-4 overflow-hidden"
        >
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Scrollable List
          </text>
          <scroll-view
            scroll-orientation="vertical"
            class="h-[300px] rounded-lg border border-zinc-200"
          >
            @for (item of items(); track item) {
              <view class="border-b border-zinc-200 px-4 py-3.5">
                <text class="text-[15px] text-zinc-900">Item {{ item }}</text>
              </view>
            }
          </scroll-view>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly items = signal(Array.from({ length: 20 }, (_, i) => i + 1));
}
