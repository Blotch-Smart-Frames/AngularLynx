import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">SSR</text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Instant first-frame rendering with snapshot encoding.
        </text>

        <view
          class="mb-4 rounded-xl border p-4"
          [class.bg-green-50]="ssrStatus().ok"
          [class.border-green-200]="ssrStatus().ok"
          [class.bg-red-50]="!ssrStatus().ok"
          [class.border-red-200]="!ssrStatus().ok"
        >
          <text class="mb-2 text-sm font-semibold text-zinc-900">
            SSR Status
          </text>
          <text class="mb-0.5 text-[13px] text-zinc-500">
            ssrEncode registered:
            {{ ssrStatus().encodeRegistered ? 'YES' : 'NO' }}
          </text>
          <text class="mb-0.5 text-[13px] text-zinc-500">
            ssrHydrate registered:
            {{ ssrStatus().hydrateRegistered ? 'YES' : 'NO' }}
          </text>
          <text class="mb-0.5 text-[13px] text-zinc-500">
            Opcode count: {{ ssrStatus().opcodeCount }}
          </text>
          <text class="mb-0.5 text-[13px] text-zinc-500">
            Snapshot size: {{ ssrStatus().snapshotSize }} bytes
          </text>
        </view>

        <view
          class="mb-4 items-center rounded-[10px] bg-indigo-500 px-6 py-3"
          (bindtap)="runEncode()"
        >
          <text class="text-[15px] font-semibold text-white">
            Run ssrEncode()
          </text>
        </view>

        @if (snapshotPreview()) {
          <view class="mb-4 rounded-lg bg-zinc-100 p-3">
            <text class="text-[11px] text-zinc-900">{{
              snapshotPreview()
            }}</text>
          </view>
        }

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Static Content
          </text>
          <text class="text-sm leading-5 text-zinc-500">
            This text is part of the first-frame snapshot. It appears instantly
            without waiting for JS to execute on the background thread.
          </text>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Dynamic Items
          </text>
          @for (item of items(); track item.id) {
            <view class="border-b border-zinc-200 py-2.5">
              <text class="text-sm text-zinc-900">{{ item.label }}</text>
            </view>
          }
          <view
            class="mt-3 items-center rounded-[10px] bg-indigo-500 px-6 py-3"
            (bindtap)="addItem()"
          >
            <text class="text-[15px] font-semibold text-white">
              Add item (post-hydration)
            </text>
          </view>
        </view>

        <text class="text-xs text-zinc-400">
          Items added after hydration use normal element creation — the SSR
          snapshot only captures the initial render state.
        </text>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly items = signal([
    { id: 1, label: 'Item 1 — from initial data' },
    { id: 2, label: 'Item 2 — from initial data' },
    { id: 3, label: 'Item 3 — from initial data' },
  ]);

  readonly ssrStatus = signal(this.#checkSsrStatus());
  readonly snapshotPreview = signal('');

  #nextId = 4;

  addItem(): void {
    this.items.update((prev) => [
      ...prev,
      { id: this.#nextId, label: `Item ${this.#nextId} — added dynamically` },
    ]);
    this.#nextId++;
  }

  runEncode(): void {
    try {
      const ssrEncode = (globalThis as any).ssrEncode as
        | (() => string)
        | undefined;
      if (!ssrEncode) {
        this.snapshotPreview.set('ERROR: ssrEncode not registered');
        return;
      }
      const result = ssrEncode();
      const parsed = JSON.parse(result);
      const opcodeCount = parsed.__opcodes?.length ?? 0;

      this.ssrStatus.set({
        ...this.#checkSsrStatus(),
        opcodeCount,
        snapshotSize: result.length,
      });

      const preview =
        result.length > 500 ? `${result.slice(0, 500)}...` : result;
      this.snapshotPreview.set(preview);
    } catch (e) {
      this.snapshotPreview.set(`ERROR: ${e}`);
    }
  }

  #checkSsrStatus(): {
    ok: boolean;
    encodeRegistered: boolean;
    hydrateRegistered: boolean;
    opcodeCount: number;
    snapshotSize: number;
  } {
    const encodeRegistered =
      typeof (globalThis as any).ssrEncode === 'function';
    const hydrateRegistered =
      typeof (globalThis as any).ssrHydrate === 'function';
    return {
      ok: encodeRegistered && hydrateRegistered,
      encodeRegistered,
      hydrateRegistered,
      opcodeCount: 0,
      snapshotSize: 0,
    };
  }
}
