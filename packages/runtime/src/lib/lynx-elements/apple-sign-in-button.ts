import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * The button that starts Sign in with Apple, drawn to Apple's guidelines:
 * the logo, one of the titles Apple allows, its colors and its corners. Tap
 * it to call `LynxAppleSignIn.signIn()`.
 *
 * In an iOS app built with angular.json's `"signInWithApple": true` it's
 * iOS's own `ASAuthorizationAppleIDButton`, whose title follows the system's
 * language. Elsewhere (Android, the web preview, Lynx Explorer) the runtime
 * draws the same button, with an English title. Give it a size, as Apple's
 * guidelines ask for (at least 140 × 30, and 44 tall as a rule); it takes no
 * children.
 */
@Directive({
  selector: 'apple-sign-in-button',
  inputs: ['type', 'button-style', 'corner-radius'],
})
export class LynxAppleSignInButton extends LynxElementBase {
  /**
   * The title: `signIn` ("Sign in with Apple"), `continue` ("Continue with
   * Apple") or `signUp` ("Sign up with Apple"). Read when the button is
   * made, on iOS. @default 'signIn'
   */
  declare type?: 'signIn' | 'continue' | 'signUp';
  /**
   * The colors: `black`, `white`, or `whiteOutline` (white, outlined in
   * black, for a white background). Read when the button is made, on iOS.
   * @default 'black'
   */
  declare 'button-style'?: 'black' | 'white' | 'whiteOutline';
  /**
   * The corners' radius, in points (iOS) or pixels. @default 6
   */
  declare 'corner-radius'?: number;
}
