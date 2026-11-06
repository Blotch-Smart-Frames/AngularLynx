import { Component, inject, signal } from '@angular/core';
import { LYNX_ELEMENTS, LynxLinking } from '@blotch/angular-lynx';

const DOCS_URL = 'https://lynxjs.org/guide/start/quick-start.html';
const SHOP_URL = 'https://angularlynx.js.org';
const SUPPORT_MAIL = 'mailto:support@example.com?subject=Help';
const WHATSAPP_URL = 'whatsapp://send?text=Hello';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <!-- Apps draw under the status bar, so the page starts below it. -->
      <view
        class="px-6 pb-6"
        style="padding-top: calc(24px + env(safe-area-inset-top));"
      >
        <text class="mb-1 text-[28px] font-bold text-zinc-900">Linking</text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Links that leave the app: a browser sheet over it, the browser, and
          other apps.
        </text>

        <view
          class="mb-3 rounded-xl border border-zinc-200 bg-white p-4"
          (bindtap)="openDocs()"
        >
          <text class="text-[15px] font-semibold text-zinc-900">
            Read the docs
          </text>
          <text class="mt-1 text-[13px] text-zinc-500">
            In a browser sheet, and back here when it closes
          </text>
        </view>

        <view
          class="mb-3 rounded-xl border border-zinc-200 bg-white p-4"
          (bindtap)="open(shopUrl)"
        >
          <text class="text-[15px] font-semibold text-zinc-900">
            Visit the website
          </text>
          <text class="mt-1 text-[13px] text-zinc-500">In the browser</text>
        </view>

        <view
          class="mb-3 rounded-xl border border-zinc-200 bg-white p-4"
          (bindtap)="open(supportMail)"
        >
          <text class="text-[15px] font-semibold text-zinc-900">
            Email support
          </text>
          <text class="mt-1 text-[13px] text-zinc-500">
            {{ canMail() ? 'In the mail app' : 'No mail app on this device' }}
          </text>
        </view>

        @if (canWhatsApp()) {
          <view
            class="mb-3 rounded-xl border border-zinc-200 bg-white p-4"
            (bindtap)="open(whatsAppUrl)"
          >
            <text class="text-[15px] font-semibold text-zinc-900">
              Message us on WhatsApp
            </text>
            <text class="mt-1 text-[13px] text-zinc-500">
              Shown only when WhatsApp is installed
            </text>
          </view>
        }

        @if (status()) {
          <text class="mt-2 text-[13px] text-zinc-600">{{ status() }}</text>
        }
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly #linking = inject(LynxLinking);

  protected readonly shopUrl = SHOP_URL;
  protected readonly supportMail = SUPPORT_MAIL;
  protected readonly whatsAppUrl = WHATSAPP_URL;

  readonly canMail = signal(false);
  readonly canWhatsApp = signal(false);
  readonly status = signal('');

  constructor() {
    // Asked once, so the rows match the apps on this device. WhatsApp's
    // scheme is in angular.json's canOpenURLSchemes: without it, iOS and
    // Android always say no.
    void this.#linking
      .canOpenURL(SUPPORT_MAIL)
      .then((can) => this.canMail.set(can));
    void this.#linking
      .canOpenURL(WHATSAPP_URL)
      .then((can) => this.canWhatsApp.set(can));
  }

  openDocs(): void {
    this.status.set('Reading the docs…');
    this.#linking
      .openInApp(DOCS_URL, {
        toolbarColor: '#18181b',
        controlsColor: '#ffffff',
      })
      .then(
        () => this.status.set('Back from the docs'),
        (error: Error) => this.status.set(error.message),
      );
  }

  open(url: string): void {
    this.#linking.openURL(url).then(
      () => this.status.set(`Opened ${url}`),
      (error: Error) => this.status.set(error.message),
    );
  }
}
