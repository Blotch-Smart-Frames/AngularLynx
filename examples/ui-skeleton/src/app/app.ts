import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiSkeleton } from '../components/ui/skeleton';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiSkeleton],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="p-6">
        <text class="mb-6 text-2xl font-bold text-foreground">Skeleton</text>

        <!-- Card skeleton -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Card Loading State
        </text>
        <view
          class="mb-6 flex-col gap-4 rounded-lg border border-border p-4 flex"
        >
          <view class="flex-row items-center gap-3 flex">
            <ui-skeleton class="h-10 w-10 rounded-full" />
            <view class="flex-1 flex-col gap-2 flex">
              <ui-skeleton class="h-4 w-3/4" />
              <ui-skeleton class="h-3 w-1/2" />
            </view>
          </view>
          <ui-skeleton class="h-48 w-full rounded-md" />
          <view class="flex-col gap-2 flex">
            <ui-skeleton class="h-4 w-full" />
            <ui-skeleton class="h-4 w-5/6" />
            <ui-skeleton class="h-4 w-4/6" />
          </view>
        </view>

        <!-- Profile skeleton -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Profile Loading State
        </text>
        <view
          class="mb-6 flex-col gap-4 rounded-lg border border-border p-4 flex"
        >
          <view class="flex-col items-center gap-3 flex">
            <ui-skeleton class="h-16 w-16 rounded-full" />
            <ui-skeleton class="h-5 w-32" />
            <ui-skeleton class="h-3 w-48" />
          </view>
        </view>

        <!-- List skeleton -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          List Loading State
        </text>
        <view class="flex-col gap-3 rounded-lg border border-border p-4 flex">
          @for (item of [1, 2, 3]; track item) {
            <view class="flex-row items-center gap-3 flex">
              <ui-skeleton class="h-8 w-8 rounded-full" />
              <view class="flex-1 flex-col gap-1.5 flex">
                <ui-skeleton class="h-4 w-2/3" />
                <ui-skeleton class="h-3 w-1/3" />
              </view>
              <ui-skeleton class="h-6 w-16 rounded-md" />
            </view>
          }
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {}
