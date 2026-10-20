import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiButton } from '../../components/ui/button';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

type BlurEffect = 'light' | 'extra-light' | 'dark';
type GlassStyle = 'regular' | 'clear';

/**
 * Showcase for the native `<blur-view>` element: a backdrop blur with live
 * radius/effect controls, and iOS Liquid Glass shapes merged by a
 * `glass-container`. The draggable glass lives on its own route
 * (glass-playground-demo) because dragging inside this screen's scroll-view
 * would scroll the page instead.
 *
 * Uses the shared `<app-demo-screen>` frame (it owns the page scroll-view).
 */
@Component({
  selector: 'app-blur-view-demo',
  hostDirectives: [ScreenHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiButton,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
    UiText,
  ],
  template: `
    <app-demo-screen
      heading="Blur View"
      category="Elements"
      description="The native <blur-view> element: backdrop blur on every platform, and Liquid Glass on iOS 26."
    >
      <ui-card class="w-full">
        <ui-card-header class="p-4">
          <ui-card-title>Backdrop blur</ui-card-title>
          <ui-card-description>
            Blurs whatever renders behind it, like CSS backdrop-filter.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <!--
            A gradient and bright shapes give the blur something visible to
            soften: a flat color looks the same blurred or not.
          -->
          <view class="h-[180px] rounded-lg relative overflow-hidden">
            <view
              class="h-full w-full"
              style="background-image: linear-gradient(135deg, #6366f1, #ec4899, #f97316);"
            ></view>
            <view
              class="h-[80px] w-[80px] rounded-full bg-yellow-300 absolute left-[20px] top-[24px]"
            ></view>
            <view
              class="h-[96px] w-[96px] rounded-full bg-emerald-400 absolute right-[24px] top-[48px]"
            ></view>
            <blur-view
              class="h-[64px] flex-col rounded-xl px-4 flex absolute bottom-[12px] left-[12px] right-[12px] justify-center"
              [blur-radius]="radius() + 'px'"
              [blur-effect]="effect()"
            >
              <text class="text-sm font-semibold text-zinc-900">
                blur-radius: {{ radius() }}px
              </text>
            </blur-view>
          </view>

          <ui-text variant="muted">Radius</ui-text>
          <view class="flex-row gap-2 flex">
            @for (r of radii; track r) {
              <ui-button
                size="sm"
                [variant]="r === radius() ? 'default' : 'outline'"
                (pressed)="radius.set(r)"
              >
                {{ r }}px
              </ui-button>
            }
          </view>

          <ui-text variant="muted">blur-effect</ui-text>
          <view class="flex-row gap-2 flex">
            @for (e of effects; track e) {
              <ui-button
                size="sm"
                [variant]="e === effect() ? 'default' : 'outline'"
                (pressed)="effect.set(e)"
              >
                {{ e }}
              </ui-button>
            }
          </view>
        </ui-card-content>
      </ui-card>

      <ui-card class="w-full">
        <ui-card-header class="p-4">
          <ui-card-title>Liquid Glass</ui-card-title>
          <ui-card-description>
            blur-effect="glass" inside a glass-container, which merges nearby
            shapes. iOS 26 only; other platforms show frosted circles.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view
            class="h-[140px] items-center rounded-lg flex relative justify-center overflow-hidden"
          >
            <view
              class="h-full w-full absolute left-0 top-0"
              style="background-image: linear-gradient(135deg, #6366f1, #ec4899, #f97316);"
            ></view>
            <!-- Stripes behind the glass so the refraction is visible. -->
            <view class="h-full w-full flex-row flex absolute left-0 top-0">
              @for (stripe of stripes; track stripe) {
                <view
                  class="mr-[18px] h-full w-[14px]"
                  [class.bg-white]="stripe % 2 === 0"
                  [class.bg-yellow-300]="stripe % 2 === 1"
                ></view>
              }
            </view>
            <blur-view
              class="flex-row items-center flex"
              blur-effect="glass-container"
              [spacing]="16"
            >
              @for (tint of tints; track tint) {
                <blur-view
                  class="mx-1.5 h-[60px] w-[60px] rounded-full"
                  blur-effect="glass"
                  blur-radius="16px"
                  [glass-style]="glassStyle()"
                  [glass-interactive]="true"
                  [glass-tint-color]="tint"
                ></blur-view>
              }
            </blur-view>
          </view>

          <ui-text variant="muted">glass-style</ui-text>
          <view class="flex-row gap-2 flex">
            @for (s of glassStyles; track s) {
              <ui-button
                size="sm"
                [variant]="s === glassStyle() ? 'default' : 'outline'"
                (pressed)="glassStyle.set(s)"
              >
                {{ s }}
              </ui-button>
            }
          </view>
          <ui-text variant="muted">
            Drag glass over text on the Glass Playground screen.
          </ui-text>
        </ui-card-content>
      </ui-card>
    </app-demo-screen>
  `,
})
export class BlurViewDemo {
  readonly radii = [0, 8, 16, 32] as const;
  readonly effects: readonly BlurEffect[] = ['light', 'extra-light', 'dark'];
  readonly glassStyles: readonly GlassStyle[] = ['regular', 'clear'];
  // Enough stripes to span a tablet-width screen; overflow-hidden clips the
  // excess on phones.
  readonly stripes = Array.from({ length: 30 }, (_, i) => i);
  readonly tints = [
    'transparent',
    'rgba(59, 130, 246, 0.35)',
    'rgba(236, 72, 153, 0.35)',
  ] as const;

  readonly radius = signal<number>(16);
  readonly effect = signal<BlurEffect>('light');
  readonly glassStyle = signal<GlassStyle>('regular');
}
