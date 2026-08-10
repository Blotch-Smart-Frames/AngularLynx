import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import angularLogo from '../../assets/angular-logo.png';
import angularMascot from '../../assets/Google_Angular_Mascot_2D_Superhero.png';
import landscapeImage from '../../assets/landscape-image.jpg';
import { UiButton } from '../../components/ui/button';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * Showcase for the native Lynx `<image>` element, and — deliberately — a second
 * route that carries images so the "logo disappears after leaving and returning
 * to a route" behavior seen on `home` can be reproduced somewhere other than
 * home. Each card mirrors one of home's traits in isolation: a bundled PNG bound
 * with `[src]`, the same asset under a CSS keyframe animation, and an image
 * toggled through `@if`. If only some of these vanish on revisit, that isolates
 * which trait triggers it.
 *
 * Uses the shared `<app-demo-screen>` frame (it owns the page scroll-view), so
 * this screen only supplies content — no scroll-view/list/gesture of its own.
 */
@Component({
  selector: 'app-images-demo',
  hostDirectives: [ScreenHost],
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiButton,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
  ],
  template: `
    <app-demo-screen
      heading="Images"
      category="Elements"
      description="The native <image> element: bundled assets, scaling modes, remote URLs, animation, and conditional rendering."
    >
      <!-- Bundled assets bound with [src] — the exact pattern the home logo
           uses (a build-time PNG import fed through a property binding). -->
      <ui-card class="w-full">
        <ui-card-header class="p-4">
          <ui-card-title>Bundled assets</ui-card-title>
          <ui-card-description>
            PNGs imported at build time, bound with [src].
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-row items-center gap-6 p-4 pt-0 flex">
          <image [src]="angularLogo" class="h-[80px] w-[80px]" />
          <image [src]="angularMascot" class="h-[80px] w-[80px]" />
        </ui-card-content>
      </ui-card>

      <!-- Same bundled asset, but under an infinite CSS animation, matching the
           home logo's spin/shake. -->
      <ui-card class="w-full">
        <ui-card-header class="p-4">
          <ui-card-title>Animated</ui-card-title>
          <ui-card-description>
            A bundled logo driven by a CSS keyframe animation.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="items-center p-4 pt-0 flex">
          <image [src]="angularMascot" class="logo-spin h-[80px] w-[80px]" />
        </ui-card-content>
      </ui-card>

      <!-- The same image inside a fixed box under each scaling mode. mode is a
           native attribute (unlike the image config we set at creation, which
           the native layer ignores), so it actually reaches the element. A
           landscape photo is used here on purpose: because its aspect ratio
           differs from the square box, the three modes render visibly
           differently (letterboxed vs. cropped vs. stretched). -->
      <ui-card class="w-full">
        <ui-card-header class="p-4">
          <ui-card-title>Scaling modes</ui-card-title>
          <ui-card-description>
            The same image in a fixed box under different mode values.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-row gap-4 p-4 pt-0 flex">
          @for (mode of modes; track mode) {
            <view class="flex-col items-center gap-1 flex">
              <view
                class="h-[72px] w-[72px] items-center rounded-md bg-muted flex justify-center overflow-hidden"
              >
                <image
                  [src]="landscapeImage"
                  [attr.mode]="mode"
                  class="h-full w-full"
                />
              </view>
              <text class="text-xs text-muted-foreground">{{ mode }}</text>
            </view>
          }
        </ui-card-content>
      </ui-card>

      <!-- A network image, to contrast bundled assets with remote URLs. -->
      <ui-card class="w-full">
        <ui-card-header class="p-4">
          <ui-card-title>Remote URL</ui-card-title>
          <ui-card-description>
            Loaded over the network from angular.dev.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="items-center p-4 pt-0 flex">
          <image
            src="https://angular.dev/assets/images/press-kit/angular_icon_gradient.gif"
            mode="aspectFit"
            class="h-[96px] w-[96px]"
          />
        </ui-card-content>
      </ui-card>

      <!-- Toggling an image in and out of the tree with @if — the remount path
           within a single screen (distinct from the leave-and-return remount). -->
      <ui-card class="w-full">
        <ui-card-header class="p-4">
          <ui-card-title>Conditional</ui-card-title>
          <ui-card-description>
            Toggling an image in and out of the tree with a conditional block.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col items-center gap-3 p-4 pt-0 flex">
          <ui-button (pressed)="toggleConditional()">
            {{ showConditional() ? 'Hide' : 'Show' }} image
          </ui-button>
          @if (showConditional()) {
            <image [src]="angularMascot" class="h-[80px] w-[80px]" />
          }
        </ui-card-content>
      </ui-card>
    </app-demo-screen>
  `,
  styleUrl: './images-demo.css',
})
export class ImagesDemo {
  readonly angularLogo = angularLogo;
  readonly angularMascot = angularMascot;
  readonly landscapeImage = landscapeImage;

  /** Native <image> scaling modes, shown side by side in the same fixed box. */
  readonly modes = ['aspectFit', 'aspectFill', 'scaleToFill'];

  readonly showConditional = signal(true);

  toggleConditional(): void {
    this.showConditional.update((shown) => !shown);
  }
}
