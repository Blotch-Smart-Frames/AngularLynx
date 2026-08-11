import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <refresh (bindstartrefresh)="onRefresh()">
      <refresh-header>
        <view class="h-[60px] items-center justify-center">
          <text class="text-[13px] text-zinc-400">
            {{ refreshing() ? 'Refreshing...' : 'Pull down to refresh' }}
          </text>
        </view>
      </refresh-header>
      <scroll-view class="h-screen bg-zinc-50" scroll-orientation="vertical">
        <view class="p-6">
          <text class="mb-1 text-[28px] font-bold text-zinc-900">
            Refresh Element
          </text>
          <text class="mb-5 text-[13px] text-zinc-500">
            Pull down to reload the list.
          </text>

          @for (item of items(); track item.id) {
            <view
              class="mb-2 rounded-xl border border-zinc-200 bg-white px-4 py-3.5"
            >
              <text class="text-[15px] font-medium text-zinc-900">{{
                item.name
              }}</text>
              <text class="mt-1 text-xs text-zinc-400">
                Added {{ item.time }}
              </text>
            </view>
          }
        </view>
      </scroll-view>
    </refresh>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  #counter = 0;

  readonly refreshing = signal(false);
  readonly items = signal(this.#generateItems());

  onRefresh(): void {
    this.refreshing.set(true);
    setTimeout(() => {
      this.items.set(this.#generateItems());
      this.refreshing.set(false);
    }, 1500);
  }

  #generateItems(): { id: number; name: string; time: string }[] {
    const now = new Date().toLocaleTimeString();
    return Array.from({ length: 5 }, (_) => ({
      id: ++this.#counter,
      name: `Item ${this.#counter}`,
      time: now,
    }));
  }
}
