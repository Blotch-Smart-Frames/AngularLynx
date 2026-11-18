import Lynx
import SDWebImage
import SDWebImageWebPCoder
import UIKit

/// Starts the Lynx engine once per process, before any LynxView exists.
///
/// Lynx's global config carries the template provider that LynxView falls back
/// to; the per-view fetchers in LynxViewController handle everything else.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Lynx's frameworks are built for release, where Lynx logs at INFO: a
    // line for every touch move, hit test, flush, layout, event listener and
    // main-thread module call, each written with a synchronous NSLog on the
    // thread that logged it. Mostly that's the engine thread, where Angular,
    // layout and Lynx's animator share each frame, and during a touch the
    // UI thread. A release app keeps Lynx's warnings and errors, which carry
    // the app's JavaScript errors; the Debug configuration that
    // `ng serve --platform ios` builds keeps every line for debugging.
    // First, so the lines Lynx logs while it starts are left out too.
    #if !DEBUG
      SetMinimumLoggingLevel(.warning)
    #endif
    XElementRegistry.register()
    // Before any LynxView, so its first transition already asks for 120 fps.
    AnimationFrameRate.install()
    let config = LynxConfig(provider: BundleResourceFetcher.shared)
    LynxEnv.sharedInstance().prepareConfig(config)
    // LynxService's image service decodes through SDWebImage, which only
    // understands WebP once the coder is registered. rspeedy emits WebP for
    // some image imports.
    SDImageCodersManager.shared.addCoder(SDImageWebPCoder.shared)
    return true
  }

  // Lynx leaves it to the host app to report memory pressure. Critical
  // pressure runs a full collection of each LynxView's main-thread
  // JavaScript heap and empties Lynx's text layout cache.
  func applicationDidReceiveMemoryWarning(_ application: UIApplication) {
    LynxEnv.sharedInstance().trimMemory(.critical)
  }

  // Apps built with the iOS 27 SDK must use the scene lifecycle.
  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(
      name: "Default", sessionRole: connectingSceneSession.role)
    configuration.delegateClass = SceneDelegate.self
    return configuration
  }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene, willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    // A link that started the app: one with one of the app's schemes, or a
    // Universal Link (an https link to one of angular.json's appLinkDomains),
    // which comes as a web browsing activity. It comes only here, not to
    // scene(_:openURLContexts:) or scene(_:continue:) too, and before the
    // LynxView exists, so it goes out with the first global props
    // (LinkCenter).
    LinkCenter.shared.initialURL =
      (connectionOptions.urlContexts.first?.url
      ?? connectionOptions.userActivities.lazy.compactMap(Self.universalLink).first)?
      .absoluteString
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = LynxViewController()
    window.makeKeyAndVisible()
    self.window = window
  }

  // A link with one of the app's schemes while the app is open, in front or
  // in the background: the runtime's LynxLinking takes it, and the router
  // navigates to it.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      LinkCenter.shared.open(context.url)
    }
  }

  // A Universal Link while the app is open: the same as a link with one of
  // its schemes.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    if let url = Self.universalLink(userActivity) {
      LinkCenter.shared.open(url)
    }
  }

  /// The https link a Universal Link's activity carries. iOS hands the app
  /// one for a link to a domain in its Associated Domains entitlement, once
  /// that domain's apple-app-site-association names the app.
  private static func universalLink(_ activity: NSUserActivity) -> URL? {
    activity.activityType == NSUserActivityTypeBrowsingWeb ? activity.webpageURL : nil
  }

  // Out of sight, a collection's pause can't show, and the memory it frees
  // makes the app less likely to be ended while it's in the background.
  func sceneDidEnterBackground(_ scene: UIScene) {
    LynxEnv.sharedInstance().trimMemory(.moderate)
  }
}
