import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * General-purpose container element, equivalent to HTML `<div>`.
 */
@Directive({
  selector: 'view',
  standalone: true,
  inputs: [
    'flatten',
    'pan-intercept-direction',
    'pan-intercept-scope',
    'consume-slide-event',
    'enable-touch-pseudo-propagation',
  ],
})
export class LynxView extends LynxElementBase {
  /**
   * Flatten the view into its parent's layer (Android only).
   * Improves performance for non-interactive views.
   */
  flatten?: boolean;
  /**
   * Direction of pan-gesture interception.
   * 0 = horizontal, 1 = vertical, 2 = none.
   */
  'pan-intercept-direction'?: 0 | 1 | 2;
  'pan-intercept-scope'?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  'consume-slide-event'?: [number, number][];
  'enable-touch-pseudo-propagation'?: boolean;
}
