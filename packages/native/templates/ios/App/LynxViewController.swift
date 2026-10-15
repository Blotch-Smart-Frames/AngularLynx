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
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    layoutLynxView()
  }

  /// Keeps the LynxView inside the safe area, so a freshly generated app
  /// doesn't draw under the notch or the home indicator. The insets are also
  /// passed as global props for apps that want to draw edge to edge later.
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

  private func globalProps() -> LynxTemplateData {
    let insets = view.safeAreaInsets
    return LynxTemplateData(dictionary: [
      "platform": "ios",
      "safeAreaTop": insets.top,
      "safeAreaBottom": insets.bottom,
      "safeAreaLeft": insets.left,
      "safeAreaRight": insets.right,
      "theme": traitCollection.userInterfaceStyle == .dark ? "Dark" : "Light",
    ])
  }
}
