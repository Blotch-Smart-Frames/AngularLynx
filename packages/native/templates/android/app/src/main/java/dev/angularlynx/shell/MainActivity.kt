package dev.angularlynx.shell

import android.content.res.Configuration
import android.os.Bundle
import android.util.Log
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.os.ConfigurationCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.tasm.LynxBooleanOption
import com.lynx.tasm.LynxError
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder
import com.lynx.tasm.LynxViewClient
import com.lynx.xelement.XElementBehaviors

/**
 * The whole app: one full-screen LynxView running the Angular app. Angular
 * Router navigates inside it, so there is no native navigation stack.
 */
class MainActivity : ComponentActivity(), ShellModule.Host {
    private lateinit var lynxView: LynxView

    // The system bar and cutout insets, and whether the screen has a cutout,
    // as the window last reported them. Sent in the global props.
    private var safeArea = Insets.NONE
    private var hasCutout = false

    // Disabled until the Angular app enables it (see ShellModule), so by
    // default back leaves the app like any other root screen.
    private val backHandler = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            lynxView.sendGlobalEvent(ShellModule.BACK_EVENT, JavaOnlyArray())
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Android 15+ always draws apps edge to edge; opting in on older
        // versions too keeps the layout the same everywhere.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        lynxView = LynxViewBuilder().apply {
            setTemplateProvider(AssetTemplateProvider(this@MainActivity))
            setTemplateResourceFetcher(AssetTemplateResourceFetcher(this@MainActivity))
            setMediaResourceFetcher(AssetMediaResourceFetcher())
            setEnableGenericResourceFetcher(LynxBooleanOption.TRUE)
            setGenericResourceFetcher(AssetGenericResourceFetcher(this@MainActivity))
            registerModule(ShellModule.NAME, ShellModule::class.java, this@MainActivity)
            // Lynx's core has no <input>, <overlay>, <svg>, <blur-view> etc.;
            // these come from XElement (see app/build.gradle.kts). Lynx
            // Explorer registers them the same way.
            addBehaviors(XElementBehaviors().create())
        }.build(this)
        lynxView.addLynxViewClient(object : LynxViewClient() {
            override fun onReceivedError(error: LynxError?) {
                Log.e(TAG, "Lynx error: ${error?.msg}")
            }
        })

        // Keep the app inside the safe area (status bar, navigation bar and
        // camera cutout). Lynx has no way to give CSS env(safe-area-inset-*)
        // values on Android, so they're 0, which is right for a page that's
        // already inside the safe area. The iOS shell matches.
        val container = FrameLayout(this)
        container.addView(lynxView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            // The keyboard isn't part of the safe area, as on iOS.
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val cutout = insets.displayCutout != null
            if (bars != safeArea || cutout != hasCutout) {
                safeArea = bars
                hasCutout = cutout
                lynxView.updateGlobalProps(globalProps(resources.configuration))
            }
            WindowInsetsCompat.CONSUMED
        }
        setContentView(container)

        onBackPressedDispatcher.addCallback(this, backHandler)
        // Sent before the bundle loads, so the app starts with the theme and
        // the language. The insets follow once the window reports them.
        lynxView.updateGlobalProps(globalProps(resources.configuration))
        lynxView.renderTemplateUrl(BundleAssets.MAIN_BUNDLE, "")
    }

    override fun setBackHandlerEnabled(enabled: Boolean) {
        backHandler.isEnabled = enabled
    }

    // The manifest's configChanges keeps the activity, and the running app,
    // through a dark mode switch, so the new theme is sent from here. A
    // language change still restarts the activity, which sends the new
    // appLocale: Angular reads LOCALE_ID only once.
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        lynxView.updateGlobalProps(globalProps(newConfig))
    }

    /**
     * The global props the runtime reads: `theme` (LynxTheme), `isNotchScreen`
     * (LynxSafeArea) and `appLocale` (LynxLocale), plus the safe-area insets
     * in dp. The iOS shell sends the same keys, and Lynx Explorer sends theme
     * and isNotchScreen too.
     */
    private fun globalProps(config: Configuration): Map<String, Any> {
        val density = resources.displayMetrics.density
        val night = config.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        val props = mutableMapOf<String, Any>(
            "platform" to "android",
            "theme" to if (night) "Dark" else "Light",
            "isNotchScreen" to hasCutout,
            "safeAreaTop" to safeArea.top / density,
            "safeAreaBottom" to safeArea.bottom / density,
            "safeAreaLeft" to safeArea.left / density,
            "safeAreaRight" to safeArea.right / density,
        )
        // The user's language as a BCP 47 tag, such as "fr-FR".
        ConfigurationCompat.getLocales(config)[0]?.let { props["appLocale"] = it.toLanguageTag() }
        return props
    }

    // Lynx pauses timers and animations in the background and fires the
    // page's visibility events from these.
    override fun onResume() {
        super.onResume()
        lynxView.onEnterForeground()
    }

    override fun onPause() {
        lynxView.onEnterBackground()
        super.onPause()
    }

    override fun onDestroy() {
        lynxView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val TAG = "AngularLynxShell"
    }
}
