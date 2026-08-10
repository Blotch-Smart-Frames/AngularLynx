import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiLabel } from '../components/ui/label';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiLabel],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Label</text>
        <text class="text-sm text-muted-foreground">
          A text label for form fields with support for disabled state styling.
        </text>

        <!-- Normal label -->
        <view class="flex-col gap-2 flex">
          <ui-label>Email Address</ui-label>
          <view
            class="h-10 rounded-md border border-input bg-background px-3 py-2"
          >
            <text class="text-sm text-muted-foreground">you@example.com</text>
          </view>
        </view>

        <!-- Label with custom styling -->
        <view class="flex-col gap-2 flex">
          <ui-label class="text-base">Full Name</ui-label>
          <view
            class="h-10 rounded-md border border-input bg-background px-3 py-2"
          >
            <text class="text-sm text-muted-foreground">John Doe</text>
          </view>
        </view>

        <!-- Disabled label -->
        <view class="flex-col gap-2 flex">
          <ui-label [disabled]="true">Account ID (read-only)</ui-label>
          <view
            class="h-10 rounded-md border border-input bg-background px-3 py-2 opacity-50"
          >
            <text class="text-sm text-muted-foreground">ACC-12345</text>
          </view>
        </view>

        <!-- Multiple labels in a row -->
        <view class="flex-row gap-4 flex">
          <ui-label>First Name</ui-label>
          <ui-label>Last Name</ui-label>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {}
