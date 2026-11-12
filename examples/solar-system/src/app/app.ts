import { Component, computed, inject } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { DateDial } from './case/date-dial';
import { BRUSHED_BRASS, MAHOGANY } from './case/materials';
import { NamePlates } from './case/name-plates';
import { SpecPlate } from './case/spec-plate';
import { OrreryView } from './sky-view/orrery-view';
import { OrreryState } from './state/orrery-state';

/**
 * The Orrery: the solar system as an 18th-century brass machine, every
 * planet on its arm where it really is on the date the dial shows. Above,
 * the machine in 3D; below, its mahogany case: the date dial, a brass plate
 * for every body, and, flown in to one, its figures on silver.
 */
@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, DateDial, NamePlates, OrreryView, SpecPlate],
  template: `
    <view class="flex h-full w-full flex-col bg-night">
      <view class="relative flex-1">
        <!-- three.js is most of the bundle: the case paints first. -->
        @defer (on idle) {
          <app-orrery-view class="h-full w-full" [motion]="!reduceMotion()" />
        } @placeholder {
          <view class="flex h-full w-full items-center justify-center">
            <text class="font-italic text-[13px] text-brass"
              >Winding the orrery…</text
            >
          </view>
        }
        @if (state.focus()) {
          <!-- Back out over the whole machine, below the notch. -->
          <view class="absolute pt-safe-2" style="left: 12px; top: 0">
            <view
              class="brass flex flex-row items-center px-3"
              [style.background-image]="brass"
              style="height: 34px"
              (bindtap)="state.focus.set(null)"
              accessibility-element="true"
              accessibility-traits="button"
              accessibility-label="Back to the whole orrery"
            >
              <svg
                style="width: 8px; height: 12px"
                [attr.content]="backArrow"
              ></svg>
              <text
                class="engraved ml-2 font-engraved text-[10px] tracking-[1.5px] text-wax"
                >ORRERY</text
              >
            </view>
          </view>
        }
      </view>

      <view
        class="mahogany flex flex-col pb-safe-3"
        [style.background-image]="mahogany"
      >
        <view class="lit-rule"></view>
        <view class="shade-rule"></view>
        <app-date-dial class="pt-1" [motion]="!reduceMotion()" />

        <view class="pt-2.5" style="height: 194px">
          @if (state.focus()) {
            <app-spec-plate />
          } @else {
            <app-name-plates />
            <view class="flex flex-row items-center justify-between px-4 pt-5">
              <text
                class="font-script text-[30px] leading-[38px] text-brass-lit"
                >The Orrery</text
              >
              <view class="flex flex-col items-end">
                <text class="font-italic text-[10px] leading-[14px] text-brass"
                  >Distances and sizes not to scale.</text
                >
                <text class="font-italic text-[10px] leading-[14px] text-brass"
                  >Positions true for the date · {{ renderer() }}</text
                >
              </view>
            </view>
          }
        </view>
      </view>
    </view>
  `,
  styles: [
    `
      .lit-rule {
        height: 1px;
        background-color: var(--brass-lit);
      }
      .shade-rule {
        height: 2px;
        background-color: var(--brass-shade);
      }
    `,
  ],
})
export class App {
  protected readonly state = inject(OrreryState);
  readonly #system = inject(LynxSystemInfo);
  protected readonly reduceMotion = inject(LynxAccessibilitySettings)
    .reduceMotion;

  protected readonly mahogany = MAHOGANY;
  protected readonly brass = BRUSHED_BRASS;
  protected readonly backArrow =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 12"><path d="M7 1 L1.5 6 L7 11" fill="none" stroke="#141210" stroke-width="1.6"/></svg>';

  /** What draws the machine here, said plainly. */
  protected readonly renderer = computed(() => {
    switch (this.#system.platform) {
      case 'iOS':
        return 'drawn with Metal';
      case 'Android':
        return 'drawn with GL ES';
      default:
        return 'drawn with WebGL2';
    }
  });
}
