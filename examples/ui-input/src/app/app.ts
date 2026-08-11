import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiInput } from '../components/ui/input';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiInput],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Input</text>
        <text class="text-sm text-muted-foreground">
          A text input field with label, helper text, and validation states.
        </text>

        <!-- Basic input with label -->
        <ui-input
          label="Email"
          placeholder="you@example.com"
          [(value)]="email"
        />

        <!-- Input with helper text -->
        <ui-input
          label="Username"
          placeholder="Enter username"
          helperText="Must be at least 3 characters"
          [(value)]="username"
        />

        <!-- Input with error state -->
        <ui-input
          label="Password"
          type="password"
          placeholder="Enter password"
          error="Password must be at least 8 characters"
          [(value)]="password"
        />

        <!-- Disabled input -->
        <ui-input
          label="Account ID (disabled input)"
          placeholder="Cannot edit"
          [disabled]="true"
          value="ACC-12345"
        />

        <!-- Display current values -->
        <view class="rounded-md border border-border bg-muted p-4">
          <text class="mb-2 text-sm font-medium text-foreground">
            Current Values
          </text>
          <text class="text-xs text-muted-foreground">
            Email: {{ email() }}
          </text>
          <text class="text-xs text-muted-foreground">
            Username: {{ username() }}
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  email = signal('');
  username = signal('');
  password = signal('');
}
