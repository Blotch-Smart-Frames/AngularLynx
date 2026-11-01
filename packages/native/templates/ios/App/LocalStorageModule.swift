import Foundation
import Lynx

/// The native module behind the runtime's `LynxLocalStorage`, which calls it
/// as `NativeModules.AngularLynxLocalStorage` (from the background thread,
/// where NativeModules lives).
///
/// Values are strings (the runtime stores JSON) in a UserDefaults suite of
/// their own, so `clear` removes only them, and the app's other defaults
/// stay out of reach. Each method calls back once with `{ value }` or `{}`.
final class LocalStorageModule: NSObject, LynxModule {
  static var name: String { "AngularLynxLocalStorage" }

  static var methodLookup: [String: String] {
    [
      "getItem": NSStringFromSelector(#selector(getItem(_:callback:))),
      "setItem": NSStringFromSelector(#selector(setItem(_:value:callback:))),
      "removeItem": NSStringFromSelector(#selector(removeItem(_:callback:))),
      "clear": NSStringFromSelector(#selector(clear(_:))),
    ]
  }

  /// Any name but the app's bundle ID, which UserDefaults won't take.
  private static let suite = "dev.angularlynx.storage"

  // The suite name is valid, so this is never nil.
  private let defaults = UserDefaults(suiteName: LocalStorageModule.suite)!

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  @objc func getItem(_ key: String, callback: @escaping LynxCallbackBlock) {
    // Read the suite's own values: UserDefaults' lookups also search the
    // global domain and the launch arguments, which would answer for keys
    // such as AppleLanguages that the app never stored.
    let value = defaults.persistentDomain(forName: Self.suite)?[key] as? String
    callback(value.map { ["value": $0] } ?? [:])
  }

  @objc func setItem(_ key: String, value: String, callback: @escaping LynxCallbackBlock) {
    defaults.set(value, forKey: key)
    callback([:])
  }

  @objc func removeItem(_ key: String, callback: @escaping LynxCallbackBlock) {
    defaults.removeObject(forKey: key)
    callback([:])
  }

  @objc func clear(_ callback: @escaping LynxCallbackBlock) {
    defaults.removePersistentDomain(forName: Self.suite)
    callback([:])
  }
}
