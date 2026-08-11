import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Block Element
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          A non-visual container for conditional rendering.
        </text>

        <view
          class="mb-4 items-center rounded-[10px] bg-indigo-500 px-6 py-3"
          (bindtap)="toggle()"
        >
          <text class="text-[15px] font-semibold text-white">
            Toggle Details
          </text>
        </view>

        <view class="rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Properties
          </text>
          <text class="mb-1.5 text-[15px] text-zinc-900">Name: Angular</text>

          @if (showDetails()) {
            <block>
              <text class="mb-1.5 text-[15px] text-zinc-900">
                Type: Framework
              </text>
              <text class="mb-1.5 text-[15px] text-zinc-900">
                Language: TypeScript
              </text>
            </block>
          }
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly showDetails = signal(false);

  toggle(): void {
    this.showDetails.update((v) => !v);
  }
}
