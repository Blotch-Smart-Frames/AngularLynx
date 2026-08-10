import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiText } from '../components/ui/typography';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiText],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Typography</text>
        <text class="text-sm text-muted-foreground">
          Consistent text styles for headings, body text, and utility variants.
        </text>

        <!-- All Variants -->
        <view class="flex-col gap-4 flex">
          <text class="text-lg font-semibold text-foreground">Variants</text>

          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">h1</text>
            <ui-text variant="h1">The quick brown fox</ui-text>
          </view>

          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">h2</text>
            <ui-text variant="h2">The quick brown fox</ui-text>
          </view>

          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">h3</text>
            <ui-text variant="h3">The quick brown fox</ui-text>
          </view>

          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">h4</text>
            <ui-text variant="h4">The quick brown fox</ui-text>
          </view>

          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">p (default)</text>
            <ui-text variant="p">
              The quick brown fox jumps over the lazy dog. This is the default
              paragraph style used for body content throughout the application.
            </ui-text>
          </view>

          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">lead</text>
            <ui-text variant="lead">
              A lead paragraph that stands out from regular body text with a
              larger, lighter style.
            </ui-text>
          </view>

          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">large</text>
            <ui-text variant="large">Large emphasized text</ui-text>
          </view>

          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">small</text>
            <ui-text variant="small">
              Small text for fine print or labels
            </ui-text>
          </view>

          <view class="flex-col gap-1 flex">
            <text class="text-xs text-muted-foreground">muted</text>
            <ui-text variant="muted">
              Muted text for secondary or supplemental information.
            </ui-text>
          </view>
        </view>

        <!-- Custom Classes -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">
            Custom Classes
          </text>
          <text class="text-xs text-muted-foreground">
            Use the class input to add additional Tailwind styles.
          </text>
          <view class="flex-col gap-2 flex">
            <ui-text variant="p" class="text-primary">
              Primary colored text
            </ui-text>
            <ui-text variant="p" class="text-destructive">
              Destructive colored text
            </ui-text>
            <ui-text variant="small" class="font-bold text-primary">
              Bold primary small text
            </ui-text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {}
