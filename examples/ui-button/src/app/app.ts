import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { UiButton } from '../components/ui/button';
import { injectGlassDesign } from '../components/ui/glass';
import { UiIcon } from '../components/ui/icon';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiButton, UiIcon],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Button</text>
        <text class="text-sm text-muted-foreground">
          A versatile button component with multiple variants and sizes.
        </text>

        <!-- Variants -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Variants</text>
          <view class="flex-row flex-wrap gap-3 flex">
            <ui-button variant="default" (pressed)="onPress('default')">
              Default
            </ui-button>
            <ui-button variant="destructive" (pressed)="onPress('destructive')">
              Destructive
            </ui-button>
            <ui-button variant="outline" (pressed)="onPress('outline')">
              Outline
            </ui-button>
            <ui-button variant="secondary" (pressed)="onPress('secondary')">
              Secondary
            </ui-button>
            <ui-button variant="ghost" (pressed)="onPress('ghost')">
              Ghost
            </ui-button>
          </view>
        </view>

        <!-- Glass: Liquid Glass on iOS 26, and each platform's own design
             elsewhere. Glass belongs to controls that float over content, so
             these sit on a colorful card for the glass to bend. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Glass</text>
          <text class="text-xs text-muted-foreground">{{ status() }}</text>
          <text class="text-xs text-muted-foreground">
            Last pressed: {{ lastPressed() || 'none yet' }}
          </text>
          <view
            class="flex-col gap-3 rounded-[20px] p-4 flex overflow-hidden"
            [style.background-image]="ocean"
          >
            <view class="flex-row flex-wrap items-center gap-3 flex">
              <ui-button variant="glass" (pressed)="onPress('glass')">
                Edit
              </ui-button>
              <ui-button
                variant="glass-prominent"
                (pressed)="onPress('glass-prominent')"
              >
                Done
              </ui-button>
              <ui-button variant="glass" (pressed)="onPress('share')">
                <ui-icon name="share-2" size="sm" />
                Share
              </ui-button>
            </view>
            <view class="flex-row items-center gap-3 flex">
              <ui-button
                variant="glass"
                size="icon-circle"
                accessibility-label="Add"
                (pressed)="onPress('add')"
              >
                <ui-icon name="plus" />
              </ui-button>
              <ui-button
                variant="glass"
                size="icon-circle"
                accessibility-label="Favorite"
                (pressed)="onPress('favorite')"
              >
                <ui-icon name="heart" />
              </ui-button>
              <ui-button
                variant="glass"
                size="icon-circle"
                [disabled]="true"
                accessibility-label="More"
              >
                <ui-icon name="ellipsis" />
              </ui-button>
              <ui-button
                variant="glass-prominent"
                size="icon-circle"
                accessibility-label="Done"
                (pressed)="onPress('done')"
              >
                <ui-icon name="check" />
              </ui-button>
            </view>
          </view>
        </view>

        <!-- Clear glass, for buttons over photos and video. It sits on a
             dimming layer, so its white label stays legible over bright
             content. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Clear glass</text>
          <view
            class="h-[180px] flex-col rounded-[20px] p-4 flex justify-between overflow-hidden"
            [style.background-image]="photo"
          >
            <view class="flex-row items-center flex justify-between">
              <ui-button
                variant="glass-clear"
                size="icon-circle"
                accessibility-label="Close"
                (pressed)="onPress('close')"
              >
                <ui-icon name="x" />
              </ui-button>
              <ui-button
                variant="glass-clear"
                size="sm"
                (pressed)="onPress('save')"
              >
                <ui-icon name="download" size="sm" />
                Save
              </ui-button>
            </view>
            <view class="flex-row items-center gap-4 flex justify-center">
              <ui-button
                variant="glass-clear"
                size="icon-circle"
                accessibility-label="Back"
                (pressed)="onPress('back')"
              >
                <ui-icon name="rewind" />
              </ui-button>
              <ui-button
                variant="glass-clear"
                size="icon-circle"
                accessibility-label="Play"
                (pressed)="onPress('play')"
              >
                <ui-icon name="play" />
              </ui-button>
              <ui-button
                variant="glass-clear"
                size="icon-circle"
                accessibility-label="Forward"
                (pressed)="onPress('forward')"
              >
                <ui-icon name="fast-forward" />
              </ui-button>
            </view>
          </view>
        </view>

        <!-- Sizes -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Sizes</text>
          <view class="flex-row flex-wrap items-center gap-3 flex">
            <ui-button size="sm">Small</ui-button>
            <ui-button size="default">Default</ui-button>
            <ui-button size="lg">Large</ui-button>
            <ui-button size="icon">+</ui-button>
            <ui-button
              size="icon-circle"
              variant="outline"
              accessibility-label="Search"
            >
              <ui-icon name="search" size="sm" />
            </ui-button>
          </view>
        </view>

        <!-- Disabled -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Disabled</text>
          <view class="flex-row flex-wrap gap-3 flex">
            <ui-button [disabled]="true">Disabled</ui-button>
            <ui-button variant="destructive" [disabled]="true">
              Disabled
            </ui-button>
            <ui-button variant="outline" [disabled]="true">
              Disabled
            </ui-button>
          </view>
        </view>

        <!-- Loading -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Loading</text>
          <view class="flex-row flex-wrap gap-3 flex">
            <ui-button [loading]="true">Loading</ui-button>
            <ui-button variant="secondary" [loading]="true">
              Loading
            </ui-button>
            <ui-button variant="outline" [loading]="true"> Loading </ui-button>
          </view>
        </view>

        <!-- Interactive -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Interactive</text>
          <view class="flex-row items-center gap-3 flex">
            <ui-button (pressed)="onPress('tap')">Tap me</ui-button>
            <text class="text-sm text-muted-foreground">
              Pressed: {{ pressCount() }} times
            </text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);
  readonly #design = injectGlassDesign();

  readonly ocean = 'linear-gradient(135deg, #22d3ee, #6366f1 55%, #a855f7)';
  /** A bright "photo", the kind clear glass needs its dimming layer over. */
  readonly photo =
    'linear-gradient(160deg, #fef9c3, #fde68a 30%, #fb923c 65%, #be185d)';

  readonly pressCount = signal(0);
  readonly lastPressed = signal('');

  /** What the glass buttons draw here, and the settings they follow. */
  readonly status = computed(() => {
    const on = (value: boolean) => (value ? 'on' : 'off');
    const os = `${this.#system.platform} ${this.#system.osVersion}`.trim();
    return [
      `Design: ${this.#design()} on ${os}`,
      `Reduce Motion: ${on(this.#settings.reduceMotion())}`,
      `Reduce Transparency: ${on(this.#settings.reduceTransparency())}`,
      `Increase Contrast: ${on(this.#settings.increaseContrast())}`,
    ].join(' · ');
  });

  onPress(variant: string): void {
    this.pressCount.update((n) => n + 1);
    this.lastPressed.set(variant);
  }
}
