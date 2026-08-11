import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Pull-to-refresh container. Accepts `<refresh-header>` and a scrollable `<view>` as direct children.
 */
@Directive({
  selector: 'refresh',
  standalone: true,
  inputs: ['enable-refresh'],
})
export class LynxRefresh extends LynxElementBase {
  /**
   * Whether dragging down or calling autoStartRefresh can trigger the startrefresh event. @default true
   */
  'enable-refresh'?: boolean;
}

/**
 * Customizable header revealed during a pull-to-refresh gesture. Must be a direct child of `<refresh>`.
 */
@Directive({
  selector: 'refresh-header',
  standalone: true,
})
export class LynxRefreshHeader extends LynxElementBase {}
