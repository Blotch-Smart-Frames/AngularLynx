import Foundation
import Lynx

/// Serves the app's Lynx bundles and assets from the `LynxBundle` folder that
/// the generator copies `dist/` into, and falls back to the network for
/// anything else (remote images, an API). The development build that
/// `ng serve --platform ios` runs has no LynxBundle: it loads everything the
/// bundle names from the dev server instead (see DevServer).
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
    if let remote = DevServer.shared.remoteURL(for: url) {
      // Never from URLSession's cache: the server has a new build after
      // every edit, under the same URL.
      let request = URLRequest(url: remote, cachePolicy: .reloadIgnoringLocalCacheData)
      URLSession.shared.dataTask(with: request) { data, response, error in
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let failure =
          error
          ?? (status >= 400
            ? NSError(
              domain: "AngularLynx", code: status,
              userInfo: [NSLocalizedDescriptionKey: "The dev server answered \(status) for \(remote)."])
            : nil)
        DevServer.shared.loaded(url, error: failure)
        completion(failure == nil ? data : nil, failure)
      }.resume()
      return
    }
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
    if let remote = DevServer.shared.remoteURL(for: request.url) {
      // A file the bundle loads by path is on the dev server, so it's
      // downloaded to a file first.
      let task = URLSession.shared.downloadTask(
        with: URLRequest(url: remote, cachePolicy: .reloadIgnoringLocalCacheData)
      ) { location, _, error in
        guard let location else {
          callback(nil, error)
          return
        }
        let file = FileManager.default.temporaryDirectory
          .appendingPathComponent(UUID().uuidString)
          .appendingPathExtension(remote.pathExtension)
        do {
          try FileManager.default.moveItem(at: location, to: file)
          callback(file.path, nil)
        } catch {
          callback(nil, error)
        }
      }
      task.resume()
      return { task.cancel() }
    }
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
    DevServer.shared.remoteURL(for: request.url)?.absoluteString
      ?? localFile(for: request.url)?.absoluteString ?? request.url
  }
}
