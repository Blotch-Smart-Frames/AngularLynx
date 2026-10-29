import Lynx
import XElement

/// Registers XElement's elements: `<input>`, `<textarea>`, `<overlay>`,
/// `<svg>`, `<blur-view>`, `<viewpager>`, `<refresh>`, the
/// `<scroll-coordinator>` family, `<webview>` and `<video>`. Lynx's core
/// doesn't include them, and a tag nothing is registered for renders nothing.
///
/// Lynx Explorer gets these registrations from XElement's `Behavior` subspec,
/// but that subspec also links Markdown, an element the runtime doesn't
/// support, so the frameworks build leaves it out
/// (scripts/build-lynx-ios-frameworks.sh) and the shell registers the same
/// classes under the same names here, before the first LynxConfig or LynxView
/// exists. `<blur-view>` is XElement's with UIKit's blur materials added
/// (MaterialBlurView).
enum XElementRegistry {
  static func register() {
    let elements: [(String, AnyClass)] = [
      ("input", LynxUIInput.self),
      ("textarea", LynxUITextArea.self),
      ("overlay", LynxUIOverlay.self),
      ("svg", LynxUISVG.self),
      ("blur-view", MaterialBlurView.self),
      ("viewpager", LynxUIViewPager.self),
      ("viewpager-item", LynxUIViewPagerItem.self),
      ("refresh", LynxUIRefresh.self),
      ("refresh-header", LynxUIRefreshHeader.self),
      ("scroll-coordinator", LynxUIScrollCoordinator.self),
      ("scroll-coordinator-header", LynxUIScrollCoordinatorHeader.self),
      ("scroll-coordinator-slot", LynxUIScrollCoordinatorSlot.self),
      ("scroll-coordinator-slot-drag", LynxUIScrollCoordinatorSlotDrag.self),
      ("scroll-coordinator-toolbar", LynxUIScrollCoordinatorToolbar.self),
      ("webview", LynxUIWebView.self),
      ("video", LynxUIVideo.self),
    ]
    for (name, ui) in elements {
      LynxComponentRegistry.registerUI(ui, withName: name)
    }
    // The elements whose size comes from their content (a text field's
    // text, an overlay's screen, a refresh's header) also measure themselves
    // in layout, through a shadow node.
    let shadowNodes: [(String, AnyClass)] = [
      ("input", LynxUIInputShadowNode.self),
      ("textarea", LynxUITextAreaShadowNode.self),
      ("overlay", LynxUIOverlayShadowNode.self),
      ("refresh", LynxUIRefreshShadowNode.self),
    ]
    for (name, node) in shadowNodes {
      LynxComponentRegistry.registerShadowNode(node, withName: name)
    }
  }
}
