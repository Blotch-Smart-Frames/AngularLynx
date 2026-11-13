import Lynx
import WebKit
import XElement

/// The loader behind every `<webview>`: XElement's own, which lets its web
/// view go when the element goes.
///
/// XElement's `LynxWebViewDefaultLoader` never does (issue #397). It makes
/// itself its web view's script message handler, and `WKUserContentController`
/// keeps its handlers until they're taken off, which nothing does. So the
/// loader keeps the web view, the web view's content controller keeps the
/// loader, and when the element lets the loader go, the two keep each other.
/// With them stays the WebContent process WebKit started for the web view:
/// every `<webview>` an app had shown stayed for as long as it ran, 21 of them
/// holding 0.9 to 2.4 GB after three visits to a screen with seven. Android's
/// WebViews have no such cycle and go with their elements.
///
/// This wraps XElement's loader and takes the handler off when the element
/// lets it go, which ends the cycle; the two then go with the element.
/// Everything else is XElement's: the web view's settings, the navigation
/// callbacks, and the messages a page posts (`bindmessage`). The element
/// keeps its loader on the main thread, where this goes too.
final class ShellWebViewLoader: NSObject, LynxWebViewLoader {
  private let loader: LynxWebViewLoader
  /// The name the handler is under. Taken now: by the time this goes, the
  /// element that names it (the delegate, held weakly) has gone.
  private let handlerName: String
  private var webView: WKWebView?

  init(delegate: LynxWebViewLoaderDelegate) {
    loader = LynxWebViewDefaultLoader(delegate: delegate)
    handlerName = delegate.nameOfScriptMessageHandler()
    super.init()
  }

  deinit {
    webView?.configuration.userContentController
      .removeScriptMessageHandler(forName: handlerName)
  }

  // XElement's container is its web view. Going through getWebView() here
  // means the web view is known to deinit however the element first asks.
  func getContainerView() -> UIView {
    getWebView()
  }

  func getWebView() -> WKWebView {
    let webView = loader.getWebView()
    self.webView = webView
    return webView
  }

  func setParams(_ params: [AnyHashable: Any]) {
    loader.setParams(params)
  }

  func load(_ urlStr: String) {
    loader.load(urlStr)
  }

  func loadHtmlString(_ htmlString: String) {
    loader.loadHtmlString(htmlString)
  }

  func reload() {
    loader.reload()
  }

  func evaluateJavaScript(
    _ javaScriptString: String,
    completionHandler: ((Any?, Error?) -> Void)?
  ) {
    loader.evaluateJavaScript(javaScriptString, completionHandler: completionHandler)
  }
}

/// Makes `ShellWebViewLoader` the `"default"` loader, the one a `<webview>`
/// uses unless its `webview-type` names another.
final class ShellWebViewLoaderProvider: NSObject, LynxWebViewLoaderProvider {
  static func register() {
    // XElement registers its own provider as "default" in a task Lynx runs
    // the first time it starts (LYNX_LOAD_LAZY), which would replace one
    // registered before that. The tasks run once, so starting them here puts
    // this one after XElement's.
    LynxLazyRegister.loadLynxInitTask()
    LynxWebViewService.sharedInstance().providers?["default"] =
      ShellWebViewLoaderProvider()
  }

  func createLynxWebViewLoader(with delegate: LynxWebViewLoaderDelegate)
    -> LynxWebViewLoader?
  {
    ShellWebViewLoader(delegate: delegate)
  }
}
