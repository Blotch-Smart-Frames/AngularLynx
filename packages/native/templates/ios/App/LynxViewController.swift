import Lynx
import UIKit

/// Hosts the app's single LynxView. Angular Router does all navigation inside
/// it, so the shell never pushes another view controller.
final class LynxViewController: UIViewController, LynxViewLifecycle {
  private var lynxView: LynxView?
  /// The font scale the LynxView was built with, which Lynx gives each engine
  /// it sets up (see lynxView(_:didLoadFinishedWithUrl:)).
  private var builtFontScale: CGFloat = 1
  private var lastViewport: CGRect = .zero

  /// Whether the page fills the screen, under the status bar and the home
  /// indicator: angular.json's `edgeToEdge`, which the generator writes into
  /// Info.plist. A project generated before the option existed has no key,
  /// and gets the default.
  private let edgeToEdge =
    Bundle.main.object(forInfoDictionaryKey: "AngularLynxEdgeToEdge") as? Bool ?? true

  /// Whether the app's text follows Dynamic Type, and the largest scale it
  /// takes: angular.json's `textScaling`, which the generator writes into
  /// Info.plist. A project generated before the option existed follows it,
  /// without a cap.
  private let textScaling =
    Bundle.main.object(forInfoDictionaryKey: "AngularLynxTextScaling") as? Bool ?? true
  private let maxTextScale =
    (Bundle.main.object(forInfoDictionaryKey: "AngularLynxMaxTextScale") as? NSNumber)?.doubleValue

  override func viewDidLoad() {
    super.viewDidLoad()
    // The launch screen's color (angular.json's splash.backgroundColor),
    // behind the LynxView, so no other color shows between the two.
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
    // LynxHaptics' taps (HapticsModule).
    config.register(HapticsModule.self)
    config.register(LinkingModule.self)
    // The photo picker behind LynxImagePicker (ImagePickerModule).
    config.register(ImagePickerModule.self)
    // The share sheet behind LynxShare (ShareModule).
    config.register(ShareModule.self)
    // <canvas>'s WebGL (AngularLynxWebGL.h), which the runtime calls from
    // the main thread. It's Objective-C, which Swift reaches without a
    // bridging header by name.
    if let webGL = NSClassFromString("AngularLynxWebGLModule") as? LynxModule.Type {
      config.register(webGL)
    }
    // Bundled files for the main thread's fetch and Image (AssetsModule).
    config.register(AssetsModule.self)
    // The full collections the runtime asks for after screens go
    // (ShellModule).
    config.register(ShellModule.self)
    // The shortcuts the person runs from Siri, Spotlight or the Shortcuts
    // app, which LynxShortcuts takes (ShortcutsModule).
    config.register(ShortcutsModule.self)
    // `ng serve --platform ios`'s live reload, in the development build.
    DevServer.shared.register(in: config)
    builtFontScale = textScale()
    let lynxView = LynxView { builder in
      builder.config = config
      // Lynx's engine thread, which runs the main thread's JavaScript (the
      // whole Angular app), layout and Lynx's animator, gets a thread of its
      // own. Lynx's default, AllOnUI, runs it on the UI thread, where change
      // detection, a screen being built or a long event handler took frames
      // from what UIKit runs itself: a scroll view's momentum, typing, a web
      // view. Off it, the element tree reaches the screen a step later, once
      // the flush crosses to the UI thread: the build plugin turns on Lynx's
      // pending invokes so UI methods follow it, and the runtime sets
      // enable-async-list on every <list>, which this strategy requires.
      builder.setThreadStrategyForRender(.mostOnTASM)
      // Lets main-thread code, where Angular runs, call the config's modules
      // with lynx.module(name): WebGL needs answers synchronously. Lynx calls
      // them on its engine thread, not the UI thread (see AngularLynxWebGL.h).
      builder.enableMTSModule = true
      builder.screenSize = screenSize
      // The user's text size (see textScale()). The build tells Lynx to
      // scale only `sp` lengths by it, which the page's root font size is
      // written in, so every rem grows with it and a px size doesn't.
      builder.fontScale = self.builtFontScale
      builder.enableGenericResourceFetcher = .true
      builder.genericResourceFetcher = fetcher
      builder.templateResourceFetcher = fetcher
      builder.mediaResourceFetcher = fetcher
    }
    lynxView.layoutWidthMode = .exact
    lynxView.layoutHeightMode = .exact
    view.addSubview(lynxView)
    self.lynxView = lynxView
    lynxView.addLifecycleClient(self)
    // Who hears that a shortcut ran, or a link arrived, while the app is open.
    ShortcutCenter.shared.lynxView = lynxView
    LinkCenter.shared.lynxView = lynxView

    layoutLynxView()
    lynxView.updateGlobalProps(with: globalProps())
    // The bundle inside the app, or in the development build, the dev
    // server's, which it loads again on every edit.
    let templateURL = DevServer.shared.templateURL
    lynxView.loadTemplate(fromURL: templateURL, initData: nil)
    // The launch screen, over the LynxView until the app's first screen is
    // drawn: iOS takes its own down at the first frame, which is the empty
    // LynxView (SplashScreen.swift). The development build's messages go
    // over it.
    SplashScreen.shared.show(over: view)
    DevServer.shared.attach(to: view) { [weak self] in
      self?.lynxView?.loadTemplate(fromURL: templateURL, initData: nil)
    }

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
    NotificationCenter.default.addObserver(
      self, selector: #selector(contentSizeCategoryDidChange),
      name: UIContentSizeCategory.didChangeNotification, object: nil)
  }

