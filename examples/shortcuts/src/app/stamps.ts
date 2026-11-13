import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-stamps',
  imports: [LYNX_ELEMENTS, RouterLink],
  template: `
    <scroll-view class="h-full" scroll-orientation="vertical">
      <view
        class="px-6 pb-6"
        style="padding-top: calc(24px + env(safe-area-inset-top));"
      >
        <text class="mb-1 text-[28px] font-bold text-zinc-900">Stamps</text>
        <text class="mb-5 text-[13px] text-zinc-500">
          The "Show stamps" shortcut opens the app here: its route in
          angular.json is /stamps, and that's all it takes.
        </text>

        <view class="mb-4 flex-row flex-wrap gap-3 flex">
          @for (stamp of stamps; track stamp.country) {
            <view
              class="h-[96px] w-[96px] items-center rounded-xl flex justify-center"
              [style.background-color]="stamp.color"
            >
              <text class="text-[13px] font-semibold text-white">
                {{ stamp.country }}
              </text>
            </view>
          }
        </view>

        <view
          class="items-center rounded-xl border border-zinc-200 bg-white p-4 flex"
          routerLink="/"
        >
          <text class="text-[15px] font-semibold text-zinc-900">
            Back to postcards
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class Stamps {
  readonly stamps = [
    { country: 'Portugal', color: '#b91c1c' },
    { country: 'Japan', color: '#1d4ed8' },
    { country: 'Mexico', color: '#15803d' },
    { country: 'Norway', color: '#7e22ce' },
    { country: 'Australia', color: '#c2410c' },
    { country: 'Georgia', color: '#0f766e' },
  ];
}
