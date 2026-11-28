import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { SENTINEL_A, SENTINEL_B, SENTINEL_MOVER, spin } from '../data/bench';

/**
 * The benchmark's busy screen (benchmarks/SPEC.md, "Busy"): the tap screen,
 * with a box moving across the top on a CSS animation, and a handler that
 * works for 50 ms before it counts the tap. The probe times the tap as on the
 * tap screen, and follows the moving box frame by frame to see whether the
 * handler's work held it up. A build with BENCH_SCREEN=busy opens on it at
 * launch (see app.routes.ts).
 */
@Component({
  selector: 'app-busy',
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="screen">
      <view class="track">
        <view class="mover" [style.background-color]="sentinelMover"></view>
      </view>
      <view class="top">
        <view class="box" [style.background-color]="taps() % 2 ? sentinelB : sentinelA"></view>
        <text class="count">Taps: {{ taps() }}</text>
      </view>
      <view
        class="button"
        accessibility-element="true"
        accessibility-traits="button"
        accessibility-label="Busy"
        (bindtap)="tap()"
      >
        <text class="label">Busy</text>
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
      padding-top: env(safe-area-inset-top);
    }
    .track {
      height: 40px;
    }
    .mover {
      width: 40px;
      height: 40px;
      animation: move 1s linear infinite alternate;
    }
    @keyframes move {
      from {
        transform: translateX(0px);
      }
      to {
        transform: translateX(300px);
      }
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
      height: 50%;
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
export class Busy {
  protected readonly taps = signal(0);
  protected readonly sentinelA = SENTINEL_A;
  protected readonly sentinelB = SENTINEL_B;
  protected readonly sentinelMover = SENTINEL_MOVER;

  protected tap(): void {
    spin(50);
    this.taps.update((n) => n + 1);
  }
}
