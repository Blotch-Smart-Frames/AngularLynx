import Lynx
import UIKit

/// The native module behind the runtime's `LynxShare`, which calls it as
/// `NativeModules.AngularLynxShare` (from the background thread, where
/// NativeModules lives).
///
/// Lynx has no `navigator.share()`. The system share sheet,
/// UIActivityViewController, stands in for it. Each file is written to a
/// temporary file of its own name first, rather than handed over as data or
/// a UIImage, so "Save to Files" and AirDrop get the name the app gave it,
/// and the sheet knows its type from the extension: a JPEG gets "Save Image".
///
/// The files come as base64, since the runtime's relay from the main thread
/// and the module's arguments carry only what JSON can.
final class ShareModule: NSObject, LynxModule {
  static var name: String { "AngularLynxShare" }

  static var methodLookup: [String: String] {
    ["share": NSStringFromSelector(#selector(share(_:callback:)))]
  }

  /// Whether a share sheet is open. Only touched on the main thread.
  private var open = false

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  /// Opens the share sheet with `request`'s `files` (`{ base64, name, type }`),
  /// `title`, `text` and `url`, and calls back once with `{ shared }`, or with
  /// `{ error: "failed", message }`.
  @objc func share(_ request: [String: Any], callback: @escaping LynxCallbackBlock) {
    // Decoding and writing the files takes a moment for a photo: on the
    // module's own thread, before the sheet, which is UI, opens on the main
    // thread.
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("AngularLynxShare", isDirectory: true)
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    var items: [Any] = []
    do {
      let files = request["files"] as? [[String: Any]] ?? []
      if !files.isEmpty {
        try FileManager.default.createDirectory(
          at: directory, withIntermediateDirectories: true)
      }
      var used = Set<String>()
      for file in files {
        guard let base64 = file["base64"] as? String,
          let data = Data(base64Encoded: base64)
        else {
          throw ShareFailure("A file's bytes couldn't be read.")
        }
        let name = Self.uniqueName(Self.safeName(file["name"] as? String), in: &used)
        let url = directory.appendingPathComponent(name, isDirectory: false)
        try data.write(to: url)
        items.append(url)
      }
    } catch {
      try? FileManager.default.removeItem(at: directory)
      callback(["error": "failed", "message": "The files couldn't be written to share: \(error.localizedDescription)"])
      return
    }
    let title = request["title"] as? String
    let text = request["text"] as? String
    let link = (request["url"] as? String).flatMap(URL.init(string:))
    // The title goes with the text, or the link, as its subject (Mail's
    // subject line). Shared on its own, as the Web Share API allows, it's
    // the text.
    if let text {
      items.append(TextSource(text, subject: title))
    } else if link == nil, let title, items.isEmpty {
      items.append(TextSource(title, subject: nil))
    }
    if let link {
      items.append(text == nil ? TextSource(link, subject: title) : link)
    }
    DispatchQueue.main.async {
      self.present(items, directory: directory, callback: callback)
    }
  }

  private func present(
    _ items: [Any], directory: URL, callback: @escaping LynxCallbackBlock
  ) {
    let cleanUp = { try? FileManager.default.removeItem(at: directory) }
    guard !open else {
      cleanUp()
      callback(["error": "failed", "message": "A share sheet is already open."])
      return
    }
    guard let presenter = topViewController() else {
      cleanUp()
      callback(["error": "failed", "message": "There's no screen to open the share sheet over."])
      return
    }
    let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
    // "Save Image" adds to the photo library, which crashes an app whose
    // Info.plist gives no reason for it. The apps `ng build --platform` makes
    // have one; a project ejected before they did leaves the action out
    // rather than crash.
    if Bundle.main.object(forInfoDictionaryKey: "NSPhotoLibraryAddUsageDescription") == nil {
      controller.excludedActivityTypes = [.saveToCameraRoll]
    }
    // On iPad the sheet is a popover, which needs somewhere to point:
    // the middle of the screen, without an arrow, since the tap that opened
    // it was in the LynxView, which UIKit can't see into.
    if let popover = controller.popoverPresentationController, let view = presenter.view {
      popover.sourceView = view
      popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
      popover.permittedArrowDirections = []
    }
    // The callback takes one answer, and UIKit may finish a sheet more than
    // once: iOS 27 logs completing twice as the sheet closes.
    var answered = false
    controller.completionWithItemsHandler = { [weak self, weak controller] activity, completed, _, error in
      if answered { return }
      // From iOS 13, closing an action's own screen without finishing it,
      // such as Save to Files' picker, calls this with the action, while the
      // sheet stays open for another choice. The sheet itself closing calls
      // it without one.
      if !completed, error == nil, activity != nil, controller?.viewIfLoaded?.window != nil {
        return
      }
      answered = true
      self?.open = false
      cleanUp()
      if let error {
        callback(["error": "failed", "message": error.localizedDescription])
      } else {
        callback(["shared": completed])
      }
    }
    open = true
    presenter.present(controller, animated: true)
  }

  /// A file name the file system takes: no folders, and something there.
  private static func safeName(_ name: String?) -> String {
    let base = (name ?? "")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: ":", with: "_")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return base.isEmpty || base == "." || base == ".." ? "file" : base
  }

  /// `photo.jpg`, then `photo 2.jpg`: two files of one name in one share
  /// would otherwise overwrite each other.
  private static func uniqueName(_ name: String, in used: inout Set<String>) -> String {
    var candidate = name
    var number = 2
    let url = URL(fileURLWithPath: name)
    let stem = url.deletingPathExtension().lastPathComponent
    let ext = url.pathExtension
    while used.contains(candidate.lowercased()) {
      candidate = ext.isEmpty ? "\(stem) \(number)" : "\(stem) \(number).\(ext)"
      number += 1
    }
    used.insert(candidate.lowercased())
    return candidate
  }

  /// The view controller on top, which the share sheet opens over.
  private func topViewController() -> UIViewController? {
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)
    var top = window?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }
}

private struct ShareFailure: LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}

/// Text or a link with a subject: UIActivityViewController takes a subject,
/// which Mail uses for its subject line, only from an item source.
private final class TextSource: NSObject, UIActivityItemSource {
  private let item: Any
  private let subject: String?

  init(_ item: Any, subject: String?) {
    self.item = item
    self.subject = subject
  }

  func activityViewControllerPlaceholderItem(_ controller: UIActivityViewController) -> Any {
    item
  }

  func activityViewController(
    _ controller: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?
  ) -> Any? {
    item
  }

  func activityViewController(
    _ controller: UIActivityViewController, subjectForActivityType activityType: UIActivity.ActivityType?
  ) -> String {
    subject ?? ""
  }
}
