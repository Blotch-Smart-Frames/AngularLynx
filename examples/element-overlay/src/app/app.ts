import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Overlay Element
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          A floating layer for modals and popups.
        </text>

        <view
          class="items-center rounded-[10px] bg-indigo-500 px-6 py-3"
          (bindtap)="open()"
        >
          <text class="text-[15px] font-semibold text-white">Show Modal</text>
        </view>

        <overlay [attr.visible]="showModal()">
          <view
            class="h-full w-full items-center bg-black/40 flex justify-center"
            (bindtap)="close()"
          >
            <view
              class="w-[260px] items-center rounded-2xl border border-zinc-200 bg-white p-6"
              (catchtap)="noop()"
            >
              <text class="mb-2 text-[18px] font-bold text-zinc-900">
                Modal Title
              </text>
              <text class="mb-5 text-sm leading-5 text-zinc-500 text-center">
                This overlay floats above the normal content.
              </text>
              <view
                class="items-center rounded-[10px] bg-indigo-500 px-6 py-3"
                (bindtap)="close()"
              >
                <text class="text-[15px] font-semibold text-white">Close</text>
              </view>
            </view>
          </view>
        </overlay>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly showModal = signal(false);

  open(): void {
    this.showModal.set(true);
  }

  close(): void {
    this.showModal.set(false);
  }

  /**
   * Catches tap to prevent it from reaching the backdrop
   */
  noop(): void {}
}
