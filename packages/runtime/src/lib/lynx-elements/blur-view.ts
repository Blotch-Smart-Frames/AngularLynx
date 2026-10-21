import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Backdrop blur: blurs the content rendered behind the element, like CSS
 * `backdrop-filter: blur()`. On iOS, `blur-effect="glass"` renders the
 * Liquid Glass material.
 *
 * Android only has the plain blur, a Gaussian blur of `blur-radius`. There
 * the runtime approximates `blur-effect`, `glass-style` and
 * `glass-tint-color` with a translucent background and rim over the blur,
 * which a background, background image or shadow the app sets replaces.
 * Nothing refracts, and `glass-interactive` and `spacing` do nothing.
 */
@Directive({
  selector: 'blur-view',
  inputs: [
    'blur-radius',
    'blur-sampling',
    'enable-auto-blur',
    'android-capture-target',
    'experimental-update-blur-radius',
    'blur-effect',
    'spacing',
    'glass-interactive',
    'glass-tint-color',
    'glass-style',
    'ios-user-interface-style',
  ],
})
export class LynxBlurView extends LynxElementBase {
  /**
   * Gaussian blur radius (Android/iOS/Harmony). @default '0px'
   */
  'blur-radius'?: string;
  /**
   * Downsampling ratio of the blurred area. Higher is faster but softer (Android). @default 6
   */
  'blur-sampling'?: number;
  /**
   * Whether the blur updates automatically as content behind it changes (Android). @default true
   */
  'enable-auto-blur'?: boolean;
  /**
   * Raw id of the view to capture and blur; it must have `flatten="false"`
   * (Android). The runtime points it at the page, so a blur-view inside
   * another blur-view still blurs what's behind it; an empty string restores
   * Android's own choice, the nearest ancestor that clips or contains it.
   */
  'android-capture-target'?: string;
  /**
   * Switches the internal blur-buffer refresh path (Android, experimental).
   */
  'experimental-update-blur-radius'?: boolean;
  /**
   * Blur material (iOS). `glass` renders Liquid Glass; `glass-container`
   * merges nested glass `<blur-view>`s into one combined effect. Android
   * gets a tint that approximates it. @default 'light'
   */
  'blur-effect'?:
    | 'light'
    | 'extra-light'
    | 'dark'
    | 'glass'
    | 'glass-container';
  /**
   * Distance at which glass elements inside a `glass-container` start to merge (iOS). @default 0
   */
  spacing?: number;
  /**
   * Whether the glass reacts to touches (iOS). @default false
   */
  'glass-interactive'?: boolean;
  /**
   * Tint color applied to the glass (iOS; approximated on Android). @default 'transparent'
   */
  'glass-tint-color'?: string;
  /**
   * Glass variant (iOS; approximated on Android). @default 'regular'
   */
  'glass-style'?: 'regular' | 'clear';
  /**
   * Forces a light or dark appearance for the material (iOS, Lynx 4.1+).
   */
  'ios-user-interface-style'?: 'dark' | 'light';
}
