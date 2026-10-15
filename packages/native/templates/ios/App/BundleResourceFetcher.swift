import Foundation
import Lynx

/// Serves the app's Lynx bundles and assets from the `LynxBundle` folder that
/// the generator copies `dist/` into, and falls back to the network for
/// anything else (remote images, a dev server).
///
/// One class covers every loader Lynx asks for: the global template provider
/// (`LynxTemplateProvider`), and the per-view template, generic and media
/// fetchers. They all resolve URLs the same way, so a bundle path, a lazy
/// bundle and an image never disagree about where a file lives.
final class BundleResourceFetcher: NSObject, LynxTemplateProvider,
  LynxTemplateResourceFetcher, LynxGenericResourceFetcher, LynxMediaResourceFetcher
{
  static let shared = BundleResourceFetcher()

  /// The folder reference that holds the contents of `dist/`.
  private let root: URL = Bundle.main.resourceURL!.appendingPathComponent(
    "LynxBundle", isDirectory: true)

  /// Maps a URL from the bundle to a file in the app, or nil for remote URLs.
  ///
  /// rspeedy writes asset URLs with the build's `assetPrefix`, which is `/` by
  /// default (`/static/image/logo.png`), so a leading slash means "relative to
  /// dist/", not the device's file system root. `asset:///` is accepted too,
  /// for bundles built with Sparkling's prefix.
  func localFile(for url: String) -> URL? {
    if url.hasPrefix("http://") || url.hasPrefix("https://") || url.hasPrefix("data:") {
      return nil
    }
    if url.hasPrefix("file://"), let fileURL = URL(string: url), fileURL.isFileURL,
      FileManager.default.fileExists(atPath: fileURL.path)
    {
      return fileURL
    }
    var path = url
    for prefix in ["asset:///", "asset://", "file://"] where path.hasPrefix(prefix) {
      path = String(path.dropFirst(prefix.count))
      break
    }
    // Query strings (`main.lynx.bundle?fullscreen=true`) and fragments aren't
    // part of the file name.
    if let end = path.firstIndex(where: { $0 == "?" || $0 == "#" }) {
      path = String(path[..<end])
    }
    path = path.removingPercentEncoding ?? path
    while path.hasPrefix("/") { path.removeFirst() }
    let file = root.appendingPathComponent(path).standardizedFileURL
    // Never serve files outside LynxBundle, whatever the URL says.
    guard file.path.hasPrefix(root.standardizedFileURL.path),
      FileManager.default.fileExists(atPath: file.path)
    else { return nil }
    return file
  }

  private func load(_ url: String, completion: @escaping (Data?, Error?) -> Void) {
    if let file = localFile(for: url) {
      do {
        completion(try Data(contentsOf: file), nil)
      } catch {
        completion(nil, error)
      }
      return
    }
    guard let remote = URL(string: url), remote.scheme != nil else {
      completion(
        nil,
        NSError(
          domain: "AngularLynx", code: 404,
          userInfo: [NSLocalizedDescriptionKey: "\(url) is not in the app bundle"]))
      return
    }
    URLSession.shared.dataTask(with: remote) { data, _, error in
      completion(data, error)
    }.resume()
  }

  // MARK: LynxTemplateProvider

  func loadTemplate(withUrl url: String!, onComplete callback: LynxTemplateLoadBlock!) {
    load(url) { data, error in
      DispatchQueue.main.async { callback(data, error) }
    }
  }

  // MARK: LynxTemplateResourceFetcher

  func fetchTemplate(
    _ request: LynxResourceRequest, onComplete callback: @escaping LynxTemplateResourceCompletionBlock
  ) {
    load(request.url) { data, error in
      DispatchQueue.main.async {
        callback(data.map { LynxTemplateResource(nsData: $0) }, error)
      }
    }
  }

  func fetchSSRData(
    _ request: LynxResourceRequest, onComplete callback: @escaping LynxSSRResourceCompletionBlock
  ) {
    load(request.url) { data, error in callback(data, error) }
  }

  // MARK: LynxGenericResourceFetcher

  func fetchResource(
    _ request: LynxResourceRequest, onComplete callback: @escaping LynxGenericResourceCompletionBlock
  ) -> () -> Void {
    load(request.url) { data, error in callback(data, error) }
    return {}
  }

  func fetchResourcePath(
    _ request: LynxResourceRequest,
    onComplete callback: @escaping LynxGenericResourcePathCompletionBlock
  ) -> () -> Void {
    if let file = localFile(for: request.url) {
      callback(file.path, nil)
    } else {
      callback(
        nil,
        NSError(
          domain: "AngularLynx", code: 404,
          userInfo: [NSLocalizedDescriptionKey: "\(request.url) is not in the app bundle"]))
    }
    return {}
  }

  // MARK: LynxMediaResourceFetcher

  /// Images load through LynxService's SDWebImage service, which reads
  /// `file://` URLs itself, so local images only need their URL rewritten.
  func shouldRedirectUrl(_ request: LynxResourceRequest) -> String {
    localFile(for: request.url)?.absoluteString ?? request.url
  }
}
