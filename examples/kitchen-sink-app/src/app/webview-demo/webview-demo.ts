import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import { UiText } from '../../components/ui/typography';
import { ScreenHost } from '../screen-host';

type Source = 'url' | 'html';

// Angular types $event on native element events as DOM Event; Lynx delivers
// the payload on `detail`, so handlers cast to CustomEvent<…Detail>.
type WebViewErrorDetail = { errorCode: number; errorMsg: string };

const SAMPLE_HTML = `
<html>
  <body style="font-family: -apple-system, sans-serif; padding: 16px;">
    <h2>Inline HTML</h2>
    <p>This page was passed through the <code>html</code> attribute.</p>
  </body>
</html>`;

/**
 * Showcase for the native `<webview>` element: load a URL (`src`) or an inline
 * HTML string (`html`), track loading through events, and reload through its
 * UI method.
 *
 * Avoids `DemoScreen`: the web page scrolls itself, and nesting that inside
 * the frame's scroll-view would make the two fight for the same vertical
 * touches. The web view claims the free height via `flex-1` instead.
 */
@Component({
  selector: 'app-webview-demo',
  hostDirectives: [ScreenHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, UiBadge, UiButton, UiText],
  template: `
    <view class="h-full w-full flex-col gap-3 bg-background p-4 flex">
      <view class="flex-row items-center gap-2 flex">
        <ui-text variant="h3">WebView</ui-text>
        <ui-badge variant="secondary">Elements</ui-badge>
      </view>
      <ui-text variant="muted">
        A native web view that loads a URL or inline HTML.
      </ui-text>

      <view class="flex-row items-center gap-2 flex">
        <ui-button
          size="sm"
          [variant]="source() === 'url' ? 'default' : 'outline'"
          (pressed)="select('url')"
        >
          src (URL)
        </ui-button>
        <ui-button
          size="sm"
          [variant]="source() === 'html' ? 'default' : 'outline'"
          (pressed)="select('html')"
        >
          html (inline)
        </ui-button>
        <view class="flex-1"></view>
        <ui-button size="sm" variant="outline" (pressed)="reload()">
          Reload
        </ui-button>
      </view>
      <ui-text variant="muted">{{ status() }}</ui-text>

      <view
        class="flex-1 rounded-xl border border-border bg-card overflow-hidden"
      >
        <!--
          Only one of src/html is bound at a time: when both are set, src
          wins and the html is ignored.
        -->
        @if (source() === 'url') {
          <webview
            id="kitchen-sink-webview"
            class="h-full w-full"
            src="https://angular.dev"
            (bindload)="status.set('Loaded angular.dev')"
            (binderror)="onError($event)"
          ></webview>
        } @else {
          <webview
            id="kitchen-sink-webview"
            class="h-full w-full"
            [html]="html"
            (bindload)="status.set('Loaded inline HTML')"
            (binderror)="onError($event)"
          ></webview>
        }
      </view>
    </view>
  `,
})
export class WebViewDemo {
  readonly html = SAMPLE_HTML;

  readonly source = signal<Source>('url');
  readonly status = signal('Loading…');

  select(source: Source): void {
    if (source === this.source()) return;
    this.source.set(source);
    this.status.set('Loading…');
  }

  /**
   * reload is a UI method of the native web view, not an attribute, so it is
   * invoked through SelectorQuery.
   */
  reload(): void {
    this.status.set('Reloading…');
    lynx
      .createSelectorQuery()
      .select('#kitchen-sink-webview')
      .invoke({ method: 'reload', params: {} })
      .exec();
  }

  onError(event: Event): void {
    const { errorCode, errorMsg } = (event as CustomEvent<WebViewErrorDetail>)
      .detail;
    this.status.set(`Error ${errorCode}: ${errorMsg}`);
  }
}
