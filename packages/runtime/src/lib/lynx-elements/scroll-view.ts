import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Scrollable single-child container.
 */
@Directive({
  selector: 'scroll-view',
  inputs: [
    'scroll-orientation',
    'enable-scroll',
    'bounces',
    'scroll-bar-enable',
    'upper-threshold',
    'lower-threshold',
    'initial-scroll-offset',
    'initial-scroll-to-index',
    'enable-nested-scroll',
    'experimental-android-enable-new-overflow',
  ],
})
export class LynxScrollView extends LynxElementBase {
  /**
   * Scroll axis. @default 'vertical'
   */
  declare 'scroll-orientation'?: 'vertical' | 'horizontal';
  /**
   * Whether scrolling is enabled. @default true
   */
  declare 'enable-scroll'?: boolean;
  /**
   * Whether the scroll view bounces past the content edge (iOS/Harmony).
   */
  declare bounces?: boolean;
  /**
   * Whether the platform scroll indicator is shown.
   */
  declare 'scroll-bar-enable'?: boolean;
  /**
   * Distance from the top/left edge that triggers bindscrolltoupper.
   */
  declare 'upper-threshold'?: number;
  /**
   * Distance from the bottom/right edge that triggers bindscrolltolower.
   */
  declare 'lower-threshold'?: number;
  /**
   * Initial scroll offset in px.
   */
  declare 'initial-scroll-offset'?: number;
  /**
   * Scroll to item at this index on mount.
   */
  declare 'initial-scroll-to-index'?: number;
  /**
   * Whether nested scrolling is enabled.
   */
  declare 'enable-nested-scroll'?: boolean;
  /**
   * Use the new overflow clipping implementation (Android, Lynx 4.2+, experimental). @default true
   */
  declare 'experimental-android-enable-new-overflow'?: boolean;
}
