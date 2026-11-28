package dev.angularlynx.shell

import android.content.Context
import android.util.Log
import com.google.android.gms.ads.identifier.AdvertisingIdClient
import com.google.android.gms.common.GooglePlayServicesNotAvailableException
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import java.util.concurrent.Executors

/**
 * The native module behind the runtime's `LynxTracking`, which calls it as
 * `NativeModules.AngularLynxTracking` (from the background thread, where
 * NativeModules lives). MainActivity registers it without a param.
 *
 * Android has no tracking prompt: an app that declares the AD_ID permission
 * (angular.json's `permissions.tracking` does) reads the advertising ID from
 * Google Play services. The person can still opt out of personalized ads, or
 * delete the ID (Android 12 and later), in the phone's Settings, and the ID
 * then reads as zeros. Google Play's policy says to respect that, so
 * `status` and `request` both call back with `{ status }`:
 *
 * - `authorized`: the ID is there, and the person hasn't opted out.
 * - `denied`: they have opted out, or deleted it.
 * - `unsupported`: the phone has no Google Play services, so there's no ID.
 *
 * Asking Play services blocks on a binder call, so it runs on a worker
 * thread of the module's own, not on Lynx's.
 *
 * The generator leaves this file, the lines in MainActivity that register it
 * and Play's advertising ID library out of an app whose angular.json doesn't
 * set `permissions.tracking`.
 */
class TrackingModule(context: Context, @Suppress("UNUSED_PARAMETER") param: Any?) :
    LynxModule(context, param) {
    private val appContext = context.applicationContext

    @LynxMethod
    fun status(callback: Callback) = answer(callback)

    // There's nothing to ask: Android shows no prompt, so a request answers
    // what status does.
    @LynxMethod
    fun request(callback: Callback) = answer(callback)

    private fun answer(callback: Callback) {
        worker.execute {
            val status = try {
                if (AdvertisingIdClient.getAdvertisingIdInfo(appContext).isLimitAdTrackingEnabled) {
                    "denied"
                } else {
                    "authorized"
                }
            } catch (error: GooglePlayServicesNotAvailableException) {
                "unsupported"
            } catch (error: Exception) {
                // Play services couldn't be reached (an IOException), is out
                // of date (GooglePlayServicesRepairableException), or failed
                // otherwise: there's no ID to read now.
                Log.w(TAG, "Couldn't read the advertising ID", error)
                "unsupported"
            }
            callback.invoke(JavaOnlyMap().apply { putString("status", status) })
        }
    }

    companion object {
        const val NAME = "AngularLynxTracking"
        private const val TAG = "AngularLynxTracking"
        private val worker = Executors.newSingleThreadExecutor()
    }
}
