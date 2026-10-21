import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Embeds a separate Lynx bundle as a nested page.
 */
@Directive({
  selector: 'frame',
  inputs: [
    'src',
    'data',
    'global-props',
    'auto-width',
    'auto-height',
    'preset-width',
    'preset-height',
    'enable-multi-async-thread',
  ],
})
export class LynxFrame extends LynxElementBase {
  /**
   * URL of the `.lynx.bundle` file to embed.
   */
  src?: string;
  /**
   * Initial data passed into the embedded page.
   */
  data?: Record<string, unknown>;
  /**
   * Global props forwarded to the embedded page's global scope.
   */
  'global-props'?: Record<string, unknown>;
  /**
   * Size the frame to match its content width.
   */
  'auto-width'?: boolean;
  /**
   * Size the frame to match its content height.
   */
  'auto-height'?: boolean;
  /**
   * Width used before the embedded page reports its content size (e.g. `'200px'`).
   */
  'preset-width'?: string;
  /**
   * Height used before the embedded page reports its content size (e.g. `'200px'`).
   */
  'preset-height'?: string;
  /**
   * Override the host's multi-async-thread setting for the embedded page.
   */
  'enable-multi-async-thread'?: boolean;
}
