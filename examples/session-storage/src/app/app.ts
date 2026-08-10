import { Component, inject, signal } from '@angular/core';
import { LYNX_ELEMENTS, LynxSessionStorage } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Session Storage
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Persist state across Lynx pages with reactive watching.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Counter
          </text>
          <text class="mb-3 text-[24px] font-bold text-zinc-900">{{
            counter() ?? 'not set'
          }}</text>
          <view class="flex-row gap-3 flex">
            <view
              class="items-center rounded-[10px] bg-indigo-500 px-6 py-3"
              (bindtap)="increment()"
            >
              <text class="text-[15px] font-semibold text-white">
                Increment
              </text>
            </view>
            <view
              class="items-center rounded-[10px] bg-red-500 px-6 py-3"
              (bindtap)="reset()"
            >
              <text class="text-[15px] font-semibold text-white">Reset</text>
            </view>
          </view>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            One-time Read
          </text>
          <text class="mb-3 text-[15px] text-zinc-900">
            Last read: {{ lastRead() }}
          </text>
          <view
            class="items-center rounded-[10px] border border-zinc-200 bg-zinc-100 px-6 py-3"
            (bindtap)="readOnce()"
          >
            <text class="text-[15px] font-semibold text-zinc-900">
              Read Once
            </text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly #sessionStorage = inject(LynxSessionStorage);

  readonly counter = this.#sessionStorage.watch<number>('counter');
  readonly lastRead = signal<string>('(not yet read)');

  increment(): void {
    const current = this.counter() ?? 0;
    this.#sessionStorage.setItem('counter', current + 1);
  }

  reset(): void {
    this.#sessionStorage.setItem('counter', 0);
  }

  async readOnce(): Promise<void> {
    try {
      const value = await this.#sessionStorage.getItem<number>('counter');
      this.lastRead.set(`counter = ${value ?? 'not set'}`);
    } catch {
      this.lastRead.set('(not available)');
    }
  }
}
