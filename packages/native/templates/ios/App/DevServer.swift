import Foundation
import Lynx
import UIKit

/// `ng serve --platform ios`: the development app loads its bundle from the
/// dev server rather than from the copy in LynxBundle (which it doesn't
/// have), and reloads it on every edit, as Lynx Explorer does.
///
/// Only the Debug configuration, which `ng serve --platform ios` builds,
/// compiles any of it in. A Release build (`ng build --platform ios`, the App
/// Store's) gets the stubs at the bottom, so nothing can point it at another
/// server: its bundle is always the one inside it.
///
/// The builder opens the app with the bundle's URL as a launch argument,
/// `-AngularLynxDevServer <url>`, which iOS puts in UserDefaults' argument
/// domain. It's kept, so opening the app from the home screen later loads
/// from the same server.
final class DevServer {
  static let shared = DevServer()

  #if DEBUG
    private static let argument = "AngularLynxDevServer"
    private static let lastServerKey = "AngularLynxDevServerLast"

    /// The bundle on the dev server, e.g. `http://192.168.1.20:3000/main.lynx.bundle`.
    private let bundle: URL?

    /// The folder it's in, which every relative URL the bundle asks for
    /// resolves against: lazy bundles, images, files it fetches.
    private let base: URL?

    /// Reloads the LynxView, which LynxViewController sets.
    private var reload: (() -> Void)?

    /// Tells the person the dev server can't be reached, over the page.
    private var status: UILabel?
    private var statusScreen: UIView?
    private var retry: DispatchWorkItem?

    private init() {
      let defaults = UserDefaults.standard
      let launched = defaults.volatileDomain(forName: UserDefaults.argumentDomain)[
        Self.argument] as? String
      if let launched {
        defaults.set(launched, forKey: Self.lastServerKey)
      }
      bundle = (launched ?? defaults.string(forKey: Self.lastServerKey)).flatMap(URL.init(string:))
      base = bundle?.deletingLastPathComponent()
    }
  #endif

  /// The URL the LynxView loads: the dev server's bundle in a development
  /// build, else the one inside the app.
  var templateURL: String {
    #if DEBUG
      return bundle?.absoluteString ?? "main.lynx.bundle"
    #else
      return "main.lynx.bundle"
    #endif
  }

  /// Where a URL the bundle asks for is on the dev server, or nil when the
  /// app isn't loading from one, or the URL is somewhere else (an API, a
  /// CDN, a data: URL, a file the app wrote).
  ///
  /// rspeedy builds a development bundle with the server's address in its
  /// asset URLs, so most arrive absolute already; anything relative is
  /// relative to the server, as it would be to LynxBundle in a release build.
  func remoteURL(for url: String) -> URL? {
    #if DEBUG
      guard let base else { return nil }
      if url.hasPrefix(base.absoluteString) {
        return URL(string: url)
      }
      if url.hasPrefix("http://") || url.hasPrefix("https://") || url.hasPrefix("data:")
        || url.hasPrefix("file://")
      {
        return nil
      }
      var path = url
      for prefix in ["asset:///", "asset://"] where path.hasPrefix(prefix) {
        path = String(path.dropFirst(prefix.count))
        break
      }
      while path.hasPrefix("./") { path.removeFirst(2) }
      while path.hasPrefix("/") { path.removeFirst() }
      return URL(string: path, relativeTo: base)?.absoluteURL
    #else
      return nil
    #endif
  }

  /// Adds the dev server's modules to the LynxView's config: the WebSocket
  /// that rspeedy's live reload listens on, and the reload it asks for.
  func register(in config: LynxConfig) {
    #if DEBUG
      guard bundle != nil else { return }
      config.register(DevWebSocketModule.self)
      config.register(DevReloadModule.self)
    #endif
  }

  /// Gives the dev server the view to show its status over and the
  /// LynxView's reload.
  func attach(to view: UIView, reload: @escaping () -> Void) {
    #if DEBUG
      self.reload = reload
      // A screen over the page, with the message in the middle.
      let screen = UIView()
      screen.backgroundColor = .systemBackground
      screen.isHidden = true
      screen.translatesAutoresizingMaskIntoConstraints = false
      let label = UILabel()
      label.numberOfLines = 0
      label.textAlignment = .center
      label.font = .preferredFont(forTextStyle: .body)
      label.textColor = .label
      label.translatesAutoresizingMaskIntoConstraints = false
      screen.addSubview(label)
      view.addSubview(screen)
      NSLayoutConstraint.activate([
        screen.leadingAnchor.constraint(equalTo: view.leadingAnchor),
        screen.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        screen.topAnchor.constraint(equalTo: view.topAnchor),
        screen.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        label.leadingAnchor.constraint(equalTo: screen.layoutMarginsGuide.leadingAnchor, constant: 8),
        label.trailingAnchor.constraint(equalTo: screen.layoutMarginsGuide.trailingAnchor, constant: -8),
        label.centerYAnchor.constraint(equalTo: screen.centerYAnchor),
      ])
      status = label
      statusScreen = screen
      if bundle == nil {
        show(
          "This is the development build of the app, which loads the app from `ng serve`.\n\nRun `ng serve --platform ios` to open it."
        )
      }
    #endif
  }

  /// Reloads the bundle from the dev server, from any thread.
  func reloadBundle() {
    #if DEBUG
      DispatchQueue.main.async { self.reload?() }
    #endif
  }

  /// Called with the outcome of each load. When the bundle itself didn't
  /// load (the server is stopped, or on another network), the app says so
  /// rather than show nothing, and tries again every two seconds.
  func loaded(_ url: String, error: Error?) {
    #if DEBUG
      guard let bundle, url == bundle.absoluteString else { return }
      DispatchQueue.main.async {
        self.retry?.cancel()
        guard let error else {
          self.statusScreen?.isHidden = true
          return
        }
        self.show(
          "Can't reach the dev server at \(bundle.host ?? "")\(bundle.port.map { ":\($0)" } ?? "").\n\n\(error.localizedDescription)\n\nIs `ng serve --platform ios` running, and is this device on the same network?\(Self.localNetworkHint) Trying again…"
        )
        let retry = DispatchWorkItem { [weak self] in self?.reload?() }
        self.retry = retry
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: retry)
      }
    #endif
  }

  #if DEBUG
    /// On an iPhone, iOS blocks the dev server until the person allows the
    /// app on the local network, which it asks about the first time. Tapping
    /// Don't Allow leaves the app failing like this, with nothing to say why,
    /// so it says where to turn it back on. The simulator never asks.
    private static var localNetworkHint: String {
      #if targetEnvironment(simulator)
        return ""
      #else
        return
          " If you tapped Don't Allow when iOS asked to find devices on your local network, turn on this app in Settings > Privacy & Security > Local Network."
      #endif
    }

    private func show(_ message: String) {
      guard let status, let statusScreen else { return }
      status.text = message
      statusScreen.isHidden = false
      statusScreen.superview?.bringSubviewToFront(statusScreen)
    }
  #endif
}
