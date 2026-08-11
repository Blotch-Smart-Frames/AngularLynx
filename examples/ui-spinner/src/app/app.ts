import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiSpinner } from '../components/ui/spinner';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiSpinner],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="p-6">
        <text class="mb-6 text-2xl font-bold text-foreground">Spinner</text>

        <!-- Sizes -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Sizes
        </text>
        <view class="mb-6 flex-row items-center gap-6 flex">
          <view class="flex-col items-center gap-2 flex">
            <ui-spinner size="xs" />
            <text class="text-xs text-muted-foreground">xs</text>
          </view>
          <view class="flex-col items-center gap-2 flex">
            <ui-spinner size="sm" />
            <text class="text-xs text-muted-foreground">sm</text>
          </view>
          <view class="flex-col items-center gap-2 flex">
            <ui-spinner size="md" />
            <text class="text-xs text-muted-foreground">md</text>
          </view>
          <view class="flex-col items-center gap-2 flex">
            <ui-spinner size="lg" />
            <text class="text-xs text-muted-foreground">lg</text>
          </view>
        </view>

        <!-- Custom colors -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Custom Colors
        </text>
        <view class="mb-6 flex-row items-center gap-6 flex">
          <view class="flex-col items-center gap-2 flex">
            <ui-spinner color="#3b82f6" />
            <text class="text-xs text-muted-foreground">Blue</text>
          </view>
          <view class="flex-col items-center gap-2 flex">
            <ui-spinner color="#ef4444" />
            <text class="text-xs text-muted-foreground">Red</text>
          </view>
          <view class="flex-col items-center gap-2 flex">
            <ui-spinner color="#22c55e" />
            <text class="text-xs text-muted-foreground">Green</text>
          </view>
          <view class="flex-col items-center gap-2 flex">
            <ui-spinner color="#f59e0b" />
            <text class="text-xs text-muted-foreground">Amber</text>
          </view>
        </view>

        <!-- In context -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          In Context
        </text>
        <view
          class="flex-col items-center gap-3 rounded-lg border border-border p-6 flex"
        >
          <ui-spinner size="lg" />
          <text class="text-sm text-muted-foreground">Loading content...</text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {}
