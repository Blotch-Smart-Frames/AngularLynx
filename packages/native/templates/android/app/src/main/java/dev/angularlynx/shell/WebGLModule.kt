package dev.angularlynx.shell

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableArray
import com.lynx.react.bridge.ReadableMap
import com.lynx.react.bridge.ReadableType
import java.io.ByteArrayOutputStream
import java.lang.ref.WeakReference
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * `<canvas>` with WebGL2 for the AngularLynx runtime: the `AngularLynxWebGL`
 * module the runtime's WebGL2RenderingContext sends its GL calls to. Each
 * context (WebGLContext) runs them on OpenGL ES 3.0 and shows its frames in
 * a canvas element's view (CanvasUI).
 *
 * Lynx has no canvas, and runs Angular on its main thread, where WebGL's
 * synchronous answers (a program's link status, a uniform's location) can
 * only come from a main-thread module: MainActivity turns those on
 * (`setEnableMTSModule`). The runtime batches the calls into one `run` per
 * frame; see packages/runtime/src/lib/canvas/webgl-bridge.ts for the
 * protocol. Lynx calls these methods on its engine thread, where the main
 * thread's JavaScript runs, which the shell runs off the UI thread.
 */
class WebGLModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val contexts = HashMap<Int, WebGLContext>()
    private val contexts2D = HashMap<Int, Canvas2DContext>()

    /** The 2D contexts' gradients and patterns, which any of them can paint with. */
    private val canvas2DObjects = HashMap<Int, Any>()

    @LynxMethod
    fun create(contextId: Int, canvasId: String, attributes: ReadableMap?): JavaOnlyMap {
        contexts.remove(contextId)?.destroy()
        return try {
            val context = WebGLContext(canvasId, attributes)
            contexts[contextId] = context
            CanvasRegistry.setContext(canvasId, context)
            JavaOnlyMap.from(mapOf("ok" to true))
        } catch (error: RuntimeException) {
            JavaOnlyMap.from(mapOf("ok" to false, "error" to (error.message ?: "OpenGL ES 3.0 is not available")))
        }
    }

    @LynxMethod
    fun run(contextId: Int, commands: ReadableArray?): JavaOnlyArray {
        val context = contexts[contextId] ?: return JavaOnlyArray()
        return context.run(commands ?: return JavaOnlyArray())
    }

    @LynxMethod
    fun destroy(contextId: Int): Boolean {
        val context = contexts.remove(contextId) ?: return true
        CanvasRegistry.setContext(context.canvasId, null)
        context.destroy()
        return true
    }

    @LynxMethod
    fun decodeImage(imageId: Int, bytes: ReadableArray?, options: ReadableMap?): JavaOnlyMap {
        return try {
            val image = bytes?.let {
                if (hasCrop(options)) {
                    // Cropped before it's resized or flipped, as the HTML
                    // spec orders it: the file is decoded as it is, with the
                    // alpha the bitmap asks for, so the copy needn't convert
                    // it, and then cut.
                    val premultiply = options?.optString("premultiplyAlpha") == "premultiply"
                    decode(bytesFromWords(it), null, premultiply)?.let { decoded -> pixelsOfSnapshot(decoded, options) }
                } else {
                    decode(bytesFromWords(it), options)
                }
            } ?: return imageFailed("The data is not an image Android can decode")
            keptImage(imageId, image, options)
        } catch (_: OutOfMemoryError) {
            imageFailed("The image is too large to decode")
        } catch (_: IllegalArgumentException) {
            // A crop or a resize larger than a Bitmap or a buffer can hold.
            imageFailed("The image is too large to decode")
        }
    }

    @LynxMethod
    fun releaseImage(imageId: Int): Boolean {
        DecodedImages.remove(imageId)
        return true
    }

    /**
     * An ImageBitmap of a canvas, for createImageBitmap() and
     * OffscreenCanvas.transferToImageBitmap(): a copy of the canvas's pixels
     * now, kept under [imageId] as a decoded image is, so texture uploads and
     * drawImage read it as they read one. The pixels never cross the bridge.
     * [options] holds createImageBitmap's options, the canvas's size (a
     * canvas with no context is transparent black, as in a browser) and
     * `transfer`, which clears the canvas after it's read. `{ width, height }`,
     * or `{ error }`.
     */
    @LynxMethod
    fun imageFromCanvas(imageId: Int, canvasId: String?, options: ReadableMap?): JavaOnlyMap {
        val context = canvasId?.let { CanvasRegistry.context(it) }
        return try {
            val snapshot = if (context != null) {
                // A context that has pixels but couldn't read them is a
                // failure, not a blank canvas.
                context.snapshot() ?: return imageFailed("The canvas's pixels could not be read")
            } else {
                val width = options?.optInt("width") ?: 0
                val height = options?.optInt("height") ?: 0
                if (width <= 0 || height <= 0) return imageFailed("The canvas has no pixels")
                val bytes = rgbaByteCount(width, height) ?: return imageFailed("The canvas is too large to copy")
                DecodedImage(ByteBuffer.allocateDirect(bytes).order(ByteOrder.nativeOrder()), width, height, true)
            }
            if (options?.optBool("transfer") == true) context?.clearForTransfer()
            keptImage(imageId, pixelsOfSnapshot(snapshot, options), options)
        } catch (_: OutOfMemoryError) {
            imageFailed("The canvas is too large to copy")
        } catch (_: IllegalArgumentException) {
            // A crop or a resize larger than a Bitmap or a buffer can hold.
            imageFailed("The canvas is too large to copy")
        }
    }

    /**
     * An ImageBitmap of an image the module keeps (an ImageBitmap's, or an
     * `<img>`'s), for createImageBitmap(): a copy of its pixels with
     * createImageBitmap's options, so neither the pixels nor the file cross
     * the bridge again. `{ width, height, cropped }`, or `{ error }`.
     */
    @LynxMethod
    fun imageFromImage(imageId: Int, sourceId: Int, options: ReadableMap?): JavaOnlyMap {
        val source = DecodedImages.get(sourceId) ?: return imageFailed("The image is gone")
        return try {
            // pixelsOfSnapshot works on the pixels it's given, and these are
            // the source's own, which stay as they are. A crop copies them
            // first, so only the part it keeps is read.
            keptImage(imageId, pixelsOfSnapshot(if (hasCrop(options)) source else source.copy(), options), options)
        } catch (_: OutOfMemoryError) {
            imageFailed("The image is too large to copy")
        } catch (_: IllegalArgumentException) {
            imageFailed("The image is too large to copy")
        }
    }

    /**
     * An ImageBitmap of an ImageData, for createImageBitmap(): its RGBA
     * bytes, straight, rows top to bottom, sent as words (see
     * [bytesFromWords]), with its size in [options], and createImageBitmap's
     * options applied. `{ width, height, cropped }`, or `{ error }`.
     */
    @LynxMethod
    fun imageFromPixels(imageId: Int, bytes: ReadableArray?, options: ReadableMap?): JavaOnlyMap {
        val width = options?.optInt("width") ?: 0
        val height = options?.optInt("height") ?: 0
        return try {
            val pixels = bytes?.let { bytesFromWords(it) }
            if (pixels == null || width <= 0 || height <= 0 || rgbaByteCount(width, height) != pixels.remaining()) {
                return imageFailed("The pixels don't fill the image")
            }
            keptImage(imageId, pixelsOfSnapshot(DecodedImage(pixels, width, height, false), options), options)
        } catch (_: OutOfMemoryError) {
            imageFailed("The image is too large to copy")
        } catch (_: IllegalArgumentException) {
            imageFailed("The image is too large to copy")
        }
    }

    private fun imageFailed(message: String) =
        JavaOnlyMap.from(mapOf("width" to 0, "height" to 0, "error" to message))

    /**
     * Keeps a new ImageBitmap's pixels under the id the runtime gave it, and
     * answers its size and, when it was asked for, that the crop was
     * applied: a shell from before cropping leaves `cropped` out, so the
     * runtime can tell it would get all of the source.
     */
    private fun keptImage(imageId: Int, image: DecodedImage, options: ReadableMap?): JavaOnlyMap {
        DecodedImages.put(imageId, image)
        return JavaOnlyMap.from(mapOf("width" to image.width, "height" to image.height, "cropped" to hasCrop(options)))
    }

    /**
     * Whether createImageBitmap() asked for part of the source (its `sx, sy,
     * sw, sh`), which the runtime sends as cropX, cropY, cropWidth and
     * cropHeight, the sizes made positive.
     */
    private fun hasCrop(options: ReadableMap?): Boolean =
        options != null && options.optLong("cropWidth") > 0 && options.optLong("cropHeight") > 0

    /**
     * The part of [image] createImageBitmap()'s crop rectangle covers, the
     * rectangle's size: what it covers outside the image is transparent
     * black, as the HTML spec has it, and the rest keeps its alpha as it
     * was. The rows are copied into a new buffer; the image is only read.
     */
    private fun cropped(image: DecodedImage, options: ReadableMap): DecodedImage {
        // In Long: a corner near a Web IDL long's end, plus a side, passes an Int's.
        val x = options.optLong("cropX")
        val y = options.optLong("cropY")
        val width = options.optLong("cropWidth").toInt()
        val height = options.optLong("cropHeight").toInt()
        val bytes = rgbaByteCount(width, height) ?: throw IllegalArgumentException("The crop rectangle is too large")
        val out = ByteBuffer.allocateDirect(bytes).order(ByteOrder.nativeOrder())
        // The columns and rows the rectangle shares with the image.
        val left = maxOf(x, 0L)
        val right = minOf(x + width, image.width.toLong())
        val top = maxOf(y, 0L)
        val bottom = minOf(y + height, image.height.toLong())
        if (left < right && top < bottom) {
            // A view of its own, so the image's buffer keeps its position.
            val from = image.pixels.duplicate()
            val row = ByteArray(((right - left) * 4).toInt())
            for (r in top until bottom) {
                from.position(((r * image.width + left) * 4).toInt())
                from.get(row)
                out.position((((r - y) * width + (left - x)) * 4).toInt())
                out.put(row)
            }
        }
        out.rewind()
        return DecodedImage(out, width, height, image.premultiplied)
    }

    /**
     * Pixels of the shell's own (a canvas's snapshot, a copy of an image it
     * keeps, an ImageData's) as createImageBitmap's options ask, for a new
     * ImageBitmap: cropped first, as the HTML spec orders it, so a resize and
     * a flip apply to the part the crop rectangle names. Without a resize, the
     * bytes are flipped and premultiplied or divided as asked, exactly, in
     * place; a resize scales them, as a decode does.
     */
    private fun pixelsOfSnapshot(source: DecodedImage, options: ReadableMap?): DecodedImage {
        // hasCrop() is false without options; the check is for the compiler.
        val snapshot = if (options != null && hasCrop(options)) cropped(source, options) else source
        val premultiply = options?.optString("premultiplyAlpha") == "premultiply"
        val resizeWidth = options?.optInt("resizeWidth") ?: 0
        val resizeHeight = options?.optInt("resizeHeight") ?: 0
        var pixels = snapshot.pixels
        var width = snapshot.width
        var height = snapshot.height
        pixels.rewind()
        if (resizeWidth > 0 || resizeHeight > 0) {
            // Scaling draws, which Android only does on premultiplied bitmaps.
            if (!snapshot.premultiplied) premultiply(pixels)
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            // ARGB_8888 is R, G, B, A in memory, premultiplied.
            bitmap.copyPixelsFromBuffer(pixels)
            width = resizedSide(resizeWidth, snapshot.width, resizeHeight, snapshot.height)
            height = resizedSide(resizeHeight, snapshot.height, resizeWidth, snapshot.width)
            val bytes = rgbaByteCount(width, height) ?: throw IllegalArgumentException("The resize is too large")
            val scaled = Bitmap.createScaledBitmap(bitmap, width, height, true)
            pixels = ByteBuffer.allocateDirect(bytes).order(ByteOrder.nativeOrder())
            scaled.copyPixelsToBuffer(pixels)
            pixels.rewind()
            if (scaled !== bitmap) scaled.recycle()
            bitmap.recycle()
            if (!premultiply) unpremultiply(pixels)
        } else if (premultiply && !snapshot.premultiplied) {
            premultiply(pixels)
        } else if (!premultiply && snapshot.premultiplied) {
            unpremultiply(pixels)
        }
        if (options?.optString("imageOrientation") == "flipY") flipRows(pixels, width * 4, height)
        return DecodedImage(pixels, width, height, premultiply)
    }

    /**
     * The drawing buffer as an image file, for canvas.toBlob() and
     * toDataURL(): `{ base64, type }`, or `{ error }`. [options] holds the
     * MIME type (image/jpeg, or image/png for anything else, as browsers fall
     * back), the JPEG quality and premultipliedAlpha.
     *
     * The pixels are encoded here rather than sent to the runtime, which
     * would have to carry 11 MB of RGBA for a 2048 by 1365 photo across the
     * bridge as numbers, and encode it in JavaScript on PrimJS, which has no
     * JIT. The file crosses as base64: the bridge can't return bytes (see
     * webgl-bridge.ts).
     */
    @LynxMethod
    fun encodeImage(contextId: Int, options: ReadableMap?): JavaOnlyMap {
        val context = contexts[contextId] ?: return encodeFailed("The canvas has no WebGL context")
        val jpeg = options?.optString("type") == "image/jpeg"
        val quality = if (options != null && options.hasKey("quality") && options.getType("quality") in NUMBER_TYPES) {
            options.getDouble("quality")
        } else {
            0.92
        }
        val premultiplied = !(
            options != null && options.hasKey("premultipliedAlpha") &&
                options.getType("premultipliedAlpha") == ReadableType.Boolean &&
                !options.getBoolean("premultipliedAlpha")
            )
        return try {
            val pixels = context.readDrawingBuffer() ?: return encodeFailed("The WebGL context is gone")
            val file = encode(pixels, jpeg, quality, premultiplied)
            JavaOnlyMap.from(
                mapOf(
                    "base64" to Base64.encodeToString(file, Base64.NO_WRAP),
                    "type" to if (jpeg) "image/jpeg" else "image/png",
                ),
            )
        } catch (_: OutOfMemoryError) {
            encodeFailed("The canvas is too large to encode")
        }
    }

    private fun encodeFailed(message: String) = JavaOnlyMap.from(mapOf("error" to message))

    /**
     * Encodes RGBA pixels, rows bottom to top, as a PNG or JPEG file.
     */
    private fun encode(pixels: DrawingBufferPixels, jpeg: Boolean, quality: Double, premultiplied: Boolean): ByteArray {
        val buffer = pixels.rgba
        val stride = pixels.width * 4
        // GL's first row is the bottom of the image; a bitmap's is the top.
        flipRows(buffer, stride, pixels.height)
        if (jpeg && pixels.alpha) {
            // A JPEG has no transparency. Browsers draw a canvas's
            // transparent pixels over black for one, which premultiplied
            // colors already are: straight ones are multiplied first. Then
            // every pixel is opaque, so the encoder has no alpha to treat.
            for (i in 0 until buffer.limit() step 4) {
                val alpha = buffer.get(i + 3).toInt() and 0xff
                if (alpha == 255) continue
                if (!premultiplied) {
                    for (c in 0 until 3) {
                        val value = buffer.get(i + c).toInt() and 0xff
                        buffer.put(i + c, ((value * alpha + 127) / 255).toByte())
                    }
                }
                buffer.put(i + 3, 0xff.toByte())
            }
        }
        val bitmap = Bitmap.createBitmap(pixels.width, pixels.height, Bitmap.Config.ARGB_8888)
        // The drawing buffer's colors are premultiplied by alpha unless the
        // app asked for premultipliedAlpha: false. A bitmap takes either, and
        // compress() writes a PNG's straight colors from it.
        if (!premultiplied && pixels.alpha && !jpeg) bitmap.isPremultiplied = false
        // ARGB_8888 is R, G, B, A in memory: what GL_RGBA reads.
        bitmap.copyPixelsFromBuffer(buffer)
        if (jpeg || !pixels.alpha) bitmap.setHasAlpha(false)
        return try {
            ByteArrayOutputStream().use { output ->
                bitmap.compress(
                    if (jpeg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG,
                    (quality.coerceIn(0.0, 1.0) * 100).roundToInt(),
                    output,
                )
                output.toByteArray()
            }
        } finally {
            bitmap.recycle()
        }
    }

    /** A 2D context for the canvas (see Canvas2DContext): `{ ok }`, or `{ ok: false, error }`. */
    @LynxMethod
    fun create2D(contextId: Int, canvasId: String, attributes: ReadableMap?): JavaOnlyMap {
        destroy2D(contextId)
        return try {
            val context = Canvas2DContext(canvasId, attributes, canvas2DObjects)
            contexts2D[contextId] = context
            CanvasRegistry.setContext(canvasId, context)
            JavaOnlyMap.from(mapOf("ok" to true))
        } catch (_: OutOfMemoryError) {
            JavaOnlyMap.from(mapOf("ok" to false, "error" to "The canvas is too large for its bitmap"))
        }
    }

    @LynxMethod
    fun run2D(contextId: Int, commands: ReadableArray?): JavaOnlyArray {
        val context = contexts2D[contextId] ?: return JavaOnlyArray()
        return context.run(commands ?: return JavaOnlyArray())
    }

    @LynxMethod
    fun destroy2D(contextId: Int): Boolean {
        val context = contexts2D.remove(contextId) ?: return true
        if (CanvasRegistry.context(context.canvasId) === context) CanvasRegistry.setContext(context.canvasId, null)
        context.destroy()
        return true
    }

    /**
     * Frees a gradient or pattern, which every 2D context in the LynxView
     * shares, whether or not the context that made it is still there.
     */
    @LynxMethod
    fun release2D(objectId: Int): Boolean {
        canvas2DObjects.remove(objectId)
        return true
    }

    /** The bitmap as an image file, for canvas.toBlob() and toDataURL(). */
    @LynxMethod
    fun encode2D(contextId: Int, options: ReadableMap?): JavaOnlyMap {
        val context = contexts2D[contextId] ?: return encodeFailed("The canvas has no 2D context")
        val jpeg = options?.optString("type") == "image/jpeg"
        val quality = if (options != null && options.hasKey("quality") && options.getType("quality") in NUMBER_TYPES) {
            options.getDouble("quality")
        } else {
            0.92
        }
        return try {
            val file = context.encode(jpeg, quality) ?: return encodeFailed("The canvas couldn't be encoded")
            JavaOnlyMap.from(
                mapOf(
                    "base64" to Base64.encodeToString(file, Base64.NO_WRAP),
                    "type" to if (jpeg) "image/jpeg" else "image/png",
                ),
            )
        } catch (_: OutOfMemoryError) {
            encodeFailed("The canvas is too large to encode")
        }
    }

    override fun destroy() {
        for (context in contexts.values) context.destroy()
        contexts.clear()
        for (context in contexts2D.values) context.destroy()
        contexts2D.clear()
        canvas2DObjects.clear()
        super.destroy()
    }

    /**
     * Decodes an image file to RGBA bytes, as createImageBitmap's options ask:
     * `imageOrientation: 'flipY'` flips it, `premultiplyAlpha: 'premultiply'`
     * premultiplies it (otherwise it's kept straight; [premultiply] says so
     * instead, for a file decoded to be cropped), and
     * `resizeWidth`/`resizeHeight` scale it.
     */
    private fun decode(
        bytes: ByteBuffer,
        options: ReadableMap?,
        premultiply: Boolean = options?.optString("premultiplyAlpha") == "premultiply",
    ): DecodedImage? {
        val array = ByteArray(bytes.remaining()).also { bytes.get(it) }
        val resizeWidth = options?.optInt("resizeWidth") ?: 0
        val resizeHeight = options?.optInt("resizeHeight") ?: 0
        val resize = resizeWidth > 0 || resizeHeight > 0
        // Scaling draws, which Android only does on premultiplied bitmaps:
        // those are divided back after.
        val decodeOptions = BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.ARGB_8888
            inPremultiplied = premultiply || resize
        }
        var bitmap = BitmapFactory.decodeByteArray(array, 0, array.size, decodeOptions) ?: return null
        if (resize) {
            val width = resizedSide(resizeWidth, bitmap.width, resizeHeight, bitmap.height)
            val height = resizedSide(resizeHeight, bitmap.height, resizeWidth, bitmap.width)
            bitmap = Bitmap.createScaledBitmap(bitmap, width, height, true)
        }
        if (bitmap.config != Bitmap.Config.ARGB_8888) bitmap = bitmap.copy(Bitmap.Config.ARGB_8888, false)
        val pixels = ByteBuffer.allocateDirect(bitmap.width * bitmap.height * 4).order(ByteOrder.nativeOrder())
        // ARGB_8888 is R, G, B, A in memory: what GL_RGBA reads.
        bitmap.copyPixelsToBuffer(pixels)
        pixels.rewind()
        if (resize && !premultiply) unpremultiply(pixels)
        if (options?.optString("imageOrientation") == "flipY") flipRows(pixels, bitmap.width * 4, bitmap.height)
        return DecodedImage(pixels, bitmap.width, bitmap.height, premultiply)
    }

    private fun ReadableMap.optString(key: String): String? =
        if (hasKey(key) && getType(key) == ReadableType.String) getString(key) else null

    private fun ReadableMap.optInt(key: String): Int =
        if (hasKey(key) && getType(key) in NUMBER_TYPES) getDouble(key).toInt() else 0

    private fun ReadableMap.optLong(key: String): Long =
        if (hasKey(key) && getType(key) in NUMBER_TYPES) getDouble(key).toLong() else 0L

    private fun ReadableMap.optBool(key: String): Boolean =
        hasKey(key) && getType(key) == ReadableType.Boolean && getBoolean(key)

    companion object {
        const val NAME = "AngularLynxWebGL"
    }
}

