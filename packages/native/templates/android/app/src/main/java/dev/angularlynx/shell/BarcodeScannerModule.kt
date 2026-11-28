package dev.angularlynx.shell

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap

/**
 * The native module behind the runtime's `LynxBarcodeScanner`, which calls it
 * as `NativeModules.AngularLynxBarcodeScanner` (from the background thread,
 * where NativeModules lives). MainActivity registers it with itself as the
 * param: the scanner opens over it.
 *
 * It opens Google's code scanner, which runs in Google Play services rather
 * than the app: Play services shows the camera and hands back only the code
 * read, so the app needs no CAMERA permission and draws no camera screen.
 * A phone without Play services has no scanner, and a scan reports
 * `unavailable`; Play services downloads the scanner the first time an app
 * asks for it, and a scan before that's done reports `unavailable` too.
 *
 * Only an app whose angular.json sets `permissions.camera` has this file and
 * the Play services library behind it (app/build.gradle.kts's
 * `angular-lynx:barcode-scanner` lines), as only it has the iOS module. So
 * MainActivity looks it up by name, and nothing else may name the class.
 */
class BarcodeScannerModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val activity = param as Activity
    private val main = Handler(Looper.getMainLooper())

    /** Whether a scan is open: Play services runs one at a time. */
    private var scanning = false

    /**
     * Opens the scanner and calls back once with `{ format, value }`, or
     * `{ error, message }`, where `error` is `canceled`, `unavailable`,
     * `denied` or `failed`, as the iOS module does.
     */
    @LynxMethod
    fun scan(request: ReadableMap, callback: Callback) {
        val names = request.getArray("formats")?.let { formats ->
            (0 until formats.size()).map { formats.getString(it) }
        } ?: emptyList()
        // Lynx calls modules off the main thread, and the scanner starts an
        // activity.
        main.post { start(names, callback) }
    }

    private fun start(names: List<String>, callback: Callback) {
        if (scanning) {
            callback.invoke(error("failed", "A scan is already open."))
            return
        }
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity) !=
            ConnectionResult.SUCCESS
        ) {
            callback.invoke(error("unavailable", "The barcode scanner needs Google Play services."))
            return
        }
        val formats = names.mapNotNull { FORMATS[it] }.distinct()
        val options = GmsBarcodeScannerOptions.Builder()
            .apply {
                if (formats.isNotEmpty()) {
                    setBarcodeFormats(formats.first(), *formats.drop(1).toIntArray())
                }
            }
            // Zooms in on a code that's far away, as the system camera does.
            .enableAutoZoom()
            .build()
        scanning = true
        val done = { result: JavaOnlyMap ->
            scanning = false
            callback.invoke(result)
        }
        GmsBarcodeScanning.getClient(activity, options)
            .startScan()
            .addOnSuccessListener { barcode ->
                val format = NAMES[barcode.format]
                val value = barcode.rawValue ?: barcode.displayValue
                if (format == null || value == null) {
                    done(error("failed", "The scanner read a code it couldn't hand over."))
                } else {
                    done(JavaOnlyMap.from(mapOf("format" to format, "value" to value)))
                }
            }
            .addOnCanceledListener { done(error("canceled", "The scan was canceled.")) }
            .addOnFailureListener { failure ->
                val code = (failure as? MlKitException)?.errorCode
                done(
                    when (code) {
                        MlKitException.CODE_SCANNER_CANCELLED ->
                            error("canceled", "The scan was canceled.")
                        // Play services shows the camera, so it's Play
                        // services, not the app, that the person refused it
                        // to.
                        MlKitException.CODE_SCANNER_CAMERA_PERMISSION_NOT_GRANTED ->
                            error("denied", "Google Play services isn't allowed to use the camera.")
                        MlKitException.UNAVAILABLE, MlKitException.CODE_SCANNER_UNAVAILABLE ->
                            error(
                                "unavailable",
                                "Google Play services has no barcode scanner yet. It downloads one the first time an app asks: try again shortly.",
                            )
                        else -> error("failed", failure.message ?: "The scanner could not read a code.")
                    },
                )
            }
    }

    private fun error(code: String, message: String) =
        JavaOnlyMap.from(mapOf("error" to code, "message" to message))

    companion object {
        const val NAME = "AngularLynxBarcodeScanner"

        /** The runtime's BarcodeFormat names as ML Kit's formats. */
        private val FORMATS = mapOf(
            "qr" to Barcode.FORMAT_QR_CODE,
            "aztec" to Barcode.FORMAT_AZTEC,
            "dataMatrix" to Barcode.FORMAT_DATA_MATRIX,
            "pdf417" to Barcode.FORMAT_PDF417,
            "ean13" to Barcode.FORMAT_EAN_13,
            "ean8" to Barcode.FORMAT_EAN_8,
            "upcA" to Barcode.FORMAT_UPC_A,
            "upcE" to Barcode.FORMAT_UPC_E,
            "code39" to Barcode.FORMAT_CODE_39,
            "code93" to Barcode.FORMAT_CODE_93,
            "code128" to Barcode.FORMAT_CODE_128,
            "itf" to Barcode.FORMAT_ITF,
            "codabar" to Barcode.FORMAT_CODABAR,
        )

        private val NAMES = FORMATS.entries.associate { (name, format) -> format to name }
    }
}
