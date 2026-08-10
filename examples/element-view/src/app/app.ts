import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          View Element
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          The basic building block for layout with flexbox support.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Card Layout
          </text>
          <view class="rounded-[10px] bg-zinc-100 p-4">
            <view class="flex-row items-center">
              <view
                class="h-10 w-10 items-center rounded-[20px] bg-indigo-500 justify-center"
              >
                <text class="text-base font-bold text-white">A</text>
              </view>
              <view class="ml-3 flex-1">
                <text class="mb-1 text-base font-semibold text-zinc-900">
                  Card Title
                </text>
                <text class="text-[13px] leading-[18px] text-zinc-500">
                  Views are the basic building block for layout. They support
                  flexbox properties for arranging children.
                </text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {}