  @objc private func accessibilitySettingsDidChange() {
    lynxView?.updateGlobalProps(with: globalProps())
  }

  /// The user chose another text size while the app was open: the page's
  /// root font size, and with it every rem, takes the new scale at once, as
  /// UIKit's own text does, and LynxAccessibilitySettings.textScale() hears it.
  @objc private func contentSizeCategoryDidChange() {
    lynxView?.updateFontScale(textScale())
    lynxView?.updateGlobalProps(with: globalProps())
  }

  /// A load sets up a new engine, as the development build's reload does, and
  /// Lynx gives it the font scale the LynxView was built with: updateFontScale
  /// doesn't change that. So a size chosen since then would be lost on reload
  /// while `textScale` kept it; give the new page the current scale.
  func lynxView(_ view: LynxView!, didLoadFinishedWithUrl url: String!) {
    let scale = textScale()
    if scale != builtFontScale {
      view.updateFontScale(scale)
    }
  }

  /// How much larger than the default the user's Dynamic Type size draws body
  /// text: 1 at the default (Large), about 1.24 at the largest of the
  /// standard sizes and 3.1 at the largest accessibility size, and below 1 at
  /// the smaller sizes. Capped at angular.json's `textScaling.max`, and 1
  /// with `"textScaling": false`.
  ///
  /// Read from the app's content size category rather than the view's
  /// traits, which may not have changed yet when the notification arrives.
  private func textScale() -> CGFloat {
    guard textScaling else { return 1 }
    let traits = UITraitCollection(
      preferredContentSizeCategory: UIApplication.shared.preferredContentSizeCategory)
    let body: CGFloat = 17
    let scale = UIFontMetrics(forTextStyle: .body).scaledValue(for: body, compatibleWith: traits) / body
    guard let maxTextScale else { return scale }
    return min(scale, CGFloat(maxTextScale))
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
  /// and text scale (LynxAccessibilitySettings), `osVersion` (LynxSystemInfo) and
  /// `initialURL` (LynxLinking and the router), plus the safe-area insets and
  /// `edgeToEdge`, which env(safe-area-inset-*) reads. The Android shell
  /// sends the same keys, and Lynx Explorer sends theme and isNotchScreen too.
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
      // The text size, as the LynxView's font scale has it
      // (LynxAccessibilitySettings.textScale).
      "textScale": textScale(),
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
    // The link that started the app, which the router starts at. In every
    // update, since each sends the whole set.
    if let url = LinkCenter.shared.initialURL {
      props["initialURL"] = url
    }
    // Without useBoolLiterals, Lynx turns a Bool into 1 or 0.
    return LynxTemplateData(dictionary: props, useBoolLiterals: true)
  }
}
