import AuthenticationServices
import Lynx
import UIKit

/// `<apple-sign-in-button>`: iOS's own Sign in with Apple button
/// (`ASAuthorizationAppleIDButton`), which draws the logo, the title in the
/// system's language, the colors and the corners as Apple's guidelines ask,
/// so App Review finds it as Apple drew it. The app taps it to call
/// `LynxAppleSignIn.signIn()`: Lynx's `bindtap` reaches the element as on any
/// other, and the button shows its own highlight while it's pressed.
///
/// - `type`: `signIn` ("Sign in with Apple"), `continue` or `signUp`.
/// - `button-style`: `black`, `white` or `whiteOutline`.
/// - `corner-radius`: in points.
///
/// UIKit sets a button's type and style only when it makes it, so a change
/// to either makes a new one, at the end of the update (propsDidUpdate).
///
/// The generator keeps this file only in an app whose angular.json sets
/// `signInWithApple`, with AppleSignInModule, whose `button` method tells
/// the runtime the element is here. XElementRegistry registers it by its
/// Objective-C name only when it is, hence the `@objc` name. Elsewhere the
/// runtime draws the same button itself.
@objc(AngularLynxAppleSignInButton)
final class AppleSignInButton: LynxUI<UIView> {
  private var type: ASAuthorizationAppleIDButton.ButtonType = .signIn
  private var style: ASAuthorizationAppleIDButton.Style = .black
  private var cornerRadius: CGFloat?
  /// The button needs making again: a new element, or a new type or style.
  private var stale = true
  private var button: ASAuthorizationAppleIDButton?

  /// The attributes, as Lynx finds a Swift element's: an Objective-C one
  /// declares them with LYNX_PROP_SETTER.
  @objc static func propSetterLookUp() -> [[String]] {
    [
      ["type", NSStringFromSelector(#selector(setType(_:requestReset:)))],
      ["button-style", NSStringFromSelector(#selector(setButtonStyle(_:requestReset:)))],
      ["corner-radius", NSStringFromSelector(#selector(setCornerRadius(_:requestReset:)))],
    ]
  }

  override func createView() -> UIView? {
    let view = UIView()
    view.clipsToBounds = false
    return view
  }

  /// Lynx passes the value as it is (an `id`), and `NSNull` with
  /// `requestReset` when the attribute is removed.
  @objc func setType(_ value: Any?, requestReset: Bool) {
    let type: ASAuthorizationAppleIDButton.ButtonType
    switch requestReset ? nil : value as? String {
    case "continue": type = .continue
    case "signUp": type = .signUp
    default: type = .signIn
    }
    if type != self.type {
      self.type = type
      stale = true
    }
  }

  @objc func setButtonStyle(_ value: Any?, requestReset: Bool) {
    let style: ASAuthorizationAppleIDButton.Style
    switch requestReset ? nil : value as? String {
    case "white": style = .white
    case "whiteOutline": style = .whiteOutline
    default: style = .black
    }
    if style != self.style {
      self.style = style
      stale = true
    }
  }

  @objc func setCornerRadius(_ value: Any?, requestReset: Bool) {
    let radius = requestReset ? nil : (value as? NSNumber).map { CGFloat($0.doubleValue) }
      ?? (value as? String).flatMap(Double.init).map { CGFloat($0) }
    cornerRadius = radius
    if let radius {
      button?.cornerRadius = radius
    }
  }

  override func propsDidUpdate() {
    super.propsDidUpdate()
    guard stale else { return }
    let container = view()
    stale = false
    button?.removeFromSuperview()
    let button = ASAuthorizationAppleIDButton(authorizationButtonType: type, authorizationButtonStyle: style)
    if let cornerRadius {
      button.cornerRadius = cornerRadius
    }
    button.frame = container.bounds
    // Lynx sizes the container; the button follows it.
    button.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    container.addSubview(button)
    self.button = button
  }
}
