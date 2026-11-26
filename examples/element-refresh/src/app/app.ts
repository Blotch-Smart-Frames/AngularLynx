import { Component, ElementRef, signal, viewChild } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <!--
      The native shells draw edge to edge, so this view keeps the refresh
      element below the status bar: padding the scroll content instead would
      leave the pull-down header under it.
    -->
    <view
      class="h-full w-full flex-col bg-zinc-50 pt-[env(safe-area-inset-top)] flex"
    >
      <refresh
        #refresher
        class="w-full flex-1"
        (bindstartrefresh)="onRefresh()"
      >
        <refresh-header>
          <view class="h-[60px] items-center justify-center">
            <text class="text-[13px] text-zinc-400">
              {{ refreshing() ? 'Refreshing...' : 'Pull down to refresh' }}
            </text>
          </view>
        </refresh-header>
        <scroll-view
          class="h-full w-full bg-zinc-50"
          scroll-orientation="vertical"
        >
          <view class="px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6">
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
    </view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  #counter = 0;

  readonly refresher = viewChild.required('refresher', { read: ElementRef });
  readonly refreshing = signal(false);
  readonly items = signal(this.#generateItems());

  onRefresh(): void {
    this.refreshing.set(true);
    // Stands in for a network request.
    setTimeout(() => {
      this.items.set(this.#generateItems());
      this.refreshing.set(false);
      // The header stays open until the finishRefresh UI method is called.
      this.refresher().nativeElement.invoke?.('finishRefresh');
    }, 1500);
  }

  #generateItems(): { id: number; name: string; time: string }[] {
    const now = new Date().toLocaleTimeString();
    return Array.from({ length: 5 }, () => ({
      id: ++this.#counter,
      name: `Item ${this.#counter}`,
      time: now,
    }));
  }
}
