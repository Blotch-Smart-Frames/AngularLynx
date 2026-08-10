import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiTabs,
  UiTabsList,
  UiTabsTrigger,
  UiTabsContent,
} from '../components/ui/tabs';
import {
  UiCard,
  UiCardHeader,
  UiCardTitle,
  UiCardDescription,
  UiCardContent,
} from '../components/ui/card';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiTabs,
    UiTabsList,
    UiTabsTrigger,
    UiTabsContent,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Tabs</text>
        <text class="text-sm text-muted-foreground">
          A set of layered sections of content, known as tab panels.
        </text>

        <!-- Basic tabs -->
        <ui-tabs value="account">
          <ui-tabs-list>
            <ui-tabs-trigger value="account">Account</ui-tabs-trigger>
            <ui-tabs-trigger value="password">Password</ui-tabs-trigger>
            <ui-tabs-trigger value="settings">Settings</ui-tabs-trigger>
          </ui-tabs-list>

          <ui-tabs-content value="account">
            <ui-card>
              <ui-card-header>
                <ui-card-title>Account</ui-card-title>
                <ui-card-description>
                  Manage your account details and preferences.
                </ui-card-description>
              </ui-card-header>
              <ui-card-content>
                <view class="flex-col gap-3 flex">
                  <view class="flex-col gap-1 flex">
                    <text class="text-sm font-medium text-foreground">
                      Name
                    </text>
                    <text class="text-sm text-muted-foreground">
                      John Doe
                    </text>
                  </view>
                  <view class="flex-col gap-1 flex">
                    <text class="text-sm font-medium text-foreground">
                      Email
                    </text>
                    <text class="text-sm text-muted-foreground">
                      john&#64;example.com
                    </text>
                  </view>
                </view>
              </ui-card-content>
            </ui-card>
          </ui-tabs-content>

          <ui-tabs-content value="password">
            <ui-card>
              <ui-card-header>
                <ui-card-title>Password</ui-card-title>
                <ui-card-description>
                  Change your password to keep your account secure.
                </ui-card-description>
              </ui-card-header>
              <ui-card-content>
                <view class="flex-col gap-3 flex">
                  <view class="flex-col gap-1 flex">
                    <text class="text-sm font-medium text-foreground">
                      Current Password
                    </text>
                    <text class="text-sm text-muted-foreground">
                      ••••••••
                    </text>
                  </view>
                  <view class="flex-col gap-1 flex">
                    <text class="text-sm font-medium text-foreground">
                      New Password
                    </text>
                    <text class="text-sm text-muted-foreground">
                      Enter a new password
                    </text>
                  </view>
                </view>
              </ui-card-content>
            </ui-card>
          </ui-tabs-content>

          <ui-tabs-content value="settings">
            <ui-card>
              <ui-card-header>
                <ui-card-title>Settings</ui-card-title>
                <ui-card-description>
                  Configure your application preferences.
                </ui-card-description>
              </ui-card-header>
              <ui-card-content>
                <view class="flex-col gap-3 flex">
                  <view class="flex-col gap-1 flex">
                    <text class="text-sm font-medium text-foreground">
                      Language
                    </text>
                    <text class="text-sm text-muted-foreground"> English </text>
                  </view>
                  <view class="flex-col gap-1 flex">
                    <text class="text-sm font-medium text-foreground">
                      Theme
                    </text>
                    <text class="text-sm text-muted-foreground">
                      System default
                    </text>
                  </view>
                  <view class="flex-col gap-1 flex">
                    <text class="text-sm font-medium text-foreground">
                      Notifications
                    </text>
                    <text class="text-sm text-muted-foreground"> Enabled </text>
                  </view>
                </view>
              </ui-card-content>
            </ui-card>
          </ui-tabs-content>
        </ui-tabs>
      </view>
    </scroll-view>
  `,
})
export class App {}
