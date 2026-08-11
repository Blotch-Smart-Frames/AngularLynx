import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Scrollable single-child container.
 */
@Directive({
  selector: 'scroll-view',
  standalone: true,
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
  ],
})
export class LynxScrollView extends LynxElementBase {
  /**
   * Scroll axis. @default 'vertical'
   */
  'scroll-orientation'?: 'vertical' | 'horizontal';
  /**
   * Whether scrolling is enabled. @default true
   */
  'enable-scroll'?: boolean;
  /**
   * Whether the scroll view bounces past the content edge (iOS/Harmony).
   */
  bounces?: boolean;
  /**
   * Whether the platform scroll indicator is shown.
   */
  'scroll-bar-enable'?: boolean;
  /**
   * Distance from the top/left edge that triggers bindscrolltoupper.
   */
  'upper-threshold'?: number;
  /**
   * Distance from the bottom/right edge that triggers bindscrolltolower.
   */
  'lower-threshold'?: number;
  /**
   * Initial scroll offset in px.
   */
  'initial-scroll-offset'?: number;
  /**
   * Scroll to item at this index on mount.
   */
  'initial-scroll-to-index'?: number;
  /**
   * Whether nested scrolling is enabled.
   */
  'enable-nested-scroll'?: boolean;
}
