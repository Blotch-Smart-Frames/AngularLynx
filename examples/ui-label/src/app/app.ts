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

        <!-- Normal label, over a plain <input>: the field has no label of
             its own (ui-input would draw one from its label input). -->
        <view class="flex-col gap-2 flex">
          <ui-label>Email Address</ui-label>
          <input
            type="text"
            placeholder="you@example.com"
            class="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          />
        </view>

        <!-- Label with custom styling -->
        <view class="flex-col gap-2 flex">
          <ui-label class="text-base">Full Name</ui-label>
          <input
            type="text"
            placeholder="John Doe"
            class="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          />
        </view>

        <!-- Disabled label -->
        <view class="flex-col gap-2 flex">
          <ui-label [disabled]="true">Account ID (read-only)</ui-label>
          <input
            type="text"
            value="ACC-12345"
            [disabled]="true"
            class="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground opacity-50"
          />
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
