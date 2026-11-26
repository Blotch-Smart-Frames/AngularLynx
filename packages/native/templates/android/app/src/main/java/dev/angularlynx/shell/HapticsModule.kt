package dev.angularlynx.shell

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap

/**
 * The native module behind the runtime's `LynxHaptics`, which calls it as
 * `NativeModules.AngularLynxHaptics` (from the background thread, where
 * NativeModules lives). MainActivity registers it with itself as the param:
 * the feedback plays on its window.
 *
 * Each method plays the nearest of Android's `HapticFeedbackConstants` with
 * `View.performHapticFeedback()`, as the system's own controls do, and calls
 * back once with `{}`. Unlike `Vibrator`, that needs no VIBRATE permission,
 * and it follows the person's touch feedback setting: Android plays nothing
 * when they've turned it off.
 */
class HapticsModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val activity = param as Activity
    private val main = Handler(Looper.getMainLooper())

    // Lynx calls modules off the main thread, and a view's feedback belongs
    // to the UI thread.
    private fun play(feedback: Int, callback: Callback) {
        main.post {
            activity.window?.decorView?.performHapticFeedback(feedback)
            callback.invoke(JavaOnlyMap())
        }
    }

    /**
     * The runtime's HapticImpactStyle. Android has three weights of tap, so
     * `soft` plays as `light` and `rigid` as `medium`; a name the runtime
     * doesn't send plays as `medium`, as its default does.
     */
    @LynxMethod
    fun impact(style: String, callback: Callback) {
        val feedback =
            when (style) {
                "light", "soft" -> HapticFeedbackConstants.KEYBOARD_TAP
                "heavy" -> HapticFeedbackConstants.LONG_PRESS
                else -> HapticFeedbackConstants.VIRTUAL_KEY
            }
        play(feedback, callback)
    }

    /** A selection moving, as a picker's detent or a clock's hand ticks. */
    @LynxMethod
    fun selection(callback: Callback) {
        play(HapticFeedbackConstants.CLOCK_TICK, callback)
    }

    /**
     * The runtime's HapticNotificationType. Android 11 added a confirm and a
     * reject feedback; before it, success plays as a key's tap and the
     * others as a long press.
     */
    @LynxMethod
    fun notification(type: String, callback: Callback) {
        val modern = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        val feedback =
            when {
                type == "warning" || type == "error" ->
                    if (modern) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
                else ->
                    if (modern) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
            }
        play(feedback, callback)
    }

    companion object {
        const val NAME = "AngularLynxHaptics"
    }
}
