import type { ElementRef } from '../../types/lynx';
import { loadWebViewInIsolatedPage } from '../web-webview';

/**
 * Native platform web view (WKWebView / android.webkit.WebView) that loads a
 * URL (`src`) or inline HTML (`html`). Unlike `<frame>`, which embeds another
 * Lynx bundle, this hosts real web content.
 *
 * On Lynx for Web it's an `<iframe>`, which a cross-origin isolated page
 * (`ng serve`'s web preview) loads only when told to (see web-webview.ts).
 * `__WEB__` is a compile-time define, so native bundles drop the call; only
 * the main thread creates real elements.
 */
export const createWebViewElement = (pageId: number): ElementRef => {
  const element = __CreateElement('webview', pageId);
  if (__WEB__ && __MAIN_THREAD__) {
    loadWebViewInIsolatedPage(element);
  }
  return element;
};
