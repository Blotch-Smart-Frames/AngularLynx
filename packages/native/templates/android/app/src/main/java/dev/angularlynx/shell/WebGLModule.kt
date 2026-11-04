package dev.angularlynx.shell

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableArray
import com.lynx.react.bridge.ReadableMap
import com.lynx.react.bridge.ReadableType
import java.lang.ref.WeakReference
import java.nio.ByteBuffer
import java.nio.ByteOrder

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
 * protocol. Lynx calls these methods on the UI thread, where GL runs.
 */
class WebGLModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val contexts = HashMap<Int, WebGLContext>()

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
        val image = bytes?.let { decode(bytesFromWords(it), options) }
            ?: return JavaOnlyMap.from(mapOf("width" to 0, "height" to 0, "error" to "The data is not an image Android can decode"))
        DecodedImages.put(imageId, image)
        return JavaOnlyMap.from(mapOf("width" to image.width, "height" to image.height))
    }

    @LynxMethod
    fun releaseImage(imageId: Int): Boolean {
        DecodedImages.remove(imageId)
        return true
    }

    override fun destroy() {
        for (context in contexts.values) context.destroy()
        contexts.clear()
        super.destroy()
    }

    /**
     * Decodes an image file to RGBA bytes, as createImageBitmap's options ask:
     * `imageOrientation: 'flipY'` flips it, `premultiplyAlpha: 'premultiply'`
     * premultiplies it (otherwise it's kept straight), and
     * `resizeWidth`/`resizeHeight` scale it.
     */
    private fun decode(bytes: ByteBuffer, options: ReadableMap?): DecodedImage? {
        val array = ByteArray(bytes.remaining()).also { bytes.get(it) }
        val premultiply = options?.optString("premultiplyAlpha") == "premultiply"
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
            val width = if (resizeWidth > 0) resizeWidth else maxOf(1, bitmap.width * resizeHeight / bitmap.height)
            val height = if (resizeHeight > 0) resizeHeight else maxOf(1, bitmap.height * resizeWidth / bitmap.width)
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

    companion object {
        const val NAME = "AngularLynxWebGL"
    }
}

internal val NUMBER_TYPES = setOf(ReadableType.Int, ReadableType.Long, ReadableType.Number)

/** Pixels the module decoded, which texture uploads read by id: RGBA, rows top to bottom. */
internal class DecodedImage(val pixels: ByteBuffer, val width: Int, val height: Int, val premultiplied: Boolean)

internal object DecodedImages {
    private val images = HashMap<Int, DecodedImage>()
    fun put(id: Int, image: DecodedImage) { images[id] = image }
    fun get(id: Int): DecodedImage? = images[id]
    fun remove(id: Int) { images.remove(id) }
}

/**
 * Pairs canvases with contexts by canvas id: either can come first, as the
 * runtime may make the context before Lynx has made the element's view.
 */
internal object CanvasRegistry {
    private val views = HashMap<String, WeakReference<CanvasUI>>()
    private val contexts = HashMap<String, WeakReference<WebGLContext>>()

    fun setView(canvasId: String, view: CanvasUI?) {
        if (view == null) views.remove(canvasId) else views[canvasId] = WeakReference(view)
        contexts[canvasId]?.get()?.attachView(view)
    }

    fun view(canvasId: String): CanvasUI? = views[canvasId]?.get()

    fun setContext(canvasId: String, context: WebGLContext?) {
        if (context == null) {
            contexts.remove(canvasId)
        } else {
            contexts[canvasId] = WeakReference(context)
            context.attachView(views[canvasId]?.get())
        }
    }

    fun context(canvasId: String): WebGLContext? = contexts[canvasId]?.get()
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
