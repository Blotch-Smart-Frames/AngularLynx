import { Component, inject } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxInitData,
  LynxGlobalData,
} from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">Data Flow</text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Inject initial and global data from the Lynx runtime.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            InitData
          </text>
          <view class="rounded-lg bg-zinc-100 p-3.5">
            <text class="text-[13px] text-zinc-900">{{ initDataJson() }}</text>
          </view>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            GlobalData
          </text>
          <view class="rounded-lg bg-zinc-100 p-3.5">
            <text class="text-[13px] text-zinc-900">{{
              globalDataJson()
            }}</text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly #initData = inject(LynxInitData);
  readonly #globalData = inject(LynxGlobalData);

  initDataJson() {
    return JSON.stringify(this.#initData.initData(), null, 2);
  }

  globalDataJson() {
    return JSON.stringify(this.#globalData.globalData(), null, 2);
  }
}
