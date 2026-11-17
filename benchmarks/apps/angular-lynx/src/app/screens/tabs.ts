import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { LYNX_ELEMENTS, LynxTabOutlet } from '@blotch/angular-lynx';
import { filter, map } from 'rxjs';

import { UI_THEME_COLORS } from '../../components/ui/icon/icon-theme';
import { UiTabBar, UiTabBarItem } from '../../components/ui/tab-bar';
import { Colors } from '../data/colors';
import { icon } from '../data/icons';

/**
 * The two tabs, Pokédex and Favourites, over @blotch/ui's tab bar (the
 * original's expo-router Tabs). `<lynx-tab-outlet>` keeps each tab once it's
 * shown, as a native tab bar does, so the Pokédex keeps its pages and scroll
 * position while Favourites shows.
 */
@Component({
  selector: 'app-tabs',
  imports: [LYNX_ELEMENTS, LynxTabOutlet, UiTabBar, UiTabBarItem],
  // The tab bar's tint is the theme's primary color for the selected tab and
  // its muted foreground for the others. The original's are black and
  // #424242: the variables set them for the labels (a static style: bound
  // with [style.--primary], they didn't reach the labels on iOS), and
  // UI_THEME_COLORS for the icons, which an <svg> draws without reading CSS.
  providers: [
    {
      provide: UI_THEME_COLORS,
      useValue: signal({
        light: { primary: Colors.tabBarActive, 'muted-foreground': Colors.tabBarInactive },
      }).asReadonly(),
    },
  ],
  // Each item is 49px tall over the safe area, as React Navigation's iOS tab
  // bar is, rather than the 58px @blotch/ui's items are.
  template: `
    <view class="tabs">
      <lynx-tab-outlet />
      <ui-tab-bar class="bg-white" style="--primary: #000000; --muted-foreground: #424242">
        <ui-tab-bar-item
          route="/pokedex"
          label="Pokédex"
          class="pb-0 pt-[5px]"
          [svg]="onPokedex() ? homeSolid : home"
        />
        <ui-tab-bar-item
          route="/favourites"
          label="Favourites"
          class="pb-0 pt-[5px]"
          [svg]="onPokedex() ? heart : heartSolid"
        />
      </ui-tab-bar>
    </view>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .tabs {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
  `,
})
export class Tabs {
  readonly #router = inject(Router);

  protected readonly home = icon('home');
  protected readonly homeSolid = icon('homeSolid');
  protected readonly heart = icon('heart');
  protected readonly heartSolid = icon('heartSolid');

  /**
   * Whether the Pokédex is the tab shown, which draws its icon solid and the
   * other outlined, as the original's `focused` does.
   */
  protected readonly onPokedex = toSignal(
    this.#router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => !this.#router.url.startsWith('/favourites')),
    ),
    { initialValue: true },
  );
}
