import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { SENTINEL_A, SENTINEL_B } from '../data/bench';

/**
 * The benchmark's tap screen (benchmarks/SPEC.md, "Tap"): a box and a count
 * over a button that fills the bottom half. Each tap counts up and switches
 * the box between the two sentinel colors, which the probe watches for in
 * the native view (benchmarks/harness/probe). A build with
 * BENCH_SCREEN=tap opens on it at launch (see app.routes.ts).
 */
@Component({
  selector: 'app-tap',
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="screen">
      <view class="top">
        <view class="box" [style.background-color]="taps() % 2 ? sentinelB : sentinelA"></view>
        <text class="count">Taps: {{ taps() }}</text>
      </view>
      <view
        class="button"
        accessibility-element="true"
        accessibility-traits="button"
        accessibility-label="Tap"
        (bindtap)="taps.update((n) => n + 1)"
      >
        <text class="label">Tap</text>
      </view>
    </view>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
    }
    .screen {
      display: flex;
      flex-direction: column;
      flex: 1;
      background-color: #fff;
    }
    .top {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .box {
      width: 100px;
      height: 100px;
    }
    .count {
      margin-top: 16px;
      font-size: 20px;
      color: #000;
    }
    .button {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      background-color: #e3e3e3;
    }
    .label {
      font-size: 20px;
      color: #000;
    }
  `,
})
export class Tap {
  protected readonly taps = signal(0);
  protected readonly sentinelA = SENTINEL_A;
  protected readonly sentinelB = SENTINEL_B;
}
