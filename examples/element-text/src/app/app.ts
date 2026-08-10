import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Text Element
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Rendering text with inline styles and truncation.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Inline Formatting
          </text>
          <text class="text-[15px] leading-[22px] text-zinc-900">
            Regular text with
            <text class="font-bold"> bold </text>
            and
            <text class="text-red-500"> colored </text>
            inline content.
          </text>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Truncation
          </text>
          <text class="text-sm leading-5 text-zinc-500" [text-maxline]="2">
            This is a long paragraph that demonstrates text truncation with
            text-maxline. When the text exceeds two lines, it will be truncated
            with an ellipsis at the end of the second line.
          </text>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {}
