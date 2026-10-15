package dev.angularlynx.shell

import android.content.Context
import android.net.Uri
import java.io.IOException

/**
 * The app's dist/ folder is copied into the APK's assets/ (by the AngularLynx
 * generator), so every bundle and static file the Angular app references is an
 * asset. These helpers turn the URLs Lynx hands us into asset paths.
 */
object BundleAssets {
    /** The bundle the activity renders. */
    const val MAIN_BUNDLE = "main.lynx.bundle"

    /**
     * Maps a URL from the bundle to a path inside assets/, or null when it
     * points somewhere else (http(s), data:, content:...).
     *
     * Rspeedy's default asset prefix is "/", so bundled files arrive as
     * "/static/image/x.png" or, for lazy bundles, "/async/x.lynx.bundle".
     * "asset:///" (Fresco's scheme) and plain relative paths also work, so
     * the same bundle runs whatever prefix it was built with.
     */
    fun assetPath(url: String): String? {
        val path = when {
            url.startsWith("asset:///") -> url.removePrefix("asset:///")
            url.startsWith("file:///android_asset/") -> url.removePrefix("file:///android_asset/")
            Uri.parse(url).scheme == null -> url.removePrefix("./").trimStart('/')
            else -> return null
        }
        // Drop the query and fragment; assets are plain files.
        return path.substringBefore('?').substringBefore('#').ifEmpty { null }
    }

    fun read(context: Context, path: String): ByteArray =
        context.assets.open(path).use { it.readBytes() }

    fun exists(context: Context, path: String): Boolean = try {
        context.assets.open(path).close()
        true
    } catch (_: IOException) {
        false
    }
}
