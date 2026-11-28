import UIKit
import UniformTypeIdentifiers

/// The app's Share Extension: what iOS runs when the person picks the app in
/// another app's share sheet. The generator adds it to an app whose
/// angular.json has `shareTarget`, and its Info.plist's activation rule
/// lists the kinds of things `shareTarget.mimeTypes` names.
///
/// An extension is a process of its own, which iOS ends past about 120 MB,
/// so it can't run Lynx or the Angular app. It copies what's shared into
/// the App Group container it shares with the app, under
/// `AngularLynxShares/`, opens the app with the share scheme, and closes: the
/// app's ShareTargetModule hands the share to the runtime's
/// `LynxShareTarget`. Files are copied from the file iOS hands over, never
/// read into memory, so a long video doesn't come near the limit.
///
/// What it shows is minimal: a card saying it's sending to the app while it
/// copies, which most shares never see for long.
final class ShareViewController: UIViewController {
  /// The most bytes of files one share hands the app, all its files
  /// together: 20 MiB, as LynxFilePicker's FILE_PICKER_MAX_BYTES. The app
  /// reads them into memory as base64 to pass them to JavaScript, so a file
  /// that would take it past that is left out.
  private static let maxBytes = 20 * 1024 * 1024

  /// The types `shareTarget.mimeTypes` lists, from the extension's
  /// Info.plist: what's shared is checked against them, since the
  /// activation rule can only name broad kinds, such as "files".
  private let mimeTypes =
    Bundle.main.object(forInfoDictionaryKey: "AngularLynxShareMimeTypes") as? [String] ?? []

  /// The attachments are read on their own queues; their results are put
  /// together on this one.
  private let queue = DispatchQueue(label: "dev.angularlynx.share-extension")

  private var sharedTitle: String?
  private var texts: [String] = []
  private var url: String?
  private var files: [[String: String]] = []
  private var bytes = 0
  private var started = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor.black.withAlphaComponent(0.2)
    let card = UIView()
    card.backgroundColor = .secondarySystemBackground
    card.layer.cornerRadius = 16
    card.translatesAutoresizingMaskIntoConstraints = false
    let spinner = UIActivityIndicatorView(style: .medium)
    spinner.startAnimating()
    let label = UILabel()
    let appName =
      Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "the app"
    label.text = "Sending to \(appName)…"
    label.font = .preferredFont(forTextStyle: .body)
    label.adjustsFontForContentSizeCategory = true
    let stack = UIStackView(arrangedSubviews: [spinner, label])
    stack.axis = .horizontal
    stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(stack)
    view.addSubview(card)
    NSLayoutConstraint.activate([
      card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      card.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -32),
      stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
      stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
      stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !started else { return }
    started = true
    receive()
  }

  // MARK: Reading the share

  private func receive() {
    guard let folder = Self.sharesFolder() else {
      // Without the App Group there's nowhere the app can read: the
      // entitlement is missing, as when the app was signed without it.
      finish(opening: false)
      return
    }
    let id = "\(Self.sortableNow())-\(UUID().uuidString)"
    // Written under a hidden name, then renamed once complete, so the app
    // never takes a share that's half written.
    let pending = folder.appendingPathComponent(".\(id)", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: pending, withIntermediateDirectories: true)
    } catch {
      finish(opening: false)
      return
    }

