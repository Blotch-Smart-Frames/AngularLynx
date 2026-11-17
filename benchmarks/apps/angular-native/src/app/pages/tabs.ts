import { Component } from '@angular/core';
import { NativeHeader, NativeTab, NativeTabsOutlet, type TabAppearance } from '@ng-native/router';
import { HEART, HEART_SOLID, HOME, HOME_SOLID } from '../icons.ts';

/**
 * The reference's (tabs)/_layout. Its bar is React Navigation's JavaScript tab bar; Angular
 * Native's is the platform's own (UITabBarController, Android's bottom navigation), so the SVG
 * icons are drawn into images once and tinted by the bar, and the colors and 12pt labels are set
 * through the bar's appearance.
 */
@Component({
  selector: 'app-tabs',
  imports: [NativeHeader, NativeTab, NativeTabsOutlet],
  host: { style: 'flex: 1' },
  template: `
    <native-header [hidden]="true" />
    <native-tabs-outlet tintColor="#000000" colorScheme="light">
      <native-tab
        path=""
        title="Pokédex"
        testID="tab_home"
        [icon]="{ svg: home }"
        [selectedIcon]="{ svg: homeSolid }"
        [standardAppearance]="appearance"
        [scrollEdgeAppearance]="appearance"
      />
      <native-tab
        path="favourites"
        title="Favourites"
        testID="tab_favorites"
        [icon]="{ svg: heart }"
        [selectedIcon]="{ svg: heartSolid }"
        [standardAppearance]="appearance"
        [scrollEdgeAppearance]="appearance"
      />
    </native-tabs-outlet>
  `,
})
export class Tabs {
  protected readonly home = HOME;
  protected readonly homeSolid = HOME_SOLID;
  protected readonly heart = HEART;
  protected readonly heartSolid = HEART_SOLID;

  // Black when selected, #424242 otherwise, with 12pt titles: the reference's tint colors and
  // TextSize.xs label.
  protected readonly appearance: TabAppearance = {
    stacked: {
      normal: {
        tabBarItemTitleFontSize: 12,
        tabBarItemTitleFontColor: '#424242',
        tabBarItemIconColor: '#424242',
      },
      selected: {
        tabBarItemTitleFontSize: 12,
        tabBarItemTitleFontColor: '#000000',
        tabBarItemIconColor: '#000000',
      },
    },
  };
}
