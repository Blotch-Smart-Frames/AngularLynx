import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Title Bar View
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          A custom frameless window title bar with draggable regions.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Title Bar
          </text>
          <view
            class="h-[44px] flex-row items-center rounded-lg bg-zinc-100 overflow-hidden"
          >
            <title-bar-view
              moveable="true"
              class="h-full flex-1 justify-center"
            >
              <text class="pl-3.5 text-sm font-semibold text-zinc-900">
                My App
              </text>
            </title-bar-view>
            <view
              class="h-full w-11 items-center border-l border-zinc-200 justify-center"
              (bindtap)="close()"
            >
              <text class="text-sm text-zinc-500">✕</text>
            </view>
          </view>
        </view>

        <view class="rounded-xl bg-zinc-100 p-3.5">
          <text class="text-[13px] text-zinc-500">{{ message() }}</text>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly message = signal('Drag the title bar to move the window.');

  close(): void {
    this.message.set('Close button tapped!');
  }
}
