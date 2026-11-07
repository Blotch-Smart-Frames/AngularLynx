package dev.angularlynx.shell

import android.os.Build
import android.view.WindowManager
import androidx.core.view.WindowCompat
import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.shadow.ShadowNode
import com.lynx.tasm.behavior.ui.LynxUI
import com.lynx.xelement.LynxUIOverlayAutoRegistry
import com.lynx.xelement.LynxUIOverlayShadowNodeAutoRegistry

/**
 * XElement's `<overlay>`, drawn under the system bars as the page is in an
 * edge-to-edge app (see MainActivity).
 *
 * An overlay is a Dialog with its own window. XElement lays the overlay's
 * content out at the screen's full height and lets the window draw under the
 * status bar, but leaves the window fitting the navigation bar: below
 * Android 15 nothing changes that, and on 15 and later it opts out of edge to
 * edge unless the overlay sets `android-adapt-edge-to-edge`. So the window
 * ended above the navigation bar and cut off the bottom of its content, and
 * the page showed beneath it: a bottom sheet stopped short of the screen's
 * edge, over the undimmed bottom of the page, while on iOS it covers the
 * screen. Here the window draws under every bar and the cutout, as the page's
 * does, on every version, and the content pads itself with
 * env(safe-area-inset-*), as the page's does (dolan's bottom sheet with
 * `pb-safe`). It still shows the activity's navigation bar color, which
 * enableEdgeToEdge() made transparent: XElement copies it when the overlay
 * opens.
 *
 * An overlay that sets `android-adapt-edge-to-edge` itself still gets what it
 * asks for on Android 15 and later.
 */
class EdgeToEdgeOverlay(context: LynxContext) : LynxUIOverlayAutoRegistry(context) {
    init {
        // The overlay's view, which owns the Dialog.
        transitionUI.window?.let { window ->
            WindowCompat.setDecorFitsSystemWindows(window, false)
            // Into the camera cutout too, as enableEdgeToEdge() lets the
            // activity's window: in landscape the cutout is on a side the
            // status bar doesn't cover.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                window.attributes = window.attributes.apply {
                    layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    } else {
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    }
                }
            }
        }
    }

    companion object {
        /**
         * Replaces XElement's `overlay` behavior: MainActivity adds it after
         * XElement's, and the last behavior added for a tag wins. The shadow
         * node, which sizes the content to the screen, stays XElement's.
         */
        fun behavior(): Behavior = object : Behavior("overlay") {
            override fun createUI(context: LynxContext): LynxUI<*> = EdgeToEdgeOverlay(context)
            override fun createShadowNode(): ShadowNode = LynxUIOverlayShadowNodeAutoRegistry()
        }
    }
}
