import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiAvatar } from '../components/ui/avatar';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiAvatar],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="p-6">
        <text class="mb-6 text-2xl font-bold text-foreground">Avatar</text>

        <!-- With images -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          With Images
        </text>
        <view class="mb-6 flex-row items-center gap-3 flex">
          <ui-avatar src="https://i.pravatar.cc/150?img=1" />
          <ui-avatar src="https://i.pravatar.cc/150?img=5" />
          <ui-avatar src="https://i.pravatar.cc/150?img=12" />
        </view>

        <!-- Fallback initials -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Fallback Initials
        </text>
        <view class="mb-6 flex-row items-center gap-3 flex">
          <ui-avatar fallback="JD" />
          <ui-avatar fallback="AB" />
          <ui-avatar fallback="ZK" />
        </view>

        <!-- Sizes -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Sizes
        </text>
        <view class="mb-6 flex-row items-center gap-3 flex">
          <ui-avatar src="https://i.pravatar.cc/150?img=3" size="sm" />
          <ui-avatar src="https://i.pravatar.cc/150?img=3" size="default" />
          <ui-avatar src="https://i.pravatar.cc/150?img=3" size="lg" />
        </view>

        <!-- Sizes with fallback -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Sizes with Fallback
        </text>
        <view class="flex-row items-center gap-3 flex">
          <ui-avatar fallback="SM" size="sm" />
          <ui-avatar fallback="MD" size="default" />
          <ui-avatar fallback="LG" size="lg" />
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {}
