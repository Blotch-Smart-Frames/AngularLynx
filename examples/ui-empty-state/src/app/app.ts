import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiEmptyState } from '../components/ui/empty-state';
import { UiButton } from '../components/ui/button';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiEmptyState, UiButton],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="p-6">
        <text class="mb-6 text-2xl font-bold text-foreground">Empty State</text>

        <!-- With icon and description -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          With Icon and Description
        </text>
        <view class="mb-6 rounded-lg border border-border">
          <ui-empty-state
            icon="search"
            title="No results found"
            description="Try adjusting your search or filters to find what you're looking for."
          />
        </view>

        <!-- Without icon -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          Without Icon
        </text>
        <view class="mb-6 rounded-lg border border-border">
          <ui-empty-state
            title="Nothing here yet"
            description="Content will appear here once it's available."
          />
        </view>

        <!-- With action button -->
        <text class="mb-3 text-sm font-medium text-muted-foreground">
          With Action
        </text>
        <view class="rounded-lg border border-border">
          <ui-empty-state
            icon="plus"
            title="No items"
            description="Get started by creating your first item."
          >
            <ui-button class="mt-4" (pressed)="onCreate()">
              Create Item
            </ui-button>
          </ui-empty-state>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  onCreate(): void {
    // Placeholder for demo purposes
  }
}
