import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiTabBar, UiTabBarItem } from '../components/ui/tab-bar';
import { Inbox } from './inbox';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, RouterOutlet, UiTabBar, UiTabBarItem],
  template: `
    <view class="h-full flex-col bg-background flex">
      <!-- The screens fill the space above the bar. Each one's host is a
           flex-1 column (see screens.ts), so its scroll-view has a height to
           scroll within. -->
      <view class="flex-1 flex-col flex">
        <router-outlet />
      </view>

      <ui-tab-bar>
        <ui-tab-bar-item route="/home" icon="home" label="Home" />
        <ui-tab-bar-item route="/search" icon="search" label="Search" />
        <!-- The Inbox tab stays selected on /inbox/:id too. -->
        <ui-tab-bar-item
          route="/inbox"
          icon="inbox"
          label="Inbox"
          [badge]="inbox.unread()"
        />
        <ui-tab-bar-item route="/profile" icon="user" label="Profile" />
      </ui-tab-bar>
    </view>
  `,
})
export class App {
  protected readonly inbox = inject(Inbox);
}
