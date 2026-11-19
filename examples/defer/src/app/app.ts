import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { Heavy } from './heavy';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          defer Blocks
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Lazy-load components with declarative triggers.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Tap to Load
          </text>
          <view
            class="mb-3 items-center rounded-lg bg-indigo-500 px-6 py-3"
            (bindtap)="loadDeferred()"
          >
            <text class="text-[15px] font-semibold text-white">
              Tap to load
            </text>
          </view>

          @defer (when visible()) {
            <app-heavy />
          } @placeholder {
            <view class="rounded-lg bg-zinc-100 p-3.5">
              <text class="text-sm text-zinc-400">
                Placeholder — not yet triggered
              </text>
            </view>
          } @loading {
            <view class="rounded-lg bg-amber-50 p-3.5">
              <text class="text-sm text-amber-800">Loading...</text>
            </view>
          }
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Timer-based (3s)
          </text>
          @defer (on timer(3000ms)) {
            <app-heavy />
          } @placeholder {
            <view class="rounded-lg bg-zinc-100 p-3.5">
              <text class="text-sm text-zinc-400">
                Auto-loads in 3 seconds...
              </text>
            </view>
          }
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            On interaction
          </text>
          <!-- The placeholder is the trigger: a tap on it loads the block. -->
          @defer (on interaction) {
            <app-heavy />
          } @placeholder {
            <view class="rounded-lg bg-zinc-100 p-3.5">
              <text class="text-sm text-zinc-400">Tap here to load</text>
            </view>
          }
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            On hover
          </text>
          <!-- A finger touching the placeholder, or a mouse over it. -->
          @defer (on hover) {
            <app-heavy />
          } @placeholder {
            <view class="rounded-lg bg-zinc-100 p-3.5">
              <text class="text-sm text-zinc-400">
                Touch here, or hover with a mouse
              </text>
            </view>
          }
        </view>

        <text class="mb-4 text-[13px] text-zinc-400 text-center">
          Scroll down
        </text>
        <view class="h-[480px]"></view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            On viewport
          </text>
          <!-- Loads when the placeholder first comes on screen. -->
          @defer (on viewport) {
            <app-heavy />
          } @placeholder {
            <view class="rounded-lg bg-zinc-100 p-3.5">
              <text class="text-sm text-zinc-400"
                >Loads once it's on screen</text
              >
            </view>
          }
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS, Heavy],
})
export class App {
  readonly visible = signal(false);

  loadDeferred(): void {
    this.visible.set(true);
  }
}
