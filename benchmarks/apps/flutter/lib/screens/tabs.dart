import 'package:cupertino_ui/cupertino_ui.dart';

import '../theme.dart';
import '../widgets/common.dart';
import 'favourites.dart';
import 'pokedex.dart';

/// The two tabs over a tab bar (the original's expo-router `Tabs`, React
/// Navigation's bottom tabs). Like those, a tab is built the first time it's
/// shown and kept after, so the Favourites tab costs nothing at launch.
class TabsScreen extends StatefulWidget {
  const TabsScreen({super.key});

  @override
  State<TabsScreen> createState() => _TabsScreenState();
}

class _TabsScreenState extends State<TabsScreen> {
  var _index = 0;
  final _shown = <int>{0};

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Expanded(
        child: IndexedStack(
          index: _index,
          children: [
            const PokedexScreen(),
            if (_shown.contains(1)) const FavouritesScreen() else const SizedBox.shrink(),
          ],
        ),
      ),
      // Cupertino's tab bar, which Flutter draws itself: the closest to React
      // Navigation's on iOS (white, a hairline on top, the icon over its
      // label). The original's tint colors and 12px labels.
      CupertinoTheme(
        data: const CupertinoThemeData(
          textTheme: CupertinoTextThemeData(tabLabelTextStyle: TextStyle(fontSize: 12, height: 16 / 12)),
        ),
        child: CupertinoTabBar(
          currentIndex: _index,
          onTap: (index) => setState(() {
            _index = index;
            _shown.add(index);
          }),
          backgroundColor: AppColors.white,
          activeColor: AppColors.tabBarActive,
          inactiveColor: AppColors.tabBarInactive,
          iconSize: 25,
          items: [
            _item('Pokédex', 'home', active: _index == 0),
            _item('Favourites', 'heart', active: _index == 1),
          ],
        ),
      ),
    ],
  );

  /// A tab with the original's outline icon, solid while it's the current one.
  static BottomNavigationBarItem _item(String label, String icon, {required bool active}) => BottomNavigationBarItem(
    label: label,
    icon: Builder(
      builder: (context) => SvgIcon(
        active ? '$icon-solid' : icon,
        size: 25,
        color: IconTheme.of(context).color ?? AppColors.tabBarInactive,
      ),
    ),
  );
}

/// A tab's screen: white under the status bar, `#F7F7F7` below it (the
/// original's `TabScreenFrame`).
class TabScreenFrame extends StatelessWidget {
  const TabScreenFrame({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: AppColors.white,
    child: Padding(
      padding: EdgeInsets.only(top: MediaQuery.paddingOf(context).top),
      child: ColoredBox(
        color: AppColors.backgroundScreen,
        // The tab bar below takes the bottom inset, so the list doesn't.
        child: MediaQuery.removePadding(context: context, removeTop: true, removeBottom: true, child: child),
      ),
    ),
  );
}
