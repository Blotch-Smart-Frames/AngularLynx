import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Custom Fonts
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Load and display custom fonts via @font-face.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Custom Font (Roboto)
          </text>
          <text class="font-[Roboto] text-[18px] text-zinc-900">
            The quick brown fox jumps over the lazy dog
          </text>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            System Font
          </text>
          <text class="text-[18px] text-zinc-900">
            The quick brown fox jumps over the lazy dog
          </text>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Serif Display (Playfair Display)
          </text>
          <text class="mb-1 font-[PlayfairDisplay] text-[22px] text-zinc-900">
            The Quick Brown Fox
          </text>
          <text class="font-[PlayfairDisplay] text-[13px] text-zinc-500">
            Jumps Over The Lazy Dog — 0123456789
          </text>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Handwriting (Dancing Script)
          </text>
          <text class="mb-1 font-[DancingScript] text-[26px] text-zinc-900">
            Hello, beautiful world!
          </text>
          <text class="font-[DancingScript] text-[16px] text-zinc-500">
            the quick brown fox jumps over the lazy dog
          </text>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Size Scale
          </text>
          <text class="mb-2 font-[Roboto] text-sm text-zinc-500">
            14px — ABCDEFGHIJKLMNOPQRSTUVWXYZ
          </text>
          <text class="font-[Roboto] text-[28px] text-zinc-900">
            28px — Hello, Lynx!
          </text>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {}
