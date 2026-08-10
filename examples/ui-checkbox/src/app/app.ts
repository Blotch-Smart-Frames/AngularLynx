// cspell:words Notif
import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiCheckbox } from '../components/ui/checkbox';
import { UiLabel } from '../components/ui/label';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiCheckbox, UiLabel],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Checkbox</text>
        <text class="text-sm text-muted-foreground">
          A control that allows users to toggle between checked and unchecked
          states.
        </text>

        <!-- Basic checked checkbox -->
        <view class="flex-row items-center gap-3 flex">
          <ui-checkbox [(checked)]="acceptTerms" />
          <ui-label>Accept terms and conditions</ui-label>
        </view>

        <!-- Unchecked checkbox -->
        <view class="flex-row items-center gap-3 flex">
          <ui-checkbox [(checked)]="newsletter" />
          <ui-label>Subscribe to newsletter</ui-label>
        </view>

        <!-- Disabled checkbox (unchecked) -->
        <view class="flex-row items-center gap-3 flex">
          <ui-checkbox [disabled]="true" />
          <ui-label [disabled]="true">Unavailable option</ui-label>
        </view>

        <!-- Disabled checkbox (checked) -->
        <view class="flex-row items-center gap-3 flex">
          <ui-checkbox [disabled]="true" [checked]="true" />
          <ui-label [disabled]="true">Required (always on)</ui-label>
        </view>

        <!-- Multiple checkboxes as a group -->
        <view class="flex-col gap-3 flex">
          <text class="text-sm font-medium text-foreground">Notifications</text>
          <view class="flex-row items-center gap-3 flex">
            <ui-checkbox [(checked)]="emailNotif" />
            <ui-label>Email notifications</ui-label>
          </view>
          <view class="flex-row items-center gap-3 flex">
            <ui-checkbox [(checked)]="pushNotif" />
            <ui-label>Push notifications</ui-label>
          </view>
          <view class="flex-row items-center gap-3 flex">
            <ui-checkbox [(checked)]="smsNotif" />
            <ui-label>SMS notifications</ui-label>
          </view>
        </view>

        <!-- Display current state -->
        <view class="rounded-md border border-border bg-muted p-4">
          <text class="mb-2 text-sm font-medium text-foreground">State</text>
          <text class="text-xs text-muted-foreground">
            Terms: {{ acceptTerms() }}
          </text>
          <text class="text-xs text-muted-foreground">
            Newsletter: {{ newsletter() }}
          </text>
          <text class="text-xs text-muted-foreground">
            Email: {{ emailNotif() }} | Push: {{ pushNotif() }} | SMS:
            {{ smsNotif() }}
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  acceptTerms = signal(true);
  newsletter = signal(false);
  emailNotif = signal(true);
  pushNotif = signal(true);
  smsNotif = signal(false);
}
