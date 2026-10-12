import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Floating layer rendered above the main document flow.
 */
@Directive({
  selector: 'overlay',
  standalone: true,
  inputs: [
    'visible',
    'level',
    'mode',
    'ios-enable-swipe-back',
    'android-navigation-bar-style',
    'android-overlay-scope',
  ],
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
  /**
   * Android navigation bar background/appearance while the overlay is shown.
   * `transparent` also requires `android-adapt-edge-to-edge`. (Lynx 4.1+) @default 'auto'
   */
  'android-navigation-bar-style'?: 'auto' | 'light' | 'dark' | 'transparent';
  /**
   * Limit the overlay to the Fragment that owns its LynxView (Android, Lynx 4.3+). @default 'global'
   */
  'android-overlay-scope'?: 'global' | 'fragment';
}
