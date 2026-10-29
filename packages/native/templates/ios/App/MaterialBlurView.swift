import Lynx
import UIKit
import XElement

/// XElement's `<blur-view>` with one more attribute, `blur-material`, for
/// UIKit's adaptive blur materials (iOS 13 and later). Lynx's blur-view has
/// only the `blur-effect` styles from before iOS 13 (`light`, `dark` and
/// `extra-light`): one weight, in one appearance. The bars, menus and alerts
/// of iOS 13 to 25 drew on materials in a weight for each role, which follow
/// light and dark mode, here the blur-view's `ios-user-interface-style`. The
/// glass components draw their frosted design, before iOS 26, on them.
///
/// `blur-material` is `ultra-thin`, `thin`, `regular`, `thick` or `chrome`
/// (`systemUltraThinMaterial` to `systemThickMaterial`, and the bars'
/// `systemChromeMaterial`). While it's set, it replaces what `blur-effect` and
/// `blur-radius` draw, with Apple's own blur. A host without this element,
/// such as Lynx Explorer, ignores the attribute and draws the `blur-effect`,
/// so the components set both.
///
/// The material is the view's effect: XElementRegistry registers this class
/// for `blur-view`, and everything else is LynxUIBlurView's.
final class MaterialBlurView: LynxUIBlurView {
  private static let materials: [String: UIBlurEffect.Style] = [
    "ultra-thin": .systemUltraThinMaterial,
    "thin": .systemThinMaterial,
    "regular": .systemMaterial,
    "thick": .systemThickMaterial,
    "chrome": .systemChromeMaterial,
  ]

  /// The attributes this class adds, as Lynx finds a Swift element's: an
  /// Objective-C one declares them with LYNX_PROP_SETTER. Lynx looks for an
  /// attribute here first, then in LynxUIBlurView's.
  @objc static func propSetterLookUp() -> [[String]] {
    [["blur-material", NSStringFromSelector(#selector(setBlurMaterial(_:requestReset:)))]]
  }

  override func createView() -> UIVisualEffectView? {
    // LynxUIBlurView's own sets up its state too. Its view, a plain
    // UIVisualEffectView, is replaced by one that can hold the material.
    _ = super.createView()
    return MaterialEffectView()
  }

  /// Lynx passes the value as it is (an `id`), and `NSNull` with
  /// `requestReset` when the attribute is removed.
  @objc func setBlurMaterial(_ value: Any?, requestReset: Bool) {
    let material = requestReset ? nil : (value as? String).flatMap { Self.materials[$0] }
    (view() as? MaterialEffectView)?.material = material
  }
}

/// A blur-view's view that draws `material` while it's set, and otherwise
/// the effect LynxUIBlurView gives it. LynxUIBlurView sets its effect
/// whenever `blur-effect`, `blur-radius` or the glass attributes change, so
/// the view keeps that effect aside to restore when the material goes.
final class MaterialEffectView: UIVisualEffectView {
  var material: UIBlurEffect.Style? {
    didSet {
      guard material != oldValue else { return }
      // Cleared first, as LynxUIBlurView clears it: UIKit reads a blur
      // effect's settings (Lynx's radius) only when its style changes.
      super.effect = nil
      super.effect = material.map { UIBlurEffect(style: $0) } ?? lynxEffect
    }
  }

  private var lynxEffect: UIVisualEffect?

  override var effect: UIVisualEffect? {
    get { super.effect }
    set {
      lynxEffect = newValue
      if material == nil {
        super.effect = newValue
      }
    }
  }
}
