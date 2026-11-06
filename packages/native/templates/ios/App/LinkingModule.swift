import Lynx
import SafariServices
import UIKit

/// The native module behind the runtime's `LynxLinking`, which calls it as
/// `NativeModules.AngularLynxLinking` (from the background thread, where
/// NativeModules lives).
///
/// Lynx has no window.open or `<a href>`, so a link can't leave the app on
/// its own. `openURL` hands it to iOS, which opens it in Safari, Mail or the
/// app that claims it, and `openInApp` shows it in SFSafariViewController over
/// the app. Each method calls back once: with `{}` when it's done, `{ value }`
/// for `canOpenURL`, or `{ error: "failed", message }`.
final class LinkingModule: NSObject, LynxModule, SFSafariViewControllerDelegate {
  static var name: String { "AngularLynxLinking" }

  static var methodLookup: [String: String] {
    [
      "openURL": NSStringFromSelector(#selector(openURL(_:callback:))),
      "openInApp": NSStringFromSelector(#selector(openInApp(_:options:callback:))),
      "canOpenURL": NSStringFromSelector(#selector(canOpenURL(_:callback:))),
    ]
  }

  /// Who to tell when the open sheet closes, or nil when none is open.
  private var sheetClosed: LynxCallbackBlock?

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  /// Calls back once iOS has handed `address` to the app that opens it.
  /// UIApplication.open needs no LSApplicationQueriesSchemes entry: only
  /// canOpenURL asks for one.
  @objc func openURL(_ address: String, callback: @escaping LynxCallbackBlock) {
    // Lynx calls modules off the main thread, and UIApplication is
    // main-thread only.
    DispatchQueue.main.async {
      guard let url = URL(string: address) else {
        callback(Self.failed("\(address) is not a valid URL."))
        return
      }
      UIApplication.shared.open(url) { opened in
        callback(opened ? [:] : Self.failed("Nothing on this device can open \(address)."))
      }
    }
  }

  /// Calls back with `{ value }`: whether an app on the phone opens
  /// `address`. iOS answers `false` for a scheme the app doesn't list in
  /// Info.plist's LSApplicationQueriesSchemes, which the generator writes
  /// from angular.json's `canOpenURLSchemes`.
  @objc func canOpenURL(_ address: String, callback: @escaping LynxCallbackBlock) {
    DispatchQueue.main.async {
      guard let url = URL(string: address) else {
        callback(Self.failed("\(address) is not a valid URL."))
        return
      }
      callback(["value": UIApplication.shared.canOpenURL(url)])
    }
  }

  /// Shows `address` in SFSafariViewController and calls back once the
  /// person closes it. `options` may hold `toolbarColor` and `controlsColor`,
  /// each a `#` and eight hex digits: red, green, blue and alpha.
  @objc func openInApp(
    _ address: String, options: [String: Any], callback: @escaping LynxCallbackBlock
  ) {
    DispatchQueue.main.async {
      self.present(address, options, callback)
    }
  }

  private func present(
    _ address: String, _ options: [String: Any], _ callback: @escaping LynxCallbackBlock
  ) {
    guard sheetClosed == nil else {
      callback(Self.failed("A browser sheet is already open."))
      return
    }
    // SFSafariViewController throws an Objective-C exception, which Swift
    // can't catch, for any other scheme.
    guard let url = URL(string: address), let scheme = url.scheme?.lowercased(),
      scheme == "http" || scheme == "https"
    else {
      callback(Self.failed("The browser sheet opens http and https URLs only, not \(address)."))
      return
    }
    guard let presenter = Self.topViewController() else {
      callback(Self.failed("The app has no screen to show the browser sheet over."))
      return
    }
    let safari = SFSafariViewController(url: url)
    safari.delegate = self
    if let color = Self.color(options["toolbarColor"]) {
      safari.preferredBarTintColor = color
    }
    if let color = Self.color(options["controlsColor"]) {
      safari.preferredControlTintColor = color
    }
    sheetClosed = callback
    presenter.present(safari, animated: true)
  }

  /// The person tapped Done, or swiped the sheet away.
  func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
    let closed = sheetClosed
    sheetClosed = nil
    closed?([:])
  }

  /// The view controller on top of the app's window: the LynxViewController,
  /// or whatever it's presenting, such as a sign-in sheet.
  private static func topViewController() -> UIViewController? {
    var top = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)?
      .rootViewController
    while let presented = top?.presentedViewController, !presented.isBeingDismissed {
      top = presented
    }
    return top
  }

  /// A `#` and eight hex digits, red, green, blue and alpha, as the runtime
  /// writes every color it's given.
  private static func color(_ value: Any?) -> UIColor? {
    guard let hex = value as? String, hex.count == 9, hex.hasPrefix("#"),
      let rgba = UInt32(hex.dropFirst(), radix: 16)
    else { return nil }
    let channel = { (shift: UInt32) in CGFloat((rgba >> shift) & 0xFF) / 255 }
    return UIColor(red: channel(24), green: channel(16), blue: channel(8), alpha: channel(0))
  }

  private static func failed(_ message: String) -> [String: Any] {
    ["error": "failed", "message": message]
  }
}
