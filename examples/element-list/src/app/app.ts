import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          List Element
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          A virtualized list. Add and remove items to see the native list
          reconcile.
        </text>

        <view
          class="rounded-xl border border-zinc-200 bg-white p-4 overflow-hidden"
        >
          <view class="mb-2.5 flex-row items-center flex justify-between">
            <text
              class="uppercase text-[11px] font-bold tracking-[0.5px] text-zinc-400"
            >
              {{ items().length }} Items
            </text>
            <view
              class="rounded-lg bg-indigo-500 px-3 py-1.5"
              (bindtap)="addItem()"
            >
              <text class="text-[13px] font-semibold text-white">+ Add</text>
            </view>
          </view>
          <list
            list-type="single"
            scroll-orientation="vertical"
            class="h-[300px]"
          >
            @for (item of items(); track item.id) {
              <list-item [attr.item-key]="item.id">
                <view
                  class="flex-row items-center border-b border-zinc-200 py-3"
                >
                  <view
                    class="h-8 w-8 items-center rounded-[16px] bg-indigo-50 justify-center"
                  >
                    <text class="text-xs font-semibold text-indigo-500">{{
                      item.id
                    }}</text>
                  </view>
                  <text class="ml-3 flex-1 text-[15px] text-zinc-900">{{
                    item.name
                  }}</text>
                  <!--
                    catchtap (not bindtap) stops the tap here so it cannot bubble
                    up to the <list>'s own tap/scroll gesture handling — tapping ✕
                    should only remove this row, never register as a tap on the
                    list. Same pattern the todo-list example uses for its delete.
                  -->
                  <view class="px-2 py-1" (catchtap)="remove(item.id)">
                    <text class="text-base text-red-500">✕</text>
                  </view>
                </view>
              </list-item>
            }
          </list>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly items = signal(
    Array.from({ length: 50 }, (_, i) => ({
      id: `${i + 1}`,
      name: `Item ${i + 1}`,
    })),
  );

  // Monotonic counter for stable ids on newly added items. Starts past the 50
  // seed items so a freshly added item never reuses an existing id/item-key —
  // the native list diffs on item-key, so a collision would misidentify cells.
  #nextId = 51;

  addItem(): void {
    const id = `${this.#nextId++}`;
    this.items.update((list) => [...list, { id, name: `Item ${id}` }]);
  }

  remove(id: string): void {
    this.items.update((list) => list.filter((item) => item.id !== id));
  }
}