internal val NUMBER_TYPES = setOf(ReadableType.Int, ReadableType.Long, ReadableType.Number)

/** The drawing buffer's pixels: RGBA, rows bottom to top, and whether the canvas has alpha. */
class DrawingBufferPixels(val rgba: ByteBuffer, val width: Int, val height: Int, val alpha: Boolean)

/** Pixels the module decoded, which texture uploads read by id: RGBA, rows top to bottom. */
class DecodedImage(val pixels: ByteBuffer, val width: Int, val height: Int, val premultiplied: Boolean) {
    /** A copy, in a buffer of its own, for work done on the pixels in place. */
    fun copy(): DecodedImage {
        val from = pixels.duplicate()
        from.rewind()
        val to = ByteBuffer.allocateDirect(from.remaining()).order(ByteOrder.nativeOrder())
        to.put(from)
        to.rewind()
        return DecodedImage(to, width, height, premultiplied)
    }
}

/**
 * A canvas's context, of either kind: what the registry pairs with the
 * canvas's view, and what another context reads the canvas through (as a
 * texture, or drawn on a 2D canvas).
 */
interface CanvasContext {
    val canvasId: String

    /** Shows frames in this canvas's view, or nowhere while it's null. */
    fun attachView(canvas: CanvasUI?)

    /** The view's surface came, went or changed size. */
    fun surfaceChanged()

