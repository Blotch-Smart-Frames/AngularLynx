package dev.angularlynx.shell

import android.app.UiModeManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.database.ContentObserver
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityManager
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.browser.customtabs.CustomTabsIntent
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
class MainActivity : ComponentActivity(), ShellModule.Host, WebAuthModule.Host {
    private lateinit var lynxView: LynxView

    // Whether the page draws under the system bars and the cutout:
    // angular.json's edgeToEdge, which app/build.gradle.kts writes as a
    // resource.
    private val edgeToEdge by lazy { resources.getBoolean(R.bool.edge_to_edge) }

    // The safe-area insets, and whether the screen has a cutout, as the
    // window last reported them. Sent in the global props.
    private var safeArea = Insets.NONE
    private var hasCutout = false

    // Sends the accessibility settings again when the user changes one while
    // the app is open: Remove animations (the animator duration scale), the
    // contrast level (Android 14) and high contrast text (Android 16). The
    // contrast listeners are kept as Any so the class loads on older Androids.
    private val animationScaleObserver = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean) = sendGlobalProps()
    }
    private var contrastListener: Any? = null
    private var highContrastTextListener: Any? = null

    // Disabled until the Angular app enables it (see ShellModule), so by
    // default back leaves the app like any other root screen.
    private val backHandler = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            lynxView.sendGlobalEvent(ShellModule.BACK_EVENT, JavaOnlyArray())
        }
    }

    // The open sign-in (see WebAuthModule): the scheme its page returns to,
    // who to tell, and whether the app has gone behind the Custom Tab yet.
    private class WebAuthSession(val scheme: String, val done: (WebAuthModule.Result) -> Unit) {
        var opened = false
    }
    private var webAuthSession: WebAuthSession? = null

    // The Photo Picker (see ImagePickerModule), and who to tell what was
    // picked. An activity registers for results as it's created, before it
    // starts, so a result that arrives after Android recreated it still
    // finds the launcher; the property initializer runs then.
    private var imagePicked: ((Uri?) -> Unit)? = null
    private val imagePicker = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        val done = imagePicked ?: return@registerForActivityResult
        imagePicked = null
        done(uri)
    }
    private val imagePickerHost = object : ImagePickerModule.Host {
        override fun pickImage(done: (Uri?) -> Unit): Boolean {
            if (imagePicked != null) return false
            imagePicked = done
            imagePicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            return true
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Android 15+ always draws apps edge to edge; opting in on older
        // versions too keeps the layout the same everywhere.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // A shortcut that started the app waits for the runtime to take it.
        // Android hands a recreated activity the intent it started with
        // again, and so does reopening the app from Recents, neither of
        // which is the person running the shortcut again.
        if (savedInstanceState == null &&
            intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY == 0
        ) {
            ShortcutsModule.run(intent)
        }

        // The bundle in the app's assets, or in the debug build `ng serve
        // --platform android` runs, the dev server's (DevServer.kt).
        val bundleUrl = DevServer.bundleUrl(this) ?: BundleAssets.MAIN_BUNDLE
        lynxView = LynxViewBuilder().apply {
            setTemplateProvider(AssetTemplateProvider(this@MainActivity))
            setTemplateResourceFetcher(AssetTemplateResourceFetcher(this@MainActivity))
            setMediaResourceFetcher(AssetMediaResourceFetcher())
            setEnableGenericResourceFetcher(LynxBooleanOption.TRUE)
            setGenericResourceFetcher(AssetGenericResourceFetcher(this@MainActivity))
            registerModule(ShellModule.NAME, ShellModule::class.java, this@MainActivity)
            registerModule(WebAuthModule.NAME, WebAuthModule::class.java, this@MainActivity)
            registerModule(LocalStorageModule.NAME, LocalStorageModule::class.java, null)
            registerModule(SecureStorageModule.NAME, SecureStorageModule::class.java, null)
            // LynxClipboard's text (ClipboardModule.kt).
            registerModule(ClipboardModule.NAME, ClipboardModule::class.java, null)
            // Links out of the app (LinkingModule.kt), which it opens from this
            // activity.
            registerModule(LinkingModule.NAME, LinkingModule::class.java, this@MainActivity)
            // The photo picker behind LynxImagePicker (ImagePickerModule.kt), which
            // this activity launches.
            registerModule(ImagePickerModule.NAME, ImagePickerModule::class.java, imagePickerHost)
            // The share sheet behind LynxShare (ShareModule.kt), which it opens
            // from this activity.
            registerModule(ShareModule.NAME, ShareModule::class.java, this@MainActivity)
            // The shortcuts the person runs from the app icon's menu, which
            // LynxShortcuts takes (ShortcutsModule.kt).
            registerModule(ShortcutsModule.NAME, ShortcutsModule::class.java, null)
            // <canvas>'s WebGL (WebGLModule.kt), which the runtime calls from
            // the main thread, where Angular runs: main-thread modules let
            // it get its answers synchronously, with lynx.module(name).
            registerModule(WebGLModule.NAME, WebGLModule::class.java, null)
            // Bundled files for the main thread's fetch and Image (AssetsModule.kt).
            registerModule(AssetsModule.NAME, AssetsModule::class.java, null)
            setEnableMTSModule(true)
            // Lynx's core has no <input>, <overlay>, <svg>, <blur-view> etc.;
            // these come from XElement (see app/build.gradle.kts). Lynx
            // Explorer registers them the same way.
            addBehaviors(XElementBehaviors().create())
            // In an edge-to-edge app an <overlay>'s window fills the screen as
            // the page does, under the navigation bar too (EdgeToEdgeOverlay.kt).
            if (edgeToEdge) addBehavior(EdgeToEdgeOverlay.behavior())
            // The shell's own <canvas> (CanvasUI.kt): Lynx has none.
            addBehavior(CanvasUI.behavior())
            // Live reload, in the debug build: it renders the bundle again
            // after every edit.
            DevServer.register(this) { lynxView.renderTemplateUrl(bundleUrl, "") }
        }.build(this)
        // The LynxView is focusable, so it takes focus whenever the window
        // isn't in touch mode: after any key press, from a hardware keyboard,
        // a D-pad, the keyboard's Enter, or a key sent with adb.
        // Android 14 keeps touch mode for the whole display, so an app opened
        // afterwards starts out of it too. Android 8 and later then draw
        // their default focus highlight over the focused view, here the whole
        // page: a 12% black (`#1F000000`, a 12% white in dark mode), which
        // made every color about 12% darker (issue #362). The page is the
        // document, not a control, and a browser doesn't outline the document
        // either; the elements in it draw their own focus.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            lynxView.defaultFocusHighlightEnabled = false
        }
        lynxView.addLynxViewClient(object : LynxViewClient() {
            override fun onReceivedError(error: LynxError?) {
                Log.e(TAG, "Lynx error: ${error?.msg}")
            }
        })

        // Draw the page under the status bar, the navigation bar and the
        // camera cutout, as Safari does for a page with viewport-fit=cover,
        // and let it pad itself with CSS env(safe-area-inset-*). Lynx never
        // sets env() on Android, so the runtime gives every
        // env(safe-area-inset-*) the safeArea* global props instead, as CSS
        // variables on the page. With "edgeToEdge": false in angular.json
        // the page sits inside the safe area, and the runtime keeps env() at
        // 0. The iOS shell matches.
        val container = FrameLayout(this)
        container.addView(lynxView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            val safe = if (edgeToEdge) {
                // The keyboard still pushes the page up, so the input being
                // typed into stays above it.
                view.setPadding(0, 0, 0, keyboard.bottom)
                // The part of the page the bars cover. While the keyboard is
                // open the page ends at its top edge, above the navigation
                // bar, so nothing covers the bottom.
                Insets.of(bars.left, bars.top, bars.right, maxOf(0, bars.bottom - keyboard.bottom))
            } else {
                val padding = Insets.max(bars, keyboard)
                view.setPadding(padding.left, padding.top, padding.right, padding.bottom)
                // The window's insets, as before the option existed. The
                // keyboard isn't part of the safe area, as on iOS.
                bars
            }
            val cutout = insets.displayCutout != null
            if (safe != safeArea || cutout != hasCutout) {
                safeArea = safe
                hasCutout = cutout
                lynxView.updateGlobalProps(globalProps(resources.configuration))
            }
            WindowInsetsCompat.CONSUMED
        }
        DevServer.attach(container)
        setContentView(container)

        contentResolver.registerContentObserver(
            Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),
            false,
            animationScaleObserver,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val listener = UiModeManager.ContrastChangeListener { sendGlobalProps() }
            getSystemService(UiModeManager::class.java).addContrastChangeListener(mainExecutor, listener)
            contrastListener = listener
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
            val listener = AccessibilityManager.HighContrastTextStateChangeListener { sendGlobalProps() }
            getSystemService(AccessibilityManager::class.java)
                .addHighContrastTextStateChangeListener(mainExecutor, listener)
            highContrastTextListener = listener
        }

        onBackPressedDispatcher.addCallback(this, backHandler)
        // Sent before the bundle loads, so the app starts with the theme and
        // the language. The insets follow once the window reports them.
        lynxView.updateGlobalProps(globalProps(resources.configuration))
        lynxView.renderTemplateUrl(bundleUrl, "")
    }

    override fun setBackHandlerEnabled(enabled: Boolean) {
        backHandler.isEnabled = enabled
    }

    override fun startWebAuthSession(url: Uri, callbackScheme: String, done: (WebAuthModule.Result) -> Unit) {
        if (webAuthSession != null) {
            done(WebAuthModule.Result.Failed("A sign-in is already open."))
            return
        }
        val session = WebAuthSession(callbackScheme.lowercase(), done)
        webAuthSession = session
        try {
            CustomTabsIntent.Builder().build().launchUrl(this, url)
        } catch (_: ActivityNotFoundException) {
            webAuthSession = null
            done(WebAuthModule.Result.Failed("No browser can open the sign-in page."))
        }
    }

    // The activity is singleTask, so an intent for it while it's open comes
    // here rather than starting another.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // A shortcut run while the app is open (ShortcutActivity): the
        // runtime takes it when it hears the event.
        if (ShortcutsModule.run(intent)) {
            lynxView.sendGlobalEvent(ShortcutsModule.EVENT, JavaOnlyArray())
            return
        }
        // The sign-in page's redirect to the callback scheme: the deep link
        // comes back to this activity, which closes the Custom Tab above it.
        // It arrives before onResume, which then finds no session open.
        val url = intent.data ?: return
        val session = webAuthSession ?: return
        if (url.scheme?.lowercase() != session.scheme) return
        webAuthSession = null
        session.done(WebAuthModule.Result.Returned(url.toString()))
    }

    // The manifest's configChanges keeps the activity, and the running app,
    // through a dark mode switch, so the new theme is sent from here. A
    // language change still restarts the activity, which sends the new
    // appLocale: Angular reads LOCALE_ID only once. A new wallpaper arrives
    // here too, without a restart, and globalProps() reads its colors again.
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        updateWindowAppearance()
        lynxView.updateGlobalProps(globalProps(newConfig))
    }

    // Kept through a dark mode switch, the window keeps the theme it started
    // with: its background, which shows behind the system bars, and the
    // bars' icons, which enableEdgeToEdge() picked for the old mode. Both are
    // set again for the new one, from the same resources.
    private fun updateWindowAppearance() {
        window.setBackgroundDrawable(ColorDrawable(getColor(R.color.window_background)))
        enableEdgeToEdge()
    }

    private fun sendGlobalProps() {
        lynxView.updateGlobalProps(globalProps(resources.configuration))
    }

    /**
     * The global props the runtime reads: `theme` (LynxTheme), `isNotchScreen`
     * (LynxSafeArea), `appLocale` (LynxLocale), `appTimeZone` (the `intl`
     * build option's Intl.DateTimeFormat), the accessibility settings
     * (LynxAccessibilitySettings) and `osVersion` (LynxSystemInfo), plus the
     * safe-area insets in dp and `edgeToEdge`, which env(safe-area-inset-*)
     * reads. The iOS shell sends the same keys, and Lynx Explorer sends theme
     * and isNotchScreen too. Android 12 and later also send the wallpaper's
     * colors, `dynamicColors` (LynxTheme.dynamicColors), which iOS has no
     * equivalent of.
     */
    private fun globalProps(config: Configuration): Map<String, Any> {
        val density = resources.displayMetrics.density
        val night = config.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        val props = mutableMapOf<String, Any>(
            "platform" to "android",
            // Whether the page fills the screen. The runtime gives env() the
            // insets below only then; otherwise the page is already inside them.
            "edgeToEdge" to edgeToEdge,
            "theme" to if (night) "Dark" else "Light",
            "isNotchScreen" to hasCutout,
            "safeAreaTop" to safeArea.top / density,
            "safeAreaBottom" to safeArea.bottom / density,
            "safeAreaLeft" to safeArea.left / density,
            "safeAreaRight" to safeArea.right / density,
            // Lynx builds the main thread's SystemInfo, where Angular runs,
            // without the OS version, so LynxSystemInfo reads it from here.
            "osVersion" to Build.VERSION.RELEASE,
            // Lynx has no API for these. Android has no Reduce Transparency.
            "reduceMotion" to reduceMotion(),
            "increaseContrast" to increaseContrast(),
        )
        // The user's language as a BCP 47 tag, such as "fr-FR".
        ConfigurationCompat.getLocales(config)[0]?.let { props["appLocale"] = it.toLanguageTag() }
        // The time zone's IANA name, such as "Europe/London". The `intl` build
        // option's Intl.DateTimeFormat formats in the device's zone by default,
        // which it reads from the engine's local time, and names it with this.
        props["appTimeZone"] = java.util.TimeZone.getDefault().id
        DynamicColors.read(this)?.let { props["dynamicColors"] = it }
        return props
    }

    // Settings > Accessibility > Remove animations sets the animator
    // duration scale to 0, as does turning animations off in the developer
    // options.
    private fun reduceMotion(): Boolean =
        Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

    // Medium or high contrast (Android 14), or high contrast text (Android 16):
    // the closest Android has to iOS's Increase Contrast.
    private fun increaseContrast(): Boolean =
        (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
            getSystemService(UiModeManager::class.java).contrast > 0f) ||
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA &&
                getSystemService(AccessibilityManager::class.java).isHighContrastTextEnabled)

    // Lynx pauses timers and animations in the background and fires the
    // page's visibility events from these.
    override fun onResume() {
        super.onResume()
        lynxView.onEnterForeground()
        // Back from a Custom Tab without its redirect: the person closed it.
        // Android says nothing else when a Custom Tab closes.
        webAuthSession?.takeIf { it.opened }?.let {
            webAuthSession = null
            it.done(WebAuthModule.Result.Canceled)
        }
    }

    override fun onPause() {
        lynxView.onEnterBackground()
        webAuthSession?.opened = true
        super.onPause()
    }

    override fun onDestroy() {
        contentResolver.unregisterContentObserver(animationScaleObserver)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            (contrastListener as UiModeManager.ContrastChangeListener?)?.let {
                getSystemService(UiModeManager::class.java).removeContrastChangeListener(it)
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
            (highContrastTextListener as AccessibilityManager.HighContrastTextStateChangeListener?)?.let {
                getSystemService(AccessibilityManager::class.java).removeHighContrastTextStateChangeListener(it)
            }
        }
        lynxView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val TAG = "AngularLynxShell"
    }
}
