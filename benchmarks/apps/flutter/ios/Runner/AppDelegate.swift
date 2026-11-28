import Flutter
import OSLog
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }
}

/// The marks the benchmark's harness reads (benchmarks/SPEC.md, "Marks"):
/// `os_signpost` events in the Points of Interest category, which Instruments
/// shows by name, the counterpart of the React Native app's
/// `modules/app-startup-module`.
private let signposter = OSSignposter(
  subsystem: "com.angularlynx.bench.flutter",
  category: "PointsOfInterest"
)
private let lock = NSLock()
private var loggedMarks = Set<Int32>()

/// Emits a mark: 0 is `TTFD`, 1 `MountStart`, 2 `MountEnd`. Each once per
/// process, so a later call can't move it.
///
/// Dart calls this through `dart:ffi`, not a method channel, because the call
/// has to emit the signpost when it's made. Flutter runs Dart on the
/// platform's main thread, and a method channel's message is handled by that
/// thread's run loop only once the Dart code running returns: `MountStart`,
/// sent as the mount screen starts building, would come after the whole first
/// frame, at the same instant as `MountEnd`. React Native's module is called
/// synchronously (JSI) for the same reason. Dart finds it by name in the
/// app's exports (`DynamicLibrary.process()`), where a public `@_cdecl`
/// function stays in a Release build.
@_cdecl("launch_perf_report_mark")
public func launchPerfReportMark(_ mark: Int32) {
  lock.lock()
  defer { lock.unlock() }
  guard loggedMarks.insert(mark).inserted else { return }
  let id = signposter.makeSignpostID()
  // emitEvent takes a StaticString, so each name needs its own call.
  switch mark {
  case 0: signposter.emitEvent("TTFD", id: id)
  case 1: signposter.emitEvent("MountStart", id: id)
  case 2: signposter.emitEvent("MountEnd", id: id)
  default: break
  }
}
