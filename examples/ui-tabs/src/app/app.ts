import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { injectGlassDesign } from '../components/ui/glass';
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

        <!-- Segmented: the platform's segmented control, for switching
             between closely related views. On iOS 26 the thumb lifts into
             Liquid Glass as it slides, and can be dragged across the tabs. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Segmented</text>
          <text class="text-xs text-muted-foreground">{{ status() }}</text>
          <ui-tabs [(value)]="view">
            <ui-tabs-list variant="segmented">
              <ui-tabs-trigger value="photos">Photos</ui-tabs-trigger>
              <ui-tabs-trigger value="albums">Albums</ui-tabs-trigger>
              <ui-tabs-trigger value="people">People</ui-tabs-trigger>
            </ui-tabs-list>
            <ui-tabs-content value="photos">
              <text class="text-sm text-muted-foreground">
                1,204 photos, newest first.
              </text>
            </ui-tabs-content>
            <ui-tabs-content value="albums">
              <text class="text-sm text-muted-foreground">
                Recents, Favorites and 12 of your own.
              </text>
            </ui-tabs-content>
            <ui-tabs-content value="people">
              <text class="text-sm text-muted-foreground">
                38 people and 4 pets.
              </text>
            </ui-tabs-content>
          </ui-tabs>
        </view>

        <text class="text-lg font-semibold text-foreground">Default</text>

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
export class App {
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);
  readonly #design = injectGlassDesign();

  readonly view = signal('photos');

  /** What the segmented control draws here, and the settings it follows. */
  readonly status = computed(() => {
    const on = (value: boolean) => (value ? 'on' : 'off');
    const os = `${this.#system.platform} ${this.#system.osVersion}`.trim();
    return [
      `Design: ${this.#design()} on ${os}`,
      `Reduce Motion: ${on(this.#settings.reduceMotion())}`,
      `Reduce Transparency: ${on(this.#settings.reduceTransparency())}`,
      `Increase Contrast: ${on(this.#settings.increaseContrast())}`,
    ].join(' · ');
  });
}
