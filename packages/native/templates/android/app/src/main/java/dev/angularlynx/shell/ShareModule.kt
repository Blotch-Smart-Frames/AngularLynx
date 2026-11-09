package dev.angularlynx.shell

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.MimeTypeMap
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableArray
import com.lynx.react.bridge.ReadableMap
import com.lynx.react.bridge.ReadableType
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors

/**
 * The native module behind the runtime's `LynxShare`, which calls it as
 * `NativeModules.AngularLynxShare` (from the background thread, where
 * NativeModules lives). MainActivity registers it with itself as the param:
 * the module starts the share sheet from it and watches its lifecycle.
 *
 * Lynx has no `navigator.share()`. Android's share sheet stands in for it:
 * an ACTION_SEND (or ACTION_SEND_MULTIPLE) intent in a chooser. Each file is
 * written to the app's cache first, under the name the app gave it, and
 * handed over as a content:// URI of the app's FileProvider (the manifest's
 * `<provider>`), which the receiving app may read once.
 *
 * Android doesn't say whether the person finished sharing in the app they
 * picked. The chooser does say which app they picked, through an
 * IntentSender, so the module calls back `{ shared: true }` then, and
 * `{ shared: false }` when the activity comes back to the front without a
 * pick, as when they close the sheet. Or `{ error: "failed", message }`.
 */
class ShareModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val activity = param as ComponentActivity
    private val main = Handler(Looper.getMainLooper())

    /** The open share sheet. Only touched on the main thread. */
    private var open: Share? = null

    private inner class Share(val callback: Callback) : DefaultLifecycleObserver {
        private var answered = false
        private var paused = false

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) = answer(true)
        }

        override fun onPause(owner: LifecycleOwner) {
            paused = true
        }

        override fun onResume(owner: LifecycleOwner) {
            if (!paused) return
            // The pick's broadcast comes before the app is back in front;
            // the wait lets a late one in before this calls it a close.
            main.postDelayed({ answer(false) }, PICK_GRACE_MS)
        }

        fun answer(shared: Boolean) {
            if (answered) return
            answered = true
            callback.invoke(JavaOnlyMap.from(mapOf("shared" to shared)))
            // Once the pick is in, the module is done with the sheet: a
            // second share can open when the person comes back.
            close()
        }

        fun close() {
            if (open === this) open = null
            activity.lifecycle.removeObserver(this)
            try {
                activity.unregisterReceiver(receiver)
            } catch (_: IllegalArgumentException) {
                // Already unregistered.
            }
        }
    }

    /**
     * Opens the share sheet with [request]'s `files` (`{ base64, name, type }`),
     * `title`, `text` and `url`, and calls back once with `{ shared }`, or
     * with `{ error: "failed", message }`.
     */
    @LynxMethod
    fun share(request: ReadableMap, callback: Callback) {
        // Decoding and writing a photo takes a moment: off the main thread.
        worker.execute {
            val uris = try {
                writeFiles(request.optArray("files"))
            } catch (error: IOException) {
                callback.invoke(failed("The files couldn't be written to share: ${error.message}"))
                return@execute
            } catch (error: IllegalArgumentException) {
                callback.invoke(failed("A file's bytes couldn't be read."))
                return@execute
            }
            val intent = sendIntent(
                uris,
                request.optString("title"),
                request.optString("text"),
                request.optString("url"),
            )
            // The chooser is UI: the main thread starts it.
            main.post { present(intent, callback) }
        }
    }

    private fun present(intent: Intent, callback: Callback) {
        if (open != null) {
            callback.invoke(failed("A share sheet is already open."))
            return
        }
        val share = Share(callback)
        // The chooser sends this when the person picks an app. It's the
        // app's own, so the receiver needn't be exported, and immutable,
        // since nothing it would fill in is read.
        val action = "${activity.packageName}.ANGULAR_LYNX_SHARE_PICKED.${UUID.randomUUID()}"
        ContextCompat.registerReceiver(
            activity,
            share.receiver,
            IntentFilter(action),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        val picked = PendingIntent.getBroadcast(
            activity,
            0,
            Intent(action).setPackage(activity.packageName),
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE,
        )
        open = share
        activity.lifecycle.addObserver(share)
        try {
            activity.startActivity(Intent.createChooser(intent, null, picked.intentSender))
        } catch (error: RuntimeException) {
            share.close()
            callback.invoke(failed("The share sheet couldn't open: ${error.message}"))
        }
    }

    /**
     * Writes the files under the cache's share folder, the one the
     * FileProvider's paths (res/xml/share_paths.xml) name, and returns their
     * content:// URIs. The last share's files go first: the app that got them
     * may read them after the share sheet closes, so they're kept until the
     * next share rather than deleted when it closes.
     */
    private fun writeFiles(files: ReadableArray?): List<Pair<Uri, String>> {
        val root = File(mContext.cacheDir, SHARE_FOLDER)
        root.deleteRecursively()
        if (files == null || files.size() == 0) return emptyList()
        val folder = File(root, UUID.randomUUID().toString())
        if (!folder.mkdirs()) throw IOException("No folder for the files")
        val used = HashSet<String>()
        return (0 until files.size()).map { index ->
            val file = files.getMap(index)
            val bytes = Base64.decode(file.optString("base64") ?: "", Base64.DEFAULT)
            val name = uniqueName(safeName(file.optString("name")), used)
            val target = File(folder, name)
            target.writeBytes(bytes)
            val uri = FileProvider.getUriForFile(mContext, "${mContext.packageName}$AUTHORITY_SUFFIX", target)
            uri to (file.optString("type")?.takeIf { it.isNotEmpty() } ?: typeOf(name))
        }
    }

    private fun sendIntent(files: List<Pair<Uri, String>>, title: String?, text: String?, url: String?): Intent {
        val intent = if (files.size > 1) {
            Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(
                Intent.EXTRA_STREAM,
                ArrayList(files.map { it.first }),
            )
        } else {
            Intent(Intent.ACTION_SEND).apply {
                files.firstOrNull()?.let { putExtra(Intent.EXTRA_STREAM, it.first) }
            }
        }
        intent.type = when {
            files.isEmpty() -> "text/plain"
            else -> commonType(files.map { it.second })
        }
        // Text and a link go together, as Chrome shares them on Android. A
        // title on its own, as the Web Share API allows, is the text.
        val body = listOfNotNull(text, url).joinToString(" ").ifEmpty { if (files.isEmpty()) title else null }
        if (body != null) intent.putExtra(Intent.EXTRA_TEXT, body)
        if (title != null) {
            // The subject of an email, and the heading of the sheet's preview.
            intent.putExtra(Intent.EXTRA_SUBJECT, title)
            intent.putExtra(Intent.EXTRA_TITLE, title)
        }
        if (files.isNotEmpty()) {
            // The ClipData carries the read grant to the app picked, and lets
            // the sheet show a preview of the files.
            val clip = ClipData.newUri(mContext.contentResolver, title ?: "", files[0].first)
            for (file in files.drop(1)) clip.addItem(ClipData.Item(file.first))
            intent.clipData = clip
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        return intent
    }

    private fun failed(message: String) =
        JavaOnlyMap.from(mapOf("error" to "failed", "message" to message))

    private fun ReadableMap.optString(key: String): String? =
        if (hasKey(key) && getType(key) == ReadableType.String) getString(key) else null

    private fun ReadableMap.optArray(key: String): ReadableArray? =
        if (hasKey(key) && getType(key) == ReadableType.Array) getArray(key) else null

    companion object {
        const val NAME = "AngularLynxShare"

        /** The FileProvider's authority after the app's id (AndroidManifest.xml). */
        private const val AUTHORITY_SUFFIX = ".angularlynx.share"

        /** The cache folder the files are written to (res/xml/share_paths.xml). */
        private const val SHARE_FOLDER = "angular-lynx-share"

        /** How long a pick's broadcast may come after the app is back in front. */
        private const val PICK_GRACE_MS = 500L

        /** One thread for writing files, so two shares can't hold two photos at once. */
        private val worker = Executors.newSingleThreadExecutor()

        /** A file name the file system takes: no folders, and something there. */
        private fun safeName(name: String?): String {
            val base = (name ?: "").replace('/', '_').trim()
            return if (base.isEmpty() || base == "." || base == "..") "file" else base
        }

        /** `photo.jpg`, then `photo 2.jpg`: two files of one name would overwrite each other. */
        private fun uniqueName(name: String, used: MutableSet<String>): String {
            val dot = name.lastIndexOf('.')
            val stem = if (dot > 0) name.substring(0, dot) else name
            val extension = if (dot > 0) name.substring(dot) else ""
            var candidate = name
            var number = 2
            while (!used.add(candidate.lowercase())) candidate = "$stem ${number++}$extension"
            return candidate
        }

        /** The type of a file the app gave none, from its extension. */
        private fun typeOf(name: String): String =
            MimeTypeMap.getSingleton()
                .getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
                ?: "application/octet-stream"

        /**
         * The intent's type for its files: theirs when they share one,
         * `image/` with `*` when they're all images, and any type otherwise,
         * so the sheet lists the apps that take them all.
         */
        private fun commonType(types: List<String>): String {
            if (types.distinct().size == 1) return types[0]
            val kinds = types.map { it.substringBefore('/') }.distinct()
            return if (kinds.size == 1) "${kinds[0]}/*" else "*/*"
        }
    }
}
