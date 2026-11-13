import Lynx
import UIKit

/// The shortcuts the person has run and the app hasn't taken yet.
///
/// angular.json's `shortcuts` become App Intents (AppShortcuts.swift, which
/// the generator writes), and iOS runs one from Siri, Spotlight or the
/// Shortcuts app. It may run before the app has started, which iOS then
/// launches for it, so an intent can't call into the app: it leaves the
/// shortcut here, and the runtime's `LynxShortcuts` takes it when it's ready,
/// at startup and again each time it hears the `angularLynxShortcut` global
/// event. A shortcut waits here for as long as that takes, so the one that
/// launched the app is never lost, and none is handled twice.
final class ShortcutCenter {
  static let shared = ShortcutCenter()

  /// The global event that says a shortcut is waiting. It carries nothing:
  /// the listener answers by taking them.
  static let event = "angularLynxShortcut"

  /// App Intents run off the main thread, and Lynx calls modules off it too.
  private let lock = NSLock()
  private var waiting: [[String: String]] = []

  /// The app's LynxView, which LynxViewController sets once it has one.
  weak var lynxView: LynxView?

  /// Called by each shortcut's App Intent, with angular.json's `id` and
  /// `route`.
  func run(id: String, route: String? = nil) {
    var shortcut = ["id": id]
    if let route {
      shortcut["route"] = route
    }
    lock.lock()
    waiting.append(shortcut)
    lock.unlock()
    DispatchQueue.main.async {
      // Before the LynxView exists there's nobody to tell, and the runtime
      // asks when it starts anyway.
      self.lynxView?.sendGlobalEvent(Self.event, withParams: [])
    }
  }

  /// The waiting shortcuts, oldest first, which stop waiting.
  func take() -> [[String: String]] {
    lock.lock()
    defer { lock.unlock() }
    let taken = waiting
    waiting = []
    return taken
  }
}

/// The native module behind the runtime's `LynxShortcuts`, which calls it as
/// `NativeModules.AngularLynxShortcuts` (from the background thread, where
/// NativeModules lives). Android's shell has one of the same name.
///
/// `take` calls back with `{ shortcuts }`: each shortcut the person ran since
/// the last call, as `{ id, route? }`.
final class ShortcutsModule: NSObject, LynxModule {
  static var name: String { "AngularLynxShortcuts" }

  static var methodLookup: [String: String] {
    ["take": NSStringFromSelector(#selector(take(_:)))]
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

  @objc func take(_ callback: @escaping LynxCallbackBlock) {
    callback(["shortcuts": ShortcutCenter.shared.take()])
  }
}
