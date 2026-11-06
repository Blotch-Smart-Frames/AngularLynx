import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import redHeart from '../../assets/icons/red-heart.png';
import whiteHeart from '../../assets/icons/white-heart.png';

/**
 * The heart in a picture's corner. A tap fills it red and sends two rings
 * out from it; the rings are plain CSS animations, started by rendering the
 * views that carry them.
 */
@Component({
  selector: 'app-like-icon',
  imports: [LYNX_ELEMENTS],
  template: `
    @if (liked()) {
      <view class="circle" />
      <view class="circle circle-after" />
    }
    <image class="heart" [src]="liked() ? redHeart : whiteHeart" />
  `,
  // catchtap: a tap on the heart likes the picture and stops there, instead
  // of also opening it.
  host: {
    'accessibility-element': 'true',
    'accessibility-traits': 'button',
    '[accessibility-label]': "liked() ? 'Liked' : 'Like'",
    '(catchtap)': 'toggle()',
  },
  styles: `
    /* The host is the 48px tap target in the card's corner. */
    :host {
      position: absolute;
      top: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
    }

    .heart {
      width: 16px;
      height: 16px;
    }

    .circle {
      position: absolute;
      top: calc(50% - 8px);
      left: calc(50% - 8px);
      width: 16px;
      height: 16px;
      border: 2px solid red;
      border-radius: 50%;
      transform: scale(0);
      opacity: 1;
      animation: ripple 1s 1 ease-out;
    }

    .circle-after {
      animation-delay: 0.5s;
    }

    @keyframes ripple {
      0% {
        transform: scale(1);
        opacity: 1;
      }
      100% {
        transform: scale(2);
        opacity: 0;
      }
    }
  `,
})
export class LikeIcon {
  readonly liked = signal(false);
  readonly redHeart = redHeart;
  readonly whiteHeart = whiteHeart;

  toggle(): void {
    this.liked.update((liked) => !liked);
  }
}
