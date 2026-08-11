import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiNavDrawer,
  UiNavDrawerHeader,
  UiNavDrawerContent,
  UiNavDrawerItem,
  UiNavDrawerFooter,
  UiNavDrawerTrigger,
} from '../components/ui/nav-drawer';
import { UiIcon } from '../components/ui/icon';
import { UiSeparator } from '../components/ui/separator';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiNavDrawer,
    UiNavDrawerHeader,
    UiNavDrawerContent,
    UiNavDrawerItem,
    UiNavDrawerFooter,
    UiNavDrawerTrigger,
    UiIcon,
    UiSeparator,
  ],
  template: `
    <view class="h-full flex-col flex">
      <view
        class="flex-row items-center border-b border-border bg-background px-4 py-3 flex"
      >
        <ui-nav-drawer-trigger (pressed)="drawerOpen.set(true)" />
        <text class="ml-3 text-lg font-semibold text-foreground">My App</text>
      </view>

      <scroll-view scroll-orientation="vertical" class="flex-1">
        <view class="flex-col gap-4 p-6 flex">
          <text class="text-2xl font-bold text-foreground">Nav Drawer</text>
          <text class="text-sm text-muted-foreground">
            Tap the hamburger menu icon to open the navigation drawer.
          </text>
          <text class="text-sm text-foreground">
            Current page: {{ currentPage() }}
          </text>
        </view>
      </scroll-view>

      <ui-nav-drawer [(open)]="drawerOpen">
        <ui-nav-drawer-header>
          <text class="text-lg font-semibold text-foreground">Navigation</text>
          <text class="text-sm text-muted-foreground">Choose a section</text>
        </ui-nav-drawer-header>
        <ui-nav-drawer-content>
          <ui-nav-drawer-item
            [active]="currentPage() === 'Home'"
            (pressed)="navigate('Home')"
          >
            <ui-icon name="heart" size="sm" />
            <text class="text-sm text-foreground">Home</text>
          </ui-nav-drawer-item>
          <ui-nav-drawer-item
            [active]="currentPage() === 'Search'"
            (pressed)="navigate('Search')"
          >
            <ui-icon name="search" size="sm" />
            <text class="text-sm text-foreground">Search</text>
          </ui-nav-drawer-item>
          <ui-nav-drawer-item
            [active]="currentPage() === 'Favorites'"
            (pressed)="navigate('Favorites')"
          >
            <ui-icon name="star" size="sm" />
            <text class="text-sm text-foreground">Favorites</text>
          </ui-nav-drawer-item>
          <ui-separator />
          <ui-nav-drawer-item
            [active]="currentPage() === 'Settings'"
            (pressed)="navigate('Settings')"
          >
            <ui-icon name="settings" size="sm" />
            <text class="text-sm text-foreground">Settings</text>
          </ui-nav-drawer-item>
        </ui-nav-drawer-content>
        <ui-nav-drawer-footer>
          <ui-nav-drawer-item variant="destructive" (pressed)="onLogout()">
            <ui-icon name="x" size="sm" color="rgba(220, 38, 38, 1)" />
            <text class="text-sm text-destructive">Log out</text>
          </ui-nav-drawer-item>
        </ui-nav-drawer-footer>
      </ui-nav-drawer>
    </view>
  `,
})
export class App {
  drawerOpen = signal(false);
  currentPage = signal('Home');

  navigate(page: string): void {
    this.currentPage.set(page);
  }

  onLogout(): void {
    this.currentPage.set('Logged out');
  }
}
