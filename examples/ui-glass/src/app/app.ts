import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { UiIcon } from '../components/ui/icon';
import {
  UiGlass,
  UiGlassGroup,
  concentricRadius,
  injectGlassDesign,
} from '../components/ui/glass';

/** The rounded panel's corners, and how far its content sits inside them. */
const PANEL_RADIUS = 28;
const PANEL_PADDING = 8;

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiGlass, UiGlassGroup, UiIcon],
  template: `
    <view class="h-full w-full relative">
      <!-- Glass shows what's behind it, so the screen gets a busy backdrop:
           a gradient with stripes that the floating bar bends. -->
      <view
        class="h-full w-full absolute left-0 top-0"
        style="background-image: linear-gradient(160deg, #c7d2fe, #fbcfe8 45%, #fed7aa);"
      ></view>
      <view class="h-full w-full flex-row flex absolute left-0 top-0">
        @for (stripe of stripes; track stripe) {
          <view
            class="mr-[22px] h-full w-[10px] shrink-0"
            [class.bg-white]="stripe % 2 === 0"
            [class.bg-indigo-300]="stripe % 2 === 1"
          ></view>
        }
      </view>

      <scroll-view scroll-orientation="vertical" class="h-full w-full">
        <view class="flex-col gap-6 px-4 pb-[140px] flex pt-safe-6">
          <view class="flex-col gap-1 flex">
            <text class="text-2xl font-bold text-foreground">Glass</text>
            <text class="text-sm text-foreground">
              Liquid Glass for the controls that float over your content.
            </text>
            <text class="text-xs text-foreground">{{ status() }}</text>
          </view>

          <!-- Each demo's glass sits right on a colorful card, so there's
               something behind it to bend. -->

          <!-- Variants: regular glass, and clear glass, which is for media,
               with and without the dimming layer -->
          <view class="flex-col gap-3 flex">
            <text class="text-sm font-semibold text-foreground">Variants</text>
            <view
              class="h-[150px] flex-col rounded-[20px] p-3 flex justify-between overflow-hidden"
              [style.background-image]="sunset"
            >
              <blur-view
                ui-glass
                class="items-center self-start px-4 py-2 flex justify-center"
              >
                <text class="text-sm font-medium text-glass-foreground">
                  Regular
                </text>
              </blur-view>
              <view class="flex-row items-end gap-3 flex">
                <!-- Clear glass over bright content gets a dark layer under
                     it, at about a third, so the white stays legible. -->
                <view
                  class="h-[52px] w-[52px] rounded-full bg-glass-dim relative"
                >
                  <blur-view
                    ui-glass
                    variant="clear"
                    shape="circle"
                    class="h-[52px] w-[52px] items-center flex justify-center"
                  >
                    <ui-icon name="play" />
                  </blur-view>
                </view>
                <blur-view
                  ui-glass
                  variant="clear"
                  shape="circle"
                  class="h-[52px] w-[52px] items-center flex justify-center"
                >
                  <ui-icon name="pause" />
                </blur-view>
                <text class="text-xs text-white">
                  Clear, dimmed and not dimmed
                </text>
              </view>
            </view>
          </view>

          <!-- Shapes, and a concentric card inside the rounded one -->
          <view class="flex-col gap-3 flex">
            <text class="text-sm font-semibold text-foreground">Shapes</text>
            <view
              class="flex-col gap-3 rounded-[20px] p-3 flex overflow-hidden"
              [style.background-image]="ocean"
            >
              <view class="flex-row items-center gap-3 flex">
                <blur-view
                  ui-glass
                  shape="capsule"
                  class="h-[48px] items-center px-5 flex justify-center"
                >
                  <text class="text-sm text-glass-foreground">Capsule</text>
                </blur-view>
                <blur-view
                  ui-glass
                  shape="circle"
                  class="h-[48px] w-[48px] items-center flex justify-center"
                >
                  <ui-icon name="heart" />
                </blur-view>
              </view>
              <blur-view
                ui-glass
                shape="rounded"
                [radius]="panelRadius"
                [style.padding.px]="panelPadding"
                class="flex-col flex"
              >
                <!-- Inset by the padding, its corners share the panel's
                     centers: concentricRadius(28, 8) is 20. -->
                <view
                  class="bg-background px-4 py-3"
                  [style.border-radius.px]="innerRadius"
                >
                  <text class="text-sm text-foreground">
                    Rounded, {{ panelRadius }}px, with a concentric
                    {{ innerRadius }}px card inside
                  </text>
                </view>
              </blur-view>
            </view>
          </view>

          <!-- Tint -->
          <view class="flex-col gap-3 flex">
            <text class="text-sm font-semibold text-foreground">Tint</text>
            <view
              class="flex-row gap-3 rounded-[20px] p-3 flex overflow-hidden"
              [style.background-image]="mint"
            >
              <blur-view
                ui-glass
                class="h-[44px] flex-1 items-center flex justify-center"
              >
                <text class="text-sm text-glass-foreground">None</text>
              </blur-view>
              <blur-view
                ui-glass
                tint="var(--glass-tint)"
                class="h-[44px] flex-1 items-center flex justify-center"
              >
                <text class="text-sm text-glass-tint-foreground">Theme</text>
              </blur-view>
              <blur-view
                ui-glass
                tint="#2563eb"
                class="h-[44px] flex-1 items-center flex justify-center"
              >
                <text class="text-sm text-white">Blue</text>
              </blur-view>
            </view>
          </view>

          <!-- Interactive -->
          <view class="flex-col gap-3 flex">
            <text class="text-sm font-semibold text-foreground">
              Interactive
            </text>
            <view
              class="flex-col rounded-[20px] p-3 flex overflow-hidden"
              [style.background-image]="sunset"
            >
              <blur-view
                ui-glass
                interactive
                class="h-[52px] items-center flex justify-center"
                (bindtap)="taps.set(taps() + 1)"
              >
                <text class="text-sm font-medium text-glass-foreground">
                  Press me · {{ taps() }}
                </text>
              </blur-view>
            </view>
          </view>

          <!-- Group -->
          <view class="flex-col gap-3 flex">
            <text class="text-sm font-semibold text-foreground">Group</text>
            <text class="text-xs text-foreground">
              Glass in a group merges within its spacing.
            </text>
            <view
              class="flex-row items-center gap-4 rounded-[20px] p-3 flex overflow-hidden"
              [style.background-image]="ocean"
            >
              <blur-view
                ui-glass-group
                [spacing]="24"
                class="flex-row items-center flex"
              >
                <blur-view
                  ui-glass
                  shape="circle"
                  class="h-[56px] w-[56px] items-center flex justify-center"
                >
                  <ui-icon name="sun" />
                </blur-view>
                <blur-view
                  ui-glass
                  shape="circle"
                  class="h-[56px] w-[56px] items-center flex justify-center"
                  [style.margin-left.px]="merged() ? 4 : 48"
                  [style.transition]="groupTransition()"
                >
                  <ui-icon name="moon" />
                </blur-view>
              </blur-view>
              <view
                class="rounded-full bg-foreground px-4 py-2"
                (bindtap)="merged.set(!merged())"
              >
                <text class="text-xs text-background">
                  {{ merged() ? 'Pull apart' : 'Bring together' }}
                </text>
              </view>
            </view>
          </view>

          <!-- Morph: a button and the panel it opens share a glassId, so
               when one replaces the other the group morphs it into the
               other, on iOS 26 in an app built with ng build --platform. -->
          <view class="flex-col gap-3 flex">
            <text class="text-sm font-semibold text-foreground">Morph</text>
            <text class="text-xs text-foreground">
              Shapes with the same glassId turn into each other.
            </text>
            <view
              class="h-[200px] rounded-[20px] p-3 flex overflow-hidden"
              [style.background-image]="sunset"
            >
              <blur-view ui-glass-group class="flex-1 relative">
                @if (composing()) {
                  <blur-view
                    ui-glass
                    shape="rounded"
                    [radius]="panelRadius"
                    glassId="compose"
                    class="flex-col gap-2 p-4 flex absolute bottom-0 left-0 right-0 top-0"
                  >
                    <text class="text-base font-semibold text-glass-foreground">
                      New note
                    </text>
                    <text class="text-sm text-glass-muted-foreground">
                      Grown out of the button that opened it.
                    </text>
                    <view
                      class="self-end rounded-full bg-foreground px-4 py-2"
                      (bindtap)="composing.set(false)"
                    >
                      <text class="text-xs text-background">Done</text>
                    </view>
                  </blur-view>
                } @else {
                  <blur-view
                    ui-glass
                    shape="circle"
                    interactive
                    glassId="compose"
                    class="h-[56px] w-[56px] items-center flex absolute bottom-0 right-0 justify-center"
                    [accessibility-element]="true"
                    accessibility-traits="button"
                    accessibility-label="New note"
                    (bindtap)="composing.set(true)"
                  >
                    <ui-icon name="plus" />
                  </blur-view>
                }
              </blur-view>
            </view>
          </view>
        </view>
      </scroll-view>

      <!-- A floating bar over the content, the layer glass belongs to: a
           capsule of actions and a separate button, in a group so they merge
           when close. It clears the home indicator by the safe area. -->
      <blur-view
        ui-glass-group
        [spacing]="16"
        class="flex-row items-center gap-3 flex absolute left-[16px] right-[16px]"
        style="bottom: calc(16px + env(safe-area-inset-bottom));"
      >
        <blur-view
          ui-glass
          class="h-[56px] flex-1 flex-row items-center px-2 flex justify-around"
        >
          @for (action of actions; track action) {
            <view class="items-center px-3 py-2 flex justify-center">
              <ui-icon [name]="action" />
            </view>
          }
        </blur-view>
        <blur-view
          ui-glass
          shape="circle"
          interactive
          class="h-[56px] w-[56px] items-center flex justify-center"
        >
          <ui-icon name="search" />
        </blur-view>
      </blur-view>
    </view>
  `,
})
export class App {
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);
  readonly #design = injectGlassDesign();

  readonly stripes = Array.from({ length: 40 }, (_, i) => i);
  readonly sunset =
    'linear-gradient(120deg, #fde047, #f97316 40%, #db2777 70%, #4f46e5)';
  readonly ocean = 'linear-gradient(135deg, #22d3ee, #6366f1 55%, #a855f7)';
  readonly mint = 'linear-gradient(135deg, #a7f3d0, #60a5fa 50%, #f9a8d4)';
  readonly actions = ['home', 'inbox', 'user'] as const;
  readonly panelRadius = PANEL_RADIUS;
  readonly panelPadding = PANEL_PADDING;
  readonly innerRadius = concentricRadius(PANEL_RADIUS, PANEL_PADDING);

  readonly taps = signal(0);
  readonly merged = signal(true);
  readonly composing = signal(false);

  /**
   * The group's shapes slide together and apart, and the glass morphs with
   * them, unless the user asked for less motion: then they jump.
   */
  readonly groupTransition = computed(() =>
    this.#settings.reduceMotion() ? 'none' : 'margin-left 450ms ease-in-out',
  );

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
}
