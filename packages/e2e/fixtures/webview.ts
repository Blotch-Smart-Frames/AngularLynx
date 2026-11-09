import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LYNX_ELEMENTS, type LynxEvent } from '@blotch/angular-lynx';

/**
 * With the viewport tag, WKWebView lays the page out at its own width rather
 * than a desktop page's 980 pixels, so the line is legible in screenshots.
 */
const PAGE =
  '<html><head><meta name="viewport" content="width=device-width"></head><body><p>Web page text</p></body></html>';

/**
 * E2E fixture for `<webview>` (issue #338), loaded through `loadComponent`
 * like linking.ts; photo.ts links here. It loads a page from its `html`
 * attribute, with no network, and shows "Web view: loaded" once the native
 * web view (WKWebView, android.webkit.WebView) has finished loading it and
 * its `bindload` reached Angular, or the error it reported.
 *
 * The page's own line, "Web page text", is in the web view's accessibility
 * tree, which the web view builds from the page it drew, so native/webview.yaml
 * looks for it too. A host without XElement's web view leaves the box empty
 * and the status on "loading".
 *
 * A web view's first page in an app takes a moment: the platform starts the
 * web engine's processes for it then (on the iOS Simulator, 1 to 3 seconds,
 * and over 10 on a busy Mac). The box stays empty until then, which issue
 * #338 took for a web view that never draws.
 *
 * "Open overlays", below the status, opens overlays.ts.
 */
@Component({
  selector: 'app-webview',
  imports: [LYNX_ELEMENTS, RouterLink],
  template: `
    <webview
      style="margin-top: 16px; width: 200px; height: 80px; border-width: 1px; border-color: #999999;"
      [html]="page"
      (bindload)="status.set('loaded')"
      (binderror)="onError($event)"
    ></webview>
    <text flatten="false" style="margin-top: 8px;"
      >Web view: {{ status() }}</text
    >
    <view
      [flatten]="false"
      [accessibility-element]="true"
      accessibility-label="Open overlays"
      accessibility-traits="button"
      style="margin-top: 8px; padding: 12px; background-color: #e0e0e0; align-self: flex-start;"
      routerLink="/overlays"
    >
      <text>Open overlays</text>
    </view>
  `,
})
export class WebViewRoute {
  readonly page = PAGE;
  readonly status = signal('loading');

  /**
   * Shows the whole detail: XElement's iOS web view names a failed
   * navigation's fields `errCode` and `errMsg`, and an empty page's
   * `errorCode` and `errorMsg`.
   */
  onError({ detail }: LynxEvent<unknown>): void {
    this.status.set(`error ${JSON.stringify(detail)}`);
  }
}
