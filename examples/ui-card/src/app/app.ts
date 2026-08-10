import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiCard,
  UiCardHeader,
  UiCardTitle,
  UiCardDescription,
  UiCardContent,
  UiCardFooter,
} from '../components/ui/card';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
    UiCardFooter,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-4 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Card</text>
        <text class="text-sm text-muted-foreground">
          A container for grouping related content and actions.
        </text>

        <!-- Full card with all sub-components -->
        <ui-card>
          <ui-card-header>
            <ui-card-title>Notifications</ui-card-title>
            <ui-card-description>
              You have 3 unread messages.
            </ui-card-description>
          </ui-card-header>
          <ui-card-content>
            <view class="flex-col gap-3 flex">
              <view class="flex-row items-center gap-3 flex">
                <view class="h-2 w-2 rounded-full bg-primary" />
                <view class="flex-col flex">
                  <text class="text-sm font-medium text-foreground">
                    New deployment started
                  </text>
                  <text class="text-xs text-muted-foreground">
                    2 minutes ago
                  </text>
                </view>
              </view>
              <view class="flex-row items-center gap-3 flex">
                <view class="h-2 w-2 rounded-full bg-primary" />
                <view class="flex-col flex">
                  <text class="text-sm font-medium text-foreground">
                    Build completed
                  </text>
                  <text class="text-xs text-muted-foreground">
                    1 hour ago
                  </text>
                </view>
              </view>
              <view class="flex-row items-center gap-3 flex">
                <view class="h-2 w-2 rounded-full bg-muted-foreground" />
                <view class="flex-col flex">
                  <text class="text-sm font-medium text-foreground">
                    Your trial expires soon
                  </text>
                  <text class="text-xs text-muted-foreground"> Yesterday </text>
                </view>
              </view>
            </view>
          </ui-card-content>
          <ui-card-footer>
            <text class="text-sm text-muted-foreground">
              View all notifications
            </text>
          </ui-card-footer>
        </ui-card>

        <!-- Card without footer -->
        <ui-card>
          <ui-card-header>
            <ui-card-title>Team Members</ui-card-title>
            <ui-card-description>
              Manage your team and invite new members.
            </ui-card-description>
          </ui-card-header>
          <ui-card-content>
            <text class="text-sm text-foreground">
              You currently have 5 active team members.
            </text>
          </ui-card-content>
        </ui-card>

        <!-- Minimal card -->
        <ui-card>
          <ui-card-content class="pt-6">
            <text class="text-sm text-foreground">
              A minimal card with only content — no header or footer.
            </text>
          </ui-card-content>
        </ui-card>
      </view>
    </scroll-view>
  `,
})
export class App {}
