import Lynx
import StoreKit
import UIKit

/// The native module behind the runtime's `LynxStoreReview`, which calls it
/// as `NativeModules.AngularLynxStoreReview` (from the background thread,
/// where NativeModules lives).
///
/// `request` asks StoreKit for its rating prompt over the app's window scene
/// and calls back once with `{}`. StoreKit decides whether the prompt shows,
/// and doesn't say: it shows it at most three times in 365 days in an App
/// Store build, never in a TestFlight one, and every time in a development
/// build. So the callback says only that the request was made.
///
/// The generator leaves this file out of an app whose angular.json doesn't
/// set `storeReview`, and LynxViewController registers the module by its
/// Objective-C name only when it's there, hence the `@objc` name.
@objc(AngularLynxStoreReviewModule)
final class StoreReviewModule: NSObject, LynxModule {
  static var name: String { "AngularLynxStoreReview" }

  static var methodLookup: [String: String] {
    ["request": NSStringFromSelector(#selector(request(_:)))]
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

  // Lynx calls modules off the main thread, and the scene and StoreKit's
  // request belong to the main actor.
  @objc func request(_ callback: @escaping LynxCallbackBlock) {
    Task { @MainActor in
      if let scene = Self.activeScene() {
        if #available(iOS 16.0, *) {
          // SKStoreReviewController's request is deprecated from iOS 18 in
          // favor of this one, which iOS 15 doesn't have.
          AppStore.requestReview(in: scene)
        } else {
          SKStoreReviewController.requestReview(in: scene)
        }
      }
      // Without a scene in the foreground there's nothing to show the prompt
      // over, which is the same to the app as StoreKit choosing not to.
      callback([:])
    }
  }

  /// The window scene in the foreground: StoreKit shows the prompt over it.
  @MainActor private static func activeScene() -> UIWindowScene? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
  }
}
