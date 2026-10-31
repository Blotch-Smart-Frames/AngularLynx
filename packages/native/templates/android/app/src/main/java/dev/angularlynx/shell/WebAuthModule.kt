package dev.angularlynx.shell

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap

/**
 * The native module behind the runtime's `LynxWebAuthSession`, which calls it
 * as `NativeModules.AngularLynxWebAuth` (from the background thread, where
 * NativeModules lives).
 *
 * Lynx has no popups or redirects, so a sign-in page can't run inside the
 * app. The activity opens it in a Custom Tab instead, and the page's redirect
 * to the callback scheme comes back to it as a deep link, which is why the
 * scheme has to be one of the app's `deepLinkSchemes`.
 */
class WebAuthModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val host = param as Host
    private val main = Handler(Looper.getMainLooper())

    interface Host {
        /**
         * Opens [url] and calls [done] once with the URL the page redirected
         * to on [callbackScheme], or with why it didn't.
         */
        fun startWebAuthSession(url: Uri, callbackScheme: String, done: (Result) -> Unit)
    }

    /** How a session ended: the URL the page returned to, or why it didn't. */
    sealed interface Result {
        data class Returned(val url: String) : Result
        data object Canceled : Result
        data class Failed(val message: String) : Result
    }

    /**
     * Calls back once with `{ url }` or `{ error, message }`, where `error` is
     * `canceled` or `failed`, as the iOS module does.
     */
    @LynxMethod
    fun start(request: ReadableMap, callback: Callback) {
        val url = request.getString("url", "")
        val scheme = request.getString("callbackScheme", "")
        if (url.isEmpty() || scheme.isEmpty()) {
            callback.invoke(failed("The sign-in needs a URL and a callback scheme."))
            return
        }
        // Lynx calls modules off the main thread, and the activity starts the
        // Custom Tab.
        main.post {
            host.startWebAuthSession(Uri.parse(url), scheme) { result ->
                callback.invoke(
                    when (result) {
                        is Result.Returned -> JavaOnlyMap.from(mapOf("url" to result.url))
                        Result.Canceled -> JavaOnlyMap.from(
                            mapOf("error" to "canceled", "message" to "The sign-in was canceled."),
                        )
                        is Result.Failed -> failed(result.message)
                    },
                )
            }
        }
    }

    private fun failed(message: String) =
        JavaOnlyMap.from(mapOf("error" to "failed", "message" to message))

    companion object {
        const val NAME = "AngularLynxWebAuth"
    }
}
