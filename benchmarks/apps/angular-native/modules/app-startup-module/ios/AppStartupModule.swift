import ExpoModulesCore
import OSLog

// The reference app's module (launchperf-poke-rn), with the benchmark's mount marks added.
// The harness finds each mark by name in Instruments' Points of Interest, whatever the subsystem.
public class AppStartupModule: Module {
  private let signposter = OSSignposter(
    subsystem: Bundle.main.bundleIdentifier ?? "launchperf.angularnative",
    category: "PointsOfInterest"
  )
  private var loggedEvents = Set<String>()

  public func definition() -> ModuleDefinition {
    Name("AppStartupModule")

    Function("reportInitiallyDrawn") {
      self.logOnce(name: "TTID")
    }

    Function("reportFullyDrawn") {
      self.logOnce(name: "TTFD")
    }

    // Not once per process: the mount screen can be opened again by another deep link, and each
    // opening is its own measurement.
    Function("reportMountStart") {
      self.signposter.emitEvent("MountStart", id: self.signposter.makeSignpostID())
    }

    Function("reportMountEnd") {
      self.signposter.emitEvent("MountEnd", id: self.signposter.makeSignpostID())
    }
  }

  // A launch has one first frame and one fully drawn moment; a second call (a remount, a tab
  // revisited) must not add a later mark that the harness could pick up instead.
  private func logOnce(name: String) {
    guard !loggedEvents.contains(name) else { return }
    loggedEvents.insert(name)
    let id = signposter.makeSignpostID()
    // emitEvent takes a StaticString, so each name is spelled out.
    switch name {
    case "TTID":
      signposter.emitEvent("TTID", id: id)
    case "TTFD":
      signposter.emitEvent("TTFD", id: id)
    default:
      signposter.emitEvent("Milestone", id: id)
    }
  }
}