    /** The canvas's pixels now, rows top to bottom, or null when it has none. */
    fun snapshot(): DecodedImage?

    /**
     * After `OffscreenCanvas.transferToImageBitmap()` took the pixels: a 2D
     * bitmap is cleared to transparent black (opaque black without alpha),
     * and a WebGL drawing buffer too, even with preserveDrawingBuffer, which
     * the HTML spec says has no effect on a transfer. The context's state
     * stays.
     */
    fun clearForTransfer()
}

internal object DecodedImages {
    private val images = HashMap<Int, DecodedImage>()
    fun put(id: Int, image: DecodedImage) { images[id] = image }
    fun get(id: Int): DecodedImage? = images[id]
    fun remove(id: Int) { images.remove(id) }
}

/**
 * Pairs canvases with contexts by canvas id: either can come first, as the
 * runtime may make the context before Lynx has made the element's view.
 *
 * Views come and go on the UI thread, contexts on Lynx's engine thread, so
 * it's locked. A context looks a canvas up here while it holds its own lock
 * (drawing another canvas, or uploading it as a texture), so the registry
 * never calls a context while it holds its lock: it finds the context, lets
 * go, then attaches the view.
 */
internal object CanvasRegistry {
    private val views = HashMap<String, WeakReference<CanvasUI>>()
    private val contexts = HashMap<String, WeakReference<CanvasContext>>()

