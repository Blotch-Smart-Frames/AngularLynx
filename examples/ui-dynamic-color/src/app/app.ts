import { Component, computed, inject, signal } from '@angular/core';
import { LYNX_ELEMENTS, LynxTheme } from '@blotch/angular-lynx';
import { UiButton } from '../components/ui/button';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../components/ui/card';
import { UiDynamicColor } from '../components/ui/dynamic-color';
import { UiIcon } from '../components/ui/icon';
import { UiSlider } from '../components/ui/slider';
import { UiSwitch } from '../components/ui/switch';
import { UiToggleGroup, UiToggleGroupItem } from '../components/ui/toggle';

/** A theme color, and the class that fills a swatch with it. */
type Swatch = { readonly token: string; readonly fill: string };

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiButton,
    UiCard,
    UiCardContent,
    UiCardDescription,
    UiCardHeader,
    UiCardTitle,
    UiDynamicColor,
    UiIcon,
    UiSlider,
    UiSwitch,
    UiToggleGroup,
    UiToggleGroupItem,
  ],
  template: `
    <!-- The root view switches the dark class and takes the wallpaper's
         colors: everything inside it reads them. -->
    <view
      class="h-full bg-background"
      [class.dark]="theme.isDarkMode()"
      uiDynamicColor
    >
      <scroll-view scroll-orientation="vertical" class="h-full">
        <view class="flex-col gap-6 p-6 flex">
          <text class="text-2xl font-bold text-foreground">Dynamic color</text>
          <text class="text-sm text-muted-foreground">
            On Android 12 and later, the theme takes its colors from your
            wallpaper. Change the wallpaper or turn on dark mode, and the screen
            follows.
          </text>
          <view class="rounded-lg bg-primary/10 px-3 py-2">
            <text class="text-xs text-foreground">{{ status() }}</text>
          </view>

          <view class="flex-col gap-3 flex">
            <text class="text-lg font-semibold text-foreground">Controls</text>
            <view class="flex-row flex-wrap items-center gap-3 flex">
              <ui-button>Save</ui-button>
              <ui-button variant="secondary">Cancel</ui-button>
              <ui-button variant="outline">Edit</ui-button>
              <ui-button variant="glass">
                <ui-icon name="share-2" size="sm" />
                Share
              </ui-button>
            </view>
            <ui-toggle-group variant="segmented" [(value)]="range">
              @for (option of ranges; track option) {
                <ui-toggle-group-item
                  [value]="option"
                  [accessibility-label]="option"
                >
                  <text class="text-[13px] text-foreground">{{ option }}</text>
                </ui-toggle-group-item>
              }
            </ui-toggle-group>
            <view class="flex-row items-center flex justify-between">
              <text class="text-sm text-foreground">Notifications</text>
              <ui-switch
                [(checked)]="notifications"
                accessibility-label="Notifications"
              />
            </view>
            <ui-slider [(value)]="volume" accessibility-label="Volume" />
          </view>

          <ui-card>
            <ui-card-header>
              <ui-card-title>Trip to Lisbon</ui-card-title>
              <ui-card-description>3 nights · 2 guests</ui-card-description>
            </ui-card-header>
            <ui-card-content>
              <view class="flex-row items-center gap-2 flex">
                <ui-icon name="calendar" size="sm" color="var(--primary)" />
                <text class="text-sm text-muted-foreground">
                  Leaves Friday at 9:40
                </text>
              </view>
            </ui-card-content>
          </ui-card>

          <view class="flex-col gap-3 flex">
            <text class="text-lg font-semibold text-foreground">
              Theme colors
            </text>
            @for (swatch of swatches; track swatch.token) {
              <view class="flex-row items-center gap-3 flex">
                <view
                  [class]="
                    'h-8 w-8 rounded-md border border-border ' + swatch.fill
                  "
                />
                <text class="text-sm text-foreground">{{ swatch.token }}</text>
              </view>
            }
          </view>
        </view>
      </scroll-view>
    </view>
  `,
})
export class App {
  protected readonly theme = inject(LynxTheme);

  protected readonly ranges = ['Day', 'Week', 'Month'];
  protected readonly range = signal<string[]>(['Week']);
  protected readonly notifications = signal(true);
  protected readonly volume = signal(60);

  protected readonly swatches: readonly Swatch[] = [
    { token: 'background', fill: 'bg-background' },
    { token: 'primary', fill: 'bg-primary' },
    { token: 'secondary', fill: 'bg-secondary' },
    { token: 'muted', fill: 'bg-muted' },
    { token: 'accent', fill: 'bg-accent' },
    { token: 'border', fill: 'bg-border' },
  ];

  /** Where the colors come from, and the wallpaper's primary if there's one. */
  protected readonly status = computed(() => {
    const colors = this.theme.dynamicColors();
    if (!colors) {
      return 'No wallpaper colors here, so the screen shows the theme.';
    }
    const scheme = this.theme.isDarkMode() ? colors.dark : colors.light;
    return `Wallpaper colors from Android. Primary: ${scheme.primary}`;
  });
}
