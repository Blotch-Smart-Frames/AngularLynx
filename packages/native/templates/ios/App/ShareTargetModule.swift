import Foundation
import Lynx

/// The native module behind the runtime's `LynxShareTarget`, which calls it as
/// `NativeModules.AngularLynxShareTarget` (from the background thread, where
/// NativeModules lives).
///
/// iOS puts an app in other apps' share sheets only through a Share
/// Extension: a separate process, with a memory limit of about 120 MB, that
/// can't run Lynx. So the extension (ShareExtension/ShareViewController.swift)
/// only copies what the person shares into the App Group container both
/// processes can read, one folder per share, and opens the app with the
/// share scheme. This module hands those shares to the runtime and deletes
/// them: `take` calls back with `{ shares }`, each `{ title?, text?, url?,
/// files: [{ base64, name, type }] }`, oldest first. A share waits in the
/// container until the app takes it, so one that arrives while the app
/// isn't running, or before Angular has started, isn't lost, and none is
/// handled twice. SceneDelegate sends the `angularLynxShare` global event
/// when the extension opens the app, and the runtime takes the shares then,
/// and once as it starts.
///
/// The generator leaves this file and the extension out of an app whose
/// angular.json has no `shareTarget`, and LynxViewController registers the
/// module by its Objective-C name only when it's there, hence the `@objc`
/// name.
@objc(AngularLynxShareTargetModule)
final class ShareTargetModule: NSObject, LynxModule {
  static var name: String { "AngularLynxShareTarget" }

  static var methodLookup: [String: String] {
    ["take": NSStringFromSelector(#selector(take(_:)))]
  }

  /// The folder of the App Group container the extension writes each share
  /// to, as `<sortable time>-<UUID>/share.json` beside its files. The
  /// extension writes a share under a name starting with `.` and renames it
  /// once it's complete, so a share being written is never taken half done.
  static let folderName = "AngularLynxShares"

  /// One `take` at a time: two would read the same folders.
  private static let queue = DispatchQueue(label: "dev.angularlynx.share-target")

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
    // Reading the files and encoding them is slow for a large photo, and
    // Lynx calls modules on its own thread, which mustn't wait on the disk.
    Self.queue.async {
      callback(["shares": Self.takeWaiting()])
    }
  }

  /// The App Group container's share folder, or nil when the app has no App
  /// Group: Info.plist's `AngularLynxShareGroup` names it, which the
  /// generator writes with the entitlement.
  static func folder() -> URL? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "AngularLynxShareGroup") as? String,
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return container.appendingPathComponent(folderName, isDirectory: true)
  }

  private static func takeWaiting() -> [[String: Any]] {
    guard let folder = folder(),
      let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path)
    else { return [] }
    var shares: [[String: Any]] = []
    for name in names.sorted() where !name.hasPrefix(".") {
      let share = folder.appendingPathComponent(name, isDirectory: true)
      if let read = read(share) {
        shares.append(read)
      }
      // Taken, or unreadable: either way it mustn't come back on every take.
      try? FileManager.default.removeItem(at: share)
    }
    return shares
  }

  /// A share's `share.json`, with each file it lists read in as base64, the
  /// way the runtime's LynxFilePicker receives files.
  private static func read(_ share: URL) -> [String: Any]? {
    guard
      let data = try? Data(contentsOf: share.appendingPathComponent("share.json")),
      let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    var result: [String: Any] = [:]
    for key in ["title", "text", "url"] {
      if let value = manifest[key] as? String {
        result[key] = value
      }
    }
    var files: [[String: Any]] = []
    for file in manifest["files"] as? [[String: Any]] ?? [] {
      guard let path = file["path"] as? String,
        let bytes = try? Data(contentsOf: share.appendingPathComponent(path))
      else { continue }
      files.append([
        "base64": bytes.base64EncodedString(),
        "name": file["name"] as? String ?? path,
        "type": file["type"] as? String ?? "application/octet-stream",
      ])
    }
    result["files"] = files
    return result
  }
}
