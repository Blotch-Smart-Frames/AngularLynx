import Lynx
import UIKit

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
final class ShellModule: NSObject, LynxModule {
  static var name: String { "AngularLynxShell" }

  static var methodLookup: [String: String] {
    [
      "collectGarbage": NSStringFromSelector(#selector(collectGarbage)),
      "hideSplashScreen": NSStringFromSelector(#selector(hideSplashScreen)),
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
}