    fun setView(canvasId: String, view: CanvasUI?) {
        val context = synchronized(this) {
            if (view == null) views.remove(canvasId) else views[canvasId] = WeakReference(view)
            contexts[canvasId]?.get()
        }
        context?.attachView(view)
    }

    @Synchronized
    fun view(canvasId: String): CanvasUI? = views[canvasId]?.get()

    fun setContext(canvasId: String, context: CanvasContext?) {
        val view = synchronized(this) {
            if (context == null) {
                contexts.remove(canvasId)
                null
            } else {
                contexts[canvasId] = WeakReference(context)
                views[canvasId]?.get()
            }
        }
        context?.attachView(view)
    }

    @Synchronized
    fun context(canvasId: String): CanvasContext? = contexts[canvasId]?.get()
}

/**
 * The bytes the runtime sends as 32-bit words, with the byte count last (see
 * toWords in webgl-bridge.ts). Android runs little-endian, so the words land
 * in memory as the bytes were.
 */
internal fun bytesFromWords(words: ReadableArray): ByteBuffer {
    val count = words.size()
    if (count == 0) return ByteBuffer.allocateDirect(0)
    val byteLength = words.getDouble(count - 1).toLong().toInt()
    val buffer = ByteBuffer.allocateDirect((count - 1) * 4).order(ByteOrder.LITTLE_ENDIAN)
    for (i in 0 until count - 1) buffer.putInt(words.getDouble(i).toLong().toInt())
    buffer.rewind()
    buffer.limit(minOf(byteLength, (count - 1) * 4))
    return buffer
}

