import { Component, computed, input, output } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * The row of dots under the photos: one per photo, the current one orange.
 * A tap on a dot asks the swiper for that photo.
 */
@Component({
  selector: 'app-indicator',
  imports: [LYNX_ELEMENTS],
  template: `
    @for (index of indexes(); track index) {
      <!-- The dot is 10px; its wrapper gives the finger something to hit. -->
      <view
        class="dot-target"
        accessibility-element="true"
        accessibility-traits="button"
        [accessibility-label]="'Photo ' + (index + 1)"
        (bindtap)="select.emit(index)"
      >
        <view class="dot" [class.active]="index === current()" />
      </view>
    }
  `,
  styles: `
    :host {
      position: absolute;
      bottom: 140px;
      left: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: translateX(-50%);
    }

    .dot-target {
      padding: 10px 5px;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.5);
    }

    .dot.active {
      background-color: #ff6740;
    }
  `,
})
export class Indicator {
  readonly total = input.required<number>();
  readonly current = input(0);
  readonly select = output<number>();
  readonly indexes = computed(() =>
    Array.from({ length: this.total() }, (_, index) => index),
  );
}
