package dev.angularlynx.shell

import android.app.Activity
import android.widget.FrameLayout
import com.lynx.tasm.LynxViewBuilder

/**
 * The release build's DevServer: nothing. Only the debug build type, which
 * `ng serve --platform android` builds, has the dev server support
 * (src/debug/.../DevServer.kt), so nothing can point a release build at
 * another server: its bundle is always the one in its assets. The two files
 * keep the same functions, which MainActivity and the loaders call.
 */
object DevServer {
    fun bundleUrl(activity: Activity): String? = null

    fun register(builder: LynxViewBuilder, reload: () -> Unit) = Unit

    fun attach(container: FrameLayout) = Unit

    fun remoteUrl(url: String): String? = null

    fun loaded(url: String, error: Throwable?) = Unit
}
