import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxGestureDetector,
  PanGesture,
} from '@blotch/angular-lynx';
import {
  ADJUSTMENTS,
  type AdjustmentKey,
  type AdjustmentSpec,
} from '../develop/settings';
import { DarkroomState } from '../state/darkroom-state';
import { MarkerRing } from './marks';

/** Steps across a control's whole range: exposure moves in tenths of a stop. */
const STEPS = 40;
/** Pixels per step: the whole range is a drag of 480 pixels. */
const STEP_WIDTH = 12;
const RULER_HEIGHT = 58;

/**
 * Each control name's width: Share Tech Mono's glyphs are half an em (6px at
 * 12px) plus 1.5px of tracking, with room either side for the ring. Fixed,
 * so choosing a control never moves the others.
 */
const nameWidth = (label: string): number => label.length * 7.5 + 20;

/**
 * The printer's notes: the controls written along the sheet in edge print,
 * the chosen one ringed in marker, and under them one ruler, cut from the film's edge, that
 * scrubs it. The ticks slide under the fixed red index; on release they
 * settle on the nearest step. One value is read out at a time, large.
 */
@Component({
  selector: 'app-controls',
  imports: [LYNX_ELEMENTS, LynxGestureDetector, MarkerRing],
  host: { class: 'flex flex-col' },
  template: `
    <scroll-view
      class="w-full"
      style="height: 34px"
      scroll-orientation="horizontal"
    >
      <view class="flex flex-row items-center px-1.5">
        @for (spec of adjustments; track spec.key; let index = $index) {
          <view
            class="relative flex flex-row items-center justify-center"
            style="height: 34px"
            [style.width.px]="nameWidth(spec.label)"
            (bindtap)="active.set(spec.key)"
            accessibility-element="true"
            accessibility-traits="button"
            [attr.accessibility-label]="
              spec.label + ', ' + spec.format(value(spec))
            "
          >
            <!-- Ink once it's been set, gray while it's untouched. -->
            <text
              class="font-edge text-[12px] tracking-[1.5px]"
              [class.text-ink]="value(spec) !== 0 || spec.key === active()"
              [class.text-ink-muted]="
                value(spec) === 0 && spec.key !== active()
              "
              >{{ spec.label.toUpperCase() }}</text
            >
            @if (spec.key === active()) {
              <app-ring
                [width]="nameWidth(spec.label)"
                [height]="32"
                [seed]="index + 11"
                [stroke]="2"
                style="left: 0; top: 1px"
              />
            }
          </view>
        }
      </view>
    </scroll-view>

    <view class="flex flex-row items-end justify-between px-3 pt-1 pb-2">
      <text
        class="font-marker text-[26px] text-marker"
        (bindtap)="resetActive()"
        accessibility-traits="button"
        [attr.accessibility-label]="
          spec().label + ' ' + readout() + '. Tap to reset.'
        "
        >{{ readout() }}</text
      >
      @if (state.edited()) {
        <text
          class="pb-1.5 font-edge text-[11px] tracking-[2px] text-ink-muted"
          (bindtap)="state.reset()"
          accessibility-traits="button"
          accessibility-label="Start this photo over"
          >START OVER</text
        >
      }
    </view>

    <view
      class="relative w-full overflow-hidden bg-film"
      [style.height.px]="rulerHeight"
      [lynxGesture]="pan"
      [consume-slide-event]="sideways"
      (bindlayoutchange)="measure($event)"
      accessibility-element="true"
      accessibility-traits="adjustable"
      [attr.accessibility-label]="
        spec().label + ' ' + readout() + '. Drag sideways to change.'
      "
    >
      <!-- The ticks: a long strip slid under the index by the value. -->
      <view
        class="absolute top-0 flex flex-row items-start"
        [style.left.px]="offset()"
        [style.transition]="settling() ? 'left 160ms ease-out' : 'none'"
      >
        @for (tick of ticks(); track tick.index) {
          <view
            class="flex shrink-0 flex-col items-center"
            [style.width.px]="stepWidth"
          >
            <view
              class="bg-edge"
              style="width: 1px"
              [style.height.px]="tick.major ? 18 : tick.half ? 12 : 7"
            ></view>
            @if (tick.major) {
              <text
                class="mt-1 font-edge text-[9px] text-edge"
                style="width: 40px; text-align: center"
                >{{ tick.label }}</text
              >
            }
          </view>
        }
      </view>
      <!-- The index: fixed at the middle, where the value is read. -->
      <view
        class="absolute top-0 bg-marker"
        [style.left.px]="center() - 1"
        style="width: 2px; height: 22px"
      ></view>
    </view>
  `,
})
export class Controls {
  protected readonly state = inject(DarkroomState);
  readonly #reduceMotion = inject(LynxAccessibilitySettings).reduceMotion;

