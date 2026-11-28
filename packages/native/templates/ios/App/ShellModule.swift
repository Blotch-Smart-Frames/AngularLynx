import Lynx
import UIKit
import os

/// The native module the AngularLynx runtime calls as
/// `NativeModules.AngularLynxShell` (from the background thread, where
/// NativeModules lives). Android's shell has one of the same name, which also
/// connects the back button.
///
/// `collectGarbage` runs a full collection of the main thread's JavaScript
/// heap. PrimJS, which runs it, collects as the app runs, but those collections
/// leave behind much of what a screen leaves when it goes, and the app's
/// footprint grows with every screen it has shown. Lynx runs a full one, which
/// also hands the freed pages back to the system, when the host app reports
/// memory pressure, so this reports a moderate one. The runtime asks once it
/// has released about a screen's worth of elements and the app has settled
/// (`collect-garbage.ts` in `packages/runtime`).
///
/// `hideSplashScreen` fades out the copy of the launch screen the shell keeps
/// over the app until its first screen is ready (SplashScreen.swift). The
/// runtime's LynxSplashScreen calls it.
///
/// `reportFullyDrawn` marks the moment the app's first screen is complete
/// (the runtime's `reportFullyDrawn()`) with an `os_signpost` event named
/// `Fully Drawn` in the Points of Interest category, which Instruments shows
/// beside the App Launch template's phases. iOS has no API of its own for it,
/// as Android has `Activity.reportFullyDrawn()`.
///
/// `markEvent(name)` marks any other moment the app names, in the same
/// category, so it shows on Instruments' Points of Interest timeline beside
/// `Fully Drawn`: the start of the work a profile is about, for example.
/// Every call marks, not only the first. The benchmark apps mark
/// `MountStart` as their mount screen starts building (`benchmarks/SPEC.md`),
/// so the harness can time the screen apart from the launch before it.
final class ShellModule: NSObject, LynxModule {
  static var name: String { "AngularLynxShell" }

  static var methodLookup: [String: String] {
    [
      "collectGarbage": NSStringFromSelector(#selector(collectGarbage)),
      "hideSplashScreen": NSStringFromSelector(#selector(hideSplashScreen)),
      "reportFullyDrawn": NSStringFromSelector(#selector(reportFullyDrawn)),
      "markEvent": NSStringFromSelector(#selector(markEvent(_:))),
    ]
  }

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  // Lynx calls modules off the main thread. trimMemory hands the collection
  // to each LynxView's engine, which runs it on its own thread.
  @objc func collectGarbage() {
    DispatchQueue.main.async {
      LynxEnv.sharedInstance().trimMemory(.moderate)
    }
  }

  @objc func hideSplashScreen() {
    DispatchQueue.main.async {
      SplashScreen.shared.hide()
    }
  }

  private static let pointsOfInterest = OSLog(
    subsystem: Bundle.main.bundleIdentifier ?? "AngularLynx", category: .pointsOfInterest)
  private static let fullyDrawnOnce = NSLock()
  private static var fullyDrawn = false

  // Emitted on the calling thread: the runtime calls it from Lynx's engine
  // thread, through main-thread modules, and a hop to the main queue would
  // add a frame's wait to the moment it marks. os_signpost is thread-safe.
  @objc func reportFullyDrawn() {
    ShellModule.fullyDrawnOnce.lock()
    defer { ShellModule.fullyDrawnOnce.unlock() }
    // Once per process, as Android's is: the development build loads the app
    // again on every edit, and each load reports.
    guard !ShellModule.fullyDrawn else { return }
    ShellModule.fullyDrawn = true
    os_signpost(.event, log: ShellModule.pointsOfInterest, name: "Fully Drawn")
  }

  // On the calling thread, as reportFullyDrawn is: a mark made from the
  // engine thread lands at the moment it marks. os_signpost takes only a
  // string literal as an event's name, so every mark is an event named
  // `Mark`, and the app's name for it is the event's message, which
  // Instruments shows beside the name.
  @objc func markEvent(_ name: String) {
    os_signpost(.event, log: ShellModule.pointsOfInterest, name: "Mark", "%{public}s", name)
  }
}
