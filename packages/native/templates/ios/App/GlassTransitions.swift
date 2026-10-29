import UIKit

/// Animates Liquid Glass coming and going, as UIKit animates its own glass
/// and SwiftUI's GlassEffectContainer does:
///
/// - In a `glass-container`, a shape that's added, or whose `visibility` turns
///   visible, materializes: its effect animates from nothing to the glass, and
///   its content fades in. One that's removed, or hidden, dissolves in place.
/// - A shape that goes and one with the same `glass-effect-id` that comes, in
///   the same update, are one piece of glass changing shape, as SwiftUI's
///   `glassEffectID` pairs them. In the same container, the new one grows out
///   of the old one's frame and corners while a copy of the old one flows into
///   it and dissolves, and the container merges the two as they move. Across
///   containers or windows, such as a button and the menu it opens in an
///   overlay, the new one takes over where it is, from the old one's corners,
///   with the old content fading out over it: a component that grows one out
///   of the other moves it there itself, as the menus and popovers do.
/// - In a container, a shape whose effect changes (its tint, its style, glass
///   turned off) eases to the new one.
///
/// Lynx's blur-view sets its effect directly, outside any animation, so all
/// of these happened in one frame. Only glass in a container that was already
/// on screen materializes or dissolves: a screen that appears with its glass,
/// such as a new page, draws it at once, as UIKit does. Under Reduce Motion
/// nothing moves: a pair cross-fades in place.
///
/// Lynx tells the shell about each change while it applies an update (see
/// BlurView), before it has laid out the elements it added, and removes an
/// element by detaching it, so a removal and a move look alike until the
/// update ends. The coordinator writes each change down and settles them all
/// at the end of the run loop pass, before Core Animation commits it: what
/// was on screen and isn't anymore went, what wasn't and is came, and an
/// element that left and came back was moved.
@available(iOS 26.0, *)
final class GlassTransitions {
  static let shared = GlassTransitions()

  /// How long a shape takes to materialize or dissolve, and its content to
  /// fade, in seconds: UIKit's own default animation length.
  private static let fadeDuration: TimeInterval = 0.35
  /// The spring a pair moves on: a little longer than a fade, with a touch of
  /// bounce, as SwiftUI's default animation.
  private static let morphDuration: TimeInterval = 0.5
  private static let morphBounce: CGFloat = 0.15

  /// What a view looked like when it went: enough to draw a copy of it (a
  /// ghost) where it was, since Lynx has already taken the view itself away.
  private struct Departure {
    /// The container it was in, if it was in one that stays on screen.
    weak var container: BlurEffectView?
    let effect: UIVisualEffect
    /// Its frame on the screen, for a ghost in its container.
    let frame: CGRect
    let cornerRadius: CGFloat
    let cornerCurve: CALayerCornerCurve
    let content: UIView?
    let id: String?
  }

  /// A view that changed during this run loop pass.
  private final class Change {
    weak var view: BlurEffectView?
    /// Whether it was drawing when the pass began.
    let wasShown: Bool
    /// Whether its last change took it off screen.
    var leaving: Bool
    /// Its look as it went, if it was glass that can still be seen going.
    var departure: Departure?

    init(view: BlurEffectView, wasShown: Bool, leaving: Bool) {
      self.view = view
      self.wasShown = wasShown
      self.leaving = leaving
    }
  }

  private var changes: [ObjectIdentifier: Change] = [:]
  private var observer: CFRunLoopObserver?

  // MARK: - Changes, as Lynx applies them

  /// The view joins a window, leaves one (`to` is nil), or moves from one to
  /// another, as an element a context menu lifts into its overlay does.
  func view(_ view: BlurEffectView, willMoveFrom from: UIWindow?, to: UIWindow?) {
    if to == nil {
      note(view, wasShown: !view.isHidden, leaving: true)
    } else {
      note(view, wasShown: from != nil && !view.isHidden, leaving: false)
    }
  }

  func viewWillHide(_ view: BlurEffectView) {
    note(view, wasShown: view.window != nil, leaving: true)
  }

