import Capacitor
import UIKit

// Capacitor finds the plugins of npm packages by itself; a plugin in the app's own code is
// registered by the bridge's view controller, as Capacitor's docs on custom native code show.
// SceneDelegate makes this the window's root instead of CAPBridgeViewController.
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppStartupPlugin())
    }
}
