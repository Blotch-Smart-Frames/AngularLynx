import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiCollapsible,
  UiCollapsibleTrigger,
  UiCollapsibleContent,
} from '../components/ui/collapsible';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiCollapsible,
    UiCollapsibleTrigger,
    UiCollapsibleContent,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Collapsible</text>
        <text class="text-sm text-muted-foreground">
          An interactive component that expands and collapses content.
        </text>

        <!-- Basic collapsible -->
        <view class="flex-col gap-2 flex">
          <text class="text-lg font-semibold text-foreground"> Basic </text>
        </view>

        <ui-collapsible class="rounded-lg border border-border">
          <ui-collapsible-trigger class="p-4 justify-between">
            <text class="text-sm font-medium text-foreground">
              What are starred repositories?
            </text>
            <text class="text-xs text-muted-foreground">Toggle</text>
          </ui-collapsible-trigger>
          <ui-collapsible-content>
            <view class="px-4 pb-4">
              <text class="text-sm text-muted-foreground">
                Starred repositories let you keep track of projects you find
                interesting. You can star repositories and topics to discover
                related content in your news feed.
              </text>
            </view>
          </ui-collapsible-content>
        </ui-collapsible>

        <!-- Collapsible with list content -->
        <view class="flex-col gap-2 flex">
          <text class="text-lg font-semibold text-foreground">
            With List Content
          </text>
        </view>

        <ui-collapsible class="rounded-lg border border-border">
          <ui-collapsible-trigger class="p-4 justify-between">
            <text class="text-sm font-medium text-foreground">
              3 tagged versions
            </text>
            <text class="text-xs text-muted-foreground">Show</text>
          </ui-collapsible-trigger>
          <ui-collapsible-content>
            <view class="flex-col gap-2 px-4 pb-4 flex">
              <view class="rounded-md border border-border px-4 py-3">
                <text class="text-sm text-foreground">v1.0.0</text>
              </view>
              <view class="rounded-md border border-border px-4 py-3">
                <text class="text-sm text-foreground">v1.1.0</text>
              </view>
              <view class="rounded-md border border-border px-4 py-3">
                <text class="text-sm text-foreground">v2.0.0-beta</text>
              </view>
            </view>
          </ui-collapsible-content>
        </ui-collapsible>

        <!-- Disabled collapsible -->
        <view class="flex-col gap-2 flex">
          <text class="text-lg font-semibold text-foreground"> Disabled </text>
          <text class="text-xs text-muted-foreground">
            Cannot be toggled when disabled.
          </text>
        </view>

        <ui-collapsible
          [disabled]="true"
          class="rounded-lg border border-border"
        >
          <ui-collapsible-trigger class="p-4 justify-between">
            <text class="text-sm font-medium text-foreground">
              This section is locked
            </text>
            <text class="text-xs text-muted-foreground">Disabled</text>
          </ui-collapsible-trigger>
          <ui-collapsible-content>
            <view class="px-4 pb-4">
              <text class="text-sm text-muted-foreground">
                You should never see this content.
              </text>
            </view>
          </ui-collapsible-content>
        </ui-collapsible>
      </view>
    </scroll-view>
  `,
})
export class App {}
