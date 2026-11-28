import 'package:material_ui/material_ui.dart';

import '../config.dart';
import '../startup.dart';
import '../theme.dart';

/// What the mount screen renders `count` of (SPEC.md, "Mount").
enum MountKind { view, text, image }

/// The benchmark's rendering-throughput screen: `count` elements of one kind
/// in a wrapping, non-virtualized container, opened at launch in a build with
/// `BENCH_SCREEN` set, or by the link `launchperfflutter://bench/mount?kind=…&count=…`.
class MountScreen extends StatefulWidget {
  const MountScreen({super.key, required this.kind, required this.count});

  /// The screen for a route such as `/bench/mount?kind=view&count=1500`: an
  /// unknown kind is a view and a missing or bad count 1500, as in the other
  /// apps.
  factory MountScreen.fromUri(Uri uri) {
    final kind = MountKind.values.where((k) => k.name == uri.queryParameters['kind']).firstOrNull ?? MountKind.view;
    final count = int.tryParse(uri.queryParameters['count'] ?? '') ?? 0;
    return MountScreen(kind: kind, count: count > 0 ? count : 1500);
  }

  final MountKind kind;
  final int count;

  @override
  State<MountScreen> createState() => _MountScreenState();
}

class _MountScreenState extends State<MountScreen> {
  @override
  void initState() {
    super.initState();
    // Before the screen builds its children, so the marks bracket the whole
    // mount.
    AppStartup.reportMountStart();
    // After the frame that builds, lays out and paints all `count` elements,
    // as the original reports from a requestAnimationFrame after the commit.
    // A BENCH_SCREEN build launches here, so this is its fully drawn too.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      AppStartup.reportMountEnd();
      AppStartup.reportFullyDrawn();
    });
  }

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: AppColors.white,
    // A SingleChildScrollView builds every child (it isn't virtualized), so
    // all `count` elements mount, and the ones past the screen can still be
    // scrolled to.
    child: SingleChildScrollView(
      padding: EdgeInsets.only(top: MediaQuery.paddingOf(context).top),
      child: Wrap(children: [for (var i = 0; i < widget.count; i++) _item(i)]),
    ),
  );

  Widget _item(int index) => switch (widget.kind) {
    // React Native's default text: 14px, black.
    MountKind.text => Text('$index', style: const TextStyle(fontSize: 14, color: Colors.black)),
    MountKind.image => Image.network('$sprites/${(index % 300) + 1}.png', width: 24, height: 24, fit: BoxFit.contain),
    MountKind.view => const SizedBox(width: 10, height: 10, child: ColoredBox(color: AppColors.textPrimary)),
  };
}
