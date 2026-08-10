import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiProgress } from '../components/ui/progress';
import { UiButton } from '../components/ui/button';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiProgress, UiButton],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="p-6">
        <text class="mb-6 text-2xl font-bold text-foreground">Progress</text>

        <!-- Static values -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Static Values
        </text>
        <view class="mb-6 flex-col gap-4 flex">
          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">0%</text>
            <ui-progress [value]="0" />
          </view>
          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">25%</text>
            <ui-progress [value]="25" />
          </view>
          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">50%</text>
            <ui-progress [value]="50" />
          </view>
          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">75%</text>
            <ui-progress [value]="75" />
          </view>
          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">100%</text>
            <ui-progress [value]="100" />
          </view>
        </view>

        <!-- Custom max -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Custom Max (200)
        </text>
        <view class="mb-6 flex-col gap-1 flex">
          <text class="text-xs text-muted-foreground">150 / 200</text>
          <ui-progress [value]="150" [max]="200" />
        </view>

        <!-- Interactive -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Interactive
        </text>
        <view class="flex-col gap-3 flex">
          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">
              {{ dynamicValue() }}%
            </text>
            <ui-progress [value]="dynamicValue()" />
          </view>
          <view class="flex-row gap-2 flex">
            <ui-button size="sm" variant="outline" (pressed)="decrease()">
              -10
            </ui-button>
            <ui-button size="sm" variant="outline" (pressed)="increase()">
              +10
            </ui-button>
            <ui-button size="sm" variant="secondary" (pressed)="reset()">
              Reset
            </ui-button>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly dynamicValue = signal(30);

  increase(): void {
    this.dynamicValue.update((v) => Math.min(100, v + 10));
  }

  decrease(): void {
    this.dynamicValue.update((v) => Math.max(0, v - 10));
  }

  reset(): void {
    this.dynamicValue.set(0);
  }
}
