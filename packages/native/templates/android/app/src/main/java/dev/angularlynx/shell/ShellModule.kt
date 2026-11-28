package dev.angularlynx.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.Trace
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.tasm.LynxEnv

/**
 * Native module the AngularLynx runtime calls as
 * `NativeModules.AngularLynxShell` (from the background thread, where
 * NativeModules lives).
 *
 * The system back gesture is synchronous: Android needs to know before the
 * gesture starts whether the app will handle it (predictive back shows a
 * different animation either way). The Angular app can't answer in time, so it
 * tells us ahead of time instead: it enables the back handler while the Router
 * has somewhere to go back to, or something open on top (a popover) takes
 * back. While enabled, back presses become an
 * `angularLynxBack` global event; while disabled (the default, and whenever the
 * runtime doesn't know about this module) Android's default back behavior
 * applies, which leaves the app. While enabled, the predictive back gesture
 * also arrives as it goes, as `angularLynxBackGesture` global events, so a
 * stack in the app can move its page with the finger.
 *
 * `collectGarbage` runs a full collection of the main thread's JavaScript
 * heap. PrimJS, which runs it, collects as the app runs, but those collections
 * leave behind much of what a screen leaves when it goes, and the app's native
 * memory grows with every screen it has shown. Lynx runs a full one, which also
 * hands the freed pages back to the system, when the host app reports memory
 * pressure, so this reports a moderate one. The runtime asks once it has
 * released about a screen's worth of elements and the app has settled
 * (`collect-garbage.ts` in `packages/runtime`).
 *
 * `hideSplashScreen` lets the splash screen go, which MainActivity keeps up
 * until the app's first screen is ready. The runtime's LynxSplashScreen
 * calls it.
 *
 * `reportFullyDrawn` calls `Activity.reportFullyDrawn()` when the app's first
 * screen is complete (the runtime's `reportFullyDrawn()`), which logcat prints
 * as `Fully drawn` and Android's startup tools (Macrobenchmark,
 * `am start -W`'s callers) read as time to full display. It's called on the
 * thread the runtime calls from, Lynx's engine thread: the system takes it
 * from any thread, and a post to the UI thread would add a wait to the moment
 * it marks. Each call also logs `Fully Drawn at <ns> ns` (below).
 *
 * `markEvent(name)` marks any other moment the app names, as an instant
 * section of that name in a system trace (`Trace.beginSection`, ended at
 * once), which Perfetto and Android Studio's profiler show on the thread
 * that called it: the start of the work a profile is about, for example.
 * Every call marks. The benchmark apps mark `MountStart` as their mount
 * screen starts building (`benchmarks/SPEC.md`); the iOS shell's is an
 * `os_signpost` event that Instruments shows.
 *
 * Both also log a line under this module's name, `Mark <name> at <ns> ns`
 * and `Fully Drawn at <ns> ns`, with `SystemClock.elapsedRealtimeNanos()`
 * at the call. logcat shows neither trace sections nor when the app called
 * reportFullyDrawn: its own `Fully drawn` line gives a time from the
 * launch's start, or from the first frame for a call before it, on no clock
 * a mark shares. The benchmark harness (`android_launch.py`) reads the two
 * lines to time a mount screen from its `MountStart` to its fully drawn call,
 * as the iOS harness does with the two signposts. The clock is in the
 * message, rather than taken from logcat's timestamps, because those are
 * wall-clock time, which an emulator steps when it syncs with its host.
 */
class ShellModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val host = param as Host
    private val main = Handler(Looper.getMainLooper())

    interface Host {
        fun setBackHandlerEnabled(enabled: Boolean)
        fun hideSplashScreen()
        fun markFullyDrawn()
    }

    @LynxMethod
    fun setBackHandlerEnabled(enabled: Boolean) {
        main.post { host.setBackHandlerEnabled(enabled) }
    }

    @LynxMethod
    fun hideSplashScreen() {
        main.post { host.hideSplashScreen() }
    }

    @LynxMethod
    fun reportFullyDrawn() {
        // Read before the call, which is the moment it marks: the system's
        // own bookkeeping comes after.
        val at = SystemClock.elapsedRealtimeNanos()
        host.markFullyDrawn()
        Log.i(NAME, "Fully Drawn at $at ns")
    }

    // On the calling thread, as reportFullyDrawn is, so the mark lands at the
    // moment it marks. A trace section's name is at most 127 characters.
    @LynxMethod
    fun markEvent(name: String) {
        val at = SystemClock.elapsedRealtimeNanos()
        Trace.beginSection(name.take(127))
        Trace.endSection()
        Log.i(NAME, "Mark $name at $at ns")
    }

    @LynxMethod
    fun collectGarbage() {
        main.post { LynxEnv.inst().trimMemory(MEMORY_PRESSURE_MODERATE) }
    }

    companion object {
        const val NAME = "AngularLynxShell"
        const val BACK_EVENT = "angularLynxBack"

        // Android's predictive back gesture as it goes (see MainActivity's
        // backHandler): it starts, moves, or is canceled. One that ends in
        // back sends BACK_EVENT, as a press does.
        const val BACK_GESTURE_EVENT = "angularLynxBackGesture"

        // Lynx's MemoryPressureLevel values, from a package the app doesn't
        // compile against.
        const val MEMORY_PRESSURE_MODERATE = 1
        const val MEMORY_PRESSURE_CRITICAL = 2
    }
}
