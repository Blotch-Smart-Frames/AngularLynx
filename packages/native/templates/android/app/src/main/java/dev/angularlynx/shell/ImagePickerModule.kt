package dev.angularlynx.shell

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The native module behind the runtime's `LynxImagePicker`, which calls it as
 * `NativeModules.AngularLynxImagePicker` (from the background thread, where
 * NativeModules lives).
 *
 * Lynx has no `<input type="file">`. The activity opens Android's Photo
 * Picker instead (`PickVisualMedia`), which needs no permission: the app reads
 * only the photo picked. Where a phone has no Photo Picker, Android opens its
 * document picker.
 *
 * The image goes back as base64, since the module's callback and the
 * runtime's relay to the main thread carry only what JSON can. Scaling it
 * down here first, with `maxDimension`, keeps that small: a 12-megapixel
 * photo is several megabytes, a 1024-pixel one a few hundred kilobytes.
 */
class ImagePickerModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val host = param as Host
    private val main = Handler(Looper.getMainLooper())

    interface Host {
        /**
         * Opens the Photo Picker and calls [done] once with the picked image,
         * or with null when the person closes it. Returns false, without
         * opening it, when it's already open.
         */
        fun pickImage(done: (Uri?) -> Unit): Boolean
    }

    /**
     * Opens the picker and calls back once with `{ base64, name, type }`,
     * `{ canceled: true }` when the person closes it, or
     * `{ error: "failed", message }`, as the iOS module does.
     */
    @LynxMethod
    fun pick(options: ReadableMap, callback: Callback) {
        // JavaScript numbers can arrive as either, so both are read as doubles.
        val maxDimension = if (options.hasKey("maxDimension")) options.getDouble("maxDimension").toInt() else null
        val quality = if (options.hasKey("quality")) options.getDouble("quality") else null
        // Lynx calls modules off the main thread, and the activity launches
        // the picker.
        main.post {
            val opened = host.pickImage { uri ->
                if (uri == null) {
                    callback.invoke(JavaOnlyMap.from(mapOf("canceled" to true)))
                } else {
                    // Decoding a 12-megapixel photo takes a moment: off the
                    // main thread.
                    worker.execute { callback.invoke(prepare(uri, maxDimension, quality)) }
                }
            }
            if (!opened) callback.invoke(failed("A picker is already open."))
        }
    }

    /**
     * The callback's answer for the picked image: as it was picked, or
     * re-encoded as a JPEG.
     */
    private fun prepare(uri: Uri, maxDimension: Int?, quality: Double?): JavaOnlyMap {
        val resolver = mContext.contentResolver
        val bytes = try {
            resolver.openInputStream(uri)?.use { it.readBytes() }
        } catch (_: IOException) {
            null
        } catch (_: SecurityException) {
            null
        } ?: return failed("The picked image couldn't be read.")
        val type = resolver.getType(uri) ?: "application/octet-stream"
        val name = displayName(uri) ?: "image"
        if (maxDimension == null && quality == null && type in PORTABLE_TYPES) {
            return answer(bytes, name, type)
        }
        val jpeg = try {
            toJpeg(bytes, maxDimension, quality ?: DEFAULT_QUALITY)
        } catch (_: OutOfMemoryError) {
            null
        } ?: return failed("The picked image couldn't be decoded.")
        return answer(jpeg, withExtension(name, "jpg"), "image/jpeg")
    }

    /** The file name the picker gives the image, such as `PXL_20261106.jpg`. */
    private fun displayName(uri: Uri): String? =
        try {
            mContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
        } catch (_: RuntimeException) {
            null
        }

    private fun answer(bytes: ByteArray, name: String, type: String) =
        JavaOnlyMap.from(
            mapOf("base64" to Base64.encodeToString(bytes, Base64.NO_WRAP), "name" to name, "type" to type),
        )

    private fun failed(message: String) =
        JavaOnlyMap.from(mapOf("error" to "failed", "message" to message))

    companion object {
        const val NAME = "AngularLynxImagePicker"

        /** What a re-encoded image gets when the app doesn't choose a quality. */
        private const val DEFAULT_QUALITY = 0.9

        /**
         * The formats other platforms can show, which go back as they were
         * picked unless the app asks for a smaller or re-compressed image.
         * Anything else, such as HEIC photos, is re-encoded as a JPEG.
         */
        private val PORTABLE_TYPES = setOf("image/jpeg", "image/png", "image/gif", "image/webp")

        /** One thread for decoding, so two picks can't hold two photos at once. */
        private val worker = Executors.newSingleThreadExecutor()

        /** `photo.heic` → `photo.jpg`. */
        private fun withExtension(name: String, extension: String): String {
            val dot = name.lastIndexOf('.')
            return "${if (dot > 0) name.substring(0, dot) else name}.$extension"
        }

        /**
         * The image as a JPEG: upright, whichever way the camera stored it
         * (BitmapFactory ignores it), no larger than [maxDimension] on its
         * longest side, and without the original's metadata, such as where it
         * was taken. It's decoded at the smallest power-of-two reduction that
         * still covers the target, so a 12-megapixel photo is never held in
         * memory at full size when it's scaled down.
         */
        private fun toJpeg(bytes: ByteArray, maxDimension: Int?, quality: Double): ByteArray? {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            val longest = max(bounds.outWidth, bounds.outHeight)
            // Never larger than the image.
            val target = min(maxDimension ?: longest, longest)
            var sampleSize = 1
            while (longest / (sampleSize * 2) >= target) sampleSize *= 2
            val decoded = BitmapFactory.decodeByteArray(
                bytes,
                0,
                bytes.size,
                BitmapFactory.Options().apply { inSampleSize = sampleSize },
            ) ?: return null
            val scale = target.toFloat() / max(decoded.width, decoded.height)
            val matrix = Matrix().apply {
                postScale(scale, scale)
                orient(this, orientation(bytes))
            }
            val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
            // A JPEG has no transparency, and would show it black.
            val opaque = if (upright.hasAlpha()) {
                Bitmap.createBitmap(upright.width, upright.height, Bitmap.Config.ARGB_8888).also {
                    Canvas(it).apply {
                        drawColor(Color.WHITE)
                        drawBitmap(upright, 0f, 0f, null)
                    }
                }
            } else {
                upright
            }
            return ByteArrayOutputStream().use { output ->
                opaque.compress(Bitmap.CompressFormat.JPEG, (quality * 100).roundToInt(), output)
                output.toByteArray()
            }
        }

        private fun orientation(bytes: ByteArray): Int =
            try {
                ExifInterface(bytes.inputStream())
                    .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            } catch (_: IOException) {
                ExifInterface.ORIENTATION_NORMAL
            }

        /** Turns [matrix] the way the camera's [orientation] tag says the image is stored. */
        private fun orient(matrix: Matrix, orientation: Int) {
            when (orientation) {
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
                ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
                ExifInterface.ORIENTATION_TRANSPOSE -> {
                    matrix.postRotate(90f)
                    matrix.postScale(-1f, 1f)
                }
                ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
                ExifInterface.ORIENTATION_TRANSVERSE -> {
                    matrix.postRotate(-90f)
                    matrix.postScale(-1f, 1f)
                }
                ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            }
        }
    }
}
