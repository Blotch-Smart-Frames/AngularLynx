import EventKit
import EventKitUI
import Lynx
import UIKit

/// The native module behind the runtime's `LynxCalendar`, which calls it as
/// `NativeModules.AngularLynxCalendar` (from the background thread, where
/// NativeModules lives).
///
/// `addEvent` opens the system's event editor, EventKitUI's
/// `EKEventEditViewController`, filled in with the app's event, and calls
/// back once with `{ result: "saved" }` or `{ result: "canceled" }` when the
/// person closes it, or `{ error, message }`. From iOS 17 the editor runs
/// outside the app and writes the event itself, so the app needs no calendar
/// permission and no usage description for it: it never sees the person's
/// calendars. Before iOS 17 the editor needs full calendar access, which
/// this module doesn't ask for, so it answers `unavailable` there.
///
/// The generator leaves this file out of an app whose angular.json doesn't
/// set `calendar`, and LynxViewController registers the module by its
/// Objective-C name only when it's there, hence the `@objc` name.
@objc(AngularLynxCalendarModule)
final class CalendarModule: NSObject, LynxModule, EKEventEditViewDelegate,
  UIAdaptivePresentationControllerDelegate
{
  static var name: String { "AngularLynxCalendar" }

  static var methodLookup: [String: String] {
    ["addEvent": NSStringFromSelector(#selector(addEvent(_:callback:)))]
  }

  /// Who to tell how the open editor closed. The editor keeps its delegate
  /// weakly, and Lynx keeps the module, so the module is the delegate.
  private var open: LynxCallbackBlock?

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  /// Opens the editor with `event`: `{ title, start, end, allDay, location?,
  /// notes? }`, with the times in milliseconds since 1970.
  @objc func addEvent(_ event: [String: Any], callback: @escaping LynxCallbackBlock) {
    // Lynx calls modules off the main thread, and the editor is UI.
    DispatchQueue.main.async {
      self.present(event, callback)
    }
  }

  private func present(_ event: [String: Any], _ callback: @escaping LynxCallbackBlock) {
    guard #available(iOS 17.0, *) else {
      callback([
        "error": "unavailable",
        "message":
          "Adding an event without calendar access needs iOS 17 or later.",
      ])
      return
    }
    guard open == nil else {
      callback(["error": "failed", "message": "The event editor is already open."])
      return
    }
    guard
      let title = event["title"] as? String,
      let start = (event["start"] as? NSNumber)?.doubleValue,
      let end = (event["end"] as? NSNumber)?.doubleValue
    else {
      callback(["error": "failed", "message": "The event needs a title, a start and an end."])
      return
    }
    guard let presenter = topViewController() else {
      callback(["error": "failed", "message": "There's no screen to open the editor over."])
      return
    }
    // A store with no access is all the editor needs from iOS 17: it saves
    // the event in its own process.
    let store = EKEventStore()
    let draft = EKEvent(eventStore: store)
    draft.title = title
    draft.startDate = Date(timeIntervalSince1970: start / 1000)
    draft.endDate = Date(timeIntervalSince1970: end / 1000)
    draft.isAllDay = (event["allDay"] as? NSNumber)?.boolValue ?? false
    draft.location = event["location"] as? String
    draft.notes = event["notes"] as? String

    let editor = EKEventEditViewController()
    editor.eventStore = store
    editor.event = draft
    editor.editViewDelegate = self
    open = callback
    presenter.present(editor, animated: true)
    // Swiping the sheet down closes it without the delegate's answer.
    editor.presentationController?.delegate = self
  }

  func eventEditViewController(
    _ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction
  ) {
    controller.dismiss(animated: true)
    // .deleted can't happen to an event that was never saved; it's a cancel
    // to the app.
    finish(action == .saved ? "saved" : "canceled")
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finish("canceled")
  }

  /// Calls back once, however the editor closed.
  private func finish(_ result: String) {
    guard let callback = open else { return }
    open = nil
    callback(["result": result])
  }

  /// The view controller on top, which the editor opens over.
  private func topViewController() -> UIViewController? {
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)
    var top = window?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }
}
