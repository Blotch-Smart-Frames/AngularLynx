import 'package:material_ui/material_ui.dart';

import 'config.dart';
import 'screens/mount.dart';
import 'screens/tabs.dart';
import 'theme.dart';

void main() {
  runApp(const LaunchPerfApp());
}

class LaunchPerfApp extends StatelessWidget {
  const LaunchPerfApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'LaunchPerfFlutter',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: AppColors.textPrimary),
      scaffoldBackgroundColor: AppColors.white,
    ),
    // A BENCH_SCREEN build starts on that screen, so the tabs, the list and
    // its requests never exist (SPEC.md, "Benchmark screens"). A launch from
    // a link starts on the link's route instead: Flutter hands it over as the
    // initial route.
    initialRoute: benchScreen.isEmpty ? '/' : '/bench/$benchScreen',
    // Only the route asked for, not every route its path passes through, as
    // the Navigator would by default (`/`, `/bench`, then
    // `/bench/mount?...`), which would build the tabs under the mount screen.
    onGenerateInitialRoutes: (name) => [_route(RouteSettings(name: name))],
    onGenerateRoute: _route,
  );

  static Route<void> _route(RouteSettings settings) {
    final uri = Uri.parse(settings.name ?? '/');
    // `/mount` too: Flutter makes a link's route from its path and query
    // alone, so `launchperfflutter://bench/mount?...` arrives without `bench`,
    // which is the link's host.
    final mount = uri.path == '/bench/mount' || uri.path == '/mount';
    final Widget screen = mount ? MountScreen.fromUri(uri) : const TabsScreen();
    return PageRouteBuilder(
      settings: settings,
      // A launch has nothing to animate from.
      transitionDuration: Duration.zero,
      pageBuilder: (context, _, _) => Material(color: AppColors.white, child: screen),
    );
  }
}