  protected readonly adjustments = ADJUSTMENTS;
  protected readonly nameWidth = nameWidth;
  protected readonly stepWidth = STEP_WIDTH;
  protected readonly rulerHeight = RULER_HEIGHT;
  protected readonly active = signal<AdjustmentKey>('exposure');
  protected readonly spec = computed(() =>
    ADJUSTMENTS.find((spec) => spec.key === this.active())!,
  );
  protected readonly readout = computed(() =>
    this.spec().format(this.state.adjustments()[this.active()]),
  );

  /** The ruler's width, from its layout: the index sits at its middle. */
  readonly #width = signal(402);
  protected readonly center = computed(() => this.#width() / 2);

  /** Where the ticks start, so the value's tick sits under the index. */
  protected readonly offset = computed(() => {
    const spec = this.spec();
    const value = this.state.adjustments()[spec.key];
    const position = ((value - spec.min) / (spec.max - spec.min)) * STEPS;
    return this.center() - (position + 0.5) * STEP_WIDTH;
  });

  /** Every step's tick, with the control's figures every ten steps. */
  protected readonly ticks = computed(() => {
    const spec = this.spec();
    return Array.from({ length: STEPS + 1 }, (_, index) => ({
      index,
      major: index % 10 === 0,
      half: index % 5 === 0,
      label: spec.format(spec.min + (index / STEPS) * (spec.max - spec.min)),
    }));
  });

  protected readonly settling = signal(false);

  protected readonly sideways: [number, number][] = [
    [-40, 40],
    [140, 180],
    [-180, -140],
  ];
  #startValue = 0;
  protected readonly pan = new PanGesture()
    .minDistance(2)
    .onStart(() => {
      this.settling.set(false);
      this.#startValue = this.state.adjustments()[this.active()];
    })
    .onUpdate((event) => {
      const spec = this.spec();
      // Dragging left pulls higher figures under the index, as on a dial.
      const change =
        (-event.translationX / (STEPS * STEP_WIDTH)) * (spec.max - spec.min);
      this.state.adjust(spec.key, clamp(spec, this.#startValue + change));
    })
    .onEnd(() => {
      const spec = this.spec();
      const step = (spec.max - spec.min) / STEPS;
      const value = this.state.adjustments()[spec.key];
      this.settling.set(!this.#reduceMotion());
      this.state.adjust(spec.key, clamp(spec, Math.round(value / step) * step));
    });

  protected value(spec: AdjustmentSpec): number {
    return this.state.adjustments()[spec.key];
  }

  protected measure(event: { detail?: { width?: number } }): void {
    const width = event.detail?.width;
    if (width) this.#width.set(width);
  }

  protected resetActive(): void {
    this.settling.set(!this.#reduceMotion());
    this.state.adjust(this.active(), 0);
  }
}

const clamp = (spec: AdjustmentSpec, value: number): number =>
  // Rounded to a thousandth, so a value that's back at zero is exactly zero.
  Math.round(Math.min(spec.max, Math.max(spec.min, value)) * 1000) / 1000;
