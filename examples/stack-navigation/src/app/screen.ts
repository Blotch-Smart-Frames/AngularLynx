import { Location } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * The frame of each screen: a bar with a Back button (on every screen but
 * the first) over a large title and the screen's rows, which scroll.
 *
 * The host fills the outlet's frame: Lynx renders a component's host as a
 * real element, so a host left content-sized would give the scroll view no
 * height to scroll within.
 */
@Component({
  selector: 'app-screen',
  imports: [LYNX_ELEMENTS],
  host: { class: 'flex flex-1 flex-col bg-zinc-100' },
  template: `
    <view
      class="h-[52px] flex-row items-center px-2 flex"
      style="margin-top: env(safe-area-inset-top)"
    >
      @if (backLabel(); as label) {
        <view
          class="flex-row items-center px-2 py-2 flex"
          accessibility-element="true"
          accessibility-traits="button"
          [attr.accessibility-label]="'Back to ' + label"
          (bindtap)="location.back()"
        >
          <text class="text-[28px] leading-[28px] text-blue-500">‹</text>
          <text class="ml-1 text-[17px] text-blue-500">{{ label }}</text>
        </view>
      }
    </view>
    <scroll-view scroll-orientation="vertical" class="w-full flex-1">
      <view
        class="flex-col gap-6 px-4 flex"
        style="padding-bottom: calc(40px + env(safe-area-inset-bottom))"
      >
        <text accessibility-traits="header" class="text-[34px] font-bold">
          {{ title() }}
        </text>
        <ng-content />
      </view>
    </scroll-view>
  `,
})
export class Screen {
  readonly title = input.required<string>();
  /** The title of the screen Back goes to, or none on the first screen. */
  readonly backLabel = input<string>();

  protected readonly location = inject(Location);
}