  func viewDidShow(_ view: BlurEffectView) {
    note(view, wasShown: false, leaving: false)
  }

  /// Lynx gave the view a new effect: one in a container that's on screen,
  /// and that isn't coming or going in this pass, eases from the old one.
  func effectChanged(_ view: BlurEffectView, from old: UIVisualEffect?) {
    guard changes[ObjectIdentifier(view)] == nil, !view.isHidden,
      view.window != nil, let container = container(of: view), isSettled(container)
    else { return }
    let new = view.lynxEffect
    UIView.performWithoutAnimation { view.draw(old) }
    UIView.animate(
      withDuration: Self.fadeDuration, delay: 0, options: [.allowUserInteraction, .curveEaseInOut]
    ) {
      view.draw(new)
    }
  }

  /// Writes the change down. The first change in a pass says whether the
  /// view was on screen when it began; a view that leaves is copied then,
  /// while it still draws.
  private func note(_ view: BlurEffectView, wasShown: Bool, leaving: Bool) {
    let key = ObjectIdentifier(view)
    let change: Change
    if let noted = changes[key] {
      change = noted
      change.leaving = leaving
    } else {
      change = Change(view: view, wasShown: wasShown, leaving: leaving)
      changes[key] = change
    }
    if leaving, change.wasShown, change.departure == nil {
      change.departure = departure(of: view)
    }
    scheduleSettle()
  }

  /// The view's look as it goes, if anything could show it going: a
  /// container that stays, or a shape with its id coming somewhere else.
  private func departure(of view: BlurEffectView) -> Departure? {
    guard view.lynxEffect is UIGlassEffect, let effect = view.effect,
      let screen = view.window?.screen
    else { return nil }
    let container = container(of: view).flatMap { container in
      isSettled(container) && changes[ObjectIdentifier(container)]?.leaving != true
        ? container : nil
    }
    guard container != nil || view.glassEffectId != nil else { return nil }
    return Departure(
      container: container,
      effect: effect,
      frame: view.convert(view.bounds, to: screen.coordinateSpace),
      // As last drawn: an overlay that hides with its glass lays it out at
      // nothing in the same update, and Lynx has applied that by now.
      cornerRadius: (view.layer.presentation() ?? view.layer).cornerRadius,
      cornerCurve: view.layer.cornerCurve,
      content: view.contentView.snapshotView(afterScreenUpdates: false),
      id: view.glassEffectId)
  }

  // MARK: - The end of the pass

  /// Settles the changes at the end of this run loop pass, after Lynx has
  /// applied the whole update and before Core Animation commits it (its
  /// observer has order 2,000,000), so the first frame drawn already shows
  /// the transition's start.
  private func scheduleSettle() {
    guard observer == nil else { return }
    let observer = CFRunLoopObserverCreateWithHandler(
      kCFAllocatorDefault,
      CFRunLoopActivity.beforeWaiting.rawValue | CFRunLoopActivity.exit.rawValue,
      false, 1_000_000
    ) { [weak self] _, _ in
      self?.settle()
    }
    CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
    self.observer = observer
  }

  private func settle() {
    if let observer { CFRunLoopObserverInvalidate(observer) }
    observer = nil
    let changes = Array(self.changes.values)
    self.changes = [:]

    var departures: [Departure] = []
    var arrivals: [(view: BlurEffectView, container: BlurEffectView?)] = []
    for change in changes {
      let view = change.view
      let shown = view.map { $0.window != nil && !$0.isHidden } ?? false
      if change.wasShown, !shown, let departure = change.departure {
        departures.append(departure)
      } else if !change.wasShown, shown, let view, view.lynxEffect is UIGlassEffect {
        // Glass in a container that was already on screen materializes, and
        // glass with an id can take over from a shape that went.
        let container = container(of: view).flatMap {
          isSettled($0, in: changes) ? $0 : nil
        }
        if container != nil || view.glassEffectId != nil {
          arrivals.append((view, container))
        }
      }
    }

    // Pair each shape that came with one that went under the same id, from
    // its own container first.
    for (view, container) in arrivals {
      let index = view.glassEffectId.flatMap { id in
        departures.firstIndex { $0.id == id && $0.container === container && container != nil }
          ?? departures.firstIndex { $0.id == id }
      }
      if let index {
        let departure = departures.remove(at: index)
        if let container, departure.container === container {
          morph(departure, into: view, in: container)
        } else {
          takeOver(from: departure, view)
        }
      } else if container != nil {
        materialize(view)
      }
    }
    for departure in departures where departure.container?.window != nil {
      dissolve(departure)
    }
  }

