import ObjectiveC
import QuartzCore

/// Asks iOS to run the app's Core Animation transitions at up to 120 fps on a
/// ProMotion iPhone.
///
/// An element with `enable-new-animator="false"` hands its CSS transitions and
/// `@keyframes` to Core Animation, as `<lynx-stack-outlet>`'s pages and
/// `ui-bottom-sheet` do. Lynx makes those animations without a
/// `preferredFrameRateRange`, and iOS runs an animation that asks for no rate at
/// 60 fps: `CADisableMinimumFrameDurationOnPhone` in Info.plist only lets the
/// app ask for more. On an iPhone 14 Pro a stack push ran at a steady 60 fps
/// while the Home Screen's own animations ran at 120.
///
/// Lynx adds its animations in many places (a transition, a keyframe
/// animation, and their copies on the element's background and border layers),
/// and they all go through `CALayer.add(_:forKey:)`, so the shell asks there,
/// for every animation added in the app: UIKit's in the shell's own views too.
/// With it, the push ran at 120 fps while it moved fast, then slower as it
/// eased to a stop, as the Home Screen's animations do.
///
/// It leaves alone an animation that asks for a rate of its own, and a loop
/// that never ends, such as a spinner or a pulse: nobody follows those with
/// their eye, so they keep the system's rate, and the battery that saves.
enum AnimationFrameRate {
  /// The range Apple's ProMotion guidance gives fast motion: 120 fps, and no
  /// lower than 80.
  static let fastMotion = CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)

  /// The most repeats a finite animation has. Lynx writes CSS's `infinite` as
  /// 10⁹ iterations (half that with `alternate`), and UIKit's loops repeat
  /// forever (`.infinity`), so anything above this is a loop.
  static let loopRepeatCount: Float = 1_000

  /// Whether the shell asks for `fastMotion` on this animation.
  static func asksForFastMotion(_ animation: CAAnimation) -> Bool {
    // The default range, {0, 0, 0}, is an animation that asks for nothing.
    animation.preferredFrameRateRange.maximum == 0
      && animation.repeatCount <= loopRepeatCount
      && animation.repeatDuration.isFinite
  }

  /// Swaps in `CALayer`'s replacement `add(_:forKey:)`. Call it once, before
  /// the first LynxView exists.
  static func install() {
    _ = swapped
  }

  /// A static's initializer runs once, however often `install()` is called:
  /// swapping twice would put CALayer's own method back.
  private static let swapped: Void = {
    guard
      let original = class_getInstanceMethod(
        CALayer.self, #selector(CALayer.add(_:forKey:))),
      let replacement = class_getInstanceMethod(
        CALayer.self, #selector(CALayer.angularLynx_add(_:forKey:)))
    else { return }
    method_exchangeImplementations(original, replacement)
  }()
}

extension CALayer {
  /// Takes the place of `add(_:forKey:)` once `AnimationFrameRate.install()`
  /// has run.
  @objc fileprivate func angularLynx_add(_ animation: CAAnimation, forKey key: String?) {
    // The implementations are swapped, so each `angularLynx_add` call below
    // runs CALayer's own `add(_:forKey:)`.
    guard AnimationFrameRate.asksForFastMotion(animation),
      // Core Animation adds a copy of the animation anyway. The one passed in
      // may be one a layer handed back from `animation(forKey:)`, which mustn't
      // be changed, so the rate goes on a copy of our own.
      let fast = animation.copy() as? CAAnimation
    else {
      angularLynx_add(animation, forKey: key)
      return
    }
    fast.preferredFrameRateRange = AnimationFrameRate.fastMotion
    angularLynx_add(fast, forKey: key)
  }
}
