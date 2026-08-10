import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Textarea Element
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Multi-line input with a reactive character counter.
        </text>

        <view class="rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Compose
          </text>
          <textarea
            class="h-[120px] rounded-lg border border-zinc-200 bg-white px-3.5 py-3 text-[15px]"
            placeholder="Write a message..."
            (bindinput)="onInput($event)"
          ></textarea>
          <text class="mt-1.5 text-xs text-zinc-400 text-right">
            {{ charCount() }} characters
          </text>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly text = signal('');
  readonly charCount = computed(() => this.text().length);

  onInput(event: { detail: { value: string } }): void {
    this.text.set(event.detail.value);
  }
}
