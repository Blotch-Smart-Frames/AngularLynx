import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS, LynxLogger } from '@blotch/angular-lynx';
import { type IconName, UiIcon } from '../components/ui/icon';
import {
  UiNavDrawer,
  UiNavDrawerContent,
  UiNavDrawerFooter,
  UiNavDrawerHeader,
  UiNavDrawerItem,
  UiNavDrawerTrigger,
} from '../components/ui/nav-drawer';
import { UiSeparator } from '../components/ui/separator';
import { UiText } from '../components/ui/typography';

type NavItem = { path: string; label: string; icon: IconName };
type NavGroup = { title: string; items: NavItem[] };

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    LYNX_ELEMENTS,
    UiNavDrawer,
    UiNavDrawerHeader,
    UiNavDrawerContent,
    UiNavDrawerItem,
    UiNavDrawerFooter,
    UiNavDrawerTrigger,
    UiIcon,
    UiSeparator,
    UiText,
  ],
  template: `
    <view class="h-full flex-col bg-background flex">
      <!-- Persistent app bar. The hamburger opens the nav drawer and is
           available on every screen, so screens don't need their own back
           button — the drawer is the single navigation surface.

           Fixes: on-device the hamburger trigger and title were drawn behind
           the status bar / notch / dynamic island — the bar started at y=0 with
           a flat py-2, so its content sat under the system inset.
           Fix: split the vertical padding — keep pb-2 (0.5rem) at the bottom,
           and use pt-safe-2 at the top = calc(0.5rem + env(safe-area-inset-top)),
           which preserves the original 0.5rem base padding AND adds the device
           top inset. Degrades to plain 0.5rem where the inset is 0 (web preview),
           so no platform fork is needed. -->
      <view
        class="flex-row items-center border-b border-border bg-background px-2 pb-2 flex pt-safe-2"
      >
        <ui-nav-drawer-trigger (pressed)="openDrawer()" />
        <ui-text variant="large" class="ml-2">AngularLynx</ui-text>
      </view>

      <!-- Routed demo content fills the remaining height. This must be a
           bounded flex-col container (not a plain view): each routed component
           is inserted as a real Lynx element here and, via ScreenHost, claims
           this height with flex-1 so its inner scroll-view can actually scroll.
           A plain flex-1 view leaves the routed host content-sized, so every
           route's scroll-view expands to fit instead of scrolling. -->
      <view class="flex-1 flex-col flex">
        <router-outlet />
      </view>

      <ui-nav-drawer [(open)]="drawerOpen">
        <ui-nav-drawer-header>
          <ui-text variant="large">AngularLynx</ui-text>
          <ui-text variant="muted">Kitchen sink · Angular on Lynx</ui-text>
        </ui-nav-drawer-header>
        <ui-nav-drawer-content>
          <ui-nav-drawer-item
            [active]="currentPath() === 'home'"
            (pressed)="navigateTo('home')"
          >
            <ui-icon name="home" size="sm" />
            <text class="text-sm text-foreground">Home</text>
          </ui-nav-drawer-item>
          <ui-separator />
          @for (group of navGroups; track group.title) {
            <view class="px-4 pb-1 pt-4 flex">
              <ui-text variant="small" class="text-muted-foreground">
                {{ group.title }}
              </ui-text>
            </view>
            @for (item of group.items; track item.path) {
              <ui-nav-drawer-item
                [active]="currentPath() === item.path"
                (pressed)="navigateTo(item.path)"
              >
                <ui-icon [name]="item.icon" size="sm" />
                <text class="text-sm text-foreground">{{ item.label }}</text>
              </ui-nav-drawer-item>
            }
          }
        </ui-nav-drawer-content>
        <ui-nav-drawer-footer>
          <ui-text variant="muted">
            Proof of concept · built with @blotch/dolan
          </ui-text>
        </ui-nav-drawer-footer>
      </ui-nav-drawer>
    </view>
  `,
})
export class App {
  #router = inject(Router);
  #logger = inject(LynxLogger);