  // MARK: - Transitions

  private func materialize(_ view: BlurEffectView) {
    let effect = view.lynxEffect
    UIView.performWithoutAnimation {
      view.draw(nil)
      view.contentView.alpha = 0
    }
    UIView.animate(
      withDuration: Self.fadeDuration, delay: 0, options: [.allowUserInteraction, .curveEaseOut]
    ) {
      view.draw(effect)
      view.contentView.alpha = 1
    }
  }

  /// A copy of the shape that went, where it was, which dissolves.
  private func dissolve(_ departure: Departure) {
    guard let ghost = ghost(of: departure) else { return }
    UIView.animate(withDuration: Self.fadeDuration, delay: 0, options: [.curveEaseIn]) {
      ghost.effect = nil
      ghost.contentView.alpha = 0
    } completion: { _ in
      ghost.removeFromSuperview()
    }
  }

  /// `view` grows out of the shape that went, in the same container, and the
  /// shape that went, as a ghost, flows into it while it dissolves. The
  /// container draws the two as one glass shape that changes.
  private func morph(_ departure: Departure, into view: BlurEffectView, in container: BlurEffectView) {
    guard !UIAccessibility.isReduceMotionEnabled, let superview = view.superview,
      let screen = view.window?.screen.coordinateSpace,
      CATransform3DIsIdentity(view.layer.transform), let ghost = ghost(of: departure)
    else {
      // A cross-fade: no movement under Reduce Motion, nor for a view with a
      // transform, whose frame isn't its own to animate.
      materialize(view)
      dissolve(departure)
      return
    }
    let frame = view.frame
    let cornerRadius = view.layer.cornerRadius
    let target = superview.convert(frame, to: container.contentView)
    UIView.performWithoutAnimation {
      view.frame = screen.convert(departure.frame, to: superview)
      view.layer.cornerRadius = departure.cornerRadius
      view.contentView.alpha = 0
    }
    UIView.animate(
      springDuration: Self.morphDuration, bounce: Self.morphBounce, initialSpringVelocity: 0,
      delay: 0, options: [.allowUserInteraction]
    ) {
      view.frame = frame
      view.layer.cornerRadius = cornerRadius
      ghost.frame = target
      ghost.layer.cornerRadius = cornerRadius
    }
    fadeContent(of: view)
    // The old content goes quickly, and the old glass dissolves into the new
    // as they move.
    UIView.animate(withDuration: Self.fadeDuration / 2, delay: 0, options: [.curveEaseIn]) {
      ghost.contentView.alpha = 0
    }
    UIView.animate(withDuration: Self.morphDuration, delay: 0, options: [.curveEaseInOut]) {
      ghost.effect = nil
    } completion: { _ in
      ghost.removeFromSuperview()
    }
  }

