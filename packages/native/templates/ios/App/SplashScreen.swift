import UIKit

/// Keeps the launch screen up until the app's first screen is ready.
///
/// iOS takes the launch screen down as soon as the app draws its first
/// frame, which is the empty LynxView: the bundle hasn't run yet, and the
/// app's first screen may have work to finish first, such as a lazy route or
/// a guard. So the shell puts a copy of the launch screen over the LynxView
/// (UILaunchScreen's color and image, from the asset catalog, laid out as iOS
/// lays them out), and fades it out when the runtime says the screen under
/// it is drawn: `ShellModule.hideSplashScreen`, which the runtime's
/// LynxSplashScreen calls after the first frame Angular commits, or when the
/// app's `provideSplashScreen()` says.
///
/// A host the runtime can't reach never asks, so the copy also goes after
/// `timeout`, rather than leave the app behind its logo.
final class SplashScreen {
  static let shared = SplashScreen()

  /// The longest the copy stays up: enough for a slow first screen, short
  /// enough that one that never settles doesn't look like a hung app.
  static let timeout: TimeInterval = 5
  /// The fade, as long as UIKit's own transitions.
  private static let fadeDuration: TimeInterval = 0.25

  private weak var overlay: UIView?

  private init() {}

  /// Puts the copy over everything in `view`, now and until it's hidden.
  func show(over view: UIView) {
    let overlay = UIView(frame: view.bounds)
    overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    // The same names Info.plist's UILaunchScreen reads, so the two match.
    // Both follow dark mode, as the launch screen does.
    overlay.backgroundColor = UIColor(named: "LaunchBackground") ?? .systemBackground
    // An app without angular.json's splash.image has none: the color alone.
    if let image = UIImage(named: "LaunchImage") {
      let imageView = UIImageView(image: image)
      // At its natural size, centered on the whole screen, as the launch
      // screen draws it (UIImageRespectsSafeAreaInsets is false).
      imageView.center = CGPoint(x: overlay.bounds.midX, y: overlay.bounds.midY)
      imageView.autoresizingMask = [
        .flexibleLeftMargin, .flexibleRightMargin, .flexibleTopMargin, .flexibleBottomMargin,
      ]
      overlay.addSubview(imageView)
    }
    // VoiceOver has nothing to read until the app is there.
    overlay.isAccessibilityElement = false
    view.addSubview(overlay)
    self.overlay = overlay

    DispatchQueue.main.asyncAfter(deadline: .now() + Self.timeout) { [weak self] in
      self?.hide()
    }
  }

  /// Fades the copy out. Main thread only. Once it's gone, does nothing: the
  /// development build loads the app again on every edit, and each load
  /// asks.
  func hide() {
    guard let overlay else { return }
    self.overlay = nil
    // Reduce Motion keeps the fade, as UIKit's cross-dissolves do: it moves
    // nothing.
    UIView.animate(
      withDuration: Self.fadeDuration, delay: 0, options: [.curveEaseOut],
      animations: { overlay.alpha = 0 },
      completion: { _ in overlay.removeFromSuperview() })
  }
}
