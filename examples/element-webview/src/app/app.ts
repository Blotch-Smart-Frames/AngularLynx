import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

type Source = 'url' | 'html';

// Angular types $event on native element events as DOM Event; Lynx delivers
// the payload on `detail`, so handlers cast to CustomEvent<…Detail>.
type WebViewErrorDetail = {
  errorCode: number;
  errorMsg: string;
};

const SAMPLE_HTML = `
<html>
  <body style="font-family: -apple-system, sans-serif; padding: 16px;">
    <h2>Inline HTML</h2>
    <p>This page was passed through the <code>html</code> attribute.</p>
  </body>
</html>`;

@Component({
  selector: 'app-root',
  template: `
    <view class="h-full flex-col bg-zinc-50 flex">
      <view class="p-6 pb-3">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">WebView</text>
        <text class="mb-4 text-[13px] text-zinc-500">
          A native web view that loads a URL or inline HTML.
        </text>

        <view class="mb-3 flex-row rounded-lg bg-zinc-100 p-1 flex">
          @for (option of sources; track option) {
            <view
              class="flex-1 items-center rounded-md py-2"
              [class.bg-white]="option === source()"
              (bindtap)="select(option)"
            >
              <text
                class="text-[13px]"
                [class.font-semibold]="option === source()"
                [class.text-zinc-900]="option === source()"
                [class.text-zinc-500]="option !== source()"
              >
                {{ option === 'url' ? 'src (URL)' : 'html (inline)' }}
              </text>
            </view>
          }
        </view>

        <view class="flex-row items-center flex justify-between">
          <text class="text-[13px] text-zinc-500">{{ status() }}</text>
          <view class="rounded-md bg-zinc-900 px-3 py-1.5" (bindtap)="reload()">
            <text class="text-[13px] font-semibold text-white">Reload</text>
          </view>
        </view>
      </view>

      <view
        class="mx-6 mb-6 flex-1 rounded-xl border border-zinc-200 bg-white overflow-hidden"
      >
        <!--
          Only one of src/html is bound at a time: when both are set, src
          wins and the html is ignored.
        -->
        @if (source() === 'url') {
          <webview
            id="browser"
            class="h-full w-full"
            src="https://angular.dev"
            (bindload)="status.set('Loaded angular.dev')"
            (binderror)="onError($event)"
            (bindmessage)="onMessage($event)"
          ></webview>
        } @else {
          <webview
            id="browser"
            class="h-full w-full"
            [html]="html"
            (bindload)="status.set('Loaded inline HTML')"
            (binderror)="onError($event)"
          ></webview>
        }
      </view>
    </view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly sources: readonly Source[] = ['url', 'html'];
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
      .select('#browser')
      .invoke({ method: 'reload', params: {} })
      .exec();
  }

  onError(event: Event): void {
    const { errorCode, errorMsg } = (event as CustomEvent<WebViewErrorDetail>)
      .detail;
    this.status.set(`Error ${errorCode}: ${errorMsg}`);
  }

  onMessage(event: Event): void {
    const { msg } = (event as CustomEvent<{ msg: string }>).detail;
    this.status.set(`Message: ${msg}`);
  }
}
