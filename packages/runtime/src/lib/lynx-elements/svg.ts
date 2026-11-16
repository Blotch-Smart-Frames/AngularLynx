import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Renders SVG content from a URL or an inline XML string.
 */
@Directive({
  selector: 'svg',
  inputs: ['src', 'content', 'current-color'],
})
export class LynxSvg extends LynxElementBase {
  /**
   * URL pointing to an SVG resource.
   */
  declare src?: string;
  /**
   * Inline SVG XML string.
   */
  declare content?: string;
  /**
   * Color used for `currentColor` in the SVG. Doesn't override explicit `fill`/`stroke`.
   */
  declare 'current-color'?: string;
}
