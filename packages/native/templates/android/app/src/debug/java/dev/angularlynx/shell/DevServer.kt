package dev.angularlynx.shell

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import com.lynx.tasm.LynxViewBuilder

/**
 * `ng serve --platform android`: the development app loads its bundle from
 * the dev server rather than from its assets (where it has none), and
 * reloads it on every edit, as Lynx Explorer does.
 *
 * This is the debug build type's copy, the one `ng serve --platform android`
 * builds; the release build's (src/release) does nothing.
 *
 * The builder opens the activity with two extras: `AngularLynxDevServer`, the
 * bundle at `http://localhost:<port>/`, which `adb reverse` forwards to the
 * computer whatever network the device is on, and
 * `AngularLynxDevServerOrigin`, the address the bundle was built with (the
 * computer's on the local network), whose URLs are sent to localhost too.
 * They're kept, so opening the app from the launcher later loads from the
 * same server.
 */
object DevServer {
    private const val EXTRA_URL = "AngularLynxDevServer"
    private const val EXTRA_ORIGIN = "AngularLynxDevServerOrigin"
    private const val PREFERENCES = "angular-lynx-dev-server"

    private val main = Handler(Looper.getMainLooper())

    /** The bundle on the dev server, e.g. `http://localhost:3000/main.lynx.bundle`. */
    private var bundle: String? = null

    /** The folder it's in, which every relative URL the bundle asks for resolves against. */
    private var base: Uri? = null

    /** The address the bundle was built with, e.g. `http://192.168.1.20:3000`. */
    private var origin: Uri? = null

    private var reload: (() -> Unit)? = null
    private var status: TextView? = null
    private val retry = Runnable { reload?.invoke() }

    /** The URL MainActivity renders, or null when it was never given one. */
    fun bundleUrl(activity: Activity): String? {
        val preferences = activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        val launched = activity.intent?.getStringExtra(EXTRA_URL)
        if (launched != null) {
            preferences.edit()
                .putString(EXTRA_URL, launched)
                .putString(EXTRA_ORIGIN, activity.intent.getStringExtra(EXTRA_ORIGIN))
                .apply()
        }
        bundle = preferences.getString(EXTRA_URL, null)
        base = bundle?.let { Uri.parse(it.substring(0, it.lastIndexOf('/') + 1)) }
        origin = preferences.getString(EXTRA_ORIGIN, null)?.let(Uri::parse)
        return bundle
    }

    /**
     * Adds the dev server's modules: the WebSocket rspeedy's live reload
     * listens on, and the reload it asks for (DevServerModules.kt).
     */
    fun register(builder: LynxViewBuilder, reload: () -> Unit) {
        if (bundle == null) return
        this.reload = reload
        builder.registerModule(DevWebSocketModule.NAME, DevWebSocketModule::class.java, null)
        builder.registerModule(DevReloadModule.NAME, DevReloadModule::class.java, null)
    }

    /** Adds the dev server's status, hidden, over the page. */
    fun attach(container: FrameLayout) {
        val context = container.context
        val view = TextView(context).apply {
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            val padding = (24 * resources.displayMetrics.density).toInt()
            setPadding(padding, padding, padding, padding)
            setBackgroundColor(context.getColor(R.color.window_background))
            visibility = View.GONE
        }
        container.addView(view, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        status = view
        if (bundle == null) {
            show(
                "This is the development build of the app, which loads the app from `ng serve`.\n\n" +
                    "Run `ng serve --platform android` to open it.",
            )
        }
    }

    /** Reloads the bundle from the dev server, from any thread. */
    fun reloadBundle() {
        main.post { reload?.invoke() }
    }

    /**
     * Where a URL the bundle asks for is on the dev server, or null when the
     * app isn't loading from one, or the URL is somewhere else (an API, a
     * CDN, a data: or content: URL).
     */
    fun remoteUrl(url: String): String? {
        val base = base ?: return null
        val uri = Uri.parse(url)
        val scheme = uri.scheme
        if (scheme == "http" || scheme == "https" || scheme == "ws" || scheme == "wss") {
            // The address the bundle was built with: the same server, which
            // this device reaches at localhost.
            if (origin?.encodedAuthority == uri.encodedAuthority) {
                return uri.buildUpon().encodedAuthority(base.encodedAuthority).build().toString()
            }
            return if (uri.encodedAuthority == base.encodedAuthority) url else null
        }
        val path = when {
            url.startsWith("asset:///") -> url.removePrefix("asset:///")
            scheme == null -> url.removePrefix("./").trimStart('/')
            else -> return null
        }
        return base.toString() + path
    }

    /**
     * Called with the outcome of each load. When the bundle itself didn't
     * load (the server is stopped, or `adb reverse` is gone after the device
     * reconnected), the app says so rather than show nothing, and tries again
     * every two seconds.
     */
    fun loaded(url: String, error: Throwable?) {
        val bundle = bundle ?: return
        if (url != bundle) return
        main.post {
            main.removeCallbacks(retry)
            if (error == null) {
                status?.visibility = View.GONE
                return@post
            }
            show(
                "Can't reach the dev server at ${base?.encodedAuthority}.\n\n${error.message}\n\n" +
                    "Is `ng serve --platform android` running? It forwards the port to this device again " +
                    "when it starts. Trying again…",
            )
            main.postDelayed(retry, 2000)
        }
    }

    private fun show(message: String) {
        val status = status ?: return
        status.text = message
        status.visibility = View.VISIBLE
        status.bringToFront()
    }
}
