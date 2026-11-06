import Lynx
import UIKit

/// Hosts the app's single LynxView. Angular Router does all navigation inside
/// it, so the shell never pushes another view controller.
final class LynxViewController: UIViewController {
  private var lynxView: LynxView?
  private var lastViewport: CGRect = .zero

  /// Whether the page fills the screen, under the status bar and the home
  /// indicator: angular.json's `edgeToEdge`, which the generator writes into
  /// Info.plist. A project generated before the option existed has no key,
  /// and gets the default.
  private let edgeToEdge =
    Bundle.main.object(forInfoDictionaryKey: "AngularLynxEdgeToEdge") as? Bool ?? true

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(named: "LaunchBackground") ?? .systemBackground

    let fetcher = BundleResourceFetcher.shared
    let screenSize = UIScreen.main.bounds.size
    // The shell's native modules, which the runtime's services call.
    let config = LynxConfig(provider: LynxEnv.sharedInstance().config.templateProvider)
    config.register(WebAuthModule.self)
    config.register(LocalStorageModule.self)
    config.register(SecureStorageModule.self)
    // LynxClipboard's text (ClipboardModule).
    config.register(ClipboardModule.self)
    config.register(LinkingModule.self)
    // The photo picker behind LynxImagePicker (ImagePickerModule).
    config.register(ImagePickerModule.self)
    // <canvas>'s WebGL (AngularLynxWebGL.h), which the runtime calls from
    // the main thread. It's Objective-C, which Swift reaches without a
    // bridging header by name.
    if let webGL = NSClassFromString("AngularLynxWebGLModule") as? LynxModule.Type {
      config.register(webGL)
    }
    // Bundled files for the main thread's fetch and Image (AssetsModule).
    config.register(AssetsModule.self)
    let lynxView = LynxView { builder in
      builder.config = config
      // Lets main-thread code, where Angular runs, call the config's modules
      // with lynx.module(name): WebGL needs answers synchronously.
      builder.enableMTSModule = true
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

  /// The insets change once the view is in its window (they're 0 in
  /// viewDidLoad, when the first global props go), and again on rotation.
  /// An edge-to-edge LynxView keeps its frame when only they change, so
  /// layoutLynxView wouldn't send them.
  override func viewSafeAreaInsetsDidChange() {
    super.viewSafeAreaInsetsDidChange()
    lynxView?.updateGlobalProps(with: globalProps())
  }

  /// Lays the LynxView out over the whole screen, so the page draws under
  /// the status bar and the home indicator, as Safari does for a page with
  /// `viewport-fit=cover`, and pads itself with CSS env(safe-area-inset-*).
  /// With `"edgeToEdge": false` in angular.json, it sits inside the safe area
  /// instead, and nothing draws under the notch or the home indicator.
  ///
  /// Lynx's own env(safe-area-inset-*) stays 0 here: Lynx reads it from the
  /// key window when a LynxView is created, and viewDidLoad runs before
  /// SceneDelegate makes the window key. It couldn't follow a rotation
  /// anyway, as an element reads env() once. The runtime gives every
  /// env(safe-area-inset-*) the safeArea* global props below instead, as CSS
  /// variables on the page that restyle what reads them when they change, and
  /// 0 when the LynxView is inside the safe area (see `edgeToEdge` there).
  private func layoutLynxView() {
    guard let lynxView else { return }
    let frame = edgeToEdge ? view.bounds : view.bounds.inset(by: view.safeAreaInsets)
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
  /// (LynxSafeArea), `appLocale` (LynxLocale), `appTimeZone` (the `intl`
  /// build option's Intl.DateTimeFormat), the accessibility settings
  /// (LynxAccessibilitySettings) and `osVersion` (LynxSystemInfo), plus the
  /// safe-area insets and `edgeToEdge`, which env(safe-area-inset-*) reads.
  /// The Android shell sends the same keys, and Lynx Explorer sends theme and
  /// isNotchScreen too.
  private func globalProps() -> LynxTemplateData {
    let insets = view.safeAreaInsets
    var props: [String: Any] = [
      "platform": "ios",
      // Whether the page fills the screen. The runtime gives env() the insets
      // below only then; otherwise the page is already inside them.
      "edgeToEdge": edgeToEdge,
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
    // The time zone's IANA name, such as "Europe/London". The `intl` build
    // option's Intl.DateTimeFormat formats in the device's zone by default,
    // which it reads from the engine's local time, and names it with this.
    props["appTimeZone"] = TimeZone.current.identifier
    // Without useBoolLiterals, Lynx turns a Bool into 1 or 0.
    return LynxTemplateData(dictionary: props, useBoolLiterals: true)
  }
}
