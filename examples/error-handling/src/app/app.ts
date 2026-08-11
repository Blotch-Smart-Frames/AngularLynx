import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Error Handling
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Catch and display runtime errors via __lynxLastError.
        </text>

        <view
          class="mb-4 items-center rounded-[10px] bg-indigo-500 px-6 py-3"
          (bindtap)="throwError()"
        >
          <text class="text-[15px] font-semibold text-white">
            Throw an Error
          </text>
        </view>

        <view class="rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
            >__lynxLastError
          </text>
          <view
            class="rounded-lg bg-zinc-100 p-3.5"
            [class.bg-red-50]="!!lastError()"
          >
            <text
              class="text-xs text-zinc-500 break-all"
              [class.text-red-800]="!!lastError()"
            >
              {{ lastError() || '(none)' }}
            </text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly lastError = signal('');

  throwError(): void {
    setTimeout(() => {
      try {
        throw new Error('Example error from component');
      } catch (e) {
        const err = e as Error;
        (globalThis as any).__lynxLastError =
          `${err.name}: ${err.message}\n${err.stack ?? ''}`;
        this.lastError.set((globalThis as any).__lynxLastError);
      }
    }, 0);
  }
}
