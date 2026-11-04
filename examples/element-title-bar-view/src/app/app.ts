import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <view class="h-full flex-col bg-zinc-50 flex">
      <!--
        A frameless desktop window draws its own title bar across the top.
        Only the title is inside <title-bar-view>: dragging it moves the
        window, while the close button beside it stays a plain view so a tap
        on it isn't taken as the start of a drag.
        justify-between keeps the button at the right edge where
        <title-bar-view> doesn't exist (iOS, Android, the web preview) and
        flex-1 can't stretch it.
      -->
      <view
        class="h-11 flex-row items-center border-b border-zinc-200 bg-white flex justify-between"
      >
        <title-bar-view
          [moveable]="true"
          class="h-full flex-1 flex-row items-center flex"
        >
          <text class="pl-4 text-sm font-semibold text-zinc-900">My App</text>
        </title-bar-view>
        <view
          class="h-full w-11 items-center justify-center"
          (bindtap)="close()"
        >
          <text class="text-sm text-zinc-500">✕</text>
        </view>
      </view>

      <scroll-view class="flex-1" scroll-orientation="vertical">
        <view class="p-6">
          <text class="mb-1 text-[28px] font-bold text-zinc-900">
            Title Bar View
          </text>
          <text class="mb-5 text-[13px] text-zinc-500">
            The bar above is the window's title bar. On Windows and macOS,
            dragging it moves the window.
          </text>

          <view class="rounded-xl bg-zinc-100 p-3.5">
            <text class="text-[13px] text-zinc-500">{{ message() }}</text>
          </view>
        </view>
      </scroll-view>
    </view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly message = signal('Drag the title bar to move the window.');

  close(): void {
    this.message.set('Close button tapped!');
  }
}
