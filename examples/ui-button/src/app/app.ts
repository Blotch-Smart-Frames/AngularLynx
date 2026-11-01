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

        <!-- Icons: before the label, or after it with trailing, for an icon
             that points onward. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Icons</text>
          <view class="flex-row flex-wrap items-center gap-3 flex">
            <ui-button variant="outline" (pressed)="onPress('download')">
              <ui-icon name="download" size="sm" />
              Download
            </ui-button>
            <ui-button variant="secondary" (pressed)="onPress('next')">
              Next
              <ui-icon name="arrow-right" size="sm" trailing />
            </ui-button>
          </view>
        </view>

        <!-- Sign in: a provider's mark is the app's own SVG. GitHub's draws
             in currentColor, so it follows the label; Google's keeps its
             colors. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Sign in</text>
          <view class="flex-col gap-3 flex">
            <ui-button variant="outline" (pressed)="onPress('google')">
              <ui-icon [svg]="googleMark" size="sm" />
              Continue with Google
            </ui-button>
            <ui-button variant="outline" (pressed)="onPress('github')">
              <ui-icon [svg]="githubMark" size="sm" />
              Continue with GitHub
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

  /** One color, written as `currentColor`: it takes the label's color. */
  readonly githubMark = `<svg viewBox="0 0 16 16"><path fill="currentColor" d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"/></svg>`;

  /** Four colors, written out: they stay as they are. */
  readonly googleMark = `<svg viewBox="0 0 256 262"><path fill="#4285F4" d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027"/><path fill="#34A853" d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1"/><path fill="#FBBC05" d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782"/><path fill="#EB4335" d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251"/></svg>`;

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
