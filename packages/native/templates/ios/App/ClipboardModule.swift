import Lynx
import UIKit

/// The native module behind the runtime's `LynxClipboard`, which calls it as
/// `NativeModules.AngularLynxClipboard` (from the background thread, where
/// NativeModules lives).
///
/// Text goes on the general pasteboard, the one every app shares. Each method
/// calls back once: `setString` with `{}`, `getString` with `{ value }`.
final class ClipboardModule: NSObject, LynxModule {
  static var name: String { "AngularLynxClipboard" }

  static var methodLookup: [String: String] {
    [
      "setString": NSStringFromSelector(#selector(setString(_:callback:))),
      "getString": NSStringFromSelector(#selector(getString(_:))),
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

  // Lynx calls modules off the main thread, and UIPasteboard is UIKit's: on
  // iOS 16 and later a read can show the paste prompt.
  @objc func setString(_ text: String, callback: @escaping LynxCallbackBlock) {
    DispatchQueue.main.async {
      UIPasteboard.general.string = text
      callback([:])
    }
  }

  /// The pasteboard's text, or `""` when it holds none. Reading text another
  /// app copied makes iOS 16 and later ask the person first, and a refusal
  /// reads as none. `hasStrings` doesn't ask, so an empty pasteboard, or one
  /// holding only an image, never shows the prompt.
  @objc func getString(_ callback: @escaping LynxCallbackBlock) {
    DispatchQueue.main.async {
      let pasteboard = UIPasteboard.general
      let text = pasteboard.hasStrings ? pasteboard.string : nil
      callback(["value": text ?? ""])
    }
  }
}
