import { Component, inject } from '@angular/core';
import { LYNX_ELEMENTS, LynxTabOutlet } from '@blotch/angular-lynx';
import { UiTabBar, UiTabBarItem } from '../components/ui/tab-bar';
import { Inbox } from './inbox';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, LynxTabOutlet, UiTabBar, UiTabBarItem],
  template: `
    <view class="h-full flex-col bg-background flex">
      <!-- The tabs fill the space above the bar. Each screen's host is a
           flex-1 column (see screens.ts), so its scroll-view has a height to
           scroll within. The outlet keeps each tab once it's been shown, as
           a native tab bar does: the Inbox comes back with the message you
           left open, scrolled where you left it. -->
      <lynx-tab-outlet />

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
