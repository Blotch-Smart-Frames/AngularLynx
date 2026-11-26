import { Component, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  type LynxListItemAttributes,
} from '@blotch/angular-lynx';
import { type Item, Row, rows } from './row';

/** How the list builds its rows. */
type Mode = 'list-for' | 'for';

const ITEM_COUNT = 1000;

@Component({
  selector: 'app-root',
  template: `
    <view
      class="h-full flex-col bg-zinc-50 px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] flex"
    >
      <text class="mb-1 text-[28px] font-bold text-zinc-900">
        List Element
      </text>
      <text class="mb-4 text-[13px] text-zinc-500">
        A virtualized list of {{ items().length }} items. *lynxListFor builds a
        row only when the list asks for it and reuses the rows scrolled away;
        &#64;for builds them all up front.
      </text>

      <view class="mb-3 flex-row rounded-lg bg-zinc-200 p-1 flex">
        <view
          class="flex-1 items-center rounded-md py-1.5"
          [class.bg-white]="mode() === 'list-for'"
          (bindtap)="show('list-for')"
        >
          <text class="text-[13px] font-semibold text-zinc-900"
            >*lynxListFor</text
          >
        </view>
        <view
          class="flex-1 items-center rounded-md py-1.5"
          [class.bg-white]="mode() === 'for'"
          (bindtap)="show('for')"
        >
          <text class="text-[13px] font-semibold text-zinc-900">&#64;for</text>
        </view>
      </view>

      <view class="mb-3 flex-row items-center flex justify-between">
        <text class="text-[12px] text-zinc-500">
          {{ built() }} rows built · shown in {{ shownIn() }}
        </text>
        <view class="flex-row flex">
          <view
            class="mr-2 rounded-lg bg-zinc-200 px-3 py-1.5"
            (bindtap)="shuffle()"
          >
            <text class="text-[13px] font-semibold text-zinc-900">Shuffle</text>
          </view>
          <view
            class="rounded-lg bg-indigo-500 px-3 py-1.5"
            (bindtap)="addItem()"
          >
            <text class="text-[13px] font-semibold text-white">+ Add</text>
          </view>
        </view>
      </view>

      <view
        class="flex-1 flex-col rounded-t-xl border border-zinc-200 bg-white px-4 flex overflow-hidden"
      >
        @if (mode() === 'list-for') {
          <list
            list-type="single"
            scroll-orientation="vertical"
            class="flex-1"
            (bindlayoutcomplete)="laidOut()"
            (bindscroll)="scrolled()"
          >
            <list-item
              *lynxListFor="
                let item of items();
                trackBy: byId;
                itemAttributes: rowAttributes
              "
            >
              <app-row [item]="item" (remove)="remove(item.id)" />
            </list-item>
          </list>
        } @else {
          <list
            list-type="single"
            scroll-orientation="vertical"
            class="flex-1"
            (bindlayoutcomplete)="laidOut()"
            (bindscroll)="scrolled()"
          >
            @for (item of items(); track item.id) {
              <list-item [attr.item-key]="item.id">
                <app-row [item]="item" (remove)="remove(item.id)" />
              </list-item>
            }
          </list>
        }
      </view>
    </view>
  `,
  imports: [LYNX_ELEMENTS, Row],
})
export class App {
  readonly items = signal<Item[]>(
    Array.from({ length: ITEM_COUNT }, (_, i) => ({
      id: `${i + 1}`,
      name: `Item ${i + 1}`,
    })),
  );
  readonly mode = signal<Mode>('list-for');
  readonly built = signal(0);
  readonly shownIn = signal('…');

  // Each item's key, which the native list uses as its item-key.
  readonly byId = (_: number, item: Item) => item.id;
  // A row's height until it's drawn, so the list knows how long it is.
  readonly rowAttributes = (): LynxListItemAttributes => ({
    'estimated-main-axis-size-px': 57,
  });

  // When the list was asked for, to time how long it takes to show.
  #shownAt = Date.now();
  #timed = false;

  // Monotonic counter for stable ids on newly added items. Starts past the
  // seed items so a freshly added item never reuses an existing id/item-key —
  // the native list diffs on item-key, so a collision would misidentify cells.
  #nextId = ITEM_COUNT + 1;

  show(mode: Mode): void {
    if (mode === this.mode()) return;
    rows.built = 0;
    this.built.set(0);
    this.shownIn.set('…');
    this.#shownAt = Date.now();
    this.#timed = false;
    this.mode.set(mode);
  }

  laidOut(): void {
    if (!this.#timed) {
      this.#timed = true;
      this.shownIn.set(`${Date.now() - this.#shownAt} ms`);
    }
    this.built.set(rows.built);
  }

  scrolled(): void {
    this.built.set(rows.built);
  }

  addItem(): void {
    const id = `${this.#nextId++}`;
    this.items.update((list) => [{ id, name: `Item ${id}` }, ...list]);
  }

  shuffle(): void {
    this.items.update((list) => {
      const shuffled = [...list];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      return shuffled;
    });
  }

  remove(id: string): void {
    this.items.update((list) => list.filter((item) => item.id !== id));
  }
}
