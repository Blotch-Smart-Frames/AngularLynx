import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Displays text content. Supports inline child `<text>` elements for mixed styling.
 */
@Directive({
  selector: 'text',
  standalone: true,
  inputs: [
    'text-maxline',
    'text-single-line-vertical-align',
    'text-selection',
    'custom-context-menu',
    'include-font-padding',
    'tail-color-convert',
  ],
})
export class LynxText extends LynxElementBase {
  /**
   * Maximum number of lines before truncation with ellipsis.
   */
  'text-maxline'?: number;
  /**
   * Vertical alignment for single-line text.
   * @default 'normal'
   */
  'text-single-line-vertical-align'?: 'normal' | 'top' | 'center' | 'bottom';
  /**
   * Whether the user can select the text.
   */
  'text-selection'?: boolean;
  /**
   * Whether a custom context menu is shown on long-press.
   */
  'custom-context-menu'?: boolean;
  /**
   * Add extra font padding on Android.
   */
  'include-font-padding'?: boolean;
  'tail-color-convert'?: boolean;
}
