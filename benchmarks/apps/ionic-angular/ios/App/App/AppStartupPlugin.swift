import Capacitor
import OSLog

// The reference app's app-startup-module (launchperf-poke-rn), as a Capacitor plugin local to the
// app, registered by ViewController.swift. The harness finds each mark by name in Instruments'
// Points of Interest, whatever the subsystem.
@objc(AppStartupPlugin)
public class AppStartupPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppStartupPlugin"
    public let jsName = "AppStartup"
    // CAPPluginReturnNone: the web view posts the call and doesn't wait for an answer.
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "reportFullyDrawn", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "reportMountStart", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "reportMountEnd", returnType: CAPPluginReturnNone),
    ]

    private let signposter = OSSignposter(
        subsystem: Bundle.main.bundleIdentifier ?? "launchperf.ionic",
        category: .pointsOfInterest
    )
    private var fullyDrawn = false

    // A launch has one fully drawn moment; a second call (a remount, a tab revisited) must not add
    // a later mark that the harness could pick up instead.
    @objc func reportFullyDrawn(_ call: CAPPluginCall) {
        guard !fullyDrawn else { return }
        fullyDrawn = true
        signposter.emitEvent("TTFD", id: signposter.makeSignpostID())
    }

    // Not once per process: each opening of the mount screen is its own measurement.
    @objc func reportMountStart(_ call: CAPPluginCall) {
        signposter.emitEvent("MountStart", id: signposter.makeSignpostID())
    }

    @objc func reportMountEnd(_ call: CAPPluginCall) {
        signposter.emitEvent("MountEnd", id: signposter.makeSignpostID())
    }
}
