import Foundation
import OSLog

// The reference app's app-startup-module (launchperf-poke-rn), as a plain Swift class.
// NativeScript compiles the Swift in App_Resources/iOS/src into the app and generates metadata for
// every @objc class it finds, so the JavaScript calls these static methods directly
// (src/app/startup/app-startup.ts), with no plugin or bridge module in between.
// The harness finds each mark by name in Instruments' Points of Interest, whatever the subsystem.
@objcMembers
public class AppStartup: NSObject {
  private static let signposter = OSSignposter(
    subsystem: Bundle.main.bundleIdentifier ?? "launchperf.nativescript",
    category: .pointsOfInterest
  )
  private static var fullyDrawn = false

  // A launch has one fully drawn moment; a second call (a remount, a tab revisited) must not add a
  // later mark that the harness could pick up instead.
  public static func reportFullyDrawn() {
    guard !fullyDrawn else { return }
    fullyDrawn = true
    signposter.emitEvent("TTFD", id: signposter.makeSignpostID())
  }

  // Not once per process: each opening of the mount screen is its own measurement.
  public static func reportMountStart() {
    signposter.emitEvent("MountStart", id: signposter.makeSignpostID())
  }

  public static func reportMountEnd() {
    signposter.emitEvent("MountEnd", id: signposter.makeSignpostID())
  }
}
