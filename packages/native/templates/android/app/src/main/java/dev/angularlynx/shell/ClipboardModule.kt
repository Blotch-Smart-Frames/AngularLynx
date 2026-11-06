package dev.angularlynx.shell

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap

/**
 * The native module behind the runtime's `LynxClipboard`, which calls it as
 * `NativeModules.AngularLynxClipboard` (from the background thread, where
 * NativeModules lives).
 *
 * Text goes on the system clipboard as a plain-text clip. Each method calls
 * back once: `setString` with `{}` or `{ error }`, `getString` with
 * `{ value }`, as the iOS module does.
 */
class ClipboardModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val appContext = context.applicationContext
    private val main = Handler(Looper.getMainLooper())

    private val clipboard: ClipboardManager
        get() = appContext.getSystemService(ClipboardManager::class.java)

    // Lynx calls modules off the main thread, and the clipboard belongs to
    // the UI: its calls run on the main thread, as the system's own text
    // fields make them.
    //
    // Android 13 and later show the copied text in a panel of their own, and
    // TalkBack says "Text copied": the runtime's `confirmsCopies` tells the
    // app so, which then needn't confirm it again.
    @LynxMethod
    fun setString(text: String, callback: Callback) {
        main.post {
            try {
                // No label: it describes the clip to whoever pastes it, and the
                // text is all the app has to say.
                clipboard.setPrimaryClip(ClipData.newPlainText(null, text))
                callback.invoke(JavaOnlyMap())
            } catch (error: RuntimeException) {
                // A clip larger than the system's binder buffer (about 1 MB)
                // fails to reach the clipboard service.
                callback.invoke(
                    JavaOnlyMap.from(
                        mapOf("error" to (error.message ?: "The text could not be copied.")),
                    ),
                )
            }
        }
    }

    /**
     * The clipboard's text, or `""` when it holds none. Android 10 and later
     * let only the app in front read it, and Android 12 and later tell the
     * person that the app pasted.
     */
    @LynxMethod
    fun getString(callback: Callback) {
        main.post {
            val clip = clipboard.primaryClip
            val text =
                if (clip != null && clip.itemCount > 0) {
                    // Turns a URI or an intent clip into text too, as pasting
                    // into a text field does.
                    clip.getItemAt(0).coerceToText(appContext)?.toString() ?: ""
                } else {
                    ""
                }
            callback.invoke(JavaOnlyMap.from(mapOf("value" to text)))
        }
    }

    companion object {
        const val NAME = "AngularLynxClipboard"
    }
}
