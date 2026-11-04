import Foundation
import Lynx

/// The `AngularLynxAssets` module: a file the app bundles (`/static/...`),
/// read for the runtime's main-thread `fetch` and `Image`, which load a
/// texture or a glTF model the app imports. The app's `dist/` is in the app
/// bundle, not on a server, so a URL relative to it has nowhere to be
/// fetched from; BundleResourceFetcher maps it to the file, as it does for
/// Lynx's own `<image>`.
///
/// Called from the main thread, synchronously (`lynx.module(name)`), like
/// the WebGL module: the runtime turns the answer into a Response.
final class AssetsModule: NSObject, LynxModule {
  static var name: String { "AngularLynxAssets" }

  static var methodLookup: [String: String] {
    ["read": NSStringFromSelector(#selector(read(_:)))]
  }

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here.
  init(param: Any) {
    super.init()
  }

  /// The file's bytes as 32-bit words with the byte count last (see toWords
  /// in the runtime's webgl-bridge.ts: Lynx's bridge carries no binary), or
  /// nil when the app doesn't bundle it.
  @objc func read(_ url: String) -> [NSNumber]? {
    guard let file = BundleResourceFetcher.shared.localFile(for: url),
      let data = try? Data(contentsOf: file)
    else { return nil }
    var words = [NSNumber]()
    words.reserveCapacity(data.count / 4 + 2)
    data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
      var index = 0
      while index < bytes.count {
        var word: UInt32 = 0
        for offset in 0..<min(4, bytes.count - index) {
          word |= UInt32(bytes[index + offset]) << (8 * UInt32(offset))
        }
        words.append(NSNumber(value: word))
        index += 4
      }
    }
    words.append(NSNumber(value: data.count))
    return words
  }
}
