// cspell:words Español Français Deutsch
import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiSwitch } from '../components/ui/switch';
import { UiLabel } from '../components/ui/label';
import { UiSeparator } from '../components/ui/separator';
import { UiSelect, UiSelectItem } from '../components/ui/select';
import { UiRadioGroup, UiRadioGroupItem } from '../components/ui/radio-group';
import {
  UiAlertDialog,
  UiAlertDialogHeader,
  UiAlertDialogTitle,
  UiAlertDialogDescription,
  UiAlertDialogFooter,
} from '../components/ui/alert-dialog';
import { UiButton } from '../components/ui/button';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiSwitch,
    UiLabel,
    UiSeparator,
    UiSelect,
    UiSelectItem,
    UiRadioGroup,
    UiRadioGroupItem,
    UiAlertDialog,
    UiAlertDialogHeader,
    UiAlertDialogTitle,
    UiAlertDialogDescription,
    UiAlertDialogFooter,
    UiButton,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-screen bg-zinc-50">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-[28px] font-bold text-zinc-900">Settings</text>

        <view class="flex-col gap-3.5 flex">
          <text
            class="uppercase text-[11px] font-semibold tracking-[1px] text-zinc-400"
          >
            Notifications
          </text>
          <view
            class="flex-row items-center rounded-xl border border-zinc-200 bg-white px-4 py-3 flex justify-between"
          >
            <view class="flex-col gap-0.5 flex">
              <ui-label>Push Notifications</ui-label>
              <text class="text-xs text-zinc-400">
                Receive alerts on your device
              </text>
            </view>
            <ui-switch [(checked)]="pushNotifications" />
          </view>
          <view
            class="flex-row items-center rounded-xl border border-zinc-200 bg-white px-4 py-3 flex justify-between"
          >
            <ui-label>Sound</ui-label>
            <ui-switch [(checked)]="sound" />
          </view>
          <view
            class="flex-row items-center rounded-xl border border-zinc-200 bg-white px-4 py-3 flex justify-between"
          >
            <ui-label>Email Digest</ui-label>
            <ui-switch [(checked)]="emailDigest" />
          </view>
        </view>

        <ui-separator />

        <view class="flex-col gap-3.5 flex">
          <text
            class="uppercase text-[11px] font-semibold tracking-[1px] text-zinc-400"
          >
            Appearance
          </text>
          <view class="flex-col gap-1.5 flex">
            <ui-label>Language</ui-label>
            <ui-select [(value)]="language">
              <ui-select-item value="en" label="English" />
              <ui-select-item value="es" label="Español" />
              <ui-select-item value="fr" label="Français" />
              <ui-select-item value="de" label="Deutsch" />
            </ui-select>
          </view>
          <view class="flex-col gap-2.5 flex">
            <ui-label>Theme</ui-label>
            <ui-radio-group [(value)]="theme">
              <view class="flex-col gap-2.5 flex">
                @for (opt of themeOptions; track opt.value) {
                  <view
                    class="flex-row items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-4 py-3 flex"
                  >
                    <!--
                      The label lives inside ui-radio-group-item (via ng-content), not
                      as a sibling ui-label. Lynx has no HTML-style label/for-id
                      association, and the item's whole row is tappable to select — so
                      keeping the text inside makes the label tappable too.
                    -->
                    <ui-radio-group-item [value]="opt.value">{{
                      opt.label
                    }}</ui-radio-group-item>
                  </view>
                }
              </view>
            </ui-radio-group>
          </view>
        </view>

        <ui-separator />

        <view class="flex-col gap-3.5 flex">
          <text
            class="uppercase text-[11px] font-semibold tracking-[1px] text-red-500"
          >
            Danger Zone
          </text>
          <ui-button
            variant="destructive"
            (pressed)="deleteDialogOpen.set(true)"
          >
            Delete Account
          </ui-button>
        </view>
      </view>
    </scroll-view>

    <ui-alert-dialog [(open)]="deleteDialogOpen">
      <ui-alert-dialog-header>
        <ui-alert-dialog-title>Delete Account</ui-alert-dialog-title>
        <ui-alert-dialog-description>
          This will permanently delete your account and all data. This action
          cannot be undone.
        </ui-alert-dialog-description>
      </ui-alert-dialog-header>
      <ui-alert-dialog-footer>
        <ui-button variant="outline" (pressed)="deleteDialogOpen.set(false)">
          Cancel
        </ui-button>
        <ui-button
          variant="destructive"
          (pressed)="deleteDialogOpen.set(false)"
        >
          Delete
        </ui-button>
      </ui-alert-dialog-footer>
    </ui-alert-dialog>
  `,
})
export class App {
  readonly pushNotifications = signal(true);
  readonly sound = signal(true);
  readonly emailDigest = signal(false);
  readonly language = signal('en');
  readonly theme = signal('system');
  readonly deleteDialogOpen = signal(false);

  readonly themeOptions = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
}
