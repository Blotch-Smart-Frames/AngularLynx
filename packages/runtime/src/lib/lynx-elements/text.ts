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
    'text-fake-bold',
    'custom-text-selection',
    'android-emoji-compat',
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
  /**
   * Synthesize bold when the font has no bold face (Android/iOS). @default false
   */
  'text-fake-bold'?: boolean;
  /**
   * Hand selection/copy gestures to your own handlers; requires `text-selection`. @default false
   */
  'custom-text-selection'?: boolean;
  /**
   * Render emoji with the Emoji2 compatibility library (Android; the app must include it). @default false
   */
  'android-emoji-compat'?: boolean;
}

/**
 * Custom content shown at the end of a `<text>` in place of the ellipsis when
 * the text is truncated by `text-maxline`. Must be a direct child of `<text>`.
 */
@Directive({ selector: 'inline-truncation', standalone: true })
export class LynxInlineTruncation extends LynxElementBase {}
