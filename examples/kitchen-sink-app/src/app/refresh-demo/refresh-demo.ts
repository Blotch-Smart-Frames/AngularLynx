import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiText } from '../../components/ui/typography';
import { UiBadge } from '../../components/ui/badge';
import { ScreenHost } from '../screen-host';

@Component({
  selector: 'app-refresh-demo',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [LYNX_ELEMENTS, UiText, UiBadge],
  template: `
    <refresh class="h-full w-full" (bindstartrefresh)="onRefresh()">
      <refresh-header>
        <view class="h-[60px] items-center justify-center">
          <text class="text-sm text-gray-500">
            {{ refreshing() ? 'Refreshing...' : 'Pull down to refresh' }}
          </text>
        </view>
      </refresh-header>
      <scroll-view scroll-orientation="vertical" class="h-full w-full">
        <view class="flex-col gap-2 p-4 flex">
          <ui-text variant="h3">Pull to Refresh</ui-text>
          <ui-badge variant="secondary">Motion</ui-badge>
        </view>
        <view class="p-4">
          <text class="mb-4 text-sm text-gray-500">
            Pull down to reload the list (refreshed {{ refreshCount() }} times)
          </text>
          @for (item of items(); track item.id) {
            <view class="mb-2 rounded-lg bg-gray-100 p-4">
              <text class="text-base font-bold">{{ item.name }}</text>
              <text class="mt-1 text-xs text-gray-400">{{ item.time }}</text>
            </view>
          }
        </view>
      </scroll-view>
    </refresh>
  `,
})
export class RefreshDemo {
  #counter = 0;

  refreshing = signal(false);
  refreshCount = signal(0);
  items = signal(this.#generateItems());

  onRefresh(): void {
    this.refreshing.set(true);
    // Simulate a 1.5s network request. Signal updates here are safe: the
    // `bindstartrefresh` handler fires on the background thread, not the
    // main-thread event path, so no synchronous flush concern.
    setTimeout(() => {
      this.items.set(this.#generateItems());
      this.refreshCount.update((c) => c + 1);
      this.refreshing.set(false);
    }, 1500);
  }

  #generateItems(): { id: number; name: string; time: string }[] {
    const now = new Date().toLocaleTimeString();
    return Array.from({ length: 8 }, () => ({
      id: ++this.#counter,
      name: `Item ${this.#counter}`,
      time: now,
    }));
  }
}
