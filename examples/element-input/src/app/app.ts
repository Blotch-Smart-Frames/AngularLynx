import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Input Element
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Text input with reactive signal binding.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Try it
          </text>
          <input
            type="text"
            class="rounded-lg border border-zinc-200 bg-white px-3.5 py-3 text-[15px]"
            placeholder="Type your name..."
            (bindinput)="onInput($event)"
          />
        </view>

        <view
          class="items-center rounded-xl border border-indigo-200 bg-indigo-50 p-4"
        >
          <text class="text-[18px] font-semibold text-indigo-700">
            Hello, {{ name() || 'stranger' }}!
          </text>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly name = signal('');

  onInput(event: Event): void {
    this.name.set((event as CustomEvent<{ value: string }>).detail.value);
  }
}
