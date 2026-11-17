import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS, LynxLinking } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, RouterOutlet],
  template: `
    <view class="h-full flex-col bg-zinc-50 flex">
      <view class="flex-1">
        <router-outlet />
      </view>
      <!-- What LynxLinking says, for apps that want the URL itself. -->
      <view
        class="border-t border-zinc-200 bg-white px-6 pt-3"
        style="padding-bottom: calc(12px + env(safe-area-inset-bottom));"
      >
        <text class="text-[12px] text-zinc-500">
          Started from: {{ initialURL ?? 'the app icon' }}
        </text>
        <text class="mt-1 text-[12px] text-zinc-500">
          Last link: {{ lastURL() || 'none yet' }}
        </text>
      </view>
    </view>
  `,
})
export class App {
  readonly #linking = inject(LynxLinking);

  /** The link that started the app, or null. */
  protected readonly initialURL = this.#linking.getInitialURL();
  /** The last link that arrived while the app was open. */
  readonly lastURL = signal('');

  constructor() {
    // The router already navigates to each link's route. This only shows
    // the URL, as an app that reads its own links would.
    this.#linking.onURL((url) => this.lastURL.set(url));
  }
}
