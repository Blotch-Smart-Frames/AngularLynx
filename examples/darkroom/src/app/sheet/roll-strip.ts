import {
  Component,
  type ElementRef,
  computed,
  inject,
  viewChildren,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import type { Photo } from '../develop/photos';
import { DarkroomState } from '../state/darkroom-state';
import { EdgeArrow, MarkerRing, MarkerTick, Sprockets } from './marks';
import { keepChosenInView } from './strip-scroll';

/** A frame on the strip, in layout pixels: 3:2, like the film. */
const FRAME_WIDTH = 84;
const FRAME_HEIGHT = 56;
const GAP = 8;

/**
 * The roll, printed as it came off the contact printer: every photo a
 * positive on its strip of black film, numbered as the film's edge numbers
 * it. The frame on the easel is ringed in marker; tap another to enlarge it.
 */
@Component({
  selector: 'app-roll-strip',
  imports: [LYNX_ELEMENTS, EdgeArrow, MarkerRing, MarkerTick, Sprockets],
  host: { class: 'flex flex-col bg-film' },
  template: `
    <!-- The strip's own edge print: the roll, and how many frames. -->
    <view class="flex flex-row items-center justify-between px-3 pt-2">
      <view class="flex flex-row items-center">
        <app-edge-arrow class="mr-1.5" />
        <text class="font-edge text-[10px] tracking-[2px] text-edge"
          >THE ROLL</text
        >
      </view>
      <text class="font-edge text-[10px] tracking-[2px] text-edge"
        >{{ state.roll().length }} FRAMES</text
      >
    </view>
    <scroll-view
      class="w-full"
      [style.height.px]="stripHeight"
      scroll-orientation="horizontal"
    >
      <view class="flex flex-col">
        <app-sprockets class="px-1.5 pt-1.5" [count]="sprocketCount()" />
        <view class="flex flex-row px-3 pt-2">
          @for (photo of state.roll(); track photo.id; let index = $index) {
            <view
              #frame
              class="relative flex shrink-0 flex-col items-center"
              [style.width.px]="frameWidth"
              [style.margin-right.px]="gap"
              (bindtap)="state.select(photo)"
              accessibility-element="true"
              accessibility-traits="button"
              [attr.accessibility-label]="label(photo, index)"
            >
              <image
                class="bg-film-hole"
                mode="aspectFill"
                [src]="photo.src"
                [style.width.px]="frameWidth"
                [style.height.px]="frameHeight"
              ></image>
              <view class="mt-1 flex flex-row items-center">
                <app-edge-arrow class="mr-1" />
                <text class="font-edge text-[9px] tracking-[1px] text-edge">{{
                  index + 1
                }}</text>
                @if (edited(photo)) {
                  <!-- Printed already: the marker's tick. -->
                  <app-tick class="ml-1" />
                }
              </view>
              @if (photo.id === state.photoId()) {
                <!-- Round the frame and its number, as a hand would. -->
                <app-ring
                  [width]="frameWidth + 14"
                  [height]="frameHeight + 32"
                  [seed]="index + 2"
                  style="left: -7px; top: -8px"
                />
              }
            </view>
          }
        </view>
        <app-sprockets class="px-1.5 pt-1" [count]="sprocketCount()" />
      </view>
    </scroll-view>
  `,
})
export class RollStrip {
  protected readonly state = inject(DarkroomState);
  protected readonly frameWidth = FRAME_WIDTH;
  protected readonly frameHeight = FRAME_HEIGHT;
  protected readonly gap = GAP;
  protected readonly stripHeight = FRAME_HEIGHT + 52;

  readonly frameElements = viewChildren<ElementRef>('frame');

  constructor() {
    keepChosenInView(this.frameElements, () =>
      this.state.roll().findIndex((photo) => photo.id === this.state.photoId()),
    );
  }

  /** Enough holes to run the strip's whole length. */
  protected readonly sprocketCount = computed(() =>
    Math.ceil(((FRAME_WIDTH + GAP) * this.state.roll().length + 24) / 14),
  );

  protected edited(photo: Photo): boolean {
    return this.state.isEdited(photo);
  }

  protected label(photo: Photo, index: number): string {
    return `Frame ${index + 1}: ${photo.title}`;
  }
}
