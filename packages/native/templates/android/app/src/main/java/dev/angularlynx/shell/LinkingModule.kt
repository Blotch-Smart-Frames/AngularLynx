package dev.angularlynx.shell

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap

/**
 * The native module behind the runtime's `LynxLinking`, which calls it as
 * `NativeModules.AngularLynxLinking` (from the background thread, where
 * NativeModules lives). MainActivity registers it with itself as the param:
 * the module starts activities from it and watches its lifecycle.
 *
 * Lynx has no window.open or `<a href>`, so a link can't leave the app on its
 * own. `openURL` sends an ACTION_VIEW intent, which the browser, the mail app
 * or the app that claims the URL opens, and `openInApp` shows the page in a
 * Custom Tab over the app. Each method calls back once: with `{}` when it's
 * done, `{ value }` for `canOpenURL`, or `{ error: "failed", message }`, as
 * the iOS module does.
 */
class LinkingModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val activity = param as ComponentActivity
    private val main = Handler(Looper.getMainLooper())

    // The open Custom Tab's watcher, or null when none is open. Only touched
    // on the main thread.
    private var sheet: DefaultLifecycleObserver? = null

    /**
     * Calls back once Android has started the activity that opens [url].
     * Starting it needs no `<queries>` entry: only [canOpenURL] does.
     */
    @LynxMethod
    fun openURL(url: String, callback: Callback) {
        // Lynx calls modules off the main thread, and the activity starts
        // others from it.
        main.post {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                callback.invoke(JavaOnlyMap())
            } catch (_: ActivityNotFoundException) {
                callback.invoke(failed("Nothing on this device can open $url."))
            }
        }
    }

    /**
     * Calls back with `{ value }`: whether an activity on the phone opens
     * [url]. From Android 11, the app sees only the apps its manifest's
     * `<queries>` asks about, which the generator writes from angular.json's
     * `canOpenURLSchemes`, so for any other scheme the answer is `false`.
     */
    @LynxMethod
    fun canOpenURL(url: String, callback: Callback) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        val found = intent.resolveActivity(activity.packageManager) != null
        callback.invoke(JavaOnlyMap.from(mapOf("value" to found)))
    }

    /**
     * Shows [url] in a Custom Tab and calls back once the app is back in
     * front. Android says nothing when a Custom Tab closes, so the module
     * watches the activity instead: it pauses as the tab opens, and resumes
     * when the person closes the tab or comes back to the app another way.
     * [options] may hold `toolbarColor`, a `#` and eight hex digits (red,
     * green, blue, alpha); the tab picks its icons' color to contrast with it.
     */
    @LynxMethod
    fun openInApp(url: String, options: ReadableMap, callback: Callback) {
        val uri = Uri.parse(url)
        val toolbarColor = color(options.getString("toolbarColor", ""))
        main.post {
            if (sheet != null) {
                callback.invoke(failed("A browser sheet is already open."))
                return@post
            }
            // A Custom Tab falls back to any app that opens the intent, which
            // for another scheme isn't a browser.
            if (uri.scheme?.lowercase() !in setOf("http", "https")) {
                callback.invoke(failed("The browser sheet opens http and https URLs only, not $url."))
                return@post
            }
            val tab = CustomTabsIntent.Builder().apply {
                if (toolbarColor != null) {
                    setDefaultColorSchemeParams(
                        CustomTabColorSchemeParams.Builder().setToolbarColor(toolbarColor).build(),
                    )
                }
            }.build()
            val watcher = object : DefaultLifecycleObserver {
                var left = false

                override fun onPause(owner: LifecycleOwner) {
                    left = true
                }

                // Also called as soon as the watcher is added, with the
                // activity already resumed, before the tab opens.
                override fun onResume(owner: LifecycleOwner) {
                    if (!left) return
                    closed(this)
                    callback.invoke(JavaOnlyMap())
                }
            }
            sheet = watcher
            activity.lifecycle.addObserver(watcher)
            try {
                tab.launchUrl(activity, uri)
            } catch (_: ActivityNotFoundException) {
                closed(watcher)
                callback.invoke(failed("No browser on this device can open $url."))
            }
        }
    }

    private fun closed(watcher: DefaultLifecycleObserver) {
        activity.lifecycle.removeObserver(watcher)
        sheet = null
    }

    /**
     * A `#` and eight hex digits, red, green, blue and alpha, as the runtime
     * writes every color it's given, as an ARGB Int.
     */
    private fun color(hex: String): Int? {
        if (hex.length != 9 || !hex.startsWith("#")) return null
        val rgba = hex.substring(1).toLongOrNull(16) ?: return null
        return ((rgba and 0xFF) shl 24 or (rgba shr 8)).toInt()
    }

    private fun failed(message: String) =
        JavaOnlyMap.from(mapOf("error" to "failed", "message" to message))

    companion object {
        const val NAME = "AngularLynxLinking"
    }
}
