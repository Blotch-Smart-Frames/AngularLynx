import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { GlassPlayground } from './glass-playground';

type BlurEffect = 'light' | 'extra-light' | 'dark';
type GlassStyle = 'regular' | 'clear';
type Tab = 'basics' | 'playground';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <view class="h-full flex-col bg-zinc-50 flex">
      <view class="px-6 pt-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">Blur View</text>
        <text class="mb-4 text-[13px] text-zinc-500">
          Blurs whatever is rendered behind it, like CSS backdrop-filter.
        </text>
        <view class="mb-4 flex-row rounded-lg bg-zinc-100 p-1 flex">
          @for (option of tabs; track option.id) {
            <view
              class="flex-1 items-center rounded-md py-2"
              [class.bg-white]="option.id === tab()"
              (bindtap)="tab.set(option.id)"
            >
              <text
                class="text-[13px]"
                [class.font-semibold]="option.id === tab()"
                [class.text-zinc-900]="option.id === tab()"
                [class.text-zinc-500]="option.id !== tab()"
              >
                {{ option.label }}
              </text>
            </view>
          }
        </view>
      </view>

      @if (tab() === 'playground') {
        <!--
          The playground sits outside any scroll-view: dragging a blob inside
          one would scroll the page instead of moving the glass.
        -->
        <app-glass-playground />
      } @else {
        <scroll-view class="flex-1" scroll-orientation="vertical">
          <view class="px-6 pb-6">
            <!-- Backdrop blur -->
            <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
              <text
                class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
              >
                Backdrop Blur
              </text>
              <view class="h-[200px] rounded-lg relative overflow-hidden">
                <!--
              A gradient and bright shapes give the blur something visible to
              soften; a flat color would look the same blurred or not.
            -->
                <view
                  class="h-full w-full"
                  style="background-image: linear-gradient(135deg, #6366f1, #ec4899, #f97316);"
                ></view>
                <view
                  class="h-[90px] w-[90px] rounded-full bg-yellow-300 absolute left-[24px] top-[28px]"
                ></view>
                <view
                  class="h-[110px] w-[110px] rounded-full bg-emerald-400 absolute right-[32px] top-[60px]"
                ></view>
                <text
                  class="text-[22px] font-bold text-white absolute left-[24px] top-[140px]"
                >
                  Behind the glass
                </text>

                <blur-view
                  class="h-[72px] flex-col rounded-xl px-4 flex absolute bottom-[12px] left-[12px] right-[12px] justify-center"
                  [blur-radius]="radius() + 'px'"
                  [blur-effect]="effect()"
                >
                  <text class="text-[15px] font-semibold text-zinc-900">
                    blur-radius: {{ radius() }}px
                  </text>
                </blur-view>
              </view>

              <text class="mb-2 mt-4 text-[13px] text-zinc-500">Radius</text>
              <view class="flex-row flex">
                @for (r of radii; track r) {
                  <view
                    class="mr-2 rounded-lg px-3 py-2"
                    [class.bg-zinc-900]="r === radius()"
                    [class.bg-zinc-100]="r !== radius()"
                    (bindtap)="radius.set(r)"
                  >
                    <text
                      class="text-[13px]"
                      [class.text-white]="r === radius()"
                      [class.text-zinc-700]="r !== radius()"
                    >
                      {{ r }}px
                    </text>
                  </view>
                }
              </view>

              <text class="mb-2 mt-4 text-[13px] text-zinc-500">
                blur-effect (iOS)
              </text>
              <view class="flex-row flex">
                @for (e of effects; track e) {
                  <view
                    class="mr-2 rounded-lg px-3 py-2"
                    [class.bg-zinc-900]="e === effect()"
                    [class.bg-zinc-100]="e !== effect()"
                    (bindtap)="effect.set(e)"
                  >
                    <text
                      class="text-[13px]"
                      [class.text-white]="e === effect()"
                      [class.text-zinc-700]="e !== effect()"
                    >
                      {{ e }}
                    </text>
                  </view>
                }
              </view>
            </view>

            <!-- Liquid Glass -->
            <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
              <text
                class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
              >
                Liquid Glass (iOS 26+)
              </text>
              <view
                class="h-[160px] items-center rounded-lg flex relative justify-center overflow-hidden"
              >
                <view
                  class="h-full w-full absolute left-0 top-0"
                  style="background-image: linear-gradient(135deg, #6366f1, #ec4899, #f97316);"
                ></view>
                <!-- Stripes behind the glass so the refraction/blur is visible. -->
                <view class="h-full w-full flex-row flex absolute left-0 top-0">
                  @for (stripe of stripes; track stripe) {
                    <view
                      class="mr-[18px] h-full w-[14px]"
                      [class.bg-white]="stripe % 2 === 0"
                      [class.bg-yellow-300]="stripe % 2 === 1"
                    ></view>
                  }
                </view>

                <!--
              A glass-container merges the glass shapes inside it: shapes
              closer than "spacing" flow into each other like droplets.
            -->
                <blur-view
                  class="flex-row items-center flex"
                  blur-effect="glass-container"
                  [spacing]="16"
                >
                  @for (tint of tints; track tint) {
                    <blur-view
                      class="mx-1.5 h-[64px] w-[64px] rounded-full"
                      blur-effect="glass"
                      blur-radius="16px"
                      [glass-style]="glassStyle()"
                      [glass-interactive]="true"
                      [glass-tint-color]="tint"
                    ></blur-view>
                  }
                </blur-view>
              </view>

              <text class="mb-2 mt-4 text-[13px] text-zinc-500"
                >glass-style</text
              >
              <view class="flex-row flex">
                @for (s of glassStyles; track s) {
                  <view
                    class="mr-2 rounded-lg px-3 py-2"
                    [class.bg-zinc-900]="s === glassStyle()"
                    [class.bg-zinc-100]="s !== glassStyle()"
                    (bindtap)="glassStyle.set(s)"
                  >
                    <text
                      class="text-[13px]"
                      [class.text-white]="s === glassStyle()"
                      [class.text-zinc-700]="s !== glassStyle()"
                    >
                      {{ s }}
                    </text>
                  </view>
                }
              </view>
            </view>

            <view class="rounded-xl bg-zinc-100 p-3.5">
              <text class="text-[13px] text-zinc-500">
                Glass attributes only apply on iOS. Android and Harmony fall
                back to the blur-radius blur.
              </text>
            </view>
          </view>
        </scroll-view>
      }
    </view>
  `,
  imports: [LYNX_ELEMENTS, GlassPlayground],
})
export class App {
  readonly tabs: readonly { id: Tab; label: string }[] = [
    { id: 'basics', label: 'Basics' },
    { id: 'playground', label: 'Glass playground' },
  ];
  readonly tab = signal<Tab>('basics');

  readonly radii = [0, 8, 16, 32] as const;
  readonly effects: readonly BlurEffect[] = ['light', 'extra-light', 'dark'];
  readonly glassStyles: readonly GlassStyle[] = ['regular', 'clear'];
  // Enough stripes to span even a desktop-width web preview; the card's
  // overflow-hidden clips the excess on phones.
  readonly stripes = Array.from({ length: 40 }, (_, i) => i);
  readonly tints = [
    'transparent',
    'rgba(59, 130, 246, 0.35)',
    'rgba(236, 72, 153, 0.35)',
  ] as const;

  readonly radius = signal<number>(16);
  readonly effect = signal<BlurEffect>('light');
  readonly glassStyle = signal<GlassStyle>('regular');
}
