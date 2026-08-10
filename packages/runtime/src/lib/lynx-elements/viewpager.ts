import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Horizontally swipeable paging container.
 */
@Directive({
  selector: 'viewpager',
  standalone: true,
  inputs: [
    'initial-select-index',
    'enable-scroll',
    'bounces',
    'android-always-overscroll',
    'android-force-can-scroll',
    'ios-gesture-direction',
    'ios-gesture-offset',
    'ios-recognized-gesture-class',
    'ios-recognized-view-tag',
    'keep-item-view',
  ],
})
export class LynxViewPager extends LynxElementBase {
  /**
   * Page index to display on first render. @default 0
   */
  'initial-select-index'?: number;
  /**
   * Whether horizontal scroll gesture is enabled. @default true
   */
  'enable-scroll'?: boolean;
  /**
   * Whether the pager bounces past edge (iOS/Harmony/Clay). @default true
   */
  bounces?: boolean;
  /**
   * Enable bounce effect at edges on Android. @default false
   */
  'android-always-overscroll'?: boolean;
  /**
   * Block gesture pass-through to parent on Android. @default false
   */
  'android-force-can-scroll'?: boolean;
  /**
   * Allow outer container swipe at edges (iOS). @default false
   */
  'ios-gesture-direction'?: boolean;
  /**
   * Left edge exclusion zone for swipe gesture (iOS, px). @default 0
   */
  'ios-gesture-offset'?: number;
  /**
   * UIGestureRecognizer class name for simultaneous recognition (iOS).
   */
  'ios-recognized-gesture-class'?: string;
  /**
   * UIView tag for simultaneous gesture recognition (iOS). @default 0
   */
  'ios-recognized-view-tag'?: number;
  /**
   * Enable lazy load mode with early exposure. @default false
   */
  'keep-item-view'?: boolean;
}

/**
 * Single page container inside a viewpager.
 */
@Directive({
  selector: 'viewpager-item',
  standalone: true,
})
export class LynxViewPagerItem extends LynxElementBase {}
