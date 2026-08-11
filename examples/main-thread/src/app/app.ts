import { Component, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxMainThreadEvent,
  mainThreadFn,
  backgroundFn,
  createMainThreadRef,
  type MainThread,
} from '@blotch/angular-lynx';

/**
 * Persist state across main-thread function calls.
 */
const tapCount = createMainThreadRef(0);

/**
 * Registered on the background thread. Callable from main-thread via runOnBackground().
 */
let _lastColor = '';
const notifyColorChange = backgroundFn((color: string) => {
  _lastColor = color;
});

const handleTap = mainThreadFn((event: MainThread.TouchEvent) => {
  const el = event.currentTarget;
  tapCount.current++;

  const colors = ['#6366f1', '#22c55e', '#f97316', '#3b82f6', '#ef4444'];
  const color = colors[tapCount.current % colors.length]!;
  el.setStyleProperty('background-color', color);

  runOnBackground(notifyColorChange, color);
});

const handleTouchMove = mainThreadFn((event: MainThread.TouchEvent) => {
  const touch = event.touches[0];
  if (!touch) return;
  const opacity = Math.max(0.3, Math.min(1, touch.clientX / 300));
  event.currentTarget.setStyleProperty('opacity', String(opacity));
});

const handleTouchEnd = mainThreadFn((event: MainThread.TouchEvent) => {
  event.currentTarget.setStyleProperty('opacity', '1');
});

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Main Thread Scripts
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Zero-latency UI updates via main-thread execution.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-1 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Instant Color Change
          </text>
          <text class="mb-3 text-xs text-zinc-400">
            mainThreadFn + MainThreadRef
          </text>
          <view
            [mainThreadBindtap]="handleTap"
            class="h-[80px] items-center rounded-[10px] bg-indigo-500 justify-center"
          >
            <text class="text-[15px] font-medium text-white">
              Tap to change color
            </text>
          </view>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-1 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Touch Tracking
          </text>
          <text class="mb-3 text-xs text-zinc-400">mainThreadFn</text>
          <view
            [mainThreadBindtouchmove]="handleTouchMove"
            [mainThreadBindtouchend]="handleTouchEnd"
            class="h-[80px] items-center rounded-[10px] bg-blue-500 justify-center"
          >
            <text class="text-[15px] font-medium text-white">
              Drag to change opacity
            </text>
          </view>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-1 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Background Thread
          </text>
          <text class="mb-3 text-xs text-zinc-400">
            For comparison — round-trip latency
          </text>
          <view
            (bindtap)="onBgTap()"
            class="h-[80px] items-center rounded-[10px] bg-zinc-500 justify-center"
          >
            <text class="text-[15px] font-medium text-white">
              Background taps: {{ bgTapCount() }}
            </text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS, LynxMainThreadEvent],
})
export class App {
  readonly handleTap = handleTap;
  readonly handleTouchMove = handleTouchMove;
  readonly handleTouchEnd = handleTouchEnd;
  readonly bgTapCount = signal(0);

  onBgTap(): void {
    this.bgTapCount.update((v) => v + 1);
  }
}
