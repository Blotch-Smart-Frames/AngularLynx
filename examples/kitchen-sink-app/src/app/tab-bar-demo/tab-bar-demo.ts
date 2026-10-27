import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiButton } from '../../components/ui/button';
import { UiTabBar, UiTabBarItem } from '../../components/ui/tab-bar';
import { UiText } from '../../components/ui/typography';
import { ScreenHost } from '../screen-host';

/**
 * Tab bar demo: a screen with tabs of its own along the bottom, each a child
 * route of this one. The items' routes are relative ("feed"), so they resolve
 * from this route to /tab-bar-demo/feed and so on, and the drawer's Tab Bar
 * item stays active on all of them.
 */
@Component({
  selector: 'app-tab-bar-demo',
  hostDirectives: [ScreenHost],
  imports: [LYNX_ELEMENTS, RouterOutlet, UiTabBar, UiTabBarItem],
  template: `
    <!-- The child screens fill the space above the bar. -->
    <view class="flex-1 flex-col flex">
      <router-outlet />
    </view>
    <ui-tab-bar>
      <ui-tab-bar-item route="feed" icon="home" label="Feed" />
      <ui-tab-bar-item route="search" icon="search" label="Search" />
      <ui-tab-bar-item
        route="alerts"
        icon="bell"
        label="Alerts"
        [badge]="alerts()"
      />
    </ui-tab-bar>
  `,
})
export class TabBarDemo {
  readonly alerts = signal(3);
}

@Component({
  selector: 'app-tab-bar-feed',
  hostDirectives: [ScreenHost],
  imports: [LYNX_ELEMENTS, UiText],
  template: `
    <view class="flex-col gap-3 p-4 flex">
      <ui-text variant="h3">Feed</ui-text>
      <ui-text variant="muted">
        Each tab is a child route of this screen. A tap navigates with Angular's
        own RouterLink, and the tab of the current route is drawn in the primary
        color and marked selected for screen readers.
      </ui-text>
    </view>
  `,
})
export class TabBarFeed {}

@Component({
  selector: 'app-tab-bar-search',
  hostDirectives: [ScreenHost],
  imports: [LYNX_ELEMENTS, UiText],
  template: `
    <view class="flex-col gap-3 p-4 flex">
      <ui-text variant="h3">Search</ui-text>
      <ui-text variant="muted">Nothing to search yet.</ui-text>
    </view>
  `,
})
export class TabBarSearch {}

@Component({
  selector: 'app-tab-bar-alerts',
  hostDirectives: [ScreenHost],
  imports: [LYNX_ELEMENTS, UiButton, UiText],
  template: `
    <view class="flex-col gap-3 p-4 flex">
      <ui-text variant="h3">Alerts</ui-text>
      <ui-text variant="muted">
        {{ demo.alerts() }} new. The Alerts tab's badge shows the count, and
        hides at 0.
      </ui-text>
      <ui-button variant="secondary" (pressed)="demo.alerts.set(0)">
        Clear alerts
      </ui-button>
      <ui-button variant="outline" (pressed)="demo.alerts.update(add)">
        Add an alert
      </ui-button>
    </view>
  `,
})
export class TabBarAlerts {
  // A screen in the parent's <router-outlet> is created under the parent's
  // element injector, so it can inject the parent component for its state.
  protected readonly demo = inject(TabBarDemo);
  protected readonly add = (count: number) => count + 1;
}
