import Lynx
import UIKit
import UniformTypeIdentifiers

/// The native module behind the runtime's `LynxFilePicker`, which calls it as
/// `NativeModules.AngularLynxFilePicker` (from the background thread, where
/// NativeModules lives).
///
/// Lynx has no `<input type="file">` and no downloads.
/// UIDocumentPickerViewController stands in for both: it shows the Files
/// app's places (iCloud Drive, On My iPhone, other apps' file providers),
/// runs outside the app and hands over only what the person chose, so the
/// app needs no permission.
///
/// `pick` opens it for the content types asked for, as copies the app owns
/// (`asCopy`), so nothing needs a security-scoped bookmark, and reads them
/// back as base64, since the module's callback and the runtime's relay to
/// the main thread carry only what JSON can. `save` writes the file to a
/// temporary file of its name and exports a copy of it wherever the person
/// chooses.
///
/// The generator leaves this file out of an app whose angular.json doesn't
/// set `filePicker`, and LynxViewController registers the module by its
/// Objective-C name only when it's there, hence the `@objc` name.
@objc(AngularLynxFilePickerModule)
final class FilePickerModule: NSObject, LynxModule, UIDocumentPickerDelegate,
  UIAdaptivePresentationControllerDelegate
{
  static var name: String { "AngularLynxFilePicker" }

  static var methodLookup: [String: String] {
    [
      "pick": NSStringFromSelector(#selector(pick(_:callback:))),
      "save": NSStringFromSelector(#selector(save(_:callback:))),
    ]
  }

  /// The open picker, until it closes: what it's for and who to tell.
  private enum Request {
    case pick(maxBytes: Int, callback: LynxCallbackBlock)
    /// `folder` holds the temporary copy that's exported, deleted after.
    case save(folder: URL, callback: LynxCallbackBlock)
  }
  private var open: Request?

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  /// Opens the picker and calls back once with `{ files: [{ base64, name,
  /// type }] }`, `{ canceled: true }` when the person closes it, or
  /// `{ error: "too-large" | "failed", message }`.
  @objc func pick(_ options: [String: Any], callback: @escaping LynxCallbackBlock) {
    let types = Self.contentTypes(options["types"] as? [String] ?? [])
    let multiple = (options["multiple"] as? NSNumber)?.boolValue ?? false
    let maxBytes = (options["maxBytes"] as? NSNumber)?.intValue ?? Int.max
    // Lynx calls modules off the main thread, and the picker is UI.
    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
      picker.allowsMultipleSelection = multiple
      self.present(picker, .pick(maxBytes: maxBytes, callback: callback))
    }
  }

  /// Writes `{ base64, name }` to a temporary file and lets the person
  /// choose where to export it. Calls back once with `{ saved: true }`,
  /// `{ saved: false }` when they close the picker, or
  /// `{ error: "failed", message }`.
  @objc func save(_ file: [String: Any], callback: @escaping LynxCallbackBlock) {
    guard let base64 = file["base64"] as? String, let data = Data(base64Encoded: base64) else {
      callback(["error": "failed", "message": "The file to save had no bytes."])
      return
    }
    // A folder of its own, so the exported file keeps exactly its name, and
    // two saves of the same name can't overwrite each other.
    let folder = FileManager.default.temporaryDirectory
      .appendingPathComponent("angular-lynx-save", isDirectory: true)
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let url = folder.appendingPathComponent(Self.fileName(file["name"] as? String))
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try data.write(to: url)
    } catch {
      callback(["error": "failed", "message": error.localizedDescription])
      return
    }
    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
      self.present(picker, .save(folder: folder, callback: callback))
    }
  }

  private func present(_ picker: UIDocumentPickerViewController, _ request: Request) {
    guard open == nil else {
      finish(request, ["error": "failed", "message": "A picker is already open."])
      return
    }
    guard let presenter = topViewController() else {
      finish(request, ["error": "failed", "message": "There's no screen to open the picker over."])
      return
    }
    picker.delegate = self
    open = request
    presenter.present(picker, animated: true)
    // Swiping the sheet down closes it without the delegate's cancel call.
    picker.presentationController?.delegate = self
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let request = take() else { return }
    switch request {
    case .save:
      finish(request, ["saved": true])
    case .pick(let maxBytes, let callback):
      // Reading a large file takes a moment: off the main thread.
      DispatchQueue.global(qos: .userInitiated).async {
        callback(Self.read(urls, maxBytes: maxBytes))
        // The copies are the app's, in its temporary folder: once their
        // bytes are on their way, nothing reads them again.
        for url in urls {
          try? FileManager.default.removeItem(at: url)
        }
      }
    }
  }

  // UIKit's British spelling, which the delegate method must match.
  // cspell:disable-next-line
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    closed()
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    closed()
  }

  /// The person closed the picker without choosing.
  private func closed() {
    guard let request = take() else { return }
    switch request {
    case .pick: finish(request, ["canceled": true])
    case .save: finish(request, ["saved": false])
    }
  }

  private func take() -> Request? {
    let request = open
    open = nil
    return request
  }

  /// Calls back, and deletes a save's temporary copy, which the picker has
  /// exported by then.
  private func finish(_ request: Request, _ result: [String: Any]) {
    switch request {
    case .pick(_, let callback):
      callback(result)
    case .save(let folder, let callback):
      try? FileManager.default.removeItem(at: folder)
      callback(result)
    }
  }

  /// The callback's answer for the picked files: their bytes, names and
  /// types, or too-large when they hold more than the runtime can carry,
  /// checked from their sizes before anything is read.
  private static func read(_ urls: [URL], maxBytes: Int) -> [String: Any] {
    let total = urls.reduce(0) { sum, url in
      sum + ((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    }
    if total > maxBytes {
      return ["error": "too-large", "message": "The files picked are too large."]
    }
    var files: [[String: Any]] = []
    for url in urls {
      guard let data = try? Data(contentsOf: url) else {
        return ["error": "failed", "message": "\(url.lastPathComponent) couldn't be read."]
      }
      files.append([
        "base64": data.base64EncodedString(),
        "name": url.lastPathComponent,
        "type": UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
          ?? "application/octet-stream",
      ])
    }
    return ["files": files]
  }

  /// The content types for `LynxFilePicker`'s `types`, which are given as
  /// an `<input type="file">`'s `accept`: MIME types, a family such as
  /// `image/*`, or extensions such as `.docx`. Any file when none is given,
  /// or none is one iOS knows.
  private static func contentTypes(_ types: [String]) -> [UTType] {
    let families: [String: UTType] = [
      "*/*": .item,
      "image/*": .image,
      "audio/*": .audio,
      "video/*": .movie,
      "text/*": .text,
      "application/*": .data,
    ]
    let resolved = types.compactMap { type -> UTType? in
      if type.hasPrefix(".") {
        return UTType(filenameExtension: String(type.dropFirst()))
      }
      if let family = families[type.lowercased()] { return family }
      return UTType(mimeType: type)
    }
    return resolved.isEmpty ? [.item] : resolved
  }

  /// A name a file can have: a slash would make it a path.
  private static func fileName(_ name: String?) -> String {
    let cleaned = (name ?? "").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: ":", with: "_")
    return cleaned.isEmpty ? "file" : cleaned
  }

  /// The view controller on top, which the picker opens over.
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
