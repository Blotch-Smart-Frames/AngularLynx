import Lynx
import UIKit
import XElement

/// XElement's `<blur-view>`, with what the shell adds to it:
///
/// - `blur-material`, for UIKit's adaptive blur materials (iOS 13 and later).
///   Lynx's blur-view has only the `blur-effect` styles from before iOS 13
///   (`light`, `dark` and `extra-light`): one weight, in one appearance. The
///   bars, menus and alerts of iOS 13 to 25 drew on materials in a weight for
///   each role, which follow light and dark mode, here the blur-view's
///   `ios-user-interface-style`. The glass components draw their frosted
///   design, before iOS 26, on them.
/// - Liquid Glass that comes and goes inside a `glass-container` animates, as
///   UIKit's does when the change is animated: it materializes when it's
///   added or shown, dissolves when it's removed or hidden, and eases between
///   effects. Lynx's blur-view sets its effect at once, so glass popped in and
///   out. See GlassTransitions.
/// - `glass-effect-id`, which pairs two glass shapes across a change, as
///   SwiftUI's `glassEffectID` does: when one with an id goes and one with the
///   same id comes in the same update, they're one piece of glass changing
///   shape. A container morphs the first into the second; elsewhere, such as
///   from a button to the menu it opens, the second takes over from the
///   first, with its content fading out.
///
/// `blur-material` is `ultra-thin`, `thin`, `regular`, `thick` or `chrome`
/// (`systemUltraThinMaterial` to `systemThickMaterial`, and the bars'
/// `systemChromeMaterial`). While it's set, it replaces what `blur-effect` and
/// `blur-radius` draw, with Apple's own blur. A host without this element,
/// such as Lynx Explorer, ignores both attributes: it draws the `blur-effect`,
/// so the components set both, and its glass pops in and out as before.
///
/// XElementRegistry registers this class for `blur-view`, and everything else
/// is LynxUIBlurView's.
final class BlurView: LynxUIBlurView {
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
    [
      ["blur-material", NSStringFromSelector(#selector(setBlurMaterial(_:requestReset:)))],
      ["glass-effect-id", NSStringFromSelector(#selector(setGlassEffectId(_:requestReset:)))],
    ]
  }

  override func createView() -> UIVisualEffectView? {
    // LynxUIBlurView's own sets up its state too. Its view, a plain
    // UIVisualEffectView, is replaced by one that can hold the material and
    // tell its transitions apart from Lynx's changes.
    _ = super.createView()
    return BlurEffectView()
  }

  private var effectView: BlurEffectView? { view() as? BlurEffectView }

  /// Lynx passes the value as it is (an `id`), and `NSNull` with
  /// `requestReset` when the attribute is removed.
  @objc func setBlurMaterial(_ value: Any?, requestReset: Bool) {
    let material = requestReset ? nil : (value as? String).flatMap { Self.materials[$0] }
    effectView?.material = material
  }

  @objc func setGlassEffectId(_ value: Any?, requestReset: Bool) {
    effectView?.glassEffectId = requestReset ? nil : value as? String
  }

  /// LynxUIBlurView sets a new effect here when `blur-effect` or a glass
  /// attribute changed: in a container, the change animates.
  override func propsDidUpdate() {
    let drawn = effectView?.lynxEffect
    super.propsDidUpdate()
    if #available(iOS 26.0, *), let effectView, effectView.lynxEffect !== drawn {
      GlassTransitions.shared.effectChanged(effectView, from: drawn)
    }
  }
}

/// A blur-view's view. It draws `material` while one is set, and otherwise
/// the effect LynxUIBlurView gives it. LynxUIBlurView sets its effect
/// whenever `blur-effect`, `blur-radius` or the glass attributes change, so
/// the view keeps that effect aside, to restore when the material goes and to
/// animate the glass to.
final class BlurEffectView: UIVisualEffectView {
  var material: UIBlurEffect.Style? {
    didSet {
      guard material != oldValue else { return }
      // Cleared first, as LynxUIBlurView clears it: UIKit reads a blur
      // effect's settings (Lynx's radius) only when its style changes.
      super.effect = nil
      super.effect = material.map { UIBlurEffect(style: $0) } ?? lynxEffect
    }
  }

  /// The `glass-effect-id` attribute.
  var glassEffectId: String?

  /// The effect Lynx last set, which a transition may not be drawing yet.
  private(set) var lynxEffect: UIVisualEffect?

  override var effect: UIVisualEffect? {
    get { super.effect }
    set {
      lynxEffect = newValue
      if material == nil {
        super.effect = newValue
      }
    }
  }

  /// Draws `effect` while leaving the one Lynx set alone: for a transition,
  /// which starts from nothing or from the effect Lynx just replaced.
  func draw(_ effect: UIVisualEffect?) {
    super.effect = effect
  }

  /// UIKit calls this as Lynx inserts the view, or the element around it, and
  /// as it removes one, while the view is still on screen, and as an overlay
  /// shows or hides with the view in it. LynxUI has a hook of its own, but its
  /// header promises a window that's nil on removal, which Swift can't take.
  override func willMove(toWindow newWindow: UIWindow?) {
    super.willMove(toWindow: newWindow)
    if #available(iOS 26.0, *) {
      GlassTransitions.shared.view(self, willMoveFrom: window, to: newWindow)
    }
  }

  /// Lynx's `visibility`. Hiding takes the glass off screen at once, so the
  /// transition needs to know before, while it can still see it.
  override var isHidden: Bool {
    willSet {
      if #available(iOS 26.0, *), newValue, !isHidden {
        GlassTransitions.shared.viewWillHide(self)
      }
    }
    didSet {
      if #available(iOS 26.0, *), !isHidden, oldValue {
        GlassTransitions.shared.viewDidShow(self)
      }
    }
  }
}
