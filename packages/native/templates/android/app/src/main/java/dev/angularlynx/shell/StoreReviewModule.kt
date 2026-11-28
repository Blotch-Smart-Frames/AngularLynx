package dev.angularlynx.shell

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.google.android.play.core.review.ReviewManagerFactory
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap

/**
 * The native module behind the runtime's `LynxStoreReview`, which calls it as
 * `NativeModules.AngularLynxStoreReview` (from the background thread, where
 * NativeModules lives). MainActivity registers it with itself as the param:
 * Google Play shows the rating prompt over it.
 *
 * `request` asks Play's In-App Review API for a review flow and launches it,
 * then calls back once with `{}`. Play decides whether the prompt shows, and
 * doesn't say: it has a quota per person, shows nothing until the account
 * has installed the app from Play (an internal test track or internal app
 * sharing will do), and fails
 * where the phone has no Play Store. None of that is something the app can
 * act on, so a failure is logged and calls back the same `{}`.
 *
 * The generator leaves this file, the lines in MainActivity that register it
 * and Play's review library out of an app whose angular.json doesn't set
 * `storeReview`.
 */
class StoreReviewModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val activity = param as Activity
    private val main = Handler(Looper.getMainLooper())

    // Lynx calls modules off the main thread. Play's tasks call their
    // listeners on the main thread, and the flow is launched from there too,
    // over the activity.
    @LynxMethod
    fun request(callback: Callback) {
        main.post {
            val done = { callback.invoke(JavaOnlyMap()) }
            try {
                val manager = ReviewManagerFactory.create(activity)
                manager.requestReviewFlow().addOnCompleteListener { request ->
                    if (!request.isSuccessful || activity.isFinishing) {
                        Log.w(TAG, "Google Play has no review flow for the app", request.exception)
                        done()
                        return@addOnCompleteListener
                    }
                    // Completes once the prompt has closed, or at once when
                    // Play chose not to show it.
                    manager.launchReviewFlow(activity, request.result).addOnCompleteListener { done() }
                }
            } catch (error: RuntimeException) {
                Log.w(TAG, "Google Play's review flow failed", error)
                done()
            }
        }
    }

    companion object {
        const val NAME = "AngularLynxStoreReview"
        private const val TAG = "AngularLynxStoreReview"
    }
}
