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
    XElementRegistry.register()
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
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = LynxViewController()
    window.makeKeyAndVisible()
    self.window = window
  }

  // Out of sight, a collection's pause can't show, and the memory it frees
  // makes the app less likely to be ended while it's in the background.
  func sceneDidEnterBackground(_ scene: UIScene) {
    LynxEnv.sharedInstance().trimMemory(.moderate)
  }
}
