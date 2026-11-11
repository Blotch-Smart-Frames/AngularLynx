package dev.angularlynx.shell

import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.tasm.core.LynxThreadPool
import okhttp3.Request
import java.io.IOException
import java.nio.ByteBuffer
import java.util.concurrent.FutureTask

/**
 * The `AngularLynxAssets` module: a file the app bundles (`/static/...`),
 * read for the runtime's main-thread `fetch` and `Image`, which load a
 * texture or a glTF model the app imports. The app's `dist/` is in the APK's
 * assets, not on a server, so a URL relative to it has nowhere to be fetched
 * from; BundleAssets maps it to the asset, as it does for Lynx's own
 * `<image>`.
 *
 * Called from the main thread, synchronously (`lynx.module(name)`), like the
 * WebGL module: the runtime turns the answer into a Response.
 */
class AssetsModule(context: Context, param: Any?) : LynxModule(context, param) {
    /**
     * The file's bytes as 32-bit words with the byte count last (see toWords
     * in the runtime's webgl-bridge.ts: Lynx's bridge carries no binary), or
     * null when the app doesn't bundle it.
     */
    @LynxMethod
    fun read(url: String): JavaOnlyArray? {
        DevServer.remoteUrl(url)?.let { return readRemote(it) }
        val path = BundleAssets.assetPath(url) ?: return null
        return try {
            val bytes = BundleAssets.read(mContext, path)
            wordsFromBytes(ByteBuffer.wrap(bytes), bytes.size)
        } catch (_: IOException) {
            null
        }
    }

    /**
     * The file on the dev server, in the debug build `ng serve --platform
     * android` runs, which has the current copy. The call is synchronous, so
     * the request is too, but on a thread of its own: Android doesn't allow
     * network requests on the UI thread, where Lynx may call this.
     */
    private fun readRemote(url: String): JavaOnlyArray? = try {
        val download = FutureTask {
            http.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (response.isSuccessful) response.body?.bytes() else null
            }
        }
        LynxThreadPool.getBriefIOExecutor().execute(download)
        download.get()?.let { wordsFromBytes(ByteBuffer.wrap(it), it.size) }
    } catch (_: Exception) {
        null
    }

    companion object {
        const val NAME = "AngularLynxAssets"
    }
}
