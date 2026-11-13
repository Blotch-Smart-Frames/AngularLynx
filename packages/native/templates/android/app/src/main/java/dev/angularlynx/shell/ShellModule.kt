package dev.angularlynx.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
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
 * has somewhere to go back to. While enabled, back presses become an
 * `angularLynxBack` global event; while disabled (the default, and whenever the
 * runtime doesn't know about this module) Android's default back behavior
 * applies, which leaves the app.
 *
 * `collectGarbage` runs a full collection of the main thread's JavaScript
 * heap. PrimJS, which runs it, collects as the app runs, but those collections
 * leave behind much of what a screen leaves when it goes, and the app's native
 * memory grows with every screen it has shown. Lynx runs a full one, which also
 * hands the freed pages back to the system, when the host app reports memory
 * pressure, so this reports a moderate one. The runtime asks once it has
 * released about a screen's worth of elements and the app has settled
 * (`collect-garbage.ts` in `packages/runtime`).
 */
class ShellModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val host = param as Host
    private val main = Handler(Looper.getMainLooper())

    interface Host {
        fun setBackHandlerEnabled(enabled: Boolean)
    }

    @LynxMethod
    fun setBackHandlerEnabled(enabled: Boolean) {
        main.post { host.setBackHandlerEnabled(enabled) }
    }

    @LynxMethod
    fun collectGarbage() {
        main.post { LynxEnv.inst().trimMemory(MEMORY_PRESSURE_MODERATE) }
    }

    companion object {
        const val NAME = "AngularLynxShell"
        const val BACK_EVENT = "angularLynxBack"

        // Lynx's MemoryPressureLevel values, from a package the app doesn't
        // compile against.
        const val MEMORY_PRESSURE_MODERATE = 1
        const val MEMORY_PRESSURE_CRITICAL = 2
    }
}
