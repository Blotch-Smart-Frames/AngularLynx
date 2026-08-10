import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          SVG Element
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Render SVG content via the content attribute.
        </text>

        <view class="rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Circle
          </text>
          <view class="mb-3 items-center rounded-lg bg-zinc-100 p-5">
            <svg [attr.content]="circleSvg" class="h-[100px] w-[100px]" />
          </view>
          <text class="text-[13px] leading-[18px] text-zinc-500">
            SVG content is passed via the content attribute as a string.
          </text>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  circleSvg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="45" fill="#6366f1" />
    <text x="50" y="55" text-anchor="middle" fill="white" font-size="16">SVG</text>
  </svg>`;
}
