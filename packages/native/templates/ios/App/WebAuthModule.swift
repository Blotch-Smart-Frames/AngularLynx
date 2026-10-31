import AuthenticationServices
import Lynx
import UIKit

/// The native module behind the runtime's `LynxWebAuthSession`, which calls it
/// as `NativeModules.AngularLynxWebAuth` (from the background thread, where
/// NativeModules lives).
///
/// Lynx has no popups or redirects, so a sign-in page can't run inside the
/// app. ASWebAuthenticationSession opens it in Safari's sign-in sheet instead,
/// asking the person first, and ends when the page redirects to the callback
/// scheme. The scheme needn't be registered in Info.plist: the session catches
/// the redirect itself, so no other app can.
final class WebAuthModule: NSObject, LynxModule, ASWebAuthenticationPresentationContextProviding {
  static var name: String { "AngularLynxWebAuth" }

  static var methodLookup: [String: String] {
    ["start": NSStringFromSelector(#selector(start(_:callback:)))]
  }

  /// The open session. Held until it ends: ASWebAuthenticationSession closes
  /// its sheet when released.
  private var session: ASWebAuthenticationSession?

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  /// Opens `request.url` and calls back once with `{ url }`, the URL the page
  /// redirected to, or `{ error, message }`, where `error` is `canceled` or
  /// `failed`.
  @objc func start(_ request: [String: Any], callback: @escaping LynxCallbackBlock) {
    // Lynx calls modules off the main thread, and the session presents UI.
    DispatchQueue.main.async {
      self.open(request, callback)
    }
  }

  private func open(_ request: [String: Any], _ callback: @escaping LynxCallbackBlock) {
    let fail = { (message: String) in callback(["error": "failed", "message": message]) }
    guard session == nil else {
      fail("A sign-in is already open.")
      return
    }
    guard let address = request["url"] as? String, let url = URL(string: address),
      let scheme = request["callbackScheme"] as? String, !scheme.isEmpty
    else {
      fail("The sign-in needs a URL and a callback scheme.")
      return
    }

    let completion: ASWebAuthenticationSession.CompletionHandler = { [weak self] url, error in
      self?.session = nil
      if let url {
        callback(["url": url.absoluteString])
      } else if let error = error as? ASWebAuthenticationSessionError,
        error.code == .canceledLogin
      {
        callback(["error": "canceled", "message": "The sign-in was canceled."])
      } else {
        fail(error?.localizedDescription ?? "The sign-in page could not be opened.")
      }
    }
    let session: ASWebAuthenticationSession
    if #available(iOS 17.4, *) {
      session = ASWebAuthenticationSession(
        url: url, callback: .customScheme(scheme), completionHandler: completion)
    } else {
      session = ASWebAuthenticationSession(
        url: url, callbackURLScheme: scheme, completionHandler: completion)
    }
    session.presentationContextProvider = self
    session.prefersEphemeralWebBrowserSession = (request["ephemeral"] as? Bool) ?? false
    self.session = session
    if !session.start() {
      self.session = nil
      fail("The sign-in page could not be opened.")
    }
  }

  /// The sheet opens over the app's window.
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
  }
}
