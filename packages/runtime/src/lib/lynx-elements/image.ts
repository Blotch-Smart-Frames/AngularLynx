import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Displays raster images, base64 data URIs, and animated GIFs.
 */
@Directive({
  selector: 'image',
  standalone: true,
  inputs: [
    'src',
    'mode',
    'placeholder',
    'blur-radius',
    'cap-insets',
    'cap-insets-scale',
    'auto-size',
    'autoplay',
    'loop-count',
    'tint-color',
    'image-config',
    'prefetch-width',
    'prefetch-height',
    'defer-src-invalidation',
  ],
})
export class LynxImage extends LynxElementBase {
  /**
   * Remote URL, local asset path, or base64 data URI.
   */
  src?: string;
  /**
   * How the image is scaled to fit its container.
   * @default 'scaleToFill'
   */
  mode?: 'scaleToFill' | 'aspectFit' | 'aspectFill' | 'center';
  /**
   * Placeholder image shown while the main image loads.
   */
  placeholder?: string;
  /**
   * Gaussian blur radius applied to the image.
   */
  'blur-radius'?: string;
  /**
   * Nine-slice cap insets for stretching images (CSS shorthand, e.g. "10px 10px 10px 10px").
   */
  'cap-insets'?: string;
  'cap-insets-scale'?: number;
  /**
   * Automatically size the element to the image's intrinsic dimensions.
   */
  'auto-size'?: boolean;
  /**
   * Auto-play for animated GIF images.
   */
  autoplay?: boolean;
  /**
   * Number of times to loop the animation (0 = infinite).
   */
  'loop-count'?: number;
  /**
   * Tint color applied over the image (CSS color string).
   */
  'tint-color'?: string;
  /**
   * Bitmap color format hint (Android).
   */
  'image-config'?: 'ARGB_8888' | 'RGB_565';
  /**
   * Pre-declared width for prefetch optimization.
   */
  'prefetch-width'?: string;
  'prefetch-height'?: string;
  /**
   * Keep showing the current image while the new src loads.
   */
  'defer-src-invalidation'?: boolean;
}
