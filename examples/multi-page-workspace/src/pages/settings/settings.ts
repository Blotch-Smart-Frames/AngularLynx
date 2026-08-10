import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-settings',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Settings Page
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          A separate Lynx page with its own entry point.
        </text>

        <view class="rounded-xl border border-zinc-200 bg-white p-4">
          <view class="flex-row items-center py-1 justify-between">
            <text class="text-[15px] text-zinc-900">Dark Mode</text>
            <view
              class="h-7 w-12 rounded-[14px] p-0.5"
              [style.background-color]="darkMode() ? '#22c55e' : '#d4d4d8'"
              (bindtap)="toggleDarkMode()"
            >
              <view
                class="h-6 w-6 rounded-xl bg-white"
                [style.margin-left]="darkMode() ? '20px' : '0px'"
              />
            </view>
          </view>

          <view class="my-3 h-px bg-zinc-200" />

          <view class="flex-row items-center py-1 justify-between">
            <text class="text-[15px] text-zinc-900">Notifications</text>
            <view
              class="h-7 w-12 rounded-[14px] p-0.5"
              [style.background-color]="notifications() ? '#22c55e' : '#d4d4d8'"
              (bindtap)="toggleNotifications()"
            >
              <view
                class="h-6 w-6 rounded-xl bg-white"
                [style.margin-left]="notifications() ? '20px' : '0px'"
              />
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class Settings {
  readonly darkMode = signal(false);
  readonly notifications = signal(true);

  toggleDarkMode(): void {
    this.darkMode.update((v) => !v);
  }

  toggleNotifications(): void {
    this.notifications.update((v) => !v);
  }
}
