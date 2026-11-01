import Foundation
import Lynx
import Security

/// The native module behind the runtime's `LynxSecureStorage`, which calls it
/// as `NativeModules.AngularLynxSecureStorage` (from the background thread,
/// where NativeModules lives).
///
/// Values are strings (the runtime stores JSON) kept in the Keychain, as
/// generic passwords of one service, each under its key as the account.
/// They're readable once the phone has been unlocked after it starts, so a
/// token can be refreshed while the app is in the background, and never leave
/// the device, in a backup or otherwise. The Keychain keeps them when the app
/// is deleted, which the runtime's docs point out. Each method calls back once
/// with `{ value }`, `{}` or `{ error }`.
final class SecureStorageModule: NSObject, LynxModule {
  static var name: String { "AngularLynxSecureStorage" }

  static var methodLookup: [String: String] {
    [
      "getItem": NSStringFromSelector(#selector(getItem(_:callback:))),
      "setItem": NSStringFromSelector(#selector(setItem(_:value:callback:))),
      "removeItem": NSStringFromSelector(#selector(removeItem(_:callback:))),
      "clear": NSStringFromSelector(#selector(clear(_:))),
    ]
  }

  private let service = "\(Bundle.main.bundleIdentifier ?? "app").angular-lynx.secure-storage"

  /// Keychain calls can block, so they run off the JavaScript thread, one at
  /// a time and in the order they were made, so a read sees the writes
  /// before it. Shared by every LynxView's module.
  private static let queue = DispatchQueue(label: "dev.angularlynx.secure-storage")

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
    Self.queue.async {
      var query = self.query(key)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      var data: AnyObject?
      let status = SecItemCopyMatching(query as CFDictionary, &data)
      if status == errSecSuccess, let data = data as? Data,
        let value = String(data: data, encoding: .utf8)
      {
        callback(["value": value])
      } else if status == errSecSuccess || status == errSecItemNotFound {
        callback([:])
      } else {
        callback(self.failure(status))
      }
    }
  }

  @objc func setItem(_ key: String, value: String, callback: @escaping LynxCallbackBlock) {
    Self.queue.async {
      let data = Data(value.utf8)
      var status = SecItemUpdate(
        self.query(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
      if status == errSecItemNotFound {
        var item = self.query(key)
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        status = SecItemAdd(item as CFDictionary, nil)
      }
      callback(status == errSecSuccess ? [:] : self.failure(status))
    }
  }

  @objc func removeItem(_ key: String, callback: @escaping LynxCallbackBlock) {
    Self.queue.async {
      self.delete(self.query(key), callback)
    }
  }

  @objc func clear(_ callback: @escaping LynxCallbackBlock) {
    Self.queue.async {
      self.delete(
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: self.service],
        callback)
    }
  }

  private func query(_ key: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
    ]
  }

  /// Deletes every item `query` matches. None is fine too.
  private func delete(_ query: [String: Any], _ callback: LynxCallbackBlock) {
    let status = SecItemDelete(query as CFDictionary)
    callback(status == errSecSuccess || status == errSecItemNotFound ? [:] : failure(status))
  }

  private func failure(_ status: OSStatus) -> [String: Any] {
    ["error": SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"]
  }
}