    let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
    let group = DispatchGroup()
    var hasText = false
    for item in items {
      if sharedTitle == nil, let title = item.attributedTitle?.string, !title.isEmpty {
        sharedTitle = title
      }
      for provider in item.attachments ?? [] {
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
          && !provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
        {
          hasText = true
        }
        read(provider, into: pending, group: group)
      }
    }
    group.notify(queue: queue) {
      // A share sheet that hands over text only as the item's content: a
      // page's title beside its link, as Safari's, or else a selection's
      // text.
      if !hasText {
        for item in items {
          guard let content = item.attributedContentText?.string, !content.isEmpty else { continue }
          if self.url != nil {
            if self.sharedTitle == nil { self.sharedTitle = content }
          } else if self.accepts("text/plain") {
            self.texts.append(content)
          }
        }
      }
      let complete = self.write(pending, as: folder.appendingPathComponent(id, isDirectory: true))
      DispatchQueue.main.async { self.finish(opening: complete) }
    }
  }

  /// Reads one attachment: a web link, text, or a file of an accepted type.
  private func read(_ provider: NSItemProvider, into folder: URL, group: DispatchGroup) {
    let identifiers = provider.registeredTypeIdentifiers
    let isFileURL = provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)

    if !isFileURL, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
      guard accepts("text/uri-list") else { return }
      group.enter()
      provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
        let link = (item as? URL) ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
        self.queue.async {
          if let link, !link.isFileURL {
            // The first link is the share's url, as the Web Share API's
            // ShareData has one; any more go with the text.
            if self.url == nil { self.url = link.absoluteString } else { self.texts.append(link.absoluteString) }
          }
          group.leave()
        }
      }
      return
    }

    if !isFileURL, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
      guard accepts("text/plain") else { return }
      group.enter()
      provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
        let text = (item as? String) ?? (item as? Data).flatMap { String(data: $0, encoding: .utf8) }
        self.queue.async {
          if let text, !text.isEmpty { self.texts.append(text) }
          group.leave()
        }
      }
      return
    }

    // A file: the most specific of its types that's accepted, such as
    // public.jpeg for a photo, so the app gets image/jpeg.
    guard
      let identifier = identifiers.first(where: { identifier in
        guard let type = UTType(identifier), type.conforms(to: .data) else { return false }
        return accepts(type.preferredMIMEType ?? "application/octet-stream")
      })
    else { return }
    let type = UTType(identifier)
    group.enter()
    _ = provider.loadFileRepresentation(forTypeIdentifier: identifier) { file, _ in
      // The file iOS hands over is deleted once this returns, so it's copied
      // before then.
      var copied: [String: String]?
      if let file {
        let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        let name = Self.fileName(file, suggested: provider.suggestedName, type: type)
        let path = "\(UUID().uuidString)-\(name)"
        // Reserved under the queue, so two files can't both take the last
        // of the limit.
        let fits = self.queue.sync { () -> Bool in
          guard self.bytes + size <= Self.maxBytes else { return false }
          self.bytes += size
          return true
        }
        if fits, (try? FileManager.default.copyItem(at: file, to: folder.appendingPathComponent(path))) != nil {
          copied = [
            "path": path,
            "name": name,
            "type": type?.preferredMIMEType ?? "application/octet-stream",
          ]
        } else if fits {
          self.queue.sync { self.bytes -= size }
        }
      }
      self.queue.async {
        if let copied { self.files.append(copied) }
        group.leave()
      }
    }
  }

  /// The name the app sees: the one the sharing app suggests, with the
  /// type's extension when it has none, or the file's own.
  private static func fileName(_ file: URL, suggested: String?, type: UTType?) -> String {
    guard let suggested, !suggested.isEmpty else { return file.lastPathComponent }
    if (suggested as NSString).pathExtension.isEmpty, let ext = type?.preferredFilenameExtension {
      return "\(suggested).\(ext)"
    }
    return suggested
  }

  /// Writes the share's share.json and moves the share where the app looks.
  /// Returns false, leaving nothing behind, when there's nothing to hand
  /// over: nothing shared was of a type the app takes.
  private func write(_ pending: URL, as final: URL) -> Bool {
    var manifest: [String: Any] = ["files": files]
    if let sharedTitle { manifest["title"] = sharedTitle }
    if !texts.isEmpty { manifest["text"] = texts.joined(separator: "\n") }
    if let url { manifest["url"] = url }
    guard files.count > 0 || !texts.isEmpty || url != nil,
      let data = try? JSONSerialization.data(withJSONObject: manifest),
      (try? data.write(to: pending.appendingPathComponent("share.json"))) != nil,
      (try? FileManager.default.moveItem(at: pending, to: final)) != nil
    else {
      try? FileManager.default.removeItem(at: pending)
      return false
    }
    return true
  }

  // MARK: Handing it to the app

  /// Opens the app, which takes the share, and closes the extension.
  private func finish(opening: Bool) {
    if opening, let scheme = Bundle.main.object(forInfoDictionaryKey: "AngularLynxShareScheme") as? String,
      let url = URL(string: "\(scheme)://share")
    {
      openApp(url)
    }
    extensionContext?.completeRequest(returningItems: nil)
  }

  /// A Share Extension has no API to open its app: `extensionContext.open`
  /// works only in widgets, and `UIApplication.shared` isn't available to an
  /// extension. The UIApplication is in the view controller's responder
  /// chain, though, and its `open(_:options:completionHandler:)` opens the
  /// app as a link would, so it's called through the Objective-C runtime.
  /// If that ever stops working, the share still waits in the container, and
  /// the app takes it the next time it comes to the front.
  private func openApp(_ url: URL) {
    let selector = NSSelectorFromString("openURL:options:completionHandler:")
    var responder: UIResponder? = self
    while let current = responder {
      if current is UIApplication, current.responds(to: selector),
        let implementation = current.method(for: selector)
      {
        typealias Open = @convention(c) (
          AnyObject, Selector, NSURL, NSDictionary, AnyObject?
        ) -> Void
        let open = unsafeBitCast(implementation, to: Open.self)
        open(current, selector, url as NSURL, NSDictionary(), nil)
        return
      }
      responder = current.next
    }
  }

  // MARK: Helpers

  /// Whether `shareTarget.mimeTypes` takes `mime`: the type itself, its
  /// `type/*`, or `*/*`.
  private func accepts(_ mime: String) -> Bool {
    let mime = mime.lowercased()
    let major = mime.split(separator: "/").first.map(String.init) ?? ""
    return mimeTypes.contains { accepted in
      accepted == "*/*" || accepted == mime || accepted == "\(major)/*"
    }
  }

  /// The App Group container's share folder (see ShareTargetModule).
  private static func sharesFolder() -> URL? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "AngularLynxShareGroup") as? String,
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return container.appendingPathComponent("AngularLynxShares", isDirectory: true)
  }

  /// Milliseconds since 1970, zero-padded, so the folders sort oldest first.
  private static func sortableNow() -> String {
    String(format: "%015.0f", Date().timeIntervalSince1970 * 1000)
  }
}
