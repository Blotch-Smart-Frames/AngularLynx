import 'dart:ffi';

/// The marks the harness reads (SPEC.md, "Marks"), emitted as `os_signpost`
/// events by `launch_perf_report_mark` in `ios/Runner/AppDelegate.swift`, the
/// counterpart of the original's `modules/app-startup-module`, which emits
/// each name once per process.
///
/// Dart can't emit a signpost itself, and a method channel would emit it too
/// late: Flutter runs Dart on iOS's main thread, whose run loop handles a
/// channel's message only once the Dart code running has returned, so a mark
/// sent while a frame is built would be emitted after the frame. `dart:ffi`
/// calls the Swift function synchronously, as React Native calls its module
/// through JSI.
class AppStartup {
  AppStartup._();

  /// Looked up in the app's own executable on the first mark.
  static final _reportMark = DynamicLibrary.process().lookupFunction<Void Function(Int32), void Function(int)>(
    'launch_perf_report_mark',
  );

  /// `TTFD`: the first page of the list, or the mount screen's elements, on
  /// screen.
  static void reportFullyDrawn() => _reportMark(0);

  /// `MountStart`: the mount screen starts building.
  static void reportMountStart() => _reportMark(1);

  /// `MountEnd`: the frame with all of the mount screen's elements is done.
  static void reportMountEnd() => _reportMark(2);
}
