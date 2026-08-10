import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Image Element
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Display images with different scaling modes.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            aspectFit (default)
          </text>
          <view class="items-center rounded-lg bg-zinc-100 p-4">
            <image
              src="https://angular.dev/assets/images/press-kit/angular_icon_gradient.gif"
              mode="aspectFit"
              class="h-[120px] w-[120px]"
            />
          </view>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            aspectFill
          </text>
          <view class="items-center rounded-lg bg-zinc-100 p-4">
            <image
              src="https://angular.dev/assets/images/press-kit/angular_icon_gradient.gif"
              mode="aspectFill"
              class="h-[80px] w-[120px]"
            />
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {}
