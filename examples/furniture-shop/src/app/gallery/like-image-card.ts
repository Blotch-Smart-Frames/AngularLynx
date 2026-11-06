import { Component, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import type { Picture } from '../data/pictures';
import { LikeIcon } from './like-icon';

/**
 * One picture of the gallery, with rounded corners and a heart to like it.
 * The image takes the column's width and keeps the picture's aspect ratio,
 * so the card has its height before the picture loads.
 */
@Component({
  selector: 'app-like-image-card',
  imports: [LYNX_ELEMENTS, LikeIcon],
  template: `
    <view class="picture-wrapper">
      <image
        class="picture"
        [src]="picture().src"
        [style.aspect-ratio]="picture().width / picture().height"
      />
      <app-like-icon />
    </view>
  `,
  styles: `
    .picture-wrapper {
      width: 100%;
      border-radius: 10px;
      overflow: hidden;
    }

    .picture {
      width: 100%;
    }
  `,
})
export class LikeImageCard {
  readonly picture = input.required<Picture>();
}
