import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { ICONS, UiIcon, type IconName } from '../components/ui/icon';
import { UiText } from '../components/ui/typography';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiIcon, UiText],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Icon</text>
        <text class="text-sm text-muted-foreground">
          SVG icons rendered natively via Lynx's svg element.
        </text>

        <!-- All Icons -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">All Icons</text>
          <view class="flex-row flex-wrap gap-4 flex">
            @for (icon of icons; track icon) {
              <view
                class="flex-col items-center gap-1 rounded-md border border-border p-3 flex justify-center"
                style="width: 80px;"
              >
                <ui-icon [name]="icon" size="md" />
                <text class="text-xs text-muted-foreground">{{ icon }}</text>
              </view>
            }
          </view>
        </view>

        <!-- Sizes -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Sizes</text>
          <view class="flex-row items-end gap-6 flex">
            <view class="flex-col items-center gap-1 flex">
              <ui-icon name="heart" size="xs" />
              <text class="text-xs text-muted-foreground">xs (16px)</text>
            </view>
            <view class="flex-col items-center gap-1 flex">
              <ui-icon name="heart" size="sm" />
              <text class="text-xs text-muted-foreground">sm (20px)</text>
            </view>
            <view class="flex-col items-center gap-1 flex">
              <ui-icon name="heart" size="md" />
              <text class="text-xs text-muted-foreground">md (24px)</text>
            </view>
            <view class="flex-col items-center gap-1 flex">
              <ui-icon name="heart" size="lg" />
              <text class="text-xs text-muted-foreground">lg (32px)</text>
            </view>
          </view>
        </view>

        <!-- Custom Colors -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">
            Custom Colors
          </text>
          <view class="flex-row flex-wrap gap-4 flex">
            <view class="flex-col items-center gap-1 flex">
              <ui-icon name="heart" size="lg" color="#ef4444" />
              <text class="text-xs text-muted-foreground">Red</text>
            </view>
            <view class="flex-col items-center gap-1 flex">
              <ui-icon name="star" size="lg" color="#eab308" />
              <text class="text-xs text-muted-foreground">Yellow</text>
            </view>
            <view class="flex-col items-center gap-1 flex">
              <ui-icon name="check" size="lg" color="#22c55e" />
              <text class="text-xs text-muted-foreground">Green</text>
            </view>
            <view class="flex-col items-center gap-1 flex">
              <ui-icon name="info" size="lg" color="#3b82f6" />
              <text class="text-xs text-muted-foreground">Blue</text>
            </view>
            <view class="flex-col items-center gap-1 flex">
              <ui-icon name="alert-triangle" size="lg" color="#f97316" />
              <text class="text-xs text-muted-foreground">Orange</text>
            </view>
            <view class="flex-col items-center gap-1 flex">
              <ui-icon name="settings" size="lg" color="#8b5cf6" />
              <text class="text-xs text-muted-foreground">Purple</text>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  // Derived from ICONS so this demo never drifts out of sync with the
  // component's actual icon set as new icons are added.
  readonly icons: IconName[] = Object.keys(ICONS) as IconName[];
}
