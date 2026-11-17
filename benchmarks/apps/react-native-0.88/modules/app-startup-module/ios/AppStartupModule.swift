import ExpoModulesCore
import OSLog

public class AppStartupModule: Module {
  private let signposter = OSSignposter(
    subsystem: "com.swmansion.launchperfrn.LaunchPerfRN",
    category: "PointsOfInterest"
  )
  private var loggedEvents = Set<String>()

  public func definition() -> ModuleDefinition {
    Name("AppStartupModule")

    Function("reportInitiallyDrawn") {
      self.logEvent(name: "TTID")
    }

    Function("reportFullyDrawn") {
      self.logEvent(name: "TTFD")
    }

    // The benchmark's mount screen (app/bench/mount.tsx) brackets its render
    // with these, read by name like TTFD.
    Function("reportMountStart") {
      self.logEvent(name: "MountStart")
    }

    Function("reportMountEnd") {
      self.logEvent(name: "MountEnd")
    }
  }

  private func logEvent(name: String) {
    guard !loggedEvents.contains(name) else { return }
    loggedEvents.insert(name)
    let id = signposter.makeSignpostID()
    switch name {
        case "TTID":
            signposter.emitEvent("TTID", id: id)
        case "TTFD":
            signposter.emitEvent("TTFD", id: id)
        // emitEvent takes a StaticString, so each name needs its own case.
        case "MountStart":
            signposter.emitEvent("MountStart", id: id)
        case "MountEnd":
            signposter.emitEvent("MountEnd", id: id)
        default:
            signposter.emitEvent("Milestone", id: id)
    }
  }
}
