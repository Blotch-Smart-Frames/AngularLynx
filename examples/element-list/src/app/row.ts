import { Component, input, output } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

export type Item = {
  id: string;
  name: string;
};

/**
 * How many rows have been built so far. `@for` builds one per item;
 * `*lynxListFor` builds about as many as fit on screen and reuses them.
 * A plain count rather than a signal: rows are built while the screen's
 * change detection runs, which a signal its template reads would have to
 * run again. The screen reads it after the list lays out or scrolls.
 */
export const rows = { built: 0 };

@Component({
  selector: 'app-row',
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="flex-row items-center border-b border-zinc-200 py-3 flex">
      <view
        class="h-8 w-8 items-center rounded-[16px] bg-indigo-50 justify-center"
      >
        <text class="text-xs font-semibold text-indigo-500">{{
          item().id
        }}</text>
      </view>
      <text class="ml-3 flex-1 text-[15px] text-zinc-900">{{
        item().name
      }}</text>
      <!--
        catchtap (not bindtap) stops the tap here so it cannot bubble up to
        the <list>'s own tap/scroll gesture handling: tapping ✕ should only
        remove this row, never register as a tap on the list.
      -->
      <view class="px-2 py-1" (catchtap)="remove.emit()">
        <text class="text-base text-red-500">✕</text>
      </view>
    </view>
  `,
})
export class Row {
  // A reused row gets another item through this input, so everything it
  // shows comes from it.
  readonly item = input.required<Item>();
  readonly remove = output<void>();

  constructor() {
    rows.built++;
  }
}
