import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import styles from './demo.module.css';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          CSS Modules
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Scoped, hashed class names for style isolation.
        </text>

        <view [class]="styles['card']">
          <text [class]="styles['title']">Styled Card</text>
          <text class="text-[13px] text-zinc-500">
            This card uses hashed CSS Module classes.
          </text>
        </view>

        <view [class]="styles['highlight']">
          <text class="text-sm text-indigo-700">Highlighted Section</text>
        </view>

        <view class="mt-4 rounded-xl bg-zinc-100 p-3.5">
          <text
            class="uppercase mb-2 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Hashed class names
          </text>
          <text class="mb-0.5 text-[11px] text-zinc-500">
            card → {{ styles['card'] }}
          </text>
          <text class="mb-0.5 text-[11px] text-zinc-500">
            title → {{ styles['title'] }}
          </text>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly styles = styles;
}
