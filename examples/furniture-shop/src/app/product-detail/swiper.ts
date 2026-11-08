import {
  afterNextRender,
  Component,
  ElementRef,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxMainThreadEvent,
  type MainThread,
  MainThreadElement,
} from '@blotch/angular-lynx';
import { animate } from './animate';
import { Indicator } from './indicator';

/**
 * The second tutorial's swiper: the photos side by side in a strip, which
 * the finger drags and which snaps to the nearest photo when it lets go.
 *
 * The drag runs as main-thread scripts (the `'main thread'` handlers
 * below), so each move restyles the strip directly, with no change
 * detection in between: the strip stays under the finger. Only the current
 * photo's index is a signal, for the dots.
 */
@Component({
  selector: 'app-swiper',
  imports: [LYNX_ELEMENTS, LynxMainThreadEvent, Indicator],
  template: `
    <view class="swiper-wrapper">
      <!-- Touch events on a phone; mouse events in a desktop browser, where
           a drag sends those instead. A mouse event's x is relative to the
           LynxView; its clientX is relative to the element under the
           cursor, which moves with the drag. The handlers catch the events,
           so a drag here stays the swiper's: the stack outlet the screen is
           in would otherwise take a drag to the right as a swipe back. -->
      <view
        #strip
        class="swiper-container"
        [mainThreadCatchtouchstart]="onTouchStart"
        [mainThreadCatchtouchmove]="onTouchMove"
        [mainThreadCatchtouchend]="onTouchEnd"
        [mainThreadCatchmousedown]="onMouseDown"
        [mainThreadCatchmousemove]="onMouseMove"
        [mainThreadCatchmouseup]="onMouseUp"
      >
        @for (picture of pictures(); track $index) {
          <view class="swiper-item" [style.width.px]="itemWidth">
            <image class="photo" mode="aspectFill" [src]="picture" />
          </view>
        }
      </view>
      <app-indicator
        [total]="pictures().length"
        [current]="current()"
        (select)="goTo($event)"
      />
    </view>
  `,
  styles: `
    /* The host takes the room between the nav bar and the Order button. */
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      width: 100%;
    }

    .swiper-wrapper {
      position: relative;
      flex: 1;
      width: 100%;
    }

    /* A row that doesn't wrap or shrink its items: Lynx's linear layout. */
    .swiper-container {
      display: linear;
      linear-orientation: horizontal;
      height: 100%;
    }

    .swiper-item {
      display: flex;
      align-items: flex-end;
      justify-content: center;
      height: 100%;
    }

    .photo {
      width: 100%;
      height: 100%;
    }
  `,
})
export class Swiper {
  readonly pictures = input.required<string[]>();
  /** The photo to open on. */
  readonly start = input(0);
  /** How long the snap to the nearest photo takes, in milliseconds. */
  readonly duration = input(300);
  /** The snap's curve, from elapsed time (0 to 1) to progress (0 to 1). */
  readonly easing = input<(t: number) => number>((t) => t);
  readonly current = signal(0);
  readonly strip = viewChild.required('strip', { read: ElementRef });

  /** Each photo is as wide as the LynxView: the screen, on a phone. */
  readonly itemWidth = innerWidth;

  #offset = 0;
  #dragging = false;
  #dragStartX = 0;
  #dragStartOffset = 0;
  #stopSnap?: () => void;

  constructor() {
    afterNextRender(() => this.#moveTo(-this.start() * this.itemWidth));
  }

  readonly onTouchStart = (event: MainThread.TouchEvent) => {
    'main thread';
    this.#begin(event.touches[0]!.clientX);
  };

  readonly onTouchMove = (event: MainThread.TouchEvent) => {
    'main thread';
    this.#drag(event.touches[0]!.clientX);
  };

  readonly onTouchEnd = () => {
    'main thread';
    this.#release();
  };

  readonly onMouseDown = (event: MainThread.MouseEvent) => {
    'main thread';
    this.#begin(event.x);
  };

  readonly onMouseMove = (event: MainThread.MouseEvent) => {
    'main thread';
    // A move with no button down means the button came up outside the
    // view, where no mouseup reaches the app.
    if (event.buttons === 0) this.#release();
    else this.#drag(event.x);
  };

  readonly onMouseUp = () => {
    'main thread';
    this.#release();
  };

  /**
   * Slides to a photo, as a tap on its dot asks.
   */
  goTo(index: number): void {
    this.#snapTo(-index * this.itemWidth);
  }

  #begin(x: number): void {
    this.#stopSnap?.();
    this.#dragging = true;
    this.#dragStartX = x;
    this.#dragStartOffset = this.#offset;
  }

  #drag(x: number): void {
    // A mouse moves over the strip without being pressed; a finger doesn't.
    if (!this.#dragging) return;
    this.#moveTo(this.#dragStartOffset + x - this.#dragStartX);
  }

  #release(): void {
    if (!this.#dragging) return;
    this.#dragging = false;
    this.#snapTo(Math.round(this.#offset / this.itemWidth) * this.itemWidth);
  }

  #snapTo(offset: number): void {
    this.#stopSnap?.();
    this.#stopSnap = animate({
      from: this.#offset,
      to: offset,
      duration: this.duration(),
      easing: this.easing(),
      onUpdate: (value) => this.#moveTo(value),
    });
  }

  /**
   * Puts the strip at `offset`, kept between the first and the last photo,
   * and tells the dots which photo that is.
   */
  #moveTo(offset: number): void {
    const last = -(this.pictures().length - 1) * this.itemWidth;
    this.#offset = Math.min(0, Math.max(last, offset));
    // The strip's main-thread handle, the kind a script gets as
    // event.currentTarget, built here so the snap and the dots can move the
    // strip without an event.
    new MainThreadElement(
      this.strip().nativeElement.element,
    ).setStyleProperties({ transform: `translateX(${this.#offset}px)` });
    const index = Math.round(-this.#offset / this.itemWidth);
    if (index !== this.current()) this.current.set(index);
  }
}
