import { UpperCasePipe } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { Press } from './press';

/**
 * Panes still waiting for their works: frosted glass that daylight crosses,
 * one pane after the next, instead of a spinner. Laid out as the wall it
 * stands in for, so nothing jumps when the works arrive. Still, with
 * Reduce Motion on.
 */
@Component({
  selector: 'app-daylight',
  imports: [LYNX_ELEMENTS],
  host: { class: 'flex flex-col gap-1.5' },
  styles: `
    @keyframes daylight {
      0% {
        opacity: 0;
      }
      45% {
        opacity: 0.75;
      }
      100% {
        opacity: 0;
      }
    }
    .light {
      position: absolute;
      left: 0;
      top: 0;
      right: 0;
      bottom: 0;
      background-color: var(--clear-lit);
      opacity: 0;
    }
    .crossing {
      animation: daylight 1600ms cubic-bezier(0.45, 0, 0.55, 1) infinite;
    }
  `,
  template: `
    @for (row of rows(); track row) {
      <view class="flex flex-row gap-1.5">
        @for (pane of [0, 1]; track pane) {
          <view class="flex flex-1 flex-col gap-1.5">
            <view class="pane-seed relative h-[168px]">
              <view
                class="light"
                [class.crossing]="!still()"
                [style.animation-delay]="delay(row, pane, 0)"
              ></view>
            </view>
            <view class="pane-seed relative h-[64px]">
              <view
                class="light"
                [class.crossing]="!still()"
                [style.animation-delay]="delay(row, pane, 1)"
              ></view>
            </view>
          </view>
        }
      </view>
    }
  `,
})
export class Daylight {
  /** How many rows of two works to stand in for. */
  readonly count = input(2);

  protected readonly rows = computed(() =>
    Array.from({ length: this.count() }, (_, row) => row),
  );
  protected readonly still = inject(LynxAccessibilitySettings).reduceMotion;

  /**
   * The light crosses the wall left to right, top to bottom.
   */
  protected delay(row: number, pane: number, part: number): string {
    return `${(row * 2 + pane) * 140 + part * 70}ms`;
  }
}

/**
 * What went wrong, said in one oxblood pane, with the way out beside it.
 */
@Component({
  selector: 'app-trouble',
  imports: [LYNX_ELEMENTS, Press, UpperCasePipe],
  host: { class: 'flex flex-row gap-1.5' },
  template: `
    <view class="pane pane-oxblood flex flex-1 flex-col gap-1 px-4 py-4">
      <text class="font-strong text-[19px] leading-[23px] text-on-color">{{
        title()
      }}</text>
      @if (detail()) {
        <text class="text-[15px] leading-[21px] text-on-color">{{
          detail()
        }}</text>
      }
    </view>
    @if (action()) {
      <view
        appPress
        class="pane flex w-[104px] flex-col justify-end px-3 py-3"
        accessibility-element="true"
        accessibility-traits="button"
        [attr.accessibility-label]="action()"
        (bindtap)="pressed.emit()"
      >
        <text class="label text-ink">{{ action() | uppercase }}</text>
      </view>
    }
  `,
})
export class Trouble {
  readonly title = input.required<string>();
  readonly detail = input<string | null>(null);
  readonly action = input<string | null>('Try again');
  readonly pressed = output();
}

/**
 * The partition carrying on past the last work: empty panes in the wall's
 * own rhythm, so a short wall (Saved, with a work or two) ends in glass
 * rather than in a black void. Hidden from screen readers: there's nothing
 * in it.
 */
@Component({
  selector: 'app-blank-wall',
  imports: [LYNX_ELEMENTS],
  host: {
    class: 'flex flex-col gap-1.5',
    'accessibility-elements-hidden': 'true',
  },
  template: `
    <view class="flex h-[180px] flex-row gap-1.5">
      <view class="pane-seed flex-1"></view>
      <view class="pane w-[56px]"></view>
    </view>
    <view class="flex h-[120px] flex-row gap-1.5">
      <view class="pane w-[38%]"></view>
      <view class="pane-seed flex-1"></view>
    </view>
    <view class="flex h-[220px] flex-row gap-1.5">
      <view class="pane flex-1"></view>
      <view class="pane-seed flex-1"></view>
    </view>
  `,
})
export class BlankWall {}
