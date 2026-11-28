package dev.angularlynx.shell

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import android.webkit.MimeTypeMap
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.Executors

/**
 * The native module behind the runtime's `LynxShareTarget`, which calls it as
 * `NativeModules.AngularLynxShareTarget` (from the background thread, where
 * NativeModules lives). iOS's shell has one of the same name.
 *
 * angular.json's `shareTarget` puts `ACTION_SEND` and `ACTION_SEND_MULTIPLE`
 * intent filters for its MIME types on MainActivity, so the app is in other
 * apps' share sheets. A share may start the app, so the activity can't hand
 * it straight to the Angular app: it leaves it here ([receive]), and the
 * runtime takes it when it's ready, at startup and each time it hears the
 * `angularLynxShare` global event. A share waits for as long as that takes,
 * so the one that started the app isn't lost, and none is handled twice.
 *
 * The shared files are read as soon as the share arrives: the app may read
 * another app's `content://` URI only while the activity it was granted to
 * is alive. `take` calls back with `{ shares }`: each `{ title?, text?, url?,
 * files: [{ base64, name, type }] }` since the last call, oldest first.
 *
 * The generator leaves this file, and the lines in MainActivity that hand it
 * the intents and register it, out of an app whose angular.json has no
 * `shareTarget`.
 */
class ShareTargetModule(context: Context, param: Any?) : LynxModule(context, param) {
    @LynxMethod
    fun take(callback: Callback) {
        val shares = JavaOnlyArray()
        for (share in takeWaiting()) {
            shares.pushMap(share)
        }
        callback.invoke(JavaOnlyMap.from(mapOf("shares" to shares)))
    }

    companion object {
        const val NAME = "AngularLynxShareTarget"

        // The global event that says a share is waiting. It carries nothing:
        // the listener answers by taking them.
        const val EVENT = "angularLynxShare"

        private const val TAG = "AngularLynxShareTarget"

        /**
         * The most bytes of files one share hands the app, all its files
         * together: 20 MiB, as LynxFilePicker's FILE_PICKER_MAX_BYTES. They
         * travel to JavaScript as base64, held several times over on the
         * way, so a file that would take a share past it is left out.
         */
        private const val MAX_BYTES = 20L * 1024 * 1024

        /** An absolute link, which a share of a page carries as its text. */
        private val LINK = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://\\S+$")

        private val worker = Executors.newSingleThreadExecutor()
        private val main = Handler(Looper.getMainLooper())

        // The activity leaves them on the worker thread, and Lynx calls
        // modules off it.
        private val waiting = mutableListOf<JavaOnlyMap>()

        /**
         * Leaves the share `intent` carries for the runtime to take, and
         * calls [arrived] on the main thread once it's waiting. Returns
         * whether the intent was a share.
         */
        fun receive(context: Context, intent: Intent, arrived: () -> Unit): Boolean {
            if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) {
                return false
            }
            val accepted = context.resources.getStringArray(R.array.angular_lynx_share_mime_types).toList()
            val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: intent.getStringExtra(Intent.EXTRA_TITLE)
            val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            val streams = streams(intent)
            val resolver = context.applicationContext.contentResolver
            // Reading a large photo takes a moment: off the main thread. The
            // grant to read the URIs lasts as long as the activity, which
            // this outlives only if the person leaves at once.
            worker.execute {
                val share = mutableMapOf<String, Any>()
                if (subject != null) share["title"] = subject
                // Android shares a link as text (Chrome sends its page's URL
                // as text/plain): a text that is one link is the share's url,
                // for an app that takes links.
                val trimmed = text?.trim()
                if (trimmed != null && LINK.matches(trimmed) && accepts(accepted, "text/uri-list")) {
                    share["url"] = trimmed
                } else if (!text.isNullOrEmpty() && accepts(accepted, "text/plain")) {
                    share["text"] = text
                }
                val files = JavaOnlyArray()
                var remaining = MAX_BYTES
                for (uri in streams) {
                    val type = resolver.getType(uri) ?: typeFromName(uri) ?: "application/octet-stream"
                    if (!accepts(accepted, type)) continue
                    val bytes = try {
                        resolver.openInputStream(uri)?.use { readAtMost(it, remaining) }
                    } catch (error: IOException) {
                        Log.w(TAG, "Couldn't read $uri", error)
                        null
                    } catch (error: SecurityException) {
                        Log.w(TAG, "Not allowed to read $uri", error)
                        null
                    } ?: continue
                    if (bytes.size > remaining) {
                        Log.w(TAG, "Left out $uri: the share is over ${MAX_BYTES / 1024 / 1024} MiB")
                        continue
                    }
                    remaining -= bytes.size
                    files.pushMap(
                        JavaOnlyMap.from(
                            mapOf(
                                "base64" to Base64.encodeToString(bytes, Base64.NO_WRAP),
                                "name" to (displayName(context, uri) ?: uri.lastPathSegment ?: "file"),
                                "type" to type,
                            ),
                        ),
                    )
                }
                // Nothing the app takes, such as text for an app that takes
                // only photos: there's nothing to hand over.
                if (files.size == 0 && !share.containsKey("text") && !share.containsKey("url")) {
                    return@execute
                }
                share["files"] = files
                synchronized(waiting) { waiting.add(JavaOnlyMap.from(share)) }
                main.post(arrived)
            }
            return true
        }

        private fun takeWaiting(): List<JavaOnlyMap> =
            synchronized(waiting) {
                val taken = waiting.toList()
                waiting.clear()
                taken
            }

        /** The files a share carries: one for ACTION_SEND, a list for ACTION_SEND_MULTIPLE. */
        @Suppress("DEPRECATION")
        private fun streams(intent: Intent): List<Uri> {
            if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
                return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
                } ?: emptyList()
            }
            val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            }
            return listOfNotNull(uri)
        }

        /**
         * Whether angular.json's `shareTarget.mimeTypes` takes [type]: the
         * type itself, a wildcard for its subtype, or the wildcard for
         * every type. The intent filters already chose, but a share's own
         * type is often broader than each of its files', such as the
         * wildcard for a photo and a PDF together.
         */
        private fun accepts(accepted: List<String>, type: String): Boolean {
            val mime = type.lowercase()
            val major = mime.substringBefore('/')
            return accepted.any { it == "*/*" || it == mime || it == "$major/*" }
        }

        private fun typeFromName(uri: Uri): String? =
            uri.lastPathSegment?.substringAfterLast('.', "")?.takeIf { it.isNotEmpty() }?.let {
                MimeTypeMap.getSingleton().getMimeTypeFromExtension(it.lowercase())
            }

        /** The file's name, such as `photo.jpg`, as its provider gives it. */
        private fun displayName(context: Context, uri: Uri): String? =
            try {
                context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                    if (it.moveToFirst() && !it.isNull(0)) it.getString(0) else null
                }
            } catch (_: Exception) {
                null
            }

        /**
         * The stream's bytes, up to [limit] and one more: a result longer
         * than [limit] says the file is over it, without reading the rest.
         */
        private fun readAtMost(input: InputStream, limit: Long): ByteArray {
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            while (output.size() <= limit) {
                val left = limit - output.size()
                val wanted = if (left >= buffer.size) buffer.size else (left + 1).toInt()
                val read = input.read(buffer, 0, wanted)
                if (read < 0) break
                output.write(buffer, 0, read)
            }
            return output.toByteArray()
        }
    }
}
