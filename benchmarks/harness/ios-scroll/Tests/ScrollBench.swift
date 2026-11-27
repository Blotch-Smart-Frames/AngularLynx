import UIKit
import XCTest

/// One run of the scroll benchmark: launches an installed benchmark app,
/// waits for its list, then swipes up through it, measuring each swipe with
/// Apple's own scroll metric (frames, hitches) and the app's CPU and memory.
///
/// `ios_scroll.py` runs it once per launch, alternating apps, and reads the
/// metrics from the result bundle. It takes its settings from the
/// environment, which xcodebuild hands the runner with the `TEST_RUNNER_`
/// prefix dropped:
///
/// - `BENCH_BUNDLE_ID`: the app to drive (required)
/// - `BENCH_SWIPES`: how many swipes to measure (default 10)
/// - `BENCH_SETTLE`: seconds to wait after the launch (default 3)
final class ScrollBench: XCTestCase {
  func testScroll() throws {
    let environment = ProcessInfo.processInfo.environment
    let bundleID = try XCTUnwrap(environment["BENCH_BUNDLE_ID"], "BENCH_BUNDLE_ID isn't set")
    let swipes = Int(environment["BENCH_SWIPES"] ?? "") ?? 10
    let settle = Double(environment["BENCH_SETTLE"] ?? "") ?? 3

    // The run's conditions, read on the phone, for the CSV. ios_scroll.py
    // picks this line out of xcodebuild's output.
    UIDevice.current.isBatteryMonitoringEnabled = true
    let thermal: String
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: thermal = "Nominal"
    case .fair: thermal = "Fair"
    case .serious: thermal = "Serious"
    case .critical: thermal = "Critical"
    @unknown default: thermal = "Unknown"
    }
    print("BENCH_CONDITIONS thermal=\(thermal)")

    let app = XCUIApplication(bundleIdentifier: bundleID)
    // launch() ends the app if it's running, so every run starts from a new
    // process, as the launch benchmark's do.
    app.launch()
    // A newly installed app asks for local network access the first time it
    // reaches the fixture server, and its first requests fail behind the
    // prompt. ios_scroll.py reinstalls the apps as it alternates them (the
    // phone has room for one beside this runner), so allow it and start over.
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let allow = springboard.alerts.buttons["Allow"]
    if allow.waitForExistence(timeout: 3) {
      allow.tap()
      app.terminate()
      app.launch()
    }
    // Long enough for the first page and its rows' details on every app
    // (each is fully drawn in under 300 ms on the phone); the swipes then
    // measure scrolling, not the launch.
    Thread.sleep(forTimeInterval: settle)
    attachScreenshot(named: "before")

    let options = XCTMeasureOptions()
    options.iterationCount = swipes
    // Each iteration's window is the swipe and the scroll it throws, until
    // the list comes to rest, and nothing else.
    options.invocationOptions = [.manuallyStop]
    measure(
      metrics: [
        // UIKit's own signposts for a scroll view's drag and deceleration:
        // the frames it drew and the hitches (frames late to the screen).
        // Every app scrolls a UIScrollView: React Native's FlatList and Lynx's
        // <list> alike.
        XCTOSSignpostMetric.scrollingAndDecelerationMetric,
        XCTCPUMetric(application: app),
        XCTMemoryMetric(application: app),
      ],
      options: options
    ) {
      // Always up, never back: each swipe brings rows the app hasn't shown
      // yet, so the framework builds them (and fetches their details) while
      // the list moves, which is the work a scroll benchmark is for. The
      // list holds 300 Pokémon, more than ten swipes reach.
      app.swipeUp(velocity: .fast)
      // swipeUp returns when the finger lifts, and the list moves on: the
      // drag and the deceleration measure about 2.5 s together, in every app
      // so far. Four seconds leaves room for a slower one.
      Thread.sleep(forTimeInterval: 4)
      stopMeasuring()
    }
    attachScreenshot(named: "after")
  }

  /// A screenshot in the result bundle, to check a run by eye: the list on
  /// screen before the swipes, and how far they got.
  /// `xcrun xcresulttool export attachments` saves them.
  private func attachScreenshot(named name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
