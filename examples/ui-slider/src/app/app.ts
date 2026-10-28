import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { injectGlassDesign } from '../components/ui/glass';
import { UiSlider } from '../components/ui/slider';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiSlider],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Slider</text>
        <text class="text-sm text-muted-foreground">
          Pick a value in a range: drag the thumb, or tap the track.
        </text>

        <!-- Default -->
        <view class="flex-col gap-3 flex">
          <view class="flex-row items-center flex justify-between">
            <text class="text-sm font-medium text-foreground">Volume</text>
            <text class="text-sm text-muted-foreground">{{ volume() }}</text>
          </view>
          <ui-slider [(value)]="volume" accessibility-label="Volume" />
        </view>

        <!-- Steps -->
        <view class="flex-col gap-3 flex">
          <view class="flex-row items-center flex justify-between">
            <text class="text-sm font-medium text-foreground">Rating</text>
            <text class="text-sm text-muted-foreground">
              {{ rating() }} of 5
            </text>
          </view>
          <ui-slider
            [(value)]="rating"
            [min]="1"
            [max]="5"
            accessibility-label="Rating"
            [valueText]="ratingText"
          />
        </view>

        <!-- Disabled -->
        <view class="flex-col gap-3 flex">
          <text class="text-sm font-medium text-muted-foreground">Locked</text>
          <ui-slider
            [value]="30"
            [disabled]="true"
            accessibility-label="Locked"
          />
        </view>

        <!-- Glass: each platform's own slider. On iOS 26 the thumb turns
             into a Liquid Glass lens while it's dragged. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Glass</text>
          <text class="text-xs text-muted-foreground">{{ status() }}</text>
          <view class="flex-col gap-4 rounded-[20px] bg-card p-4 flex">
            <view class="flex-col gap-1 flex">
              <text class="text-sm text-card-foreground">
                Brightness {{ percent(brightness()) }}
              </text>
              <ui-slider
                variant="glass"
                [min]="0"
                [max]="1"
                [step]="0.01"
                [(value)]="brightness"
                accessibility-label="Brightness"
                (changed)="lastChange.set(percent($event))"
              />
            </view>
            <view class="flex-col gap-1 flex">
              <text class="text-sm text-card-foreground">
                Volume {{ volume() }}
              </text>
              <ui-slider
                variant="glass"
                [(value)]="volume"
                accessibility-label="Volume"
                (changed)="lastChange.set($event + '')"
              />
            </view>
            <view class="flex-col gap-1 flex">
              <text class="text-sm text-muted-foreground">Locked</text>
              <ui-slider
                variant="glass"
                [value]="30"
                [disabled]="true"
                accessibility-label="Locked"
              />
            </view>
          </view>
          <text class="text-xs text-muted-foreground">
            Last settled on: {{ lastChange() || 'nothing yet' }}
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);
  readonly #design = injectGlassDesign();

  readonly volume = signal(40);
  readonly rating = signal(3);
  readonly brightness = signal(0.6);
  readonly lastChange = signal('');

  readonly ratingText = (value: number) => `${value} of 5 stars`;

  /** The design the glass sliders drew, and the settings they follow. */
  readonly status = computed(() => {
    const on = (value: boolean) => (value ? 'on' : 'off');
    const os = `${this.#system.platform} ${this.#system.osVersion}`.trim();
    return [
      `Design: ${this.#design()} on ${os}`,
      `Reduce Motion: ${on(this.#settings.reduceMotion())}`,
      `Reduce Transparency: ${on(this.#settings.reduceTransparency())}`,
    ].join(' · ');
  });

  percent(value: number): string {
    return `${Math.round(value * 100)}%`;
  }
}
