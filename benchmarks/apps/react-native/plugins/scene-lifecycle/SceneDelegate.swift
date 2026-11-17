import Expo
import React

// iOS 27 stops any app built with its SDK at launch (an EXC_BREAKPOINT in
// UIKit's scene check) unless it adopts the scene life cycle, and Expo 54's
// template still makes its window in the app delegate. This is the smallest
// scene delegate that starts React Native the way that template did; Expo 58
// ships its own (ExpoAppSceneDelegate), which this mirrors.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    // Code that reads the app delegate's window (expo-system-ui) keeps working.
    appDelegate.window = window

    // A link that cold-starts the app comes in the connection options, not in
    // the app delegate's launch options, which React Native's
    // Linking.getInitialURL() reads; so put it back there.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions = [UIApplication.LaunchOptionsKey(rawValue: "UIApplicationLaunchOptionsURLKey"): url]
    }
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)

    // expo-linking (which expo-router reads) learns the launch URL from the
    // app delegate's open-URL call, which UIKit no longer makes under scenes.
    connectionOptions.urlContexts.forEach { open($0.url) }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    URLContexts.forEach { open($0.url) }
  }

  // UIKit sends these to the scene instead of the app delegate now; pass them
  // on so ExpoAppDelegate's subscribers still hear them.
  func sceneDidBecomeActive(_ scene: UIScene) {
    UIApplication.shared.delegate?.applicationDidBecomeActive?(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    UIApplication.shared.delegate?.applicationWillResignActive?(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    UIApplication.shared.delegate?.applicationWillEnterForeground?(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    UIApplication.shared.delegate?.applicationDidEnterBackground?(UIApplication.shared)
  }

  // The app delegate's open-URL override reaches both ExpoAppDelegate's
  // subscribers and RCTLinkingManager.
  private func open(_ url: URL) {
    _ = UIApplication.shared.delegate?.application?(UIApplication.shared, open: url, options: [:])
  }
}
