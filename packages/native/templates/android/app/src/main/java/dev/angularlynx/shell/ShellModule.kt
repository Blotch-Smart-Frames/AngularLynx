package dev.angularlynx.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule

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

    companion object {
        const val NAME = "AngularLynxShell"
        const val BACK_EVENT = "angularLynxBack"
    }
}
