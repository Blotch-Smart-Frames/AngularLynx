import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiSeparator } from '../components/ui/separator';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiSeparator],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Separator</text>
        <text class="text-sm text-muted-foreground">
          A visual divider between sections of content.
        </text>

        <!-- Horizontal separator between text blocks -->
        <view class="flex-col gap-4 flex">
          <text class="text-lg font-semibold text-foreground">
            Horizontal
          </text>
          <view class="flex-col flex">
            <text class="text-sm text-foreground">
              AngularLynx is a renderer for Angular on Lynx.
            </text>
            <text class="text-sm text-muted-foreground">
              Build native mobile apps with Angular.
            </text>
          </view>
          <ui-separator />
          <view class="flex-col flex">
            <text class="text-sm text-foreground">
              Components are styled with Tailwind CSS.
            </text>
            <text class="text-sm text-muted-foreground">
              Customize everything with CSS variables.
            </text>
          </view>
          <ui-separator />
          <view class="flex-col flex">
            <text class="text-sm text-foreground">
              Signal-based inputs and outputs.
            </text>
            <text class="text-sm text-muted-foreground">
              Modern Angular patterns throughout.
            </text>
          </view>
        </view>

        <!-- Vertical separator in a row layout -->
        <view class="flex-col gap-4 flex">
          <text class="text-lg font-semibold text-foreground"> Vertical </text>
          <view class="h-5 flex-row items-center gap-4 flex">
            <text class="text-sm text-foreground">Blog</text>
            <ui-separator orientation="vertical" />
            <text class="text-sm text-foreground">Docs</text>
            <ui-separator orientation="vertical" />
            <text class="text-sm text-foreground">Source</text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {}