/** Bytes as words for the trip back, the byte count last. */
internal fun wordsFromBytes(bytes: ByteBuffer, length: Int): JavaOnlyArray {
    val words = JavaOnlyArray()
    val source = bytes.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    source.rewind()
    val wordCount = (length + 3) / 4
    for (i in 0 until wordCount) {
        var word = 0L
        for (b in 0 until 4) {
            val index = i * 4 + b
            if (index < length) word = word or ((source.get(index).toLong() and 0xff) shl (8 * b))
        }
        words.pushDouble(word.toDouble())
    }
    words.pushInt(length)
    return words
}

internal fun flipRows(pixels: ByteBuffer, stride: Int, height: Int) {
    val top = ByteArray(stride)
    val bottom = ByteArray(stride)
    for (row in 0 until height / 2) {
        val other = height - 1 - row
        pixels.position(row * stride); pixels.get(top)
        pixels.position(other * stride); pixels.get(bottom)
        pixels.position(row * stride); pixels.put(bottom)
        pixels.position(other * stride); pixels.put(top)
    }
    pixels.rewind()
}

/**
 * The bytes of a [width] by [height] RGBA image, or null when a buffer can't
 * hold that many. The pixel count of two Ints fits in a Long, and is checked
 * before it's multiplied by 4: a canvas of 32768 by 32768 has 2^32 bytes,
 * which an Int wraps round to 0, and one of Int.MAX_VALUE by Int.MAX_VALUE
 * more than a Long holds.
 */
