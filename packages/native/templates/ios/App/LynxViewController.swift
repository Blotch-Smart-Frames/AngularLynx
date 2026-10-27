import Lynx
import UIKit

/// Hosts the app's single LynxView. Angular Router does all navigation inside
/// it, so the shell never pushes another view controller.
final class LynxViewController: UIViewController {
  private var lynxView: LynxView?
  private var lastViewport: CGRect = .zero

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(named: "LaunchBackground") ?? .systemBackground

    let fetcher = BundleResourceFetcher.shared
    let screenSize = UIScreen.main.bounds.size
    let lynxView = LynxView { builder in
      builder.config = LynxConfig(provider: LynxEnv.sharedInstance().config.templateProvider)
      builder.screenSize = screenSize
      builder.fontScale = 1.0
      builder.enableGenericResourceFetcher = .true
      builder.genericResourceFetcher = fetcher
      builder.templateResourceFetcher = fetcher
      builder.mediaResourceFetcher = fetcher
    }
    lynxView.layoutWidthMode = .exact
    lynxView.layoutHeightMode = .exact
    view.addSubview(lynxView)
    self.lynxView = lynxView

    layoutLynxView()
    lynxView.updateGlobalProps(with: globalProps())
    lynxView.loadTemplate(fromURL: "main.lynx.bundle", initData: nil)

    // Send the new theme when the phone switches between light and dark
    // while the app is open. Before iOS 17, traitCollectionDidChange does.
    if #available(iOS 17.0, *) {
      registerForTraitChanges([UITraitUserInterfaceStyle.self]) {
        (controller: LynxViewController, _: UITraitCollection) in
        controller.lynxView?.updateGlobalProps(with: controller.globalProps())
      }
    }

    // Send the accessibility settings again when the user changes one while
    // the app is open, so the components adapt at once.
    for name in [
      UIAccessibility.reduceMotionStatusDidChangeNotification,
      UIAccessibility.reduceTransparencyStatusDidChangeNotification,
      UIAccessibility.darkerSystemColorsStatusDidChangeNotification,
    ] {
      NotificationCenter.default.addObserver(
        self, selector: #selector(accessibilitySettingsDidChange), name: name, object: nil)
    }
  }

  @objc private func accessibilitySettingsDidChange() {
    lynxView?.updateGlobalProps(with: globalProps())
  }

  @available(iOS, deprecated: 17.0, message: "registerForTraitChanges in viewDidLoad replaces it")
  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if #unavailable(iOS 17.0),
      traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection)
    {
      lynxView?.updateGlobalProps(with: globalProps())
    }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    layoutLynxView()
  }

  /// Keeps the LynxView inside the safe area, so a freshly generated app
  /// doesn't draw under the notch or the home indicator. The insets are also
  /// passed as global props for apps that want to know them.
  ///
  /// CSS env(safe-area-inset-*) is 0 on every side, which is right for a page
  /// that's already inside the safe area, and matches Android, where Lynx
  /// never sets it. Lynx reads it from the key window when a LynxView is
  /// created, and viewDidLoad runs before SceneDelegate makes the window key.
  /// Creating the LynxView later would make env() add the insets a second time.
  private func layoutLynxView() {
    guard let lynxView else { return }
    let frame = view.bounds.inset(by: view.safeAreaInsets)
    guard frame != lastViewport else { return }
    lastViewport = frame
    lynxView.frame = frame
    lynxView.preferredLayoutWidth = frame.width
    lynxView.preferredLayoutHeight = frame.height
    lynxView.updateViewport(
      withPreferredLayoutWidth: frame.width, preferredLayoutHeight: frame.height)
    lynxView.updateGlobalProps(with: globalProps())
    lynxView.triggerLayout()
  }

  /// The global props the runtime reads: `theme` (LynxTheme), `isNotchScreen`
  /// (LynxSafeArea), `appLocale` (LynxLocale), the accessibility settings
  /// (LynxAccessibilitySettings) and `osVersion` (LynxSystemInfo), plus the
  /// safe-area insets. The Android shell sends the same keys, and Lynx
  /// Explorer sends theme and isNotchScreen too.
  private func globalProps() -> LynxTemplateData {
    let insets = view.safeAreaInsets
    var props: [String: Any] = [
      "platform": "ios",
      "safeAreaTop": insets.top,
      "safeAreaBottom": insets.bottom,
      "safeAreaLeft": insets.left,
      "safeAreaRight": insets.right,
      // Lynx Explorer's test: anything beyond a plain 20pt status bar, as on
      // iPhones with a notch or Dynamic Island.
      "isNotchScreen": insets.top > 20 || insets.bottom > 0 || insets.left > 0
        || insets.right > 0,
      "theme": traitCollection.userInterfaceStyle == .dark ? "Dark" : "Light",
      // Lynx has no API for these. The glass components adapt what they draw
      // to them, and follow Reduce Motion in their own animations.
      "reduceMotion": UIAccessibility.isReduceMotionEnabled,
      "reduceTransparency": UIAccessibility.isReduceTransparencyEnabled,
      // Increase Contrast.
      "increaseContrast": UIAccessibility.isDarkerSystemColorsEnabled,
      // Lynx builds the main thread's SystemInfo, where Angular runs, without
      // the OS version, so LynxSystemInfo reads it from here. The glass
      // components need it: blur-view draws Liquid Glass only from iOS 26.
      "osVersion": UIDevice.current.systemVersion,
    ]
    // The user's first language as a BCP 47 tag, such as "fr-FR". iOS
    // restarts the app when the language changes, so there's no update to send.
    if let language = Locale.preferredLanguages.first {
      props["appLocale"] = language
    }
    // Without useBoolLiterals, Lynx turns a Bool into 1 or 0.
    return LynxTemplateData(dictionary: props, useBoolLiterals: true)
  }
}
