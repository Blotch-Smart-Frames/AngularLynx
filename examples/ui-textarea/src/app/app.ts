import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiTextarea } from '../components/ui/textarea';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiTextarea],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Textarea</text>
        <text class="text-sm text-muted-foreground">
          A multi-line text input for longer content.
        </text>

        <!-- Basic textarea with label -->
        <ui-textarea
          label="Bio"
          placeholder="Tell us about yourself..."
          [(value)]="bio"
        />

        <!-- Textarea with helper text -->
        <ui-textarea
          label="Feedback"
          placeholder="Share your thoughts..."
          helperText="Your feedback helps us improve"
          [(value)]="feedback"
        />

        <!-- Line limits: grows from 3 lines up to 6, then scrolls (SwiftUI lineLimit) -->
        <ui-textarea
          label="Review"
          placeholder="Write a detailed review..."
          helperText="Grows to 6 lines, then scrolls"
          [minLines]="3"
          [maxLines]="6"
          [(value)]="review"
        />

        <!-- Compact: a single starting line -->
        <ui-textarea
          label="Note"
          placeholder="Quick note..."
          [minLines]="1"
          [maxLines]="4"
          [(value)]="note"
        />

        <!-- Textarea with error state -->
        <ui-textarea
          label="Description"
          placeholder="Enter description..."
          error="Description is required"
          [(value)]="description"
        />

        <!-- Disabled textarea -->
        <ui-textarea
          label="System Notes"
          placeholder="Cannot edit"
          [disabled]="true"
          value="This field is read-only."
        />

        <!-- Display current values -->
        <view class="rounded-md border border-border bg-muted p-4">
          <text class="mb-2 text-sm font-medium text-foreground">
            Current Values
          </text>
          <text class="text-xs text-muted-foreground"> Bio: {{ bio() }} </text>
          <text class="text-xs text-muted-foreground">
            Feedback: {{ feedback() }}
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  bio = signal('');
  feedback = signal('');
  description = signal('');
  // Pre-seeded past 6 lines so the maxLines scroll behavior is visible on load.
  review = signal(
    'Line one of the review.\nLine two.\nLine three.\nLine four.\nLine five.\nLine six.\nLine seven — this one is only reachable by scrolling.',
  );
  note = signal('');
}
