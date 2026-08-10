import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../components/ui/badge';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiBadge],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="p-6">
        <text class="mb-6 text-2xl font-bold text-foreground">Badge</text>

        <!-- Variants -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Variants
        </text>
        <view class="mb-6 flex-row flex-wrap gap-2 flex">
          <ui-badge>Default</ui-badge>
          <ui-badge variant="secondary">Secondary</ui-badge>
          <ui-badge variant="destructive">Destructive</ui-badge>
          <ui-badge variant="outline">Outline</ui-badge>
        </view>

        <!-- Usage examples -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Common Uses
        </text>
        <view class="flex-col gap-3 flex">
          <view class="flex-row items-center gap-2 flex">
            <text class="text-sm text-foreground">Status</text>
            <ui-badge>Active</ui-badge>
          </view>
          <view class="flex-row items-center gap-2 flex">
            <text class="text-sm text-foreground">Notifications</text>
            <ui-badge variant="destructive">3</ui-badge>
          </view>
          <view class="flex-row items-center gap-2 flex">
            <text class="text-sm text-foreground">Category</text>
            <ui-badge variant="secondary">Angular</ui-badge>
          </view>
          <view class="flex-row items-center gap-2 flex">
            <text class="text-sm text-foreground">Version</text>
            <ui-badge variant="outline">v2.0</ui-badge>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {}
