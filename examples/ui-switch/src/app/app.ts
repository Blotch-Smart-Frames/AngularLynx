import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { injectGlassDesign } from '../components/ui/glass';
import { UiLabel } from '../components/ui/label';
import { UiSwitch } from '../components/ui/switch';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiSwitch, UiLabel],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Switch</text>
        <text class="text-sm text-muted-foreground">
          A toggle switch for turning options on or off. Tap it, or drag its
          thumb across.
        </text>

        <!-- Switch on -->
        <view class="flex-row items-center flex justify-between">
          <ui-label>Wi-Fi</ui-label>
          <ui-switch [(checked)]="wifi" accessibility-label="Wi-Fi" />
        </view>

        <!-- Switch off -->
        <view class="flex-row items-center flex justify-between">
          <ui-label>Bluetooth</ui-label>
          <ui-switch [(checked)]="bluetooth" accessibility-label="Bluetooth" />
        </view>

        <!-- Switch with description -->
        <view class="flex-row items-center flex justify-between">
          <view class="flex-col gap-1 flex">
            <ui-label>Low Power Mode</ui-label>
            <text class="text-xs text-muted-foreground">
              Reduce background activity
            </text>
          </view>
          <ui-switch
            [(checked)]="lowPower"
            accessibility-label="Low Power Mode"
          />
        </view>

        <!-- Disabled switch (off) -->
        <view class="flex-row items-center flex justify-between">
          <ui-label [disabled]="true">Airplane Mode</ui-label>
          <ui-switch [disabled]="true" accessibility-label="Airplane Mode" />
        </view>

        <!-- Disabled switch (on) -->
        <view class="flex-row items-center flex justify-between">
          <ui-label [disabled]="true">Notifications (locked)</ui-label>
          <ui-switch
            [disabled]="true"
            [checked]="true"
            accessibility-label="Notifications"
          />
        </view>

        <!-- Glass: each platform's own switch. On iOS 26 the thumb turns
             into a Liquid Glass lens while it's touched. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Glass</text>
          <text class="text-xs text-muted-foreground">{{ status() }}</text>
          <view class="flex-col rounded-[20px] bg-card px-4 flex">
            <view class="h-14 flex-row items-center flex justify-between">
              <text class="text-base text-card-foreground">Wi-Fi</text>
              <ui-switch
                variant="glass"
                [(checked)]="wifi"
                accessibility-label="Wi-Fi"
              />
            </view>
            <view class="h-[0.5px] bg-border"></view>
            <view class="h-14 flex-row items-center flex justify-between">
              <text class="text-base text-card-foreground">Bluetooth</text>
              <ui-switch
                variant="glass"
                [(checked)]="bluetooth"
                accessibility-label="Bluetooth"
              />
            </view>
            <view class="h-[0.5px] bg-border"></view>
            <view class="h-14 flex-row items-center flex justify-between">
              <text class="text-base text-muted-foreground">Airplane Mode</text>
              <ui-switch
                variant="glass"
                [disabled]="true"
                accessibility-label="Airplane Mode"
              />
            </view>
          </view>
        </view>

        <!-- Display current state -->
        <view class="rounded-md border border-border bg-muted p-4">
          <text class="mb-2 text-sm font-medium text-foreground">State</text>
          <text class="text-xs text-muted-foreground">
            Wi-Fi: {{ wifi() }}
          </text>
          <text class="text-xs text-muted-foreground">
            Bluetooth: {{ bluetooth() }}
          </text>
          <text class="text-xs text-muted-foreground">
            Low Power Mode: {{ lowPower() }}
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

  wifi = signal(true);
  bluetooth = signal(false);
  lowPower = signal(false);

  /** The design the glass switches drew, and the settings they follow. */
  protected readonly status = computed(() => {
    const os = `${this.#system.platform} ${this.#system.osVersion}`.trim();
    const motion = this.#settings.reduceMotion() ? 'on' : 'off';
    return `Design: ${this.#design()} on ${os} · Reduce Motion: ${motion}`;
  });
}
