import Foundation
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

  /// Swaps in `CALayer`'s replacement `add(_:forKey:)`, and has Lynx's own
  /// animator's rate asked for from the main thread (see `LynxAnimatorFrameRate`).
  /// Call it once, before the first LynxView exists.
  static func install() {
    _ = swapped
    LynxAnimatorFrameRate.install()
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

/// Asks iOS, from the main thread, for the rate Lynx's own animator asks for,
/// while that animator runs.
///
/// Lynx works out each frame of an element's CSS transitions and `animate()`
/// itself (every element without `enable-new-animator="false"`), from a
/// `CADisplayLink` in its `LynxVSyncPulse`. The build's `preferredFps: 'high'`
/// has Lynx ask that link for up to 120 fps. But the link is made on the thread
/// that first asks it for a frame, and the shell runs Lynx's engine off the
/// main thread (`MostOnTASM`), so it lives on the engine thread, and iOS doesn't
/// raise the display's rate for a display link there. On an iPhone 14 Pro a
/// transition on Lynx's animator drew a frame every 16.7 ms while the same one
/// in Core Animation drew one every 8.3 ms. With a display link on the main
/// thread asking for the same range, it drew one every 8.3 ms too: the engine
/// already ticked that fast, and only the display held it back.
///
/// So the shell swaps in its own `requestPulse`, which Lynx calls on the engine
/// thread for each frame it wants, and while those frames come from a link that
/// asks for more than 60 fps, a display link on the main thread asks for the
/// same range. It pauses once Lynx has asked for no frame for a few frames, so
/// a screen with nothing moving keeps the system's rate. A `preferredFps` of
/// `'auto'` or `'low'` leaves Lynx's link asking for nothing, so nothing is
/// asked for here either.
final class LynxAnimatorFrameRate: NSObject {
  static let shared = LynxAnimatorFrameRate()

  /// How long the main thread keeps asking after Lynx's last frame request: a
  /// few frames, so a frame Angular's work delays doesn't drop the rate between
  /// two of an animation's frames.
  static let linger: CFTimeInterval = 0.1

  /// The highest rate a display link asks for before the main thread asks too:
  /// what an app gets without asking.
  static let defaultMaximum: Float = 60

  /// Guards what both threads read: the engine thread writes the request, the
  /// main thread reads it on its own frames.
  private let lock = NSLock()
  private var lastRequest: CFTimeInterval = 0
  private var range = CAFrameRateRange.default
  /// Whether the main thread's link runs, or is about to.
  private var asking = false
  /// The main thread's link. Only the main thread touches it.
  private var link: CADisplayLink?

  /// Swaps `LynxVSyncPulse`'s `requestPulse` for one that also asks from the
  /// main thread. Does nothing if Lynx no longer has that class or method.
  static func install() {
    _ = swapped
  }

  private static let swapped: Void = {
    let selector = NSSelectorFromString("requestPulse")
    let replacementSelector = #selector(NSObject.angularLynx_requestPulse)
    guard
      let pulse = NSClassFromString("LynxVSyncPulse"),
      let original = class_getInstanceMethod(pulse, selector),
      let replacement = class_getInstanceMethod(NSObject.self, replacementSelector),
      // Added to LynxVSyncPulse itself, so the swap changes only its methods,
      // not NSObject's.
      class_addMethod(
        pulse, replacementSelector, method_getImplementation(replacement),
        method_getTypeEncoding(replacement)),
      let added = class_getInstanceMethod(pulse, replacementSelector)
    else { return }
    method_exchangeImplementations(original, added)
  }()

  /// Whether a link's range asks for more than an app gets by default.
  static func asksForHighRate(_ range: CAFrameRateRange) -> Bool {
    max(range.maximum, range.preferred ?? 0) > defaultMaximum
  }

  /// Called on the engine thread for each frame Lynx asks its link for.
  func lynxRequestedFrame(_ range: CAFrameRateRange) {
    lock.lock()
    lastRequest = CACurrentMediaTime()
    self.range = range
    let start = !asking
    asking = true
    lock.unlock()
    if start {
      DispatchQueue.main.async { self.resume() }
    }
  }

  private func resume() {
    let link: CADisplayLink
    if let existing = self.link {
      link = existing
    } else {
      link = CADisplayLink(target: self, selector: #selector(tick(_:)))
      link.add(to: .main, forMode: .common)
      self.link = link
    }
    lock.lock()
    let range = self.range
    lock.unlock()
    link.preferredFrameRateRange = range
    link.isPaused = false
  }

  @objc private func tick(_ link: CADisplayLink) {
    lock.lock()
    let idle = link.timestamp - lastRequest > Self.linger
    if idle {
      // A request after this unlock finds `asking` false and resumes the link
      // on a later turn of the main thread, after this pause.
      asking = false
    }
    lock.unlock()
    if idle {
      link.isPaused = true
    }
  }
}

extension NSObject {
  /// Takes the place of `LynxVSyncPulse`'s `requestPulse` once
  /// `LynxAnimatorFrameRate.install()` has run, so `self` is a `LynxVSyncPulse`.
  @objc fileprivate func angularLynx_requestPulse() {
    // The implementations are swapped, so this runs Lynx's own requestPulse.
    angularLynx_requestPulse()
    let getter = NSSelectorFromString("displayLink")
    guard responds(to: getter),
      let link = perform(getter)?.takeUnretainedValue() as? CADisplayLink,
      LynxAnimatorFrameRate.asksForHighRate(link.preferredFrameRateRange)
    else { return }
    LynxAnimatorFrameRate.shared.lynxRequestedFrame(link.preferredFrameRateRange)
  }
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
