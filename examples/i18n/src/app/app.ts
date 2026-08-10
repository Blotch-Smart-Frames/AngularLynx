import { Component, inject, signal } from '@angular/core';
import { LYNX_ELEMENTS, LynxLocale } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">i18n</text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Internationalization with Angular and Lynx.
        </text>

        <view class="mb-4 rounded-lg bg-indigo-50 px-3.5 py-2.5">
          <text class="text-[13px] font-semibold text-indigo-700">
            Locale: {{ localeService.locale() }}
          </text>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Translated Strings
          </text>
          <text i18n="@@app.greeting" class="mb-2 text-[18px] text-zinc-900">
            Hello, world!
          </text>
          <text class="mb-2 text-[15px] text-zinc-900">{{
            welcomeMessage
          }}</text>
          <text
            i18n="
              app description|A brief description of the i18n
              example@@app.description"
            class="text-[13px] text-zinc-500"
          >
            This is an internationalization example with Angular on Lynx.
          </text>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Counter
          </text>
          <text class="mb-3 text-[18px] text-zinc-900">{{
            counterMessage()
          }}</text>
          <view
            class="items-center rounded-[10px] bg-indigo-500 px-6 py-3"
            (bindtap)="increment()"
          >
            <text
              i18n="@@app.tap_button"
              class="text-[15px] font-semibold text-white"
            >
              Tap to increment
            </text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly localeService = inject(LynxLocale);
  readonly count = signal(0);
  readonly userName = 'Angular Developer';

  get welcomeMessage(): string {
    return $localize`:@@app.welcome:Welcome, ${this.userName}:userName:!`;
  }

  counterMessage() {
    const count = this.count();
    return $localize`:@@app.counter:Counter: ${count}:count:`;
  }

  increment(): void {
    this.count.update((n) => n + 1);
  }
}
