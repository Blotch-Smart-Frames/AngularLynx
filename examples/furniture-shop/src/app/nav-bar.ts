import { booleanAttribute, Component, input, output } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import backIcon from '../assets/icons/back.png';

/**
 * The black bar at the top of each screen, with the screen's title and, on
 * a screen that was opened from another, a back chevron. It pads itself by
 * the top safe-area inset: on a phone the bar starts below the status bar,
 * and the black runs on up behind it.
 */
@Component({
  selector: 'app-nav-bar',
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="nav-bar">
      @if (showBack()) {
        <view
          class="back"
          accessibility-element="true"
          accessibility-traits="button"
          accessibility-label="Back"
          (bindtap)="back.emit()"
        >
          <image class="back-icon" [src]="backIcon" />
        </view>
      }
      @if (title()) {
        <text class="title">{{ title() }}</text>
      }
    </view>
  `,
  styles: `
    .nav-bar {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
      height: calc(48px + env(safe-area-inset-top));
      padding-top: env(safe-area-inset-top);
      background-color: #000;
    }

    .title {
      position: absolute;
      top: env(safe-area-inset-top);
      width: 100%;
      height: 48px;
      line-height: 48px;
      color: #fff;
      font-size: 20px;
      font-weight: 500;
      text-align: center;
    }

    /* The chevron is 24px; the padding gives it a finger-sized target while
       it stays 20px from the edge, where the tutorial draws it. */
    .back {
      padding: 12px 16px 12px 20px;
    }

    .back-icon {
      width: 24px;
      height: 24px;
    }
  `,
})
export class NavBar {
  readonly title = input('');
  readonly showBack = input(false, { transform: booleanAttribute });
  readonly back = output();
  readonly backIcon = backIcon;
}
