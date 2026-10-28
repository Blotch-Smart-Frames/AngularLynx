import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { UiGlass, injectGlassDesign } from '../components/ui/glass';
import { UiIcon } from '../components/ui/icon';
import {
  UiPopover,
  UiPopoverContent,
  UiPopoverTrigger,
} from '../components/ui/popover';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiGlass,
    UiIcon,
    UiPopover,
    UiPopoverContent,
    UiPopoverTrigger,
  ],
  template: `
    <view class="h-full w-full flex-col bg-background flex">
      <scroll-view scroll-orientation="vertical" class="flex-1">
        <view class="flex-col gap-6 px-4 pb-10 flex pt-safe-6">
          <view class="flex-col gap-1 flex">
            <text class="text-2xl font-bold text-foreground">Popovers</text>
            <text class="text-sm text-muted-foreground">
              Content that opens from its control, and leaves the rest of the
              screen as it was.
            </text>
            <text class="text-xs text-muted-foreground">{{ status() }}</text>
          </view>

          <view class="flex-col gap-3 flex">
            <text class="text-sm font-semibold text-foreground">
              From a control
            </text>
            <text class="text-xs text-muted-foreground">
              Change the guests: the popover stays open while you use it. Then
              tap the heart: one tap closes it and likes the trip.
            </text>
            <view
              class="flex-col gap-4 rounded-[24px] p-4 flex"
              style="background-image: linear-gradient(135deg, #f472b6, #fb923c);"
            >
              <view class="flex-row items-start gap-3 flex">
                <view class="flex-1 flex-col flex">
                  <text class="text-lg font-semibold text-white">Kyoto</text>
                  <text class="text-sm text-white">Apr 2 – Apr 9</text>
                </view>
                <!-- From a glass button in the corner: it lines up with the
                   button's right edge, toward the middle of the screen. -->
                <ui-popover>
                  <blur-view
                    ui-glass
                    uiPopoverTrigger
                    shape="circle"
                    interactive
                    class="h-11 w-11 items-center flex justify-center"
                    [accessibility-element]="true"
                    accessibility-traits="button"
                    accessibility-label="About this trip"
                  >
                    <ui-icon name="info" />
                  </blur-view>
                  <ui-popover-content class="w-64">
                    <text class="text-base font-semibold text-glass-foreground">
                      Kyoto, April 2 to 9
                    </text>
                    <text class="text-sm text-glass-muted-foreground">
                      Seven nights, three temples a day, and one very long walk
                      up a mountain.
                    </text>
                  </ui-popover-content>
                </ui-popover>
              </view>
              <view class="flex-row items-center flex justify-between">
                <ui-popover>
                  <blur-view
                    ui-glass
                    uiPopoverTrigger
                    interactive
                    class="h-11 flex-row items-center gap-2 px-4 flex"
                    [accessibility-element]="true"
                    accessibility-traits="button"
                    [accessibility-label]="'Guests, ' + guests()"
                  >
                    <ui-icon name="user-plus" size="sm" />
                    <text class="text-sm font-medium text-glass-foreground">
                      {{ guests() }} {{ guests() === 1 ? 'guest' : 'guests' }}
                    </text>
                  </blur-view>
                  <ui-popover-content class="w-56 gap-3">
                    <text class="text-sm text-glass-muted-foreground">
                      Guests
                    </text>
                    <view class="flex-row items-center flex justify-between">
                      <view
                        class="h-10 w-10 items-center rounded-full border border-glass-foreground flex justify-center"
                        [accessibility-element]="true"
                        accessibility-traits="button"
                        accessibility-label="Fewer guests"
                        (bindtap)="changeGuests(-1)"
                      >
                        <ui-icon name="minus" size="sm" />
                      </view>
                      <text
                        class="text-2xl font-semibold text-glass-foreground"
                      >
                        {{ guests() }}
                      </text>
                      <view
                        class="h-10 w-10 items-center rounded-full border border-glass-foreground flex justify-center"
                        [accessibility-element]="true"
                        accessibility-traits="button"
                        accessibility-label="More guests"
                        (bindtap)="changeGuests(1)"
                      >
                        <ui-icon name="plus" size="sm" />
                      </view>
                    </view>
                  </ui-popover-content>
                </ui-popover>
                <blur-view
                  ui-glass
                  interactive
                  class="h-11 flex-row items-center gap-2 px-4 flex"
                  [accessibility-element]="true"
                  accessibility-traits="button"
                  [accessibility-label]="'Like, ' + likes()"
                  (bindtap)="likes.update((likes) => likes + 1)"
                >
                  <ui-icon name="heart" size="sm" />
                  <text class="text-sm font-medium text-glass-foreground">
                    {{ likes() }}
                  </text>
                </blur-view>
              </view>
            </view>
          </view>
        </view>
      </scroll-view>
      <!-- A toolbar along the bottom: its popover opens upward, and stays
         clear of the home indicator. -->
      <view class="flex-col px-4 pt-2 flex pb-safe-2">
        <view
          class="flex-row items-center gap-3 rounded-[24px] p-3 flex"
          style="background-image: linear-gradient(135deg, #38bdf8, #6366f1);"
        >
          <ui-popover>
            <blur-view
              ui-glass
              uiPopoverTrigger
              interactive
              class="h-11 flex-row items-center gap-2 px-4 flex"
              [accessibility-element]="true"
              accessibility-traits="button"
              accessibility-label="Reminder"
            >
              <ui-icon name="bell" size="sm" />
              <text class="text-sm font-medium text-glass-foreground">
                Reminder
              </text>
            </blur-view>
            <ui-popover-content class="w-64">
              <text class="text-base font-semibold text-glass-foreground">
                Leave by 7:40
              </text>
              <text class="text-sm text-glass-muted-foreground">
                Your train to Kyoto leaves Tokyo Station at 8:10.
              </text>
            </ui-popover-content>
          </ui-popover>
          <text class="flex-1 text-xs text-white">
            Near the bottom of the screen, a popover opens upward.
          </text>
        </view>
      </view>
    </view>
  `,
})
export class App {
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #info = inject(LynxSystemInfo);
  readonly #design = injectGlassDesign();

  readonly guests = signal(2);
  readonly likes = signal(0);

  /** What the popovers draw here, and the user's Reduce Motion setting. */
  readonly status = computed(
    () =>
      `${this.#design()} on ${this.#info.platform} ${this.#info.osVersion}` +
      (this.#settings.reduceMotion() ? ', Reduce Motion' : ''),
  );

  changeGuests(by: number): void {
    this.guests.update((guests) => Math.min(Math.max(guests + by, 1), 9));
  }
}
