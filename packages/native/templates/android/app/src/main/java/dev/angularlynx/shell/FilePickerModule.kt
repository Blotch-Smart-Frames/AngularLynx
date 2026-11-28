package dev.angularlynx.shell

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.MimeTypeMap
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.lynx.react.bridge.ReadableType
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.Executors

/**
 * The native module behind the runtime's `LynxFilePicker`, which calls it as
 * `NativeModules.AngularLynxFilePicker` (from the background thread, where
 * NativeModules lives).
 *
 * Lynx has no `<input type="file">` and no downloads. The activity opens the
 * system's document picker (`ACTION_OPEN_DOCUMENT`) and its save screen
 * (`ACTION_CREATE_DOCUMENT`) instead: Downloads, Drive and the other apps'
 * document providers. Neither needs a permission, since the app reads or
 * writes only the document the person chose.
 *
 * The bytes go back and forth as base64, since the module's callback and the
 * runtime's relay to the main thread carry only what JSON can.
 *
 * The generator leaves this file, and the lines in MainActivity that launch
 * the pickers and register it, out of an app whose angular.json doesn't set
 * `filePicker`.
 */
class FilePickerModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val host = param as Host
    private val main = Handler(Looper.getMainLooper())

    interface Host {
        /**
         * Starts [intent] for its result, and calls [done] once with the
         * result code and data. Returns false, without starting it, while
         * another is open.
         */
        fun startDocumentActivity(intent: Intent, done: (Int, Intent?) -> Unit): Boolean
    }

    /**
     * Opens the document picker and calls back once with `{ files: [{ base64,
     * name, type }] }`, `{ canceled: true }` when the person closes it, or
     * `{ error: "too-large" | "failed", message }`, as the iOS module does.
     */
    @LynxMethod
    fun pick(options: ReadableMap, callback: Callback) {
        val mimeTypes = mimeTypes(options)
        val multiple = options.hasKey("multiple") && options.getBoolean("multiple")
        // JavaScript numbers can arrive as either, so it's read as a double.
        val maxBytes = if (options.hasKey("maxBytes")) options.getDouble("maxBytes").toLong() else Long.MAX_VALUE
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            // Only documents the app can open as a stream of bytes.
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeTypes.singleOrNull() ?: "*/*"
            if (mimeTypes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
        }
        start(intent, callback) { resultCode, data ->
            val uris = if (resultCode == Activity.RESULT_OK) picked(data) else emptyList()
            if (uris.isEmpty()) {
                callback.invoke(JavaOnlyMap.from(mapOf("canceled" to true)))
            } else {
                // Reading a large document takes a moment: off the main thread.
                worker.execute { callback.invoke(read(uris, maxBytes)) }
            }
        }
    }

    /**
     * Lets the person choose where to save `{ base64, name, type }`, writes it
     * there, and calls back once with `{ saved: true }`, `{ saved: false }`
     * when they close the screen, or `{ error: "failed", message }`.
     */
    @LynxMethod
    fun save(file: ReadableMap, callback: Callback) {
        val base64 = file.optString("base64")
        val bytes = try {
            base64?.let { Base64.decode(it, Base64.DEFAULT) }
        } catch (_: IllegalArgumentException) {
            null
        }
        if (bytes == null) {
            callback.invoke(failed("The file to save had no bytes."))
            return
        }
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = file.optString("type") ?: "application/octet-stream"
            putExtra(Intent.EXTRA_TITLE, file.optString("name") ?: "file")
        }
        start(intent, callback) { resultCode, data ->
            val uri = data?.data
            if (resultCode != Activity.RESULT_OK || uri == null) {
                callback.invoke(JavaOnlyMap.from(mapOf("saved" to false)))
            } else {
                worker.execute { callback.invoke(write(uri, bytes)) }
            }
        }
    }

    /**
     * Starts [intent] from the activity, on the main thread: Lynx calls
     * modules off it.
     */
    private fun start(intent: Intent, callback: Callback, done: (Int, Intent?) -> Unit) {
        main.post {
            val opened = try {
                host.startDocumentActivity(intent, done)
            } catch (_: android.content.ActivityNotFoundException) {
                callback.invoke(failed("This phone has no document picker."))
                return@post
            }
            if (!opened) callback.invoke(failed("A picker is already open."))
        }
    }

    /**
     * The MIME types for `LynxFilePicker`'s `types`, which are given as an
     * `<input type="file">`'s `accept`: MIME types, a family such as
     * image's (`image/` and a star: written out, it would open a comment
     * inside this one, since Kotlin nests them), or extensions such as
     * `.docx`, which Android's picker
     * doesn't take, so they're looked up. Any document when none is given or
     * known.
     */
    private fun mimeTypes(options: ReadableMap): List<String> {
        if (!options.hasKey("types") || options.getType("types") != ReadableType.Array) return emptyList()
        val types = options.getArray("types")
        return (0 until types.size()).mapNotNull { index ->
            val type = types.getString(index)
            if (type.startsWith(".")) {
                MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.substring(1).lowercase())
            } else {
                type
            }
        }.distinct()
    }

    /** The documents picked: one in the data, or several in its ClipData. */
    private fun picked(data: Intent?): List<Uri> {
        val clip = data?.clipData
        if (clip != null) return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
        return listOfNotNull(data?.data)
    }

    /**
     * The callback's answer for the picked documents: their bytes, names and
     * types, or too-large when they hold more than the runtime can carry,
     * checked from the sizes their providers give before anything is read,
     * and again as each is read.
     */
    private fun read(uris: List<Uri>, maxBytes: Long): JavaOnlyMap {
        val resolver = mContext.contentResolver
        val documents = uris.map { uri -> Triple(uri, displayName(uri) ?: "file", size(uri)) }
        if (documents.sumOf { it.third ?: 0L } > maxBytes) return tooLarge()
        val files = JavaOnlyArray()
        var remaining = maxBytes
        for ((uri, name, _) in documents) {
            val bytes = try {
                resolver.openInputStream(uri)?.use { readAtMost(it, remaining) }
            } catch (_: IOException) {
                null
            } catch (_: SecurityException) {
                null
            } ?: return failed("$name couldn't be read.")
            // A provider needn't say a document's size, so the check above
            // can pass one of any size: the read stops past what's left of
            // the limit instead of holding the whole document first.
            if (bytes.size > remaining) return tooLarge()
            remaining -= bytes.size
            files.pushMap(
                JavaOnlyMap.from(
                    mapOf(
                        "base64" to Base64.encodeToString(bytes, Base64.NO_WRAP),
                        "name" to name,
                        "type" to (resolver.getType(uri) ?: "application/octet-stream"),
                    ),
                ),
            )
        }
        return JavaOnlyMap.from(mapOf("files" to files))
    }

    /**
     * The stream's bytes, up to [limit] and one more: a result longer than
     * [limit] says the document is over it, without reading the rest.
     */
    private fun readAtMost(input: InputStream, limit: Long): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        while (output.size() <= limit) {
            // Written so a limit of Long.MAX_VALUE can't overflow.
            val left = limit - output.size()
            val wanted = if (left >= buffer.size) buffer.size else (left + 1).toInt()
            val read = input.read(buffer, 0, wanted)
            if (read < 0) break
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }

    private fun tooLarge() =
        JavaOnlyMap.from(mapOf("error" to "too-large", "message" to "The files picked are too large."))

    private fun write(uri: Uri, bytes: ByteArray): JavaOnlyMap =
        try {
            // "wt" truncates a document the person chose to replace. A
            // provider that can't open it gives no stream.
            val stream = mContext.contentResolver.openOutputStream(uri, "wt")
            if (stream == null) {
                failed("The file couldn't be written.")
            } else {
                stream.use { it.write(bytes) }
                JavaOnlyMap.from(mapOf("saved" to true))
            }
        } catch (error: IOException) {
            failed(error.message ?: "The file couldn't be written.")
        } catch (error: SecurityException) {
            failed(error.message ?: "The file couldn't be written.")
        }

    /** The document's name, such as `receipt.pdf`. */
    private fun displayName(uri: Uri): String? = column(uri, OpenableColumns.DISPLAY_NAME) { getString(it) }

    /** The document's size, or null when its provider doesn't say. */
    private fun size(uri: Uri): Long? = column(uri, OpenableColumns.SIZE) { if (isNull(it)) null else getLong(it) }

    private fun <T> column(uri: Uri, name: String, value: android.database.Cursor.(Int) -> T?): T? =
        try {
            mContext.contentResolver.query(uri, arrayOf(name), null, null, null)
                ?.use { cursor -> if (cursor.moveToFirst()) cursor.value(0) else null }
        } catch (_: RuntimeException) {
            null
        }

    private fun failed(message: String) =
        JavaOnlyMap.from(mapOf("error" to "failed", "message" to message))

    private fun ReadableMap.optString(key: String): String? =
        if (hasKey(key) && getType(key) == ReadableType.String) getString(key) else null

    companion object {
        const val NAME = "AngularLynxFilePicker"

        /** One thread for reading and writing, so two documents aren't held at once. */
        private val worker = Executors.newSingleThreadExecutor()
    }
}
