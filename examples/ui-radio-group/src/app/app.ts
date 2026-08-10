import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiRadioGroup, UiRadioGroupItem } from '../components/ui/radio-group';
import { UiLabel } from '../components/ui/label';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiRadioGroup, UiRadioGroupItem, UiLabel],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Radio Group</text>
        <text class="text-sm text-muted-foreground">
          A group of radio buttons where only one option can be selected at a
          time.
        </text>

        <!-- Basic radio group -->
        <view class="flex-col gap-2 flex">
          <ui-label>Preferred Contact Method</ui-label>
          <ui-radio-group [(value)]="contact">
            <ui-radio-group-item value="email">Email</ui-radio-group-item>
            <ui-radio-group-item value="phone">Phone</ui-radio-group-item>
            <ui-radio-group-item value="text">Text Message</ui-radio-group-item>
          </ui-radio-group>
        </view>

        <!-- Radio group with different options -->
        <view class="flex-col gap-2 flex">
          <ui-label>Plan</ui-label>
          <ui-radio-group [(value)]="plan">
            <ui-radio-group-item value="free">Free</ui-radio-group-item>
            <ui-radio-group-item value="pro">Pro - $9/mo</ui-radio-group-item>
            <ui-radio-group-item value="enterprise">
              Enterprise - $29/mo
            </ui-radio-group-item>
          </ui-radio-group>
        </view>

        <!-- Disabled radio group -->
        <view class="flex-col gap-2 flex">
          <ui-label [disabled]="true">Region (locked)</ui-label>
          <ui-radio-group value="us" [disabled]="true">
            <ui-radio-group-item value="us">United States</ui-radio-group-item>
            <ui-radio-group-item value="eu">Europe</ui-radio-group-item>
            <ui-radio-group-item value="ap">Asia Pacific</ui-radio-group-item>
          </ui-radio-group>
        </view>

        <!-- Display current selections -->
        <view class="rounded-md border border-border bg-muted p-4">
          <text class="mb-2 text-sm font-medium text-foreground">
            Selected Values
          </text>
          <text class="text-xs text-muted-foreground">
            Contact: {{ contact() }}
          </text>
          <text class="text-xs text-muted-foreground">Plan: {{ plan() }}</text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  contact = signal('email');
  plan = signal('free');
}
