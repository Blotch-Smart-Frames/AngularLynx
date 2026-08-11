import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Renders SVG content from a URL or an inline XML string.
 */
@Directive({
  selector: 'svg',
  standalone: true,
  inputs: ['src', 'content'],
})
export class LynxSvg extends LynxElementBase {
  /**
   * URL pointing to an SVG resource.
   */
  src?: string;
  /**
   * Inline SVG XML string.
   */
  content?: string;
}