internal fun rgbaByteCount(width: Int, height: Int): Int? {
    val pixels = width.toLong() * height
    return if (pixels in 0..(Int.MAX_VALUE / 4).toLong()) (pixels * 4).toInt() else null
}

/**
 * One side of the size createImageBitmap's resize asks for: [resize] when
 * it's given, otherwise the side scaled by the other side's resize, keeping
 * the aspect ratio, rounded up, as the HTML spec has it. In Long, so a big
 * image can't wrap round.
 */
internal fun resizedSide(resize: Int, side: Int, otherResize: Int, otherSide: Int): Int {
    if (resize > 0) return resize
    val scaled = (side.toLong() * otherResize + otherSide - 1) / otherSide
    return scaled.coerceIn(1L, Int.MAX_VALUE.toLong()).toInt()
}

internal fun premultiply(pixels: ByteBuffer) {
    for (i in 0 until pixels.limit() step 4) {
        val alpha = pixels.get(i + 3).toInt() and 0xff
        if (alpha == 255) continue
        for (c in 0 until 3) {
            val value = pixels.get(i + c).toInt() and 0xff
            pixels.put(i + c, ((value * alpha + 127) / 255).toByte())
        }
    }
}

internal fun unpremultiply(pixels: ByteBuffer) {
    for (i in 0 until pixels.limit() step 4) {
        val alpha = pixels.get(i + 3).toInt() and 0xff
        if (alpha == 0 || alpha == 255) continue
        for (c in 0 until 3) {
            val value = pixels.get(i + c).toInt() and 0xff
            pixels.put(i + c, minOf(255, (value * 255 + alpha / 2) / alpha).toByte())
        }
    }
}
