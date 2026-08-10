import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Event Handling
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Tap the outer or inner box to see how events propagate.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Propagation Demo
          </text>
          <view
            class="items-center rounded-[10px] bg-indigo-50 p-5"
            (bindtap)="onOuterTap()"
          >
            <text class="mb-3 text-[13px] text-indigo-700">
              Outer (bindtap — bubbles)
            </text>
            <view
              class="rounded-lg bg-indigo-500 px-6 py-3.5"
              (catchtap)="onInnerTap()"
            >
              <text class="text-[13px] text-white">
                Inner (catchtap — stops propagation)
              </text>
            </view>
          </view>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Event Log
          </text>
          @for (entry of log(); track $index) {
            <text class="mb-1 text-[13px] text-zinc-900">{{ entry }}</text>
          } @empty {
            <text class="text-[13px] text-zinc-400">
              Tap a box to see events
            </text>
          }
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly log = signal<string[]>([]);

  onOuterTap(): void {
    this.log.update((entries) => [...entries.slice(-4), 'Outer tapped (bind)']);
  }

  onInnerTap(): void {
    this.log.update((entries) => [
      ...entries.slice(-4),
      'Inner tapped (catch — stopped)',
    ]);
  }
}
