import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Floating layer rendered above the main document flow.
 */
@Directive({
  selector: 'overlay',
  standalone: true,
  inputs: ['visible', 'level', 'mode', 'ios-enable-swipe-back'],
})
export class LynxOverlay extends LynxElementBase {
  /**
   * Whether the overlay is shown.
   */
  visible?: boolean;
  /**
   * Z-order layer (higher = above other overlays).
   * 1 = default, 2 = status bar level, 3 = keyboard level, 4 = top.
   */
  level?: 1 | 2 | 3 | 4;
  /**
   * Presentation mode on iOS (`'window'` | `'top'` | `'page'`).
   */
  mode?: string;
  /**
   * Whether the iOS swipe-back gesture dismisses the overlay.
   */
  'ios-enable-swipe-back'?: boolean;
}
