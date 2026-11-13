package dev.angularlynx.shell

import android.content.Context
import android.content.Intent
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap

/**
 * The native module behind the runtime's `LynxShortcuts`, which calls it as
 * `NativeModules.AngularLynxShortcuts` (from the background thread, where
 * NativeModules lives). iOS's shell has one of the same name.
 *
 * angular.json's `shortcuts` become the app's static shortcuts
 * (`res/xml/shortcuts.xml`, which the generator writes), the ones in the menu
 * a long press on the app's icon opens. One may start the app, so the
 * activity can't hand it straight to the Angular app: it leaves the shortcut
 * here, and the runtime takes it when it's ready, at startup and again each
 * time it hears the `angularLynxShortcut` global event. A shortcut waits for
 * as long as that takes, so the one that started the app is never lost, and
 * none is handled twice.
 *
 * `take` calls back with `{ shortcuts }`: each shortcut the person ran since
 * the last call, as `{ id, route? }`.
 */
class ShortcutsModule(context: Context, param: Any?) : LynxModule(context, param) {
    @LynxMethod
    fun take(callback: Callback) {
        val shortcuts = JavaOnlyArray()
        for (shortcut in takeWaiting()) {
            shortcuts.pushMap(JavaOnlyMap.from(shortcut))
        }
        callback.invoke(JavaOnlyMap.from(mapOf("shortcuts" to shortcuts)))
    }

    companion object {
        const val NAME = "AngularLynxShortcuts"

        // The global event that says a shortcut is waiting. It carries
        // nothing: the listener answers by taking them.
        const val EVENT = "angularLynxShortcut"

        // What a shortcut's intent carries (res/xml/shortcuts.xml).
        const val EXTRA_ID = "angularLynxShortcutId"
        const val EXTRA_ROUTE = "angularLynxShortcutRoute"

        // The activity leaves them on the main thread, and Lynx calls
        // modules off it.
        private val waiting = mutableListOf<Map<String, String>>()

        /**
         * Leaves the shortcut `intent` carries for the runtime to take.
         * Returns whether it carried one.
         */
        fun run(intent: Intent): Boolean {
            val id = intent.getStringExtra(EXTRA_ID) ?: return false
            val route = intent.getStringExtra(EXTRA_ROUTE)
            val shortcut = if (route == null) mapOf("id" to id) else mapOf("id" to id, "route" to route)
            synchronized(waiting) { waiting.add(shortcut) }
            return true
        }

        private fun takeWaiting(): List<Map<String, String>> =
            synchronized(waiting) {
                val taken = waiting.toList()
                waiting.clear()
                taken
            }
    }
}
