package dev.angularlynx.shell

import android.os.Bundle
import android.util.Log
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
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
        // camera cutout) until the runtime exposes the insets to CSS.
        val container = FrameLayout(this)
        container.addView(lynxView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(container)

        onBackPressedDispatcher.addCallback(this, backHandler)
        lynxView.renderTemplateUrl(BundleAssets.MAIN_BUNDLE, "")
    }

    override fun setBackHandlerEnabled(enabled: Boolean) {
        backHandler.isEnabled = enabled
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
