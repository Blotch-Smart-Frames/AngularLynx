import AppTrackingTransparency
import Lynx
import UIKit

/// The native module behind the runtime's `LynxTracking`, which calls it as
/// `NativeModules.AngularLynxTracking` (from the background thread, where
/// NativeModules lives).
///
/// `status` calls back with `{ status }`, App Tracking Transparency's answer
/// for the app: `authorized`, `denied`, `restricted` or `notDetermined`.
/// `request` shows ATT's prompt, with Info.plist's
/// NSUserTrackingUsageDescription (angular.json's `permissions.tracking`),
/// and calls back with the answer. iOS shows the prompt once per install:
/// after that, and when the person has turned off "Allow Apps to Request to
/// Track", it answers at once without showing anything.
///
/// The generator leaves this file out of an app whose angular.json doesn't
/// set `permissions.tracking`, since iOS ends an app that asks without the
/// usage description, and App Review asks about ATT code an app gives no
/// reason for. LynxViewController registers the module by its Objective-C
/// name only when it's there, hence the `@objc` name.
@objc(AngularLynxTrackingModule)
final class TrackingModule: NSObject, LynxModule {
  static var name: String { "AngularLynxTracking" }

  static var methodLookup: [String: String] {
    [
      "status": NSStringFromSelector(#selector(status(_:))),
      "request": NSStringFromSelector(#selector(request(_:))),
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

  @objc func status(_ callback: @escaping LynxCallbackBlock) {
    callback(["status": Self.name(of: ATTrackingManager.trackingAuthorizationStatus)])
  }

  // Lynx calls modules off the main thread, and the application's state and
  // the prompt belong to the main actor.
  @objc func request(_ callback: @escaping LynxCallbackBlock) {
    Task { @MainActor in
      Self.whenActive {
        ATTrackingManager.requestTrackingAuthorization { status in
          if status == .notDetermined && UIApplication.shared.applicationState != .active {
            // iOS answers notDetermined without showing anything when the app
            // stopped being active before the prompt could show, as when
            // another system alert (notifications, location) took the screen
            // first. It shows the prompt if asked again once the app is back.
            Task { @MainActor in
              Self.whenActive {
                ATTrackingManager.requestTrackingAuthorization { status in
                  callback(["status": Self.name(of: status)])
                }
              }
            }
            return
          }
          callback(["status": Self.name(of: status)])
        }
      }
    }
  }

  /// Runs `body` now if the app is active, or the next time it becomes
  /// active. ATT shows its prompt only to an active app: asked from an app
  /// still launching, or behind another alert, it answers notDetermined at
  /// once and shows nothing.
  @MainActor private static func whenActive(_ body: @escaping () -> Void) {
    if UIApplication.shared.applicationState == .active {
      body()
      return
    }
    var observer: NSObjectProtocol?
    observer = NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { _ in
      if let observer { NotificationCenter.default.removeObserver(observer) }
      observer = nil
      body()
    }
  }

  /// The runtime's name for ATT's status. A status a newer iOS adds counts
  /// as `denied`, so the app doesn't track on an answer it can't read.
  private static func name(of status: ATTrackingManager.AuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "denied"
    }
  }
}
