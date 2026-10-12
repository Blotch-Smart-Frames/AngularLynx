import type { ElementRef } from '../../types/lynx';

/**
 * Native platform web view (WKWebView / android.webkit.WebView) that loads a
 * URL (`src`) or inline HTML (`html`). Unlike `<frame>`, which embeds another
 * Lynx bundle, this hosts real web content.
 */
export const createWebViewElement = (pageId: number): ElementRef => {
  return __CreateElement('webview', pageId);
};
