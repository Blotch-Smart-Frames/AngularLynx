import Lynx
import UIKit

/// The native module behind the runtime's `LynxHaptics`, which calls it as
/// `NativeModules.AngularLynxHaptics` (from the background thread, where
/// NativeModules lives).
///
/// Each method plays its feedback on the haptic engine and calls back once
/// with `{}`. iOS plays nothing where the person turned System Haptics off,
/// and on a device without a haptic engine.
final class HapticsModule: NSObject, LynxModule {
  static var name: String { "AngularLynxHaptics" }

  static var methodLookup: [String: String] {
    [
      "impact": NSStringFromSelector(#selector(impact(_:callback:))),
      "selection": NSStringFromSelector(#selector(selection(_:))),
      "notification": NSStringFromSelector(#selector(notification(_:callback:))),
    ]
  }

  // The generators, made on first use and kept: a generator that's
  // prepared plays without the haptic engine's warm-up, which matters for
  // a slider ticking through its steps. Only touched on the main thread.
  private var impacts: [UIImpactFeedbackGenerator.FeedbackStyle: UIImpactFeedbackGenerator] = [:]
  private lazy var selectionGenerator = UISelectionFeedbackGenerator()
  private lazy var notificationGenerator = UINotificationFeedbackGenerator()

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  // Lynx calls modules off the main thread, and the generators are UIKit's.
  // Each is prepared again after it plays, so the next feedback in the
  // next few seconds, such as a slider's next step, plays at once.
  @objc func impact(_ style: String, callback: @escaping LynxCallbackBlock) {
    DispatchQueue.main.async {
      let style = Self.impactStyle(style)
      let generator = self.impacts[style] ?? UIImpactFeedbackGenerator(style: style)
      self.impacts[style] = generator
      generator.impactOccurred()
      generator.prepare()
      callback([:])
    }
  }

  @objc func selection(_ callback: @escaping LynxCallbackBlock) {
    DispatchQueue.main.async {
      self.selectionGenerator.selectionChanged()
      self.selectionGenerator.prepare()
      callback([:])
    }
  }

  @objc func notification(_ type: String, callback: @escaping LynxCallbackBlock) {
    DispatchQueue.main.async {
      self.notificationGenerator.notificationOccurred(Self.notificationType(type))
      self.notificationGenerator.prepare()
      callback([:])
    }
  }

  /// The runtime's HapticImpactStyle. A name it doesn't send taps medium,
  /// as the runtime's default does.
  private static func impactStyle(_ name: String) -> UIImpactFeedbackGenerator.FeedbackStyle {
    switch name {
    case "light": return .light
    case "heavy": return .heavy
    case "soft": return .soft
    case "rigid": return .rigid
    default: return .medium
    }
  }

  /// The runtime's HapticNotificationType, success unless it's another.
  private static func notificationType(_ name: String) -> UINotificationFeedbackGenerator.FeedbackType {
    switch name {
    case "warning": return .warning
    case "error": return .error
    default: return .success
    }
  }
}
