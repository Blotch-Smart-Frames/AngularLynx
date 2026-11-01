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

        <!-- Your own SVG: a mark the set doesn't have. currentColor in it
             takes the icon's color, so GitHub's follows the theme, and
             Google's keeps its four colors. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">
            Your Own SVG
          </text>
          <view class="flex-row flex-wrap gap-4 flex">
            <view class="flex-col items-center gap-1 flex">
              <ui-icon [svg]="githubMark" size="lg" />
              <text class="text-xs text-muted-foreground">GitHub</text>
            </view>
            <view class="flex-col items-center gap-1 flex">
              <ui-icon [svg]="googleMark" size="lg" />
              <text class="text-xs text-muted-foreground">Google</text>
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

  /** One color, written as `currentColor`: it follows the theme. */
  readonly githubMark = `<svg viewBox="0 0 16 16"><path fill="currentColor" d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"/></svg>`;

  /** Four colors, written out: they stay as they are. */
  readonly googleMark = `<svg viewBox="0 0 256 262"><path fill="#4285F4" d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027"/><path fill="#34A853" d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1"/><path fill="#FBBC05" d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782"/><path fill="#EB4335" d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251"/></svg>`;
}
