import Foundation
import LocalAuthentication
import Lynx
import Security

/// The native module behind the runtime's `LynxBiometrics`, and the values
/// `LynxSecureStorage` keeps behind Face ID or Touch ID (`requireBiometrics`).
/// The runtime calls it as `NativeModules.AngularLynxBiometrics`, from the
/// background thread, where NativeModules lives.
///
/// Only an app with `permissions.biometrics` in angular.json has this file:
/// the generator deletes it from the others, which then have no
/// NSFaceIDUsageDescription, without which Face ID fails.
/// LynxViewController registers it by its Objective-C name, so the shell
/// builds either way.
///
/// A guarded value is a Keychain item of its own service, with access
/// control `.biometryCurrentSet`: the Keychain hands its data over only after
/// a face or a finger enrolled now confirms the person, and enrolling a new
/// one invalidates it. Writing one doesn't prompt. Each method calls back once
/// with `{}`, `{ value }`, the availability, or `{ error, message }`, where
/// `error` is one of the runtime's BiometricsErrorCode values.
@objc(AngularLynxBiometricsModule)
final class BiometricsModule: NSObject, LynxModule {
  static var name: String { "AngularLynxBiometrics" }

  static var methodLookup: [String: String] {
    [
      "availability": NSStringFromSelector(#selector(availability(_:))),
      "authenticate": NSStringFromSelector(#selector(authenticate(_:callback:))),
      "getItem": NSStringFromSelector(#selector(getItem(_:reason:callback:))),
      "setItem": NSStringFromSelector(#selector(setItem(_:value:callback:))),
      "removeItem": NSStringFromSelector(#selector(removeItem(_:callback:))),
      "clear": NSStringFromSelector(#selector(clear(_:))),
    ]
  }

  private let service = "\(Bundle.main.bundleIdentifier ?? "app").angular-lynx.biometric-storage"

  /// Keychain calls block, and a guarded read waits for the person, so they
  /// run off the JavaScript thread, one at a time and in the order they were
  /// made, as SecureStorageModule's do.
  private static let queue = DispatchQueue(label: "dev.angularlynx.biometric-storage")

  /// angular.json's `permissions.biometrics`, which a guarded read shows on
  /// Touch ID when the app gives no reason of its own.
  private static var defaultReason: String {
    Bundle.main.object(forInfoDictionaryKey: "NSFaceIDUsageDescription") as? String
      ?? "Confirm it's you"
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

  /// `{ type, enrolled, deviceCredential }`. LAContext reports the sensor's
  /// type once canEvaluatePolicy has run, whatever it returns, so a phone
  /// with Face ID nobody has set up still says `faceID`.
  @objc func availability(_ callback: @escaping LynxCallbackBlock) {
    let context = LAContext()
    var error: NSError?
    let ready = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    let code = error.map { LAError.Code(rawValue: $0.code) } ?? nil
    // Locked out still means a face or a finger is set up.
    let enrolled = ready || code == .biometryLockout
    let deviceCredential = LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    callback([
      "type": Self.typeName(context.biometryType),
      "enrolled": enrolled,
      "deviceCredential": deviceCredential,
    ])
  }

  /// Shows Face ID or Touch ID with `{ reason, allowDeviceCredential,
  /// cancelLabel }`, and calls back with `{}` once the person is confirmed.
  @objc func authenticate(_ options: [String: Any], callback: @escaping LynxCallbackBlock) {
    let reason = options["reason"] as? String ?? Self.defaultReason
    let allowDeviceCredential = options["allowDeviceCredential"] as? Bool ?? false
    let context = LAContext()
    if let cancel = options["cancelLabel"] as? String {
      context.localizedCancelTitle = cancel
    }
    // Without the passcode, iOS's "Enter Password" button after a failed
    // try would end the prompt with nothing the app can do: hide it.
    if !allowDeviceCredential {
      context.localizedFallbackTitle = ""
    }
    let policy: LAPolicy =
      allowDeviceCredential ? .deviceOwnerAuthentication : .deviceOwnerAuthenticationWithBiometrics
    var error: NSError?
    guard context.canEvaluatePolicy(policy, error: &error) else {
      callback(Self.failure(error))
      return
    }
    context.evaluatePolicy(policy, localizedReason: reason) { success, error in
      callback(success ? [:] : Self.failure(error as NSError?))
    }
  }

  /// The value stored under `key`, once the person confirms, as `{ value }`,
  /// or `{}` without prompting when there's none.
  @objc func getItem(_ key: String, reason: String, callback: @escaping LynxCallbackBlock) {
    Self.queue.async {
      // Whether there's one, from its attributes, which the Keychain gives
      // without asking: a missing key mustn't show a prompt.
      var probe = self.query(key)
      probe[kSecReturnAttributes as String] = true
      let context = LAContext()
      context.interactionNotAllowed = true
      probe[kSecUseAuthenticationContext as String] = context
      var found: AnyObject?
      let exists = SecItemCopyMatching(probe as CFDictionary, &found)
      guard exists == errSecSuccess || exists == errSecInteractionNotAllowed else {
        callback(exists == errSecItemNotFound ? [:] : Self.keychainFailure(exists))
        return
      }

      let prompt = LAContext()
      prompt.localizedReason = reason.isEmpty ? Self.defaultReason : reason
      prompt.localizedFallbackTitle = ""
      var query = self.query(key)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      query[kSecUseAuthenticationContext as String] = prompt
      var data: AnyObject?
      let status = SecItemCopyMatching(query as CFDictionary, &data)
      if status == errSecSuccess, let data = data as? Data,
        let value = String(data: data, encoding: .utf8)
      {
        callback(["value": value])
      } else if status == errSecItemNotFound {
        // Invalidated by a newly enrolled face or finger.
        callback([:])
      } else {
        callback(Self.keychainFailure(status))
      }
    }
  }

  /// Stores `value` under `key`, behind the faces and fingers enrolled now,
  /// in place of what was there. Doesn't prompt.
  @objc func setItem(_ key: String, value: String, callback: @escaping LynxCallbackBlock) {
    Self.queue.async {
      var error: Unmanaged<CFError>?
      // WhenPasscodeSet: biometrics need a passcode, and the item goes with
      // it, never leaving the device.
      guard
        let access = SecAccessControlCreateWithFlags(
          nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error)
      else {
        callback([
          "error": "failed",
          "message": error?.takeRetainedValue().localizedDescription ?? "No access control.",
        ])
        return
      }
      // Updating a guarded item's data would itself ask, so it's replaced.
      SecItemDelete(self.query(key) as CFDictionary)
      var item = self.query(key)
      item[kSecValueData as String] = Data(value.utf8)
      item[kSecAttrAccessControl as String] = access
      let status = SecItemAdd(item as CFDictionary, nil)
      callback(status == errSecSuccess ? [:] : Self.keychainFailure(status))
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

  private func delete(_ query: [String: Any], _ callback: LynxCallbackBlock) {
    let status = SecItemDelete(query as CFDictionary)
    callback(
      status == errSecSuccess || status == errSecItemNotFound ? [:] : Self.keychainFailure(status))
  }

  private static func typeName(_ type: LABiometryType) -> String {
    switch type {
    case .faceID: return "faceID"
    case .touchID: return "touchID"
    case .none: return "none"
    default:
      // .opticID arrived in iOS 17, after the shell's deployment target.
      if #available(iOS 17.0, *), type == .opticID { return "opticID" }
      return "none"
    }
  }

  /// An LAError as the runtime's error codes.
  private static func failure(_ error: NSError?) -> [String: Any] {
    let message = error?.localizedDescription ?? "The person couldn't be confirmed."
    let code: String
    switch error.flatMap({ LAError.Code(rawValue: $0.code) }) {
    case .userCancel?, .systemCancel?, .appCancel?, .userFallback?:
      code = "canceled"
    case .biometryLockout?:
      code = "lockout"
    case .biometryNotEnrolled?:
      code = "notEnrolled"
    case .biometryNotAvailable?, .passcodeNotSet?:
      code = "unavailable"
    default:
      code = "failed"
    }
    return ["error": code, "message": message]
  }

  /// A Keychain status as the runtime's error codes: a guarded read reports
  /// the prompt's outcome this way.
  private static func keychainFailure(_ status: OSStatus) -> [String: Any] {
    let message = SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"
    switch status {
    case errSecUserCanceled:
      return ["error": "canceled", "message": message]
    case errSecNotAvailable, errSecInteractionNotAllowed:
      return ["error": "unavailable", "message": message]
    default:
      return ["error": "failed", "message": message]
    }
  }
}
