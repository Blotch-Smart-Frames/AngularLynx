import { Component, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxTransition,
  LynxTransitionGroup,
} from '@blotch/angular-lynx';

type Item = { id: number; label: string };

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Transitions
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Animate elements entering and leaving the DOM.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            LynxTransition — Single Element
          </text>
          <view
            class="mb-3 items-center rounded-lg bg-indigo-500 px-5 py-2.5 justify-center"
            (bindtap)="togglePanel()"
          >
            <text class="text-sm font-semibold text-white">{{
              showPanel() ? 'Hide Panel' : 'Show Panel'
            }}</text>
          </view>
          <text class="mb-2 text-[11px] text-zinc-400">
            Last event: {{ lastEvent() }}
          </text>
          <lynx-transition
            [show]="showPanel()"
            name="fade"
            [duration]="300"
            (afterEnter)="lastEvent.set('afterEnter')"
            (afterLeave)="lastEvent.set('afterLeave')"
          >
            <view class="mb-2 rounded-lg bg-indigo-50 p-4">
              <text class="text-sm text-indigo-700">
                I fade and slide in/out!
              </text>
            </view>
          </lynx-transition>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            LynxTransitionGroup — Dynamic List
          </text>
          <view
            class="mb-3 items-center rounded-lg bg-indigo-500 px-5 py-2.5 justify-center"
            (bindtap)="addItem()"
          >
            <text class="text-sm font-semibold text-white">+ Add Item</text>
          </view>
          <view class="mt-1">
            <lynx-transition-group
              [each]="items()"
              [trackBy]="trackById"
              name="list"
              [duration]="300"
            >
              <ng-template let-item>
                <view
                  class="mb-2 flex-row items-center rounded-lg bg-indigo-500 px-4 py-3 flex justify-between"
                >
                  <text class="flex-1 text-sm font-semibold text-white">{{
                    item.label
                  }}</text>
                  <view
                    class="h-7 w-7 items-center rounded-[14px] justify-center"
                    style="background-color: rgba(0,0,0,0.15)"
                    (bindtap)="removeItem(item)"
                  >
                    <text class="text-base font-bold text-white">×</text>
                  </view>
                </view>
              </ng-template>
            </lynx-transition-group>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  styles: [
    `
      @keyframes fade-enter {
        from {
          opacity: 0;
          transform: translateY(-16px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @keyframes fade-leave {
        from {
          opacity: 1;
          transform: translateY(0);
        }
        to {
          opacity: 0;
          transform: translateY(-16px);
        }
      }
      .fade-enter {
        animation: fade-enter 300ms ease both;
      }
      .fade-leave {
        animation: fade-leave 300ms ease both;
      }

      @keyframes list-enter {
        from {
          opacity: 0;
          transform: translateX(30px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
      @keyframes list-leave {
        from {
          opacity: 1;
          transform: translateX(0);
        }
        to {
          opacity: 0;
          transform: translateX(-30px);
        }
      }
      .list-enter {
        animation: list-enter 300ms ease both;
      }
      .list-leave {
        animation: list-leave 300ms ease both;
      }
    `,
  ],
  imports: [LYNX_ELEMENTS, LynxTransition, LynxTransitionGroup],
})
export class App {
  readonly showPanel = signal(false);
  // Set by (afterEnter) and (afterLeave), which fire when each animation ends.
  readonly lastEvent = signal('none yet');
  readonly items = signal<Item[]>([
    { id: 1, label: 'Item 1' },
    { id: 2, label: 'Item 2' },
    { id: 3, label: 'Item 3' },
  ]);
  #nextId = 4;

  readonly trackById = (item: Item) => item.id;

  togglePanel(): void {
    this.showPanel.update((v) => !v);
  }

  addItem(): void {
    const id = this.#nextId++;
    this.items.update((items) => [...items, { id, label: `Item ${id}` }]);
  }

  removeItem(item: Item): void {
    this.items.update((items) => items.filter((i) => i.id !== item.id));
  }
}
