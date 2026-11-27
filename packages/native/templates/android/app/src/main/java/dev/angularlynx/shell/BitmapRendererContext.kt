package dev.angularlynx.shell

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import com.lynx.react.bridge.ReadableMap
import com.lynx.react.bridge.ReadableType
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * `<canvas>`'s bitmaprenderer context for the AngularLynx runtime
 * (packages/runtime/src/lib/canvas/bitmap-renderer-context.ts):
 * ImageBitmapRenderingContext, which shows an ImageBitmap in the canvas.
 *
 * An ImageBitmap's pixels live in the shell, as a decoded image WebGLModule
 * keeps by id (`decodeImage`, `imageFromCanvas`). transferFromImageBitmap()
 * detaches the bitmap and hands its id to the context, which takes the image
 * from the module, keeps it as a Bitmap, and shows it in the canvas's view as
 * a 2D context shows its bitmap (BitmapPresenter). The canvas reads as what
 * it shows: drawImage(), texImage2D(), createImageBitmap() and the encoders
 * take its snapshot.
 *
 * Lynx calls the module on its engine thread; the view's surface comes and
 * goes on the UI thread, which shows the bitmap again then. The context's
 * lock keeps the two apart.
 */
class BitmapRendererContext(override val canvasId: String, attributes: ReadableMap?) : CanvasContext {
    private val alpha = !(attributes != null && attributes.hasKey("alpha") &&
        attributes.getType("alpha") == ReadableType.Boolean && !attributes.getBoolean("alpha"))

    /** What the canvas shows, premultiplied, or null while it's blank. */
    private var bitmap: Bitmap? = null

    /** The blank's size: the canvas's, as the runtime last said. */
    private var blankWidth = attributes.pixelSide("width", 300)
    private var blankHeight = attributes.pixelSide("height", 150)
    private var destroyed = false
    private val presenter = BitmapPresenter(TAG)

    /**
     * Shows [image], which the context owns from then on: as a Bitmap, which
     * is what Android draws, composited over black for a context without
     * alpha, as the spec shows one.
     */
    @Synchronized
    fun show(image: DecodedImage) {
        if (destroyed) return
        var shown = bitmapOf(image)
        if (!alpha) {
            val opaque = Bitmap.createBitmap(shown.width, shown.height, Bitmap.Config.ARGB_8888)
            opaque.eraseColor(Color.BLACK)
            Canvas(opaque).drawBitmap(shown, 0f, 0f, null)
            opaque.setHasAlpha(false)
            shown.recycle()
            shown = opaque
        }
        // The bitmap it replaces isn't recycled: the frame last posted to the
        // surface may still draw it. The collector frees it.
        bitmap = shown
        present()
    }

    /** Shows a blank canvas of [width] by [height]. */
    @Synchronized
    fun showBlank(width: Int, height: Int) {
        if (destroyed) return
        bitmap = null
        blankWidth = max(0, width)
        blankHeight = max(0, height)
        present()
    }

    @Synchronized
    fun destroy() {
        if (destroyed) return
        destroyed = true
        presenter.release()
        bitmap?.recycle()
        bitmap = null
    }

    // --- Showing it ----------------------------------------------------------

    @Synchronized
    override fun attachView(canvas: CanvasUI?) {
        if (presenter.attach(canvas, !alpha)) surfaceChanged()
    }

    @Synchronized
    override fun surfaceChanged() {
        if (destroyed) return
        if (presenter.surfaceChanged()) present()
    }

    /** A blank canvas without alpha is opaque black; with alpha, nothing. */
    private fun present() =
        presenter.present(bitmap, if (bitmap == null && !alpha) Color.BLACK else Color.TRANSPARENT)

    // --- Reading it ----------------------------------------------------------

    /**
     * A copy of what the canvas shows, rows top to bottom: readers change
     * the pixels they're given (createImageBitmap's options do).
     */
    @Synchronized
    override fun snapshot(): DecodedImage? {
        val source = bitmap
        if (source == null) {
            val bytes = rgbaByteCount(blankWidth, blankHeight) ?: return null
            if (bytes == 0) return null
            val pixels = ByteBuffer.allocateDirect(bytes).order(ByteOrder.nativeOrder())
            if (!alpha) for (i in 3 until bytes step 4) pixels.put(i, 0xff.toByte())
            return DecodedImage(pixels, blankWidth, blankHeight, true)
        }
        val pixels = ByteBuffer.allocateDirect(source.width * source.height * 4).order(ByteOrder.nativeOrder())
        // ARGB_8888 is R, G, B, A in memory, premultiplied.
        source.copyPixelsToBuffer(pixels)
        pixels.rewind()
        return DecodedImage(pixels, source.width, source.height, true)
    }

    /**
     * After OffscreenCanvas.transferToImageBitmap() took the bitmap: the
     * canvas is blank, as the runtime then says again with the canvas's size.
     */
    @Synchronized
    override fun clearForTransfer() {
        bitmap = null
        if (presenter.view != null) present()
    }

    /** What the canvas shows as a PNG or JPEG file, or null when it has no pixels. */
    @Synchronized
    fun encode(jpeg: Boolean, quality: Double): ByteArray? {
        val shown = bitmap
        val image = if (shown == null) {
            if (blankWidth == 0 || blankHeight == 0) return null
            Bitmap.createBitmap(blankWidth, blankHeight, Bitmap.Config.ARGB_8888).apply {
                eraseColor(if (alpha && !jpeg) Color.TRANSPARENT else Color.BLACK)
            }
        } else if (jpeg && alpha) {
            // A JPEG has no transparency: transparent pixels come out black,
            // as in browsers.
            Bitmap.createBitmap(shown.width, shown.height, Bitmap.Config.ARGB_8888).apply {
                eraseColor(Color.BLACK)
                Canvas(this).drawBitmap(shown, 0f, 0f, null)
            }
        } else {
            shown
        }
        try {
            return ByteArrayOutputStream().use { output ->
                val written = image.compress(
                    if (jpeg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG,
                    (quality.coerceIn(0.0, 1.0) * 100).roundToInt(),
                    output,
                )
                if (written) output.toByteArray() else null
            }
        } finally {
            if (image !== shown) image.recycle()
        }
    }

    private companion object {
        const val TAG = "AngularLynxBitmapRenderer"
    }
}

private fun ReadableMap?.pixelSide(key: String, default: Int): Int =
    if (this != null && hasKey(key) && getType(key) in NUMBER_TYPES) max(0, getDouble(key).toInt()) else default
