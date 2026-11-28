import XCTest

/// Taps the app in front for the benchmark harness (ios_tap.py), which runs
/// one of these tests with `xcodebuild test-without-building` and passes the
/// settings as `TEST_RUNNER_<name>` environment variables:
///
/// - `TAP_APP`: the bundle ID of the app to tap. The tapper closes it if it's
///   open, then waits for it to be in front, but never launches it or asks it
///   anything while it's measured: the harness
///   launches it under Instruments, and XCTest's queries and idle waits
///   would run in the app, beside what's measured.
/// - `TAP_POINTS`: where to tap, `x,y;x,y;...` as fractions of the screen,
///   taken in turn.
/// - `TAP_COUNT`: how many taps; `TAP_INTERVAL`: seconds from one tap to the
///   next; `TAP_START`: seconds to wait once the app is in front.
///
/// The taps go to SpringBoard's coordinates, which are the screen's, so
/// XCTest waits for SpringBoard to be idle before each one, not the app.
final class Tapper: XCTestCase {
  private let env = ProcessInfo.processInfo.environment

  private func number(_ key: String, _ fallback: Double) -> Double {
    env[key].flatMap(Double.init) ?? fallback
  }

  private func points() -> [CGVector] {
    (env["TAP_POINTS"] ?? "0.5,0.5").split(separator: ";").map { pair in
      let xy = pair.split(separator: ",").compactMap { Double($0) }
      return CGVector(dx: xy[0], dy: xy[1])
    }
  }

  /// Waits for the app to be in front, then taps.
  func testTap() throws {
    let bundleID = try XCTUnwrap(env["TAP_APP"], "TAP_APP is the app to tap")
    let app = XCUIApplication(bundleIdentifier: bundleID)
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let points = points()
    let count = Int(number("TAP_COUNT", 10))
    let interval = number("TAP_INTERVAL", 1)
    // Closed first, so the app it waits for is the one Instruments launches
    // next, not one still open from before (the first tap's run locates the
    // heart in an open app): taps sent to that would be lost in the relaunch.
    if app.state != .notRunning { app.terminate() }
    print("TAPPER READY")
    let deadline = Date().addingTimeInterval(number("TAP_TIMEOUT", 60))
    // Each state it passes through goes to the log, to tell an app that never
    // launched from one XCTest doesn't see in front.
    var state = app.state
    print("TAPPER STATE \(state.rawValue)")
    while state != .runningForeground {
      if Date() > deadline { return XCTFail("\(bundleID) never came to the front") }
      // The run loop, not Thread.sleep: XCTest learns of the app's launch on
      // the main run loop, so a blocked one reports it not running forever.
      RunLoop.current.run(until: Date().addingTimeInterval(0.005))
      let now = app.state
      if now != state { print("TAPPER STATE \(now.rawValue) \(Date().timeIntervalSince1970)") }
      state = now
    }
    print("TAPPER FRONT \(Date().timeIntervalSince1970)")
    Thread.sleep(forTimeInterval: number("TAP_START", 0))
    for i in 0..<count {
      let started = Date()
      springboard.coordinate(withNormalizedOffset: points[i % points.count]).tap()
      print("TAPPER TAP \(i) \(started.timeIntervalSince1970) \(Date().timeIntervalSince(started))")
      let rest = interval - Date().timeIntervalSince(started)
      if rest > 0 { Thread.sleep(forTimeInterval: rest) }
    }
    print("TAPPER DONE")
  }

  /// Prints where the app's element with the accessibility label `TAP_LABEL`
  /// is, as fractions of the screen: a run's points come from this, once per
  /// app, so the timed runs never query the app. The app must be in front.
  func testLocate() throws {
    let bundleID = try XCTUnwrap(env["TAP_APP"], "TAP_APP is the app to look in")
    let label = try XCTUnwrap(env["TAP_LABEL"], "TAP_LABEL is the label to find")
    try locate(label, in: XCUIApplication(bundleIdentifier: bundleID))
  }

  /// Opens the app once, unmeasured, after the harness has installed it, and
  /// closes it again. A new install asks for local network access the first
  /// time it reaches the fixture server, and the prompt would cover the next
  /// launch, the measured one: this one allows it. With `TAP_LABEL`, it also
  /// prints where that element is, as testLocate does.
  func testWarm() throws {
    let bundleID = try XCTUnwrap(env["TAP_APP"], "TAP_APP is the app to open")
    let app = XCUIApplication(bundleIdentifier: bundleID)
    app.launch()
    let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["Allow"]
    if allow.waitForExistence(timeout: number("TAP_PROMPT", 5)) {
      allow.tap()
      // Its first requests failed behind the prompt: start it over.
      app.terminate()
      app.launch()
    }
    if let label = env["TAP_LABEL"] {
      try locate(label, in: app)
    } else {
      Thread.sleep(forTimeInterval: 2)
    }
    app.terminate()
  }

  private func locate(_ label: String, in app: XCUIApplication) throws {
    // `a|b` finds the first element labeled either: the Pokédex's heart is
    // "Add to favorites" or "Remove from favorites", as the last run left it.
    let labels = label.split(separator: "|").map(String.init)
    let element = app.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", labels)).firstMatch
    XCTAssertTrue(element.waitForExistence(timeout: number("TAP_TIMEOUT", 30)), "no \(label) in \(app)")
    let frame = element.frame
    let screen = app.frame
    print(
      "TAPPER LOCATE \(label)=\((frame.midX - screen.minX) / screen.width),\((frame.midY - screen.minY) / screen.height)"
    )
  }
}
