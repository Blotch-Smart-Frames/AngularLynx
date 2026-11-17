import { useGlobalProps } from '@lynx-js/react';

import { Colors } from '../constants/colors';
import { type Tab, useNavigation } from '../navigation';
import { Icons, SVGIcon } from './SVGIcon';

const TABS: { name: Tab; title: string; icon: string; focusedIcon: string }[] = [
  { name: 'index', title: 'Pokédex', icon: Icons.home, focusedIcon: Icons.homeSolid },
  { name: 'favourites', title: 'Favourites', icon: Icons.heart, focusedIcon: Icons.heartSolid },
];

/**
 * React Navigation's bottom tab bar as it draws on an iPhone in portrait
 * (App.css, `.tab-bar`), with the original's tints, labels and icons.
 */
export function TabBar() {
  const { safeAreaBottom = 0 } = useGlobalProps();
  const tab = useNavigation(state => state.tab);
  const setTab = useNavigation(state => state.setTab);

  return (
    <view
      className="tab-bar"
      style={{ height: `${49 + safeAreaBottom}px`, paddingBottom: `${safeAreaBottom}px` }}
    >
      {TABS.map(({ name, title, icon, focusedIcon }) => {
        const focused = tab === name;
        const color = focused ? Colors.tabBarActive : Colors.tabBarInactive;
        return (
          <view
            key={name}
            className="tab"
            bindtap={() => setTab(name)}
            accessibility-element
            accessibility-label={title}
          >
            <view className="tab-icon">
              <SVGIcon icon={focused ? focusedIcon : icon} size={25} color={color} />
            </view>
            <text className="tab-label" style={{ color }}>
              {title}
            </text>
          </view>
        );
      })}
    </view>
  );
}
