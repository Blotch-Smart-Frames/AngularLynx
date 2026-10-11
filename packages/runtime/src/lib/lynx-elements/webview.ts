import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Native web view that loads a URL or an inline HTML string. Use `<frame>`
 * instead to embed another Lynx bundle.
 */
@Directive({
  selector: 'webview',
  standalone: true,
  inputs: [
    'src',
    'html',
    'bounces',
    'scroll-bar-enable',
    'params',
    'webview-type',
    'enable-debug',
    'initjs',
    'cookies',
    'use-osr',
  ],
})
export class LynxWebView extends LynxElementBase {
  /**
   * URL to load. Changing it reloads the page.
   */
  src?: string;
  /**
   * Inline HTML to load. Ignored when `src` is set.
   */
  html?: string;
  /**
   * Enable the bounce effect (iOS). @default false
   */
  bounces?: boolean;
  /**
   * Show the scroll bar (iOS). @default false
   */
  'scroll-bar-enable'?: boolean;
  /**
   * Params forwarded to a custom web view implementation (Android/iOS).
   */
  params?: Record<string, unknown>;
  /**
   * Which web view implementation (injected via LynxService) to use. @default 'default'
   */
  'webview-type'?: string;
  /**
   * Allow remote debugging (Chrome DevTools / Safari Web Inspector). @default false
   */
  'enable-debug'?: boolean;
  /**
   * JavaScript executed when the document is ready (Clay desktop).
   */
  initjs?: string;
  /**
   * Cookies preset before loading (Clay).
   */
  cookies?: {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite: string;
  }[];
  /**
   * Render off-screen (Clay). @default false
   */
  'use-osr'?: boolean;
}
