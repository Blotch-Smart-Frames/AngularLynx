import { Component, afterNextRender, computed, inject, input, numberAttribute } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { ExpoImage } from '@ng-native/expo';
import { NativeHeader } from '@ng-native/router';
import { SPRITES } from '../data/config.ts';
import { AppStartup } from '../startup/app-startup.ts';

export type MountKind = 'view' | 'text' | 'image';

/**
 * The benchmark's mount screen: `count` elements of one kind in a plain wrapping container, not a
 * virtualized list, so the time is what it costs to create and commit that many native views.
 * Opened by `bench/mount?kind=view&count=1500`, as a deep link or, for Instruments, which launches
 * with no URL, as the screen the app starts on (EXPO_PUBLIC_BENCH_SCREEN; see app.routes.ts).
 */
@Component({
  selector: 'app-mount',
  imports: [ExpoImage, NativeHeader, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <native-header [hidden]="true" />
    <view class="grid">
      @switch (kind()) {
        @case ('text') {
          @for (i of indices(); track i) {
            <text class="text">{{ i }}</text>
          }
        }
        @case ('image') {
          @for (i of indices(); track i) {
            <expo-image class="image" [source]="sprites()[i]" contentFit="contain" />
          }
        }
        @default {
          @for (i of indices(); track i) {
            <view class="box"></view>
          }
        }
      }
    </view>
  `,
  styles: `
    :host {
      background-color: #fff;
    }
    .grid {
      flex: 1;
      flex-direction: row;
      flex-wrap: wrap;
      align-content: flex-start;
    }
    .box {
      width: 10px;
      height: 10px;
      background-color: #6390f0;
    }
    .text {
      font-size: 12px;
    }
    .image {
      width: 24px;
      height: 24px;
    }
  `,
})
export class Mount {
  // Query params, bound by withComponentInputBinding.
  readonly kind = input<MountKind>('view');
  readonly count = input(1500, { transform: (value: unknown) => numberAttribute(value, 1500) });

  protected readonly indices = computed(() => Array.from({ length: this.count() }, (_, i) => i));
  protected readonly sprites = computed(() =>
    this.indices().map((i) => [{ uri: `${SPRITES}/${(i % 300) + 1}.png` }]),
  );

  constructor() {
    const startup = inject(AppStartup);
    // The screen begins rendering here: its template is created in the change detection pass
    // that follows the constructor.
    startup.reportMountStart();
    // The first pass creates every element, so its commit is the one that shows them all;
    // afterNextRender runs once that commit has gone to Fabric, and the frame after it is when they
    // are drawn, as for the list's fully drawn. TTFD is the mark the harness reads for a launch
    // straight into this screen; the module keeps only the first per process.
    afterNextRender(() =>
      requestAnimationFrame(() => {
        startup.reportMountEnd();
        startup.reportFullyDrawn();
      }),
    );
  }
}
