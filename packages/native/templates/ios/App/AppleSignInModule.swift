import AuthenticationServices
import Lynx
import UIKit

/// The native module behind the runtime's `LynxAppleSignIn`, which calls it as
/// `NativeModules.AngularLynxAppleSignIn` (from the background thread, where
/// NativeModules lives).
///
/// `signIn` opens Sign in with Apple's own sheet
/// (`ASAuthorizationAppleIDProvider`) over the app's key window, the usual
/// way to meet App Review's guideline 4.8 beside other social logins, and
/// calls back once with the credential: the stable user identifier, the identity token
/// and the authorization code the app's server checks with Apple, and the
/// email and name, which Apple gives only on the person's first sign-in.
/// `credentialState` asks Apple whether a user identifier is still signed in,
/// which Apple asks apps to check at launch, `available` says the module
/// is there, and `button` that `<apple-sign-in-button>` is (AppleSignInButton).
///
/// The sheet needs the `com.apple.developer.applesignin` entitlement, which a
/// free Personal Team can't sign, so the generator writes it and keeps this
/// file only in an app whose angular.json sets `signInWithApple`.
/// LynxViewController registers the module by its Objective-C name only when
/// it's there, hence the `@objc` name.
@objc(AngularLynxAppleSignInModule)
final class AppleSignInModule: NSObject, LynxModule, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  static var name: String { "AngularLynxAppleSignIn" }

  static var methodLookup: [String: String] {
    [
      "available": NSStringFromSelector(#selector(available(_:))),
      "signIn": NSStringFromSelector(#selector(signIn(_:callback:))),
      "credentialState": NSStringFromSelector(#selector(credentialState(_:callback:))),
      "button": NSStringFromSelector(#selector(button)),
    ]
  }

  /// The open sign-in and its callback. Held until it ends: the controller's
  /// delegate is weak, and a released controller never calls back.
  private var controller: ASAuthorizationController?
  private var callback: LynxCallbackBlock?

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  /// Calls back `{ available: true }`: the shell supports iOS 15 and later,
  /// all of which have the sheet, so an app with the module can always open
  /// it. Without the module, the runtime's call fails, which it reads as
  /// unavailable.
  @objc func available(_ callback: @escaping LynxCallbackBlock) {
    callback(["available": true])
  }

  /// Returns `{ available: true }`: the shell registers `<apple-sign-in-button>`
  /// (AppleSignInButton) with this module. The runtime calls it from the main
  /// thread, where Angular makes elements, to choose between iOS's button and
  /// the one it draws itself; without the module it gets no answer.
  @objc func button() -> [String: Any] {
    ["available": true]
  }

  /// Opens the sheet with `request`'s `scopes` (`email`, `fullName`), `nonce`
  /// and `state`, and calls back once with the credential, or with
  /// `{ error, message }`, where `error` is `canceled` or `failed`.
  @objc func signIn(_ request: [String: Any], callback: @escaping LynxCallbackBlock) {
    // Lynx calls modules off the main thread, and the sheet is UI.
    DispatchQueue.main.async {
      self.open(request, callback)
    }
  }

  private func open(_ request: [String: Any], _ callback: @escaping LynxCallbackBlock) {
    guard controller == nil else {
      callback(["error": "failed", "message": "A sign-in is already open."])
      return
    }
    let appleIDRequest = ASAuthorizationAppleIDProvider().createRequest()
    let scopes = request["scopes"] as? [String] ?? []
    appleIDRequest.requestedScopes = scopes.compactMap { scope in
      switch scope {
      case "email": return .email
      case "fullName": return .fullName
      default: return nil
      }
    }
    if let nonce = request["nonce"] as? String {
      appleIDRequest.nonce = nonce
    }
    if let state = request["state"] as? String {
      appleIDRequest.state = state
    }
    let controller = ASAuthorizationController(authorizationRequests: [appleIDRequest])
    controller.delegate = self
    controller.presentationContextProvider = self
    self.controller = controller
    self.callback = callback
    controller.performRequests()
  }

  /// Calls back the open sign-in's callback once, and lets the next one open.
  private func finish(_ result: [String: Any]) {
    let callback = self.callback
    controller = nil
    self.callback = nil
    callback?(result)
  }

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
      finish(["error": "failed", "message": "Apple gave no Apple ID credential."])
      return
    }
    var result: [String: Any] = [
      "user": credential.user,
      "realUserStatus": Self.statusName(credential.realUserStatus),
    ]
    // Both are UTF-8 text: the token a JWT, the code a short string. They're
    // missing only when Apple couldn't make them, which the runtime reports.
    if let token = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) }) {
      result["identityToken"] = token
    }
    if let code = credential.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }) {
      result["authorizationCode"] = code
    }
    if let email = credential.email {
      result["email"] = email
    }
    if let state = credential.state {
      result["state"] = state
    }
    // Only on the first sign-in with the fullName scope, and then with only
    // the parts the person filled in.
    if let name = credential.fullName {
      let parts: [String: String?] = [
        "givenName": name.givenName,
        "familyName": name.familyName,
        "middleName": name.middleName,
        "nickname": name.nickname,
        "namePrefix": name.namePrefix,
        "nameSuffix": name.nameSuffix,
      ]
      let given = parts.compactMapValues { $0 }
      if !given.isEmpty {
        result["fullName"] = given
      }
    }
    finish(result)
  }

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithError error: Error
  ) {
    // The person closed the sheet.
    if let error = error as? ASAuthorizationError, error.code == .canceled {
      finish(["error": "canceled", "message": "The sign-in was canceled."])
      return
    }
    // Code 1000 (unknown) covers more than one cause: a phone with no Apple
    // Account, where iOS offers Settings and closing that alert ends the
    // request (AuthKit's -7022 underneath, seen on the Simulator), and an
    // app signed without the entitlement. The code goes in the message so
    // the app's logs can tell them apart from the others.
    finish([
      "error": "failed",
      "message": "Sign in with Apple failed: \(error.localizedDescription) (\((error as NSError).code))",
    ])
  }

  /// The sheet opens over the app's window.
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
  }

  /// Calls back `{ state }` for `user`, an identifier a sign-in returned:
  /// `authorized`, `revoked` (the person stopped using Apple ID with the app),
  /// `notFound` or `transferred` (the app moved to another team), or
  /// `{ error, message }`.
  @objc func credentialState(_ user: String, callback: @escaping LynxCallbackBlock) {
    ASAuthorizationAppleIDProvider().getCredentialState(forUserID: user) { state, error in
      if let error {
        callback(["error": "failed", "message": error.localizedDescription])
        return
      }
      callback(["state": Self.stateName(state)])
    }
  }

  private static func stateName(_ state: ASAuthorizationAppleIDProvider.CredentialState) -> String {
    switch state {
    case .authorized: return "authorized"
    case .revoked: return "revoked"
    case .notFound: return "notFound"
    case .transferred: return "transferred"
    @unknown default: return "notFound"
    }
  }

  private static func statusName(_ status: ASUserDetectionStatus) -> String {
    switch status {
    case .likelyReal: return "likelyReal"
    case .unknown: return "unknown"
    case .unsupported: return "unsupported"
    @unknown default: return "unknown"
    }
  }
}