  readonly drawerOpen = signal(false);
  readonly currentPath = signal('home');

  readonly navGroups: NavGroup[] = [
    {
      title: 'Elements',
      items: [
        { path: 'images-demo', label: 'Images', icon: 'camera' },
        { path: 'list-example', label: 'List', icon: 'list' },
        {
          path: 'scroll-example',
          label: 'Scroll View',
          icon: 'chevrons-down',
        },
      ],
    },
    {
      title: 'Components',
      items: [
        { path: 'icon-showcase', label: 'Icons', icon: 'star' },
        {
          path: 'content-projection-demo',
          label: 'Content Projection',
          icon: 'layout-grid',
        },
        { path: 'line-chart-demo', label: 'Line Chart', icon: 'chart-line' },
        { path: 'area-chart-demo', label: 'Area Chart', icon: 'activity' },
        {
          path: 'candlestick-chart-demo',
          label: 'Candlestick Chart',
          icon: 'chart-column',
        },
        { path: 'bar-chart-demo', label: 'Bar Chart', icon: 'chart-bar' },
        {
          path: 'scatter-chart-demo',
          label: 'Scatter Chart',
          icon: 'sparkles',
        },
        { path: 'chart-zoom-demo', label: 'Chart Zoom', icon: 'zoom-in' },
        { path: 'tailwind-demo', label: 'Tailwind', icon: 'code' },
        { path: 'css-modules-demo', label: 'CSS Modules', icon: 'file-text' },
      ],
    },
    {
      title: 'Motion',
      items: [
        { path: 'motion-demo', label: 'Motion', icon: 'zap' },
        {
          path: 'transition-demo',
          label: 'Transitions',
          icon: 'chevrons-right',
        },
        {
          path: 'refresh-demo',
          label: 'Pull to Refresh',
          icon: 'refresh-cw',
        },
      ],
    },
    {
      title: 'Forms & Input',
      items: [
        { path: 'forms-demo', label: 'Forms', icon: 'list-checks' },
        {
          path: 'session-storage-demo',
          label: 'Session Storage',
          icon: 'database',
        },
      ],
    },
    {
      title: 'Platform',
      items: [
        { path: 'query-selector-demo', label: 'querySelector', icon: 'search' },
        { path: 'defer-demo', label: 'Defer', icon: 'loader' },
        { path: 'events', label: 'Events', icon: 'bell' },
        { path: 'gesture-demo', label: 'Gestures', icon: 'hand' },
        { path: 'fonts-demo', label: 'Custom Fonts', icon: 'type' },
        { path: 'text-measure-demo', label: 'Text Measure', icon: 'compass' },
        { path: 'exposure-demo', label: 'Exposure', icon: 'eye' },
        { path: 'main-thread-demo', label: 'Main Thread', icon: 'cpu' },
        {
          path: 'worklet-directive-demo',
          label: 'Worklet Directive',
          icon: 'terminal',
        },
        { path: 'i18n-demo', label: 'i18n', icon: 'globe' },
        { path: 'ssr-demo', label: 'SSR', icon: 'server' },
      ],
    },
    {
      title: 'Validation',
      items: [
        {
          path: 'css-var-validation',
          label: 'CSS Variables',
          icon: 'sliders-horizontal',
        },
        {
          path: 'text-projection-validation',
          label: 'Text Projection',
          icon: 'copy',
        },
        {
          path: 'text-whitespace-demo',
          label: 'Text Whitespace',
          icon: 'align-left',
        },
      ],
    },
  ];

  openDrawer(): void {
    this.drawerOpen.set(true);
  }

  navigateTo(path: string): void {
    this.currentPath.set(path);
    // Defer navigation out of the Lynx worklet event callback. Angular's Router
    // processes navigation synchronously, triggering __RemoveElement/__CreateView
    // during the worklet — moving to a macrotask keeps the mutations in a clean
    // tick. (The signal write above is safe: zoneless CD runs asynchronously.)
    setTimeout(() => {
      this.#router.navigateByUrl(path);
      this.#logger.log('navigated to', path);
    }, 0);
  }
}