  /// `view` takes over from the shape that went somewhere else, another
  /// container or window, where it is: it starts from that shape's corners,
  /// and the old content fades out over it as its own fades in. The two
  /// can't merge, and the old one's frame isn't known by then (an overlay
  /// that hides with its glass lays it out at nothing in the same update), so
  /// a component that grows one out of the other places it there itself, as
  /// the menus and popovers do. The old glass isn't drawn again: the new
  /// continues it.
  private func takeOver(from departure: Departure, _ view: BlurEffectView) {
    guard !UIAccessibility.isReduceMotionEnabled, let superview = view.superview else {
      materialize(view)
      return
    }
    let cornerRadius = view.layer.cornerRadius
    // Corners rounder than half the shape draw as half of it, a capsule.
    let startRadius = min(departure.cornerRadius, min(view.bounds.width, view.bounds.height) / 2)
    // The old content goes over the new shape rather than in it: a visual
    // effect view's content view is the only place for subviews, and the new
    // content fading in there would take it along.
    let content = departure.content
    UIView.performWithoutAnimation {
      view.layer.cornerRadius = startRadius
      view.contentView.alpha = 0
      if let content {
        content.center = view.center
        content.isUserInteractionEnabled = false
        superview.insertSubview(content, aboveSubview: view)
      }
    }
    UIView.animate(
      springDuration: Self.morphDuration, bounce: Self.morphBounce, initialSpringVelocity: 0,
      delay: 0, options: [.allowUserInteraction]
    ) {
      view.layer.cornerRadius = cornerRadius
    }
    // A cross-fade, at once: the shape stays where it is, so the new content
    // has room from the start, and a menu closing into its button has faded
    // its own already.
    fadeContent(of: view, after: 0)
    if let content {
      UIView.animate(withDuration: Self.fadeDuration / 2, delay: 0, options: [.curveEaseIn]) {
        content.alpha = 0
      } completion: { _ in
        content.removeFromSuperview()
      }
    }
  }

  /// The new shape's content fades in, by default once the old one's has
  /// gone and the shape has grown some.
  private func fadeContent(of view: BlurEffectView, after delay: TimeInterval = fadeDuration / 2) {
    UIView.animate(
      withDuration: Self.fadeDuration, delay: delay,
      options: [.allowUserInteraction, .curveEaseOut]
    ) {
      view.contentView.alpha = 1
    }
  }

  /// A glass shape like the one that went, with a picture of its content, in
  /// its container. It sits above the container's own children, where Lynx's
  /// index-based inserts don't see it, and it merges with them as any glass
  /// in the container does.
  private func ghost(of departure: Departure) -> UIVisualEffectView? {
    guard let container = departure.container,
      let screen = container.window?.screen.coordinateSpace
    else { return nil }
    let ghost = UIVisualEffectView(effect: departure.effect)
    ghost.frame = screen.convert(departure.frame, to: container.contentView)
    ghost.layer.cornerRadius = departure.cornerRadius
    ghost.layer.cornerCurve = departure.cornerCurve
    ghost.clipsToBounds = true
    ghost.isUserInteractionEnabled = false
    ghost.accessibilityElementsHidden = true
    if let content = departure.content {
      // Centered, so it stays where it was as the ghost grows around it.
      content.center = CGPoint(x: ghost.bounds.midX, y: ghost.bounds.midY)
      content.autoresizingMask = [
        .flexibleLeftMargin, .flexibleRightMargin, .flexibleTopMargin, .flexibleBottomMargin,
      ]
      ghost.contentView.addSubview(content)
    }
    container.contentView.addSubview(ghost)
    return ghost
  }

  // MARK: - Containers

  /// The glass container `view` is in: the nearest blur-view around it, if
  /// that's a container. Glass in other glass isn't in a container, and
  /// neither is glass in a scroll view, whose cells come and go as it
  /// scrolls.
  private func container(of view: UIView) -> BlurEffectView? {
    var ancestor = view.superview
    while let current = ancestor, !(current is UIScrollView) {
      if let blur = current as? BlurEffectView {
        return blur.lynxEffect is UIGlassContainerEffect ? blur : nil
      }
      ancestor = current.superview
    }
    return nil
  }

  /// Whether `container` was on screen before this pass, rather than coming
  /// with the glass in it.
  private func isSettled(_ container: BlurEffectView) -> Bool {
    container.window != nil && changes[ObjectIdentifier(container)].map { $0.wasShown } != false
  }

  private func isSettled(_ container: BlurEffectView, in changes: [Change]) -> Bool {
    container.window != nil && !container.isHidden
      && !changes.contains { $0.view === container && !$0.wasShown }
  }
}
