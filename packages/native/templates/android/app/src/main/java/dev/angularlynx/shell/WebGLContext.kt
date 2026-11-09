package dev.angularlynx.shell

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.GLES30
import android.util.Log
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableArray
import com.lynx.react.bridge.ReadableMap
import com.lynx.react.bridge.ReadableType
import java.nio.Buffer
import java.nio.ByteBuffer
import java.nio.ByteOrder

// WebGL's names for the default framebuffer's buffers, which GLES gives to
// window surfaces only. The default framebuffer here is an ordinary one.
private const val WEBGL_BACK = 0x0405
private const val WEBGL_COLOR = 0x1800
private const val WEBGL_DEPTH = 0x1801
private const val WEBGL_STENCIL = 0x1802
private const val WEBGL_UNMASKED_VENDOR = 0x9245
private const val WEBGL_UNMASKED_RENDERER = 0x9246
private const val TEXTURE_MAX_ANISOTROPY = 0x84FE
private const val MAX_TEXTURE_MAX_ANISOTROPY = 0x84FF
private const val EGL_OPENGL_ES3_BIT = 0x40

/**
 * One WebGL context: an EGL context with OpenGL ES 3.0, and an offscreen
 * default framebuffer the size of the canvas's `width` and `height`, which
 * each finished frame is copied from into the canvas's TextureView.
 *
 * The runtime's `run` calls arrive on the UI thread, which makes the context
 * current for each and puts back whatever was current before.
 */
class WebGLContext(val canvasId: String, attributes: ReadableMap?) {
    private val display: EGLDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
    private val config: EGLConfig
    private var context: EGLContext
    /** A 1x1 surface to be current on while there's no window. */
    private var pbuffer: EGLSurface
    private var windowSurface: EGLSurface = EGL14.EGL_NO_SURFACE
    private var windowTexture: Any? = null

    private val alpha = attributes.flag("alpha", true)
    private val depth = attributes.flag("depth", true)
    private val stencil = attributes.flag("stencil", false)
    private val preserveDrawingBuffer = attributes.flag("preserveDrawingBuffer", false)
    private var samples = 0

    // The default framebuffer, multisampled when antialias is on, and the
    // single-sampled framebuffer it resolves into before it's shown.
    private var framebuffer = 0
    private var colorBuffer = 0
    private var depthStencilBuffer = 0
    private var resolveFramebuffer = 0
    private var resolveBuffer = 0
    private var width = 1
    private var height = 1

    private var view: CanvasUI? = null
    /** A frame was finished before there was a surface to show it on. */
    private var framePending = false

    // The app's bindings, which drawing the frame changes and then restores.
    private var drawFramebuffer = 0
    private var readFramebuffer = 0
    private var renderbuffer = 0

    // The runtime's object ids, to GL names (ids are never reused).
    private var names = IntArray(256)
    private val syncs = HashMap<Int, Long>()
    private var destroyed = false

    init {
        val version = IntArray(2)
        if (!EGL14.eglInitialize(display, version, 0, version, 1)) {
            throw RuntimeException("EGL is not available")
        }
        val configs = arrayOfNulls<EGLConfig>(1)
        val count = IntArray(1)
        val configAttributes = intArrayOf(
            EGL14.EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
            EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT,
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_NONE,
        )
        if (!EGL14.eglChooseConfig(display, configAttributes, 0, configs, 0, 1, count, 0) || count[0] == 0) {
            throw RuntimeException("This device has no OpenGL ES 3.0")
        }
        config = configs[0]!!
        context = EGL14.eglCreateContext(
            display, config, EGL14.EGL_NO_CONTEXT,
            intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE), 0,
        )
        if (context == EGL14.EGL_NO_CONTEXT) throw RuntimeException("This device has no OpenGL ES 3.0")
        pbuffer = EGL14.eglCreatePbufferSurface(
            display, config, intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0,
        )
        withCurrent {
            samples = if (attributes.flag("antialias", true)) {
                val max = IntArray(1)
                GLES30.glGetIntegerv(GLES30.GL_MAX_SAMPLES, max, 0)
                minOf(4, max[0])
            } else {
                0
            }
            framebuffer = genFramebuffer()
            colorBuffer = genRenderbuffer()
            if (depth || stencil) depthStencilBuffer = genRenderbuffer()
            if (samples > 0) {
                resolveFramebuffer = genFramebuffer()
                resolveBuffer = genRenderbuffer()
            }
            drawFramebuffer = framebuffer
            readFramebuffer = framebuffer
            allocateDrawingBuffer(1, 1)
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, framebuffer)
        }
    }

    fun destroy() {
        if (destroyed) return
        withCurrent {
            GLES30.glDeleteFramebuffers(1, intArrayOf(framebuffer), 0)
            GLES30.glDeleteRenderbuffers(1, intArrayOf(colorBuffer), 0)
            if (depthStencilBuffer != 0) GLES30.glDeleteRenderbuffers(1, intArrayOf(depthStencilBuffer), 0)
            if (resolveFramebuffer != 0) GLES30.glDeleteFramebuffers(1, intArrayOf(resolveFramebuffer), 0)
            if (resolveBuffer != 0) GLES30.glDeleteRenderbuffers(1, intArrayOf(resolveBuffer), 0)
            for (sync in syncs.values) GLES30.glDeleteSync(sync)
            syncs.clear()
        }
        destroyed = true
        releaseWindowSurface()
        EGL14.eglDestroySurface(display, pbuffer)
        EGL14.eglDestroyContext(display, context)
    }

    // --- Current context -----------------------------------------------------

    /** Runs GL calls with this context current, then puts back the previous one. */
    private inline fun <T> withCurrent(block: () -> T): T {
        val previousContext = EGL14.eglGetCurrentContext()
        val previousDraw = EGL14.eglGetCurrentSurface(EGL14.EGL_DRAW)
        val previousRead = EGL14.eglGetCurrentSurface(EGL14.EGL_READ)
        val surface = if (windowSurface != EGL14.EGL_NO_SURFACE) windowSurface else pbuffer
        val switched = previousContext != context || previousDraw != surface
        if (switched) EGL14.eglMakeCurrent(display, surface, surface, context)
        try {
            return block()
        } finally {
            if (switched) {
                if (previousContext == EGL14.EGL_NO_CONTEXT) {
                    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                } else {
                    EGL14.eglMakeCurrent(EGL14.eglGetCurrentDisplay(), previousDraw, previousRead, previousContext)
                }
            }
        }
    }

    // --- The view ------------------------------------------------------------

    fun attachView(canvas: CanvasUI?) {
        if (view === canvas) return
        view = canvas
        canvas?.setOpaque(!alpha)
        surfaceChanged()
    }

    /** The view's surface came, went or changed size. */
    fun surfaceChanged() {
        if (destroyed) return
        val texture = view?.surface
        if (texture !== windowTexture) {
            releaseWindowSurface()
            if (texture != null) {
                windowSurface = EGL14.eglCreateWindowSurface(display, config, texture, intArrayOf(EGL14.EGL_NONE), 0)
                if (windowSurface == EGL14.EGL_NO_SURFACE) {
                    Log.w(TAG, "Could not make an EGL surface for the canvas")
                } else {
                    windowTexture = texture
                    withCurrent {
                        // Presenting never waits for the display: it runs on
                        // the UI thread.
                        EGL14.eglSwapInterval(display, 0)
                    }
                }
            }
        }
        if (framePending) present()
    }

    private fun releaseWindowSurface() {
        if (windowSurface == EGL14.EGL_NO_SURFACE) return
        if (EGL14.eglGetCurrentSurface(EGL14.EGL_DRAW) == windowSurface) {
            EGL14.eglMakeCurrent(display, pbuffer, pbuffer, context)
        }
        EGL14.eglDestroySurface(display, windowSurface)
        windowSurface = EGL14.EGL_NO_SURFACE
        windowTexture = null
    }

    // --- Default framebuffer -------------------------------------------------

    private fun colorFormat() = if (alpha) GLES30.GL_RGBA8 else GLES30.GL_RGB8

    private fun depthStencilFormat() = when {
        depth && stencil -> GLES30.GL_DEPTH24_STENCIL8
        depth -> GLES30.GL_DEPTH_COMPONENT24
        else -> GLES30.GL_STENCIL_INDEX8
    }

    /** (Re)allocates the default framebuffer at the canvas's size, cleared. */
    private fun allocateDrawingBuffer(newWidth: Int, newHeight: Int) {
        width = maxOf(1, newWidth)
        height = maxOf(1, newHeight)
        storage(colorBuffer, colorFormat(), samples)
        if (depthStencilBuffer != 0) storage(depthStencilBuffer, depthStencilFormat(), samples)
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, framebuffer)
        GLES30.glFramebufferRenderbuffer(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_RENDERBUFFER, colorBuffer)
        if (depthStencilBuffer != 0) {
            if (depth) {
                GLES30.glFramebufferRenderbuffer(GLES30.GL_FRAMEBUFFER, GLES30.GL_DEPTH_ATTACHMENT, GLES30.GL_RENDERBUFFER, depthStencilBuffer)
            }
            if (stencil) {
                GLES30.glFramebufferRenderbuffer(GLES30.GL_FRAMEBUFFER, GLES30.GL_STENCIL_ATTACHMENT, GLES30.GL_RENDERBUFFER, depthStencilBuffer)
            }
        }
        if (samples > 0) {
            storage(resolveBuffer, colorFormat(), 0)
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, resolveFramebuffer)
            GLES30.glFramebufferRenderbuffer(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_RENDERBUFFER, resolveBuffer)
        }
        clearDrawingBuffer()
        GLES30.glBindRenderbuffer(GLES30.GL_RENDERBUFFER, renderbuffer)
        restoreFramebuffers()
    }

    private fun storage(buffer: Int, format: Int, sampleCount: Int) {
        GLES30.glBindRenderbuffer(GLES30.GL_RENDERBUFFER, buffer)
        if (sampleCount > 0) {
            GLES30.glRenderbufferStorageMultisample(GLES30.GL_RENDERBUFFER, sampleCount, format, width, height)
        } else {
            GLES30.glRenderbufferStorage(GLES30.GL_RENDERBUFFER, format, width, height)
        }
    }

    /** Clears the default framebuffer whatever the app's clear values, masks and scissor, and puts them back. */
    private fun clearDrawingBuffer() {
        val clearColor = FloatArray(4)
        val clearDepth = FloatArray(1)
        val ints = IntArray(3)
        val colorMask = BooleanArray(4)
        val depthMask = BooleanArray(1)
        GLES30.glGetFloatv(GLES30.GL_COLOR_CLEAR_VALUE, clearColor, 0)
        GLES30.glGetFloatv(GLES30.GL_DEPTH_CLEAR_VALUE, clearDepth, 0)
        GLES30.glGetIntegerv(GLES30.GL_STENCIL_CLEAR_VALUE, ints, 0)
        GLES30.glGetIntegerv(GLES30.GL_STENCIL_WRITEMASK, ints, 1)
        GLES30.glGetIntegerv(GLES30.GL_STENCIL_BACK_WRITEMASK, ints, 2)
        GLES30.glGetBooleanv(GLES30.GL_COLOR_WRITEMASK, colorMask, 0)
        GLES30.glGetBooleanv(GLES30.GL_DEPTH_WRITEMASK, depthMask, 0)
        val scissor = GLES30.glIsEnabled(GLES30.GL_SCISSOR_TEST)
        val discard = GLES30.glIsEnabled(GLES30.GL_RASTERIZER_DISCARD)

        GLES30.glBindFramebuffer(GLES30.GL_DRAW_FRAMEBUFFER, framebuffer)
        GLES30.glDisable(GLES30.GL_SCISSOR_TEST)
        GLES30.glDisable(GLES30.GL_RASTERIZER_DISCARD)
        GLES30.glClearColor(0f, 0f, 0f, 0f)
        GLES30.glClearDepthf(1f)
        GLES30.glClearStencil(0)
        GLES30.glColorMask(true, true, true, true)
        GLES30.glDepthMask(true)
        GLES30.glStencilMask(-1)
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT or GLES30.GL_DEPTH_BUFFER_BIT or GLES30.GL_STENCIL_BUFFER_BIT)

        GLES30.glClearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3])
        GLES30.glClearDepthf(clearDepth[0])
        GLES30.glClearStencil(ints[0])
        GLES30.glColorMask(colorMask[0], colorMask[1], colorMask[2], colorMask[3])
        GLES30.glDepthMask(depthMask[0])
        GLES30.glStencilMaskSeparate(GLES30.GL_FRONT, ints[1])
        GLES30.glStencilMaskSeparate(GLES30.GL_BACK, ints[2])
        if (scissor) GLES30.glEnable(GLES30.GL_SCISSOR_TEST)
        if (discard) GLES30.glEnable(GLES30.GL_RASTERIZER_DISCARD)
        GLES30.glBindFramebuffer(GLES30.GL_DRAW_FRAMEBUFFER, drawFramebuffer)
    }

    private fun restoreFramebuffers() {
        GLES30.glBindFramebuffer(GLES30.GL_DRAW_FRAMEBUFFER, drawFramebuffer)
        GLES30.glBindFramebuffer(GLES30.GL_READ_FRAMEBUFFER, readFramebuffer)
    }

    /**
     * Runs a read of the read framebuffer (readPixels, copyTexImage2D…).
     * WebGL reads an antialiased default framebuffer as one image, its samples
     * resolved, but GLES can't read a multisampled framebuffer: those calls are
     * INVALID_OPERATION on one and read nothing. So a read of the default
     * framebuffer resolves it, as present does, and reads the resolved copy.
     */
    private inline fun <T> reading(read: () -> T): T {
        if (samples == 0 || !defaultBound(GLES30.GL_READ_FRAMEBUFFER)) return read()
        // A blit is clipped by the scissor test, and skipped with rasterizer
        // discard on, so both are off while the samples are resolved.
        val scissor = GLES30.glIsEnabled(GLES30.GL_SCISSOR_TEST)
        val discard = GLES30.glIsEnabled(GLES30.GL_RASTERIZER_DISCARD)
        GLES30.glDisable(GLES30.GL_SCISSOR_TEST)
        GLES30.glDisable(GLES30.GL_RASTERIZER_DISCARD)
        GLES30.glBindFramebuffer(GLES30.GL_DRAW_FRAMEBUFFER, resolveFramebuffer)
        GLES30.glBlitFramebuffer(0, 0, width, height, 0, 0, width, height, GLES30.GL_COLOR_BUFFER_BIT, GLES30.GL_NEAREST)
        if (scissor) GLES30.glEnable(GLES30.GL_SCISSOR_TEST)
        if (discard) GLES30.glEnable(GLES30.GL_RASTERIZER_DISCARD)
        GLES30.glBindFramebuffer(GLES30.GL_DRAW_FRAMEBUFFER, drawFramebuffer)
        GLES30.glBindFramebuffer(GLES30.GL_READ_FRAMEBUFFER, resolveFramebuffer)
        try {
            return read()
        } finally {
            GLES30.glBindFramebuffer(GLES30.GL_READ_FRAMEBUFFER, readFramebuffer)
        }
    }

    /**
     * The drawing buffer's pixels, for canvas.toBlob() and toDataURL(): RGBA,
     * rows bottom to top as GL reads them, or null once the context is gone.
     * It's what the drawing buffer holds now, as a browser reads it: what the
     * app has drawn since the last frame was shown, or, once a frame has been
     * shown without preserveDrawingBuffer, the cleared buffer.
     */
    fun readDrawingBuffer(): DrawingBufferPixels? {
        if (destroyed) return null
        val pixels = ByteBuffer.allocateDirect(width * height * 4).order(ByteOrder.nativeOrder())
        withCurrent {
            // A plain read of the whole default framebuffer, whatever the app
            // has bound and set: its pixel pack buffer and pack parameters
            // would move or redirect the read. The app's state is put back
            // after.
            val pack = IntArray(5)
            GLES30.glGetIntegerv(GLES30.GL_PIXEL_PACK_BUFFER_BINDING, pack, 0)
            GLES30.glGetIntegerv(GLES30.GL_PACK_ALIGNMENT, pack, 1)
            GLES30.glGetIntegerv(GLES30.GL_PACK_ROW_LENGTH, pack, 2)
            GLES30.glGetIntegerv(GLES30.GL_PACK_SKIP_PIXELS, pack, 3)
            GLES30.glGetIntegerv(GLES30.GL_PACK_SKIP_ROWS, pack, 4)
            GLES30.glBindBuffer(GLES30.GL_PIXEL_PACK_BUFFER, 0)
            GLES30.glPixelStorei(GLES30.GL_PACK_ALIGNMENT, 4)
            GLES30.glPixelStorei(GLES30.GL_PACK_ROW_LENGTH, 0)
            GLES30.glPixelStorei(GLES30.GL_PACK_SKIP_PIXELS, 0)
            GLES30.glPixelStorei(GLES30.GL_PACK_SKIP_ROWS, 0)
            var source = framebuffer
            if (samples > 0) {
                // GLES can't read a multisampled framebuffer: its samples are
                // resolved first, as present and reading do. A blit is clipped
                // by the scissor test, and skipped with rasterizer discard on,
                // so both are off for it.
                val scissor = GLES30.glIsEnabled(GLES30.GL_SCISSOR_TEST)
                val discard = GLES30.glIsEnabled(GLES30.GL_RASTERIZER_DISCARD)
                GLES30.glDisable(GLES30.GL_SCISSOR_TEST)
                GLES30.glDisable(GLES30.GL_RASTERIZER_DISCARD)
                GLES30.glBindFramebuffer(GLES30.GL_READ_FRAMEBUFFER, framebuffer)
                GLES30.glBindFramebuffer(GLES30.GL_DRAW_FRAMEBUFFER, resolveFramebuffer)
                GLES30.glBlitFramebuffer(0, 0, width, height, 0, 0, width, height, GLES30.GL_COLOR_BUFFER_BIT, GLES30.GL_NEAREST)
                if (scissor) GLES30.glEnable(GLES30.GL_SCISSOR_TEST)
                if (discard) GLES30.glEnable(GLES30.GL_RASTERIZER_DISCARD)
                source = resolveFramebuffer
            }
            GLES30.glBindFramebuffer(GLES30.GL_READ_FRAMEBUFFER, source)
            GLES30.glReadBuffer(GLES30.GL_COLOR_ATTACHMENT0)
            GLES30.glReadPixels(0, 0, width, height, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, pixels)
            GLES30.glBindBuffer(GLES30.GL_PIXEL_PACK_BUFFER, pack[0])
            GLES30.glPixelStorei(GLES30.GL_PACK_ALIGNMENT, pack[1])
            GLES30.glPixelStorei(GLES30.GL_PACK_ROW_LENGTH, pack[2])
            GLES30.glPixelStorei(GLES30.GL_PACK_SKIP_PIXELS, pack[3])
            GLES30.glPixelStorei(GLES30.GL_PACK_SKIP_ROWS, pack[4])
            restoreFramebuffers()
        }
        pixels.rewind()
        return DrawingBufferPixels(pixels, width, height, alpha)
    }

    /**
     * Shows the finished frame: copies the default framebuffer (resolving it
     * when it's multisampled) into the TextureView's surface, scaled to its
     * size, and swaps. Without a surface, the frame waits for one.
     */
    private fun present() {
        if (windowSurface == EGL14.EGL_NO_SURFACE) {
            framePending = true
            return
        }
        val size = IntArray(2)
        EGL14.eglQuerySurface(display, windowSurface, EGL14.EGL_WIDTH, size, 0)
        EGL14.eglQuerySurface(display, windowSurface, EGL14.EGL_HEIGHT, size, 1)
        if (size[0] < 1 || size[1] < 1) {
            framePending = true
            return
        }
        withCurrent {
            // A blit is clipped by the scissor test, and skipped with
            // rasterizer discard on, so both are off while the frame is copied.
            val scissor = GLES30.glIsEnabled(GLES30.GL_SCISSOR_TEST)
            val discard = GLES30.glIsEnabled(GLES30.GL_RASTERIZER_DISCARD)
            GLES30.glDisable(GLES30.GL_SCISSOR_TEST)
            GLES30.glDisable(GLES30.GL_RASTERIZER_DISCARD)
            var source = framebuffer
            if (samples > 0) {
                GLES30.glBindFramebuffer(GLES30.GL_READ_FRAMEBUFFER, framebuffer)
                GLES30.glBindFramebuffer(GLES30.GL_DRAW_FRAMEBUFFER, resolveFramebuffer)
                GLES30.glBlitFramebuffer(0, 0, width, height, 0, 0, width, height, GLES30.GL_COLOR_BUFFER_BIT, GLES30.GL_NEAREST)
                source = resolveFramebuffer
            }
            GLES30.glBindFramebuffer(GLES30.GL_READ_FRAMEBUFFER, source)
            GLES30.glReadBuffer(GLES30.GL_COLOR_ATTACHMENT0)
            GLES30.glBindFramebuffer(GLES30.GL_DRAW_FRAMEBUFFER, 0)
            val sameSize = size[0] == width && size[1] == height
            GLES30.glBlitFramebuffer(
                0, 0, width, height, 0, 0, size[0], size[1],
                GLES30.GL_COLOR_BUFFER_BIT, if (sameSize) GLES30.GL_NEAREST else GLES30.GL_LINEAR,
            )
            EGL14.eglSwapBuffers(display, windowSurface)
            framePending = false
            if (scissor) GLES30.glEnable(GLES30.GL_SCISSOR_TEST)
            if (discard) GLES30.glEnable(GLES30.GL_RASTERIZER_DISCARD)
            // WebGL clears the drawing buffer once it's been shown, unless the
            // app asked to keep it.
            if (!preserveDrawingBuffer) clearDrawingBuffer()
            restoreFramebuffers()
        }
    }

    // --- Objects -------------------------------------------------------------

    private fun nameOf(id: Int): Int = if (id in names.indices) names[id] else 0

    private fun setName(id: Int, name: Int) {
        if (id >= names.size) {
            var capacity = names.size
            while (capacity <= id) capacity *= 2
            names = names.copyOf(capacity)
        }
        names[id] = name
    }

    private fun takeName(id: Int): Int {
        val name = nameOf(id)
        if (id in names.indices) names[id] = 0
        return name
    }

    private fun genFramebuffer(): Int = IntArray(1).also { GLES30.glGenFramebuffers(1, it, 0) }[0]
    private fun genRenderbuffer(): Int = IntArray(1).also { GLES30.glGenRenderbuffers(1, it, 0) }[0]

    private fun defaultBound(target: Int): Boolean =
        (if (target == GLES30.GL_READ_FRAMEBUFFER) readFramebuffer else drawFramebuffer) == framebuffer

    /** WebGL's BACK, COLOR, DEPTH and STENCIL name the default framebuffer's buffers, here ordinary attachments. */
    private fun attachmentFor(attachment: Int, target: Int): Int {
        if (!defaultBound(target)) return attachment
        return when (attachment) {
            WEBGL_BACK, WEBGL_COLOR -> GLES30.GL_COLOR_ATTACHMENT0
            WEBGL_DEPTH -> GLES30.GL_DEPTH_ATTACHMENT
            WEBGL_STENCIL -> GLES30.GL_STENCIL_ATTACHMENT
            else -> attachment
        }
    }

    // --- Pixels --------------------------------------------------------------

    private class Pixels(val buffer: Buffer?, val offset: Int, val isImage: Boolean)

    /**
     * An upload's pixels (see #pixels in webgl2-context.ts): none, an offset
     * into the bound PIXEL_UNPACK_BUFFER, bytes, or a decoded image converted
     * to the format and type.
     */
    private fun pixels(reader: Reader, format: Int, type: Int): Pixels {
        return when (reader.peekType()) {
            ReadableType.Array -> Pixels(bytesFromWords(reader.array()), 0, false)
            ReadableType.Map -> {
                val source = reader.map()
                val image = DecodedImages.get(source.getDouble("image").toInt())
                    ?: return Pixels(null, 0, false)
                Pixels(
                    convertImage(image, format, type, source.bool("flipY"), source.bool("premultiply")),
                    0,
                    true,
                )
            }
            ReadableType.Int, ReadableType.Long, ReadableType.Number -> Pixels(null, reader.int(), false)
            else -> {
                reader.skip()
                Pixels(null, 0, false)
            }
        }
    }

    private fun ReadableMap.bool(key: String): Boolean =
        hasKey(key) && when (getType(key)) {
            ReadableType.Boolean -> getBoolean(key)
            in NUMBER_TYPES -> getDouble(key) != 0.0
            else -> false
        }

    /** A decoded image's RGBA bytes as the format and type an upload names, tightly packed, flipped and premultiplied as asked. */
    private fun convertImage(image: DecodedImage, format: Int, type: Int, flipY: Boolean, premultiply: Boolean): ByteBuffer {
        val components = when (format) {
            GLES30.GL_RGBA, GLES30.GL_RGBA_INTEGER -> 4
            GLES30.GL_RGB, GLES30.GL_RGB_INTEGER -> 3
            GLES30.GL_RG, GLES30.GL_RG_INTEGER, GLES30.GL_LUMINANCE_ALPHA -> 2
            else -> 1
        }
        val packed = type == GLES30.GL_UNSIGNED_SHORT_5_6_5 || type == GLES30.GL_UNSIGNED_SHORT_4_4_4_4 ||
            type == GLES30.GL_UNSIGNED_SHORT_5_5_5_1
        val componentSize = when (type) {
            GLES30.GL_FLOAT -> 4
            GLES30.GL_HALF_FLOAT -> 2
            else -> 1
        }
        val pixelSize = if (packed) 2 else components * componentSize
        val out = ByteBuffer.allocateDirect(image.width * image.height * pixelSize).order(ByteOrder.nativeOrder())
        val rgba = image.pixels
        val multiply = premultiply && !image.premultiplied
        val channels = FloatArray(4)
        for (y in 0 until image.height) {
            val row = (if (flipY) image.height - 1 - y else y) * image.width * 4
            for (x in 0 until image.width) {
                val p = row + x * 4
                var r = (rgba.get(p).toInt() and 0xff).toFloat()
                var g = (rgba.get(p + 1).toInt() and 0xff).toFloat()
                var b = (rgba.get(p + 2).toInt() and 0xff).toFloat()
                val a = (rgba.get(p + 3).toInt() and 0xff).toFloat()
                if (multiply) {
                    r = r * a / 255
                    g = g * a / 255
                    b = b * a / 255
                }
                when (format) {
                    GLES30.GL_LUMINANCE -> channels[0] = r
                    GLES30.GL_ALPHA -> channels[0] = a
                    GLES30.GL_LUMINANCE_ALPHA -> { channels[0] = r; channels[1] = a }
                    else -> { channels[0] = r; channels[1] = g; channels[2] = b; channels[3] = a }
                }
                if (packed) {
                    val value = when (type) {
                        GLES30.GL_UNSIGNED_SHORT_5_6_5 ->
                            ((r / 255 * 31 + 0.5f).toInt() shl 11) or ((g / 255 * 63 + 0.5f).toInt() shl 5) or
                                (b / 255 * 31 + 0.5f).toInt()
                        GLES30.GL_UNSIGNED_SHORT_4_4_4_4 ->
                            ((r / 255 * 15 + 0.5f).toInt() shl 12) or ((g / 255 * 15 + 0.5f).toInt() shl 8) or
                                ((b / 255 * 15 + 0.5f).toInt() shl 4) or (a / 255 * 15 + 0.5f).toInt()
                        else ->
                            ((r / 255 * 31 + 0.5f).toInt() shl 11) or ((g / 255 * 31 + 0.5f).toInt() shl 6) or
                                ((b / 255 * 31 + 0.5f).toInt() shl 1) or (if (a >= 128) 1 else 0)
                    }
                    out.putShort(value.toShort())
                    continue
                }
                for (c in 0 until components) {
                    when (type) {
                        GLES30.GL_FLOAT -> out.putFloat(channels[c] / 255)
                        GLES30.GL_HALF_FLOAT -> out.putShort(halfFromFloat(channels[c] / 255))
                        else -> out.put((channels[c] + 0.5f).toInt().toByte())
                    }
                }
            }
        }
        out.rewind()
        return out
    }

    private fun halfFromFloat(value: Float): Short {
        val bits = java.lang.Float.floatToIntBits(value)
        val sign = (bits ushr 16) and 0x8000
        val exponent = ((bits ushr 23) and 0xff) - 127 + 15
        val mantissa = bits and 0x7fffff
        return when {
            exponent <= 0 -> sign.toShort()
            exponent >= 31 -> (sign or 0x7c00).toShort()
            else -> (sign or (exponent shl 10) or (mantissa ushr 13)).toShort()
        }
    }

    /** Runs an upload of converted image bytes with tightly packed unpacking, whatever the app set. */
    private inline fun withTightUnpacking(tight: Boolean, upload: () -> Unit) {
        if (!tight) {
            upload()
            return
        }
        val names = intArrayOf(
            GLES30.GL_UNPACK_ALIGNMENT, GLES30.GL_UNPACK_ROW_LENGTH, GLES30.GL_UNPACK_IMAGE_HEIGHT,
            GLES30.GL_UNPACK_SKIP_PIXELS, GLES30.GL_UNPACK_SKIP_ROWS, GLES30.GL_UNPACK_SKIP_IMAGES,
        )
        val saved = IntArray(names.size)
        for (i in names.indices) GLES30.glGetIntegerv(names[i], saved, i)
        GLES30.glPixelStorei(GLES30.GL_UNPACK_ALIGNMENT, 1)
        for (i in 1 until names.size) GLES30.glPixelStorei(names[i], 0)
        upload()
        for (i in names.indices) GLES30.glPixelStorei(names[i], saved[i])
    }

    // --- Running a batch -----------------------------------------------------

    /** Reads a batch: the commands' arguments, in order. */
    private class Reader(val items: ReadableArray) {
        var index = 0
        val size = items.size()
        fun hasNext() = index < size
        fun peekType(): ReadableType = if (index < size) items.getType(index) else ReadableType.Null
        fun number(): Double {
            if (index >= size) return 0.0
            val i = index++
            return when (items.getType(i)) {
                ReadableType.Int, ReadableType.Long, ReadableType.Number -> items.getDouble(i)
                ReadableType.Boolean -> if (items.getBoolean(i)) 1.0 else 0.0
                else -> 0.0
            }
        }
        fun int(): Int = number().toLong().toInt()
        fun long(): Long = number().toLong()
        fun float(): Float = number().toFloat()
        fun bool(): Boolean = number() != 0.0
        fun string(): String {
            if (index >= size) return ""
            val i = index++
            return if (items.getType(i) == ReadableType.String) items.getString(i) else ""
        }
        fun array(): ReadableArray {
            if (index >= size) return JavaOnlyArray()
            val i = index++
            return if (items.getType(i) == ReadableType.Array) items.getArray(i) else JavaOnlyArray()
        }
        fun map(): ReadableMap {
            val i = index++
            return items.getMap(i)
        }
        fun skip() { index++ }
    }

    fun run(commands: ReadableArray): JavaOnlyArray {
        val results = JavaOnlyArray()
        if (destroyed) return results
        withCurrent {
            val reader = Reader(commands)
            while (reader.hasNext()) {
                val op = reader.int()
                if (op >= 200) {
                    pushResult(results, query(op, reader))
                } else {
                    command(op, reader)
                }
            }
        }
        return results
    }

    private fun pushResult(results: JavaOnlyArray, value: Any?) {
        when (value) {
            null -> results.pushNull()
            is Boolean -> results.pushBoolean(value)
            is Int -> results.pushInt(value)
            is Long -> results.pushDouble(value.toDouble())
            is Float -> results.pushDouble(value.toDouble())
            is Double -> results.pushDouble(value)
            is String -> results.pushString(value)
            is JavaOnlyArray -> results.pushArray(value)
            is JavaOnlyMap -> results.pushMap(value)
            else -> results.pushNull()
        }
    }

    private fun floats(values: ReadableArray): FloatArray = FloatArray(values.size()) { values.getDouble(it).toFloat() }
    private fun ints(values: ReadableArray): IntArray = IntArray(values.size()) { values.getDouble(it).toLong().toInt() }
    private fun padded(values: FloatArray) = if (values.size >= 4) values else values.copyOf(4)
    private fun padded(values: IntArray) = if (values.size >= 4) values else values.copyOf(4)

    private fun intArrayResult(values: IntArray, count: Int = values.size): JavaOnlyArray =
        JavaOnlyArray().apply { for (i in 0 until count) pushInt(values[i]) }

    private fun floatArrayResult(values: FloatArray, count: Int = values.size): JavaOnlyArray =
        JavaOnlyArray().apply { for (i in 0 until count) pushDouble(values[i].toDouble()) }

    private fun command(op: Int, r: Reader) {
        when (op) {
            WebGLOps.ACTIVE_TEXTURE -> GLES30.glActiveTexture(r.int())
            WebGLOps.ATTACH_SHADER -> {
                val program = nameOf(r.int())
                GLES30.glAttachShader(program, nameOf(r.int()))
            }
            WebGLOps.BIND_ATTRIB_LOCATION -> {
                val program = nameOf(r.int())
                val index = r.int()
                GLES30.glBindAttribLocation(program, index, r.string())
            }
            WebGLOps.BIND_BUFFER -> {
                val target = r.int()
                GLES30.glBindBuffer(target, nameOf(r.int()))
            }
            WebGLOps.BIND_BUFFER_BASE -> {
                val target = r.int()
                val index = r.int()
                GLES30.glBindBufferBase(target, index, nameOf(r.int()))
            }
            WebGLOps.BIND_BUFFER_RANGE -> {
                val target = r.int()
                val index = r.int()
                val buffer = nameOf(r.int())
                val offset = r.int()
                GLES30.glBindBufferRange(target, index, buffer, offset, r.int())
            }
            WebGLOps.BIND_FRAMEBUFFER -> {
                val target = r.int()
                val id = r.int()
                // null is the default framebuffer, which is one of ours.
                val name = if (id == 0) framebuffer else nameOf(id)
                if (target == GLES30.GL_FRAMEBUFFER || target == GLES30.GL_DRAW_FRAMEBUFFER) drawFramebuffer = name
                if (target == GLES30.GL_FRAMEBUFFER || target == GLES30.GL_READ_FRAMEBUFFER) readFramebuffer = name
                GLES30.glBindFramebuffer(target, name)
            }
            WebGLOps.BIND_RENDERBUFFER -> {
                val target = r.int()
                renderbuffer = nameOf(r.int())
                GLES30.glBindRenderbuffer(target, renderbuffer)
            }
            WebGLOps.BIND_SAMPLER -> {
                val unit = r.int()
                GLES30.glBindSampler(unit, nameOf(r.int()))
            }
            WebGLOps.BIND_TEXTURE -> {
                val target = r.int()
                GLES30.glBindTexture(target, nameOf(r.int()))
            }
            WebGLOps.BIND_TRANSFORM_FEEDBACK -> {
                val target = r.int()
                GLES30.glBindTransformFeedback(target, nameOf(r.int()))
            }
            WebGLOps.BIND_VERTEX_ARRAY -> GLES30.glBindVertexArray(nameOf(r.int()))
            WebGLOps.BEGIN_QUERY -> {
                val target = r.int()
                GLES30.glBeginQuery(target, nameOf(r.int()))
            }
            WebGLOps.BEGIN_TRANSFORM_FEEDBACK -> GLES30.glBeginTransformFeedback(r.int())
            WebGLOps.BLEND_COLOR -> GLES30.glBlendColor(r.float(), r.float(), r.float(), r.float())
            WebGLOps.BLEND_EQUATION -> GLES30.glBlendEquation(r.int())
            WebGLOps.BLEND_EQUATION_SEPARATE -> GLES30.glBlendEquationSeparate(r.int(), r.int())
            WebGLOps.BLEND_FUNC -> GLES30.glBlendFunc(r.int(), r.int())
            WebGLOps.BLEND_FUNC_SEPARATE -> GLES30.glBlendFuncSeparate(r.int(), r.int(), r.int(), r.int())
            WebGLOps.BLIT_FRAMEBUFFER -> GLES30.glBlitFramebuffer(
                r.int(), r.int(), r.int(), r.int(), r.int(), r.int(), r.int(), r.int(), r.int(), r.int(),
            )
            WebGLOps.BUFFER_DATA -> {
                val target = r.int()
                if (r.peekType() == ReadableType.Array) {
                    val bytes = bytesFromWords(r.array())
                    GLES30.glBufferData(target, bytes.remaining(), bytes, r.int())
                } else {
                    val size = r.int()
                    GLES30.glBufferData(target, size, null, r.int())
                }
            }
            WebGLOps.BUFFER_SUB_DATA -> {
                val target = r.int()
                val offset = r.int()
                val bytes = bytesFromWords(r.array())
                GLES30.glBufferSubData(target, offset, bytes.remaining(), bytes)
            }
            WebGLOps.CLEAR -> GLES30.glClear(r.int())
            WebGLOps.CLEAR_BUFFERFV -> {
                val buffer = r.int()
                val drawbuffer = r.int()
                GLES30.glClearBufferfv(buffer, drawbuffer, padded(floats(r.array())), 0)
            }
            WebGLOps.CLEAR_BUFFERIV -> {
                val buffer = r.int()
                val drawbuffer = r.int()
                GLES30.glClearBufferiv(buffer, drawbuffer, padded(ints(r.array())), 0)
            }
            WebGLOps.CLEAR_BUFFERUIV -> {
                val buffer = r.int()
                val drawbuffer = r.int()
                GLES30.glClearBufferuiv(buffer, drawbuffer, padded(ints(r.array())), 0)
            }
            WebGLOps.CLEAR_BUFFERFI -> GLES30.glClearBufferfi(r.int(), r.int(), r.float(), r.int())
            WebGLOps.CLEAR_COLOR -> GLES30.glClearColor(r.float(), r.float(), r.float(), r.float())
            WebGLOps.CLEAR_DEPTH -> GLES30.glClearDepthf(r.float())
            WebGLOps.CLEAR_STENCIL -> GLES30.glClearStencil(r.int())
            WebGLOps.COLOR_MASK -> GLES30.glColorMask(r.bool(), r.bool(), r.bool(), r.bool())
            WebGLOps.COMPILE_SHADER -> GLES30.glCompileShader(nameOf(r.int()))
            WebGLOps.COMPRESSED_TEX_IMAGE2D -> {
                val target = r.int(); val level = r.int(); val internalformat = r.int()
                val width = r.int(); val height = r.int(); val border = r.int()
                if (r.peekType() == ReadableType.Array) {
                    val bytes = bytesFromWords(r.array())
                    val size = r.int()
                    GLES30.glCompressedTexImage2D(target, level, internalformat, width, height, border, size, bytes)
                } else {
                    r.skip(); r.skip()
                    Log.w(TAG, "compressedTexImage2D from a PIXEL_UNPACK_BUFFER is not supported on Android")
                }
            }
            WebGLOps.COMPRESSED_TEX_IMAGE3D -> {
                val target = r.int(); val level = r.int(); val internalformat = r.int()
                val width = r.int(); val height = r.int(); val depth = r.int(); val border = r.int()
                if (r.peekType() == ReadableType.Array) {
                    val bytes = bytesFromWords(r.array())
                    val size = r.int()
                    GLES30.glCompressedTexImage3D(target, level, internalformat, width, height, depth, border, size, bytes)
                } else {
                    val offset = r.int()
                    val size = r.int()
                    GLES30.glCompressedTexImage3D(target, level, internalformat, width, height, depth, border, size, offset)
                }
            }
            WebGLOps.COMPRESSED_TEX_SUB_IMAGE2D -> {
                val target = r.int(); val level = r.int(); val x = r.int(); val y = r.int()
                val width = r.int(); val height = r.int(); val format = r.int()
                if (r.peekType() == ReadableType.Array) {
                    val bytes = bytesFromWords(r.array())
                    val size = r.int()
                    GLES30.glCompressedTexSubImage2D(target, level, x, y, width, height, format, size, bytes)
                } else {
                    r.skip(); r.skip()
                    Log.w(TAG, "compressedTexSubImage2D from a PIXEL_UNPACK_BUFFER is not supported on Android")
                }
            }
            WebGLOps.COMPRESSED_TEX_SUB_IMAGE3D -> {
                val target = r.int(); val level = r.int(); val x = r.int(); val y = r.int(); val z = r.int()
                val width = r.int(); val height = r.int(); val depth = r.int(); val format = r.int()
                if (r.peekType() == ReadableType.Array) {
                    val bytes = bytesFromWords(r.array())
                    val size = r.int()
                    GLES30.glCompressedTexSubImage3D(target, level, x, y, z, width, height, depth, format, size, bytes)
                } else {
                    val offset = r.int()
                    val size = r.int()
                    GLES30.glCompressedTexSubImage3D(target, level, x, y, z, width, height, depth, format, size, offset)
                }
            }
            WebGLOps.COPY_BUFFER_SUB_DATA -> GLES30.glCopyBufferSubData(r.int(), r.int(), r.int(), r.int(), r.int())
            WebGLOps.COPY_TEX_IMAGE2D -> reading {
                GLES30.glCopyTexImage2D(r.int(), r.int(), r.int(), r.int(), r.int(), r.int(), r.int(), r.int())
            }
            WebGLOps.COPY_TEX_SUB_IMAGE2D -> reading {
                GLES30.glCopyTexSubImage2D(r.int(), r.int(), r.int(), r.int(), r.int(), r.int(), r.int(), r.int())
            }
            WebGLOps.COPY_TEX_SUB_IMAGE3D -> reading {
                GLES30.glCopyTexSubImage3D(
                    r.int(), r.int(), r.int(), r.int(), r.int(), r.int(), r.int(), r.int(), r.int(),
                )
            }
            WebGLOps.CREATE_BUFFER -> setName(r.int(), IntArray(1).also { GLES30.glGenBuffers(1, it, 0) }[0])
            WebGLOps.CREATE_FRAMEBUFFER -> setName(r.int(), genFramebuffer())
            WebGLOps.CREATE_PROGRAM -> setName(r.int(), GLES30.glCreateProgram())
            WebGLOps.CREATE_QUERY -> setName(r.int(), IntArray(1).also { GLES30.glGenQueries(1, it, 0) }[0])
            WebGLOps.CREATE_RENDERBUFFER -> setName(r.int(), genRenderbuffer())
            WebGLOps.CREATE_SAMPLER -> setName(r.int(), IntArray(1).also { GLES30.glGenSamplers(1, it, 0) }[0])
            WebGLOps.CREATE_SHADER -> {
                val id = r.int()
                setName(id, GLES30.glCreateShader(r.int()))
            }
            WebGLOps.CREATE_TEXTURE -> setName(r.int(), IntArray(1).also { GLES30.glGenTextures(1, it, 0) }[0])
            WebGLOps.CREATE_TRANSFORM_FEEDBACK ->
                setName(r.int(), IntArray(1).also { GLES30.glGenTransformFeedbacks(1, it, 0) }[0])
            WebGLOps.CREATE_VERTEX_ARRAY -> setName(r.int(), IntArray(1).also { GLES30.glGenVertexArrays(1, it, 0) }[0])
            WebGLOps.CULL_FACE -> GLES30.glCullFace(r.int())
            WebGLOps.DELETE_BUFFER -> takeName(r.int()).let { if (it != 0) GLES30.glDeleteBuffers(1, intArrayOf(it), 0) }
            WebGLOps.DELETE_FRAMEBUFFER -> {
                val name = takeName(r.int())
                if (name != 0) {
                    // Deleting the bound framebuffer binds the default one, as in WebGL.
                    if (drawFramebuffer == name) drawFramebuffer = framebuffer
                    if (readFramebuffer == name) readFramebuffer = framebuffer
                    GLES30.glDeleteFramebuffers(1, intArrayOf(name), 0)
                    restoreFramebuffers()
                }
            }
            WebGLOps.DELETE_PROGRAM -> takeName(r.int()).let { if (it != 0) GLES30.glDeleteProgram(it) }
            WebGLOps.DELETE_QUERY -> takeName(r.int()).let { if (it != 0) GLES30.glDeleteQueries(1, intArrayOf(it), 0) }
            WebGLOps.DELETE_RENDERBUFFER -> {
                val name = takeName(r.int())
                if (name != 0) {
                    if (renderbuffer == name) renderbuffer = 0
                    GLES30.glDeleteRenderbuffers(1, intArrayOf(name), 0)
                }
            }
            WebGLOps.DELETE_SAMPLER -> takeName(r.int()).let { if (it != 0) GLES30.glDeleteSamplers(1, intArrayOf(it), 0) }
            WebGLOps.DELETE_SHADER -> takeName(r.int()).let { if (it != 0) GLES30.glDeleteShader(it) }
            WebGLOps.DELETE_SYNC -> syncs.remove(r.int())?.let { GLES30.glDeleteSync(it) }
            WebGLOps.DELETE_TEXTURE -> takeName(r.int()).let { if (it != 0) GLES30.glDeleteTextures(1, intArrayOf(it), 0) }
            WebGLOps.DELETE_TRANSFORM_FEEDBACK ->
                takeName(r.int()).let { if (it != 0) GLES30.glDeleteTransformFeedbacks(1, intArrayOf(it), 0) }
            WebGLOps.DELETE_VERTEX_ARRAY ->
                takeName(r.int()).let { if (it != 0) GLES30.glDeleteVertexArrays(1, intArrayOf(it), 0) }
            WebGLOps.DEPTH_FUNC -> GLES30.glDepthFunc(r.int())
            WebGLOps.DEPTH_MASK -> GLES30.glDepthMask(r.bool())
            WebGLOps.DEPTH_RANGE -> GLES30.glDepthRangef(r.float(), r.float())
            WebGLOps.DETACH_SHADER -> {
                val program = nameOf(r.int())
                GLES30.glDetachShader(program, nameOf(r.int()))
            }
            WebGLOps.DISABLE -> GLES30.glDisable(r.int())
            WebGLOps.DISABLE_VERTEX_ATTRIB_ARRAY -> GLES30.glDisableVertexAttribArray(r.int())
            WebGLOps.DRAW_ARRAYS -> GLES30.glDrawArrays(r.int(), r.int(), r.int())
            WebGLOps.DRAW_ARRAYS_INSTANCED -> GLES30.glDrawArraysInstanced(r.int(), r.int(), r.int(), r.int())
            WebGLOps.DRAW_BUFFERS -> {
                val buffers = ints(r.array())
                val defaultBound = defaultBound(GLES30.GL_DRAW_FRAMEBUFFER)
                for (i in buffers.indices) {
                    if (defaultBound && buffers[i] == WEBGL_BACK) buffers[i] = GLES30.GL_COLOR_ATTACHMENT0
                }
                GLES30.glDrawBuffers(buffers.size, buffers, 0)
            }
            WebGLOps.DRAW_ELEMENTS -> GLES30.glDrawElements(r.int(), r.int(), r.int(), r.int())
            WebGLOps.DRAW_ELEMENTS_INSTANCED -> GLES30.glDrawElementsInstanced(r.int(), r.int(), r.int(), r.int(), r.int())
            WebGLOps.DRAW_RANGE_ELEMENTS -> GLES30.glDrawRangeElements(r.int(), r.int(), r.int(), r.int(), r.int(), r.int())
            WebGLOps.ENABLE -> GLES30.glEnable(r.int())
            WebGLOps.ENABLE_VERTEX_ATTRIB_ARRAY -> GLES30.glEnableVertexAttribArray(r.int())
            WebGLOps.END_QUERY -> GLES30.glEndQuery(r.int())
            WebGLOps.END_TRANSFORM_FEEDBACK -> GLES30.glEndTransformFeedback()
            WebGLOps.FENCE_SYNC -> {
                val id = r.int()
                val condition = r.int()
                val sync = GLES30.glFenceSync(condition, r.int())
                if (sync != 0L) syncs[id] = sync
            }
            WebGLOps.FINISH -> GLES30.glFinish()
            WebGLOps.FLUSH -> GLES30.glFlush()
            WebGLOps.FRAMEBUFFER_RENDERBUFFER -> {
                val target = r.int(); val attachment = r.int(); val renderbufferTarget = r.int()
                GLES30.glFramebufferRenderbuffer(target, attachment, renderbufferTarget, nameOf(r.int()))
            }
            WebGLOps.FRAMEBUFFER_TEXTURE2D -> {
                val target = r.int(); val attachment = r.int(); val textarget = r.int()
                val texture = nameOf(r.int())
                GLES30.glFramebufferTexture2D(target, attachment, textarget, texture, r.int())
            }
            WebGLOps.FRAMEBUFFER_TEXTURE_LAYER -> {
                val target = r.int(); val attachment = r.int()
                val texture = nameOf(r.int())
                GLES30.glFramebufferTextureLayer(target, attachment, texture, r.int(), r.int())
            }
            WebGLOps.FRONT_FACE -> GLES30.glFrontFace(r.int())
            WebGLOps.GENERATE_MIPMAP -> GLES30.glGenerateMipmap(r.int())
            WebGLOps.HINT -> GLES30.glHint(r.int(), r.int())
            WebGLOps.INVALIDATE_FRAMEBUFFER, WebGLOps.INVALIDATE_SUB_FRAMEBUFFER -> {
                val target = r.int()
                val attachments = ints(r.array())
                for (i in attachments.indices) attachments[i] = attachmentFor(attachments[i], target)
                if (op == WebGLOps.INVALIDATE_FRAMEBUFFER) {
                    GLES30.glInvalidateFramebuffer(target, attachments.size, attachments, 0)
                } else {
                    GLES30.glInvalidateSubFramebuffer(target, attachments.size, attachments, 0, r.int(), r.int(), r.int(), r.int())
                }
            }
            WebGLOps.LINE_WIDTH -> GLES30.glLineWidth(r.float())
            WebGLOps.LINK_PROGRAM -> GLES30.glLinkProgram(nameOf(r.int()))
            WebGLOps.PAUSE_TRANSFORM_FEEDBACK -> GLES30.glPauseTransformFeedback()
            WebGLOps.PIXEL_STOREI -> GLES30.glPixelStorei(r.int(), r.int())
            WebGLOps.POLYGON_OFFSET -> GLES30.glPolygonOffset(r.float(), r.float())
            WebGLOps.READ_BUFFER -> {
                val source = r.int()
                GLES30.glReadBuffer(
                    if (defaultBound(GLES30.GL_READ_FRAMEBUFFER) && source == WEBGL_BACK) GLES30.GL_COLOR_ATTACHMENT0 else source,
                )
            }
            WebGLOps.READ_PIXELS_TO_BUFFER -> reading {
                GLES30.glReadPixels(r.int(), r.int(), r.int(), r.int(), r.int(), r.int(), r.int())
            }
            WebGLOps.RENDERBUFFER_STORAGE -> GLES30.glRenderbufferStorage(r.int(), r.int(), r.int(), r.int())
            WebGLOps.RENDERBUFFER_STORAGE_MULTISAMPLE ->
                GLES30.glRenderbufferStorageMultisample(r.int(), r.int(), r.int(), r.int(), r.int())
            WebGLOps.RESUME_TRANSFORM_FEEDBACK -> GLES30.glResumeTransformFeedback()
            WebGLOps.SAMPLE_COVERAGE -> GLES30.glSampleCoverage(r.float(), r.bool())
            WebGLOps.SAMPLER_PARAMETERF -> {
                val sampler = nameOf(r.int())
                GLES30.glSamplerParameterf(sampler, r.int(), r.float())
            }
            WebGLOps.SAMPLER_PARAMETERI -> {
                val sampler = nameOf(r.int())
                GLES30.glSamplerParameteri(sampler, r.int(), r.int())
            }
            WebGLOps.SCISSOR -> GLES30.glScissor(r.int(), r.int(), r.int(), r.int())
            WebGLOps.SHADER_SOURCE -> {
                val shader = nameOf(r.int())
                GLES30.glShaderSource(shader, r.string())
            }
            WebGLOps.STENCIL_FUNC -> GLES30.glStencilFunc(r.int(), r.int(), r.long().toInt())
            WebGLOps.STENCIL_FUNC_SEPARATE -> GLES30.glStencilFuncSeparate(r.int(), r.int(), r.int(), r.long().toInt())
            WebGLOps.STENCIL_MASK -> GLES30.glStencilMask(r.long().toInt())
            WebGLOps.STENCIL_MASK_SEPARATE -> GLES30.glStencilMaskSeparate(r.int(), r.long().toInt())
            WebGLOps.STENCIL_OP -> GLES30.glStencilOp(r.int(), r.int(), r.int())
            WebGLOps.STENCIL_OP_SEPARATE -> GLES30.glStencilOpSeparate(r.int(), r.int(), r.int(), r.int())
            WebGLOps.TEX_IMAGE2D -> {
                val target = r.int(); val level = r.int(); val internalformat = r.int()
                val width = r.int(); val height = r.int(); val border = r.int()
                val format = r.int(); val type = r.int()
                val pixels = pixels(r, format, type)
                withTightUnpacking(pixels.isImage) {
                    if (pixels.buffer == null && pixels.offset != 0) {
                        Log.w(TAG, "texImage2D from a PIXEL_UNPACK_BUFFER is not supported on Android")
                    } else {
                        GLES30.glTexImage2D(target, level, internalformat, width, height, border, format, type, pixels.buffer)
                    }
                }
            }
            WebGLOps.TEX_IMAGE3D -> {
                val target = r.int(); val level = r.int(); val internalformat = r.int()
                val width = r.int(); val height = r.int(); val depth = r.int(); val border = r.int()
                val format = r.int(); val type = r.int()
                val pixels = pixels(r, format, type)
                withTightUnpacking(pixels.isImage) {
                    if (pixels.buffer == null && pixels.offset != 0) {
                        GLES30.glTexImage3D(target, level, internalformat, width, height, depth, border, format, type, pixels.offset)
                    } else {
                        GLES30.glTexImage3D(target, level, internalformat, width, height, depth, border, format, type, pixels.buffer)
                    }
                }
            }
            WebGLOps.TEX_PARAMETERF -> GLES30.glTexParameterf(r.int(), r.int(), r.float())
            WebGLOps.TEX_PARAMETERI -> GLES30.glTexParameteri(r.int(), r.int(), r.int())
            WebGLOps.TEX_STORAGE2D -> GLES30.glTexStorage2D(r.int(), r.int(), r.int(), r.int(), r.int())
            WebGLOps.TEX_STORAGE3D -> GLES30.glTexStorage3D(r.int(), r.int(), r.int(), r.int(), r.int(), r.int())
            WebGLOps.TEX_SUB_IMAGE2D -> {
                val target = r.int(); val level = r.int(); val x = r.int(); val y = r.int()
                val width = r.int(); val height = r.int(); val format = r.int(); val type = r.int()
                val pixels = pixels(r, format, type)
                withTightUnpacking(pixels.isImage) {
                    if (pixels.buffer == null) {
                        Log.w(TAG, "texSubImage2D from a PIXEL_UNPACK_BUFFER is not supported on Android")
                    } else {
                        GLES30.glTexSubImage2D(target, level, x, y, width, height, format, type, pixels.buffer)
                    }
                }
            }
            WebGLOps.TEX_SUB_IMAGE3D -> {
                val target = r.int(); val level = r.int(); val x = r.int(); val y = r.int(); val z = r.int()
                val width = r.int(); val height = r.int(); val depth = r.int(); val format = r.int(); val type = r.int()
                val pixels = pixels(r, format, type)
                withTightUnpacking(pixels.isImage) {
                    if (pixels.buffer == null) {
                        GLES30.glTexSubImage3D(target, level, x, y, z, width, height, depth, format, type, pixels.offset)
                    } else {
                        GLES30.glTexSubImage3D(target, level, x, y, z, width, height, depth, format, type, pixels.buffer)
                    }
                }
            }
            WebGLOps.TRANSFORM_FEEDBACK_VARYINGS -> {
                val program = nameOf(r.int())
                val varyings = r.array()
                val names = Array(varyings.size()) { varyings.getString(it) }
                GLES30.glTransformFeedbackVaryings(program, names, r.int())
            }
            WebGLOps.UNIFORM1F -> GLES30.glUniform1f(r.int(), r.float())
            WebGLOps.UNIFORM2F -> GLES30.glUniform2f(r.int(), r.float(), r.float())
            WebGLOps.UNIFORM3F -> GLES30.glUniform3f(r.int(), r.float(), r.float(), r.float())
            WebGLOps.UNIFORM4F -> GLES30.glUniform4f(r.int(), r.float(), r.float(), r.float(), r.float())
            WebGLOps.UNIFORM1I -> GLES30.glUniform1i(r.int(), r.int())
            WebGLOps.UNIFORM2I -> GLES30.glUniform2i(r.int(), r.int(), r.int())
            WebGLOps.UNIFORM3I -> GLES30.glUniform3i(r.int(), r.int(), r.int(), r.int())
            WebGLOps.UNIFORM4I -> GLES30.glUniform4i(r.int(), r.int(), r.int(), r.int(), r.int())
            WebGLOps.UNIFORM1UI -> GLES30.glUniform1ui(r.int(), r.long().toInt())
            WebGLOps.UNIFORM2UI -> GLES30.glUniform2ui(r.int(), r.long().toInt(), r.long().toInt())
            WebGLOps.UNIFORM3UI -> GLES30.glUniform3ui(r.int(), r.long().toInt(), r.long().toInt(), r.long().toInt())
            WebGLOps.UNIFORM4UI ->
                GLES30.glUniform4ui(r.int(), r.long().toInt(), r.long().toInt(), r.long().toInt(), r.long().toInt())
            WebGLOps.UNIFORM1FV, WebGLOps.UNIFORM2FV, WebGLOps.UNIFORM3FV, WebGLOps.UNIFORM4FV -> {
                val location = r.int()
                val values = floats(r.array())
                val size = op - WebGLOps.UNIFORM1FV + 1
                val count = values.size / size
                if (count > 0) {
                    when (size) {
                        1 -> GLES30.glUniform1fv(location, count, values, 0)
                        2 -> GLES30.glUniform2fv(location, count, values, 0)
                        3 -> GLES30.glUniform3fv(location, count, values, 0)
                        else -> GLES30.glUniform4fv(location, count, values, 0)
                    }
                }
            }
            WebGLOps.UNIFORM1IV, WebGLOps.UNIFORM2IV, WebGLOps.UNIFORM3IV, WebGLOps.UNIFORM4IV -> {
                val location = r.int()
                val values = ints(r.array())
                val size = op - WebGLOps.UNIFORM1IV + 1
                val count = values.size / size
                if (count > 0) {
                    when (size) {
                        1 -> GLES30.glUniform1iv(location, count, values, 0)
                        2 -> GLES30.glUniform2iv(location, count, values, 0)
                        3 -> GLES30.glUniform3iv(location, count, values, 0)
                        else -> GLES30.glUniform4iv(location, count, values, 0)
                    }
                }
            }
            WebGLOps.UNIFORM1UIV, WebGLOps.UNIFORM2UIV, WebGLOps.UNIFORM3UIV, WebGLOps.UNIFORM4UIV -> {
                val location = r.int()
                val values = ints(r.array())
                val size = op - WebGLOps.UNIFORM1UIV + 1
                val count = values.size / size
                if (count > 0) {
                    when (size) {
                        1 -> GLES30.glUniform1uiv(location, count, values, 0)
                        2 -> GLES30.glUniform2uiv(location, count, values, 0)
                        3 -> GLES30.glUniform3uiv(location, count, values, 0)
                        else -> GLES30.glUniform4uiv(location, count, values, 0)
                    }
                }
            }
            WebGLOps.UNIFORM_MATRIX2FV, WebGLOps.UNIFORM_MATRIX3FV, WebGLOps.UNIFORM_MATRIX4FV,
            WebGLOps.UNIFORM_MATRIX2X3FV, WebGLOps.UNIFORM_MATRIX3X2FV, WebGLOps.UNIFORM_MATRIX2X4FV,
            WebGLOps.UNIFORM_MATRIX4X2FV, WebGLOps.UNIFORM_MATRIX3X4FV, WebGLOps.UNIFORM_MATRIX4X3FV -> {
                val location = r.int()
                val transpose = r.bool()
                val v = floats(r.array())
                val n = v.size
                when (op) {
                    WebGLOps.UNIFORM_MATRIX2FV -> if (n / 4 > 0) GLES30.glUniformMatrix2fv(location, n / 4, transpose, v, 0)
                    WebGLOps.UNIFORM_MATRIX3FV -> if (n / 9 > 0) GLES30.glUniformMatrix3fv(location, n / 9, transpose, v, 0)
                    WebGLOps.UNIFORM_MATRIX4FV -> if (n / 16 > 0) GLES30.glUniformMatrix4fv(location, n / 16, transpose, v, 0)
                    WebGLOps.UNIFORM_MATRIX2X3FV -> if (n / 6 > 0) GLES30.glUniformMatrix2x3fv(location, n / 6, transpose, v, 0)
                    WebGLOps.UNIFORM_MATRIX3X2FV -> if (n / 6 > 0) GLES30.glUniformMatrix3x2fv(location, n / 6, transpose, v, 0)
                    WebGLOps.UNIFORM_MATRIX2X4FV -> if (n / 8 > 0) GLES30.glUniformMatrix2x4fv(location, n / 8, transpose, v, 0)
                    WebGLOps.UNIFORM_MATRIX4X2FV -> if (n / 8 > 0) GLES30.glUniformMatrix4x2fv(location, n / 8, transpose, v, 0)
                    WebGLOps.UNIFORM_MATRIX3X4FV -> if (n / 12 > 0) GLES30.glUniformMatrix3x4fv(location, n / 12, transpose, v, 0)
                    else -> if (n / 12 > 0) GLES30.glUniformMatrix4x3fv(location, n / 12, transpose, v, 0)
                }
            }
            WebGLOps.UNIFORM_BLOCK_BINDING -> {
                val program = nameOf(r.int())
                GLES30.glUniformBlockBinding(program, r.int(), r.int())
            }
            WebGLOps.USE_PROGRAM -> GLES30.glUseProgram(nameOf(r.int()))
            WebGLOps.VALIDATE_PROGRAM -> GLES30.glValidateProgram(nameOf(r.int()))
            WebGLOps.VERTEX_ATTRIB4F -> GLES30.glVertexAttrib4f(r.int(), r.float(), r.float(), r.float(), r.float())
            WebGLOps.VERTEX_ATTRIB_I4I -> GLES30.glVertexAttribI4i(r.int(), r.int(), r.int(), r.int(), r.int())
            WebGLOps.VERTEX_ATTRIB_I4UI ->
                GLES30.glVertexAttribI4ui(r.int(), r.long().toInt(), r.long().toInt(), r.long().toInt(), r.long().toInt())
            WebGLOps.VERTEX_ATTRIB_DIVISOR -> GLES30.glVertexAttribDivisor(r.int(), r.int())
            WebGLOps.VERTEX_ATTRIB_IPOINTER -> GLES30.glVertexAttribIPointer(r.int(), r.int(), r.int(), r.int(), r.int())
            WebGLOps.VERTEX_ATTRIB_POINTER ->
                GLES30.glVertexAttribPointer(r.int(), r.int(), r.int(), r.bool(), r.int(), r.int())
            WebGLOps.VIEWPORT -> GLES30.glViewport(r.int(), r.int(), r.int(), r.int())
            WebGLOps.WAIT_SYNC -> {
                val sync = syncs[r.int()]
                val flags = r.int()
                r.skip() // WebGL's timeout is always TIMEOUT_IGNORED (-1).
                if (sync != null) GLES30.glWaitSync(sync, flags, GLES30.GL_TIMEOUT_IGNORED)
            }
            WebGLOps.RESIZE -> allocateDrawingBuffer(r.int(), r.int())
            WebGLOps.PRESENT -> present()
            else -> {
                Log.w(TAG, "Unknown command $op")
                // The rest of the batch can't be read without this one's arguments.
                r.index = r.size
            }
        }
    }

    private fun shaderLog(shader: Int): String = GLES30.glGetShaderInfoLog(shader) ?: ""
    private fun programLog(program: Int): String = GLES30.glGetProgramInfoLog(program) ?: ""

    /** The link status, log and reflection three.js reads after each link, in one answer. Built-ins are left out, as WebGL does. */
    private fun programInfo(program: Int): JavaOnlyMap {
        val status = IntArray(1)
        GLES30.glGetProgramiv(program, GLES30.GL_LINK_STATUS, status, 0)
        val linked = status[0] == GLES30.GL_TRUE
        val uniforms = JavaOnlyArray()
        val attributes = JavaOnlyArray()
        val counts = IntArray(2)
        if (linked) {
            val size = IntArray(1)
            val type = IntArray(1)
            GLES30.glGetProgramiv(program, GLES30.GL_ACTIVE_UNIFORMS, counts, 0)
            for (i in 0 until counts[0]) {
                val name = GLES30.glGetActiveUniform(program, i, size, 0, type, 0) ?: continue
                if (name.startsWith("gl_")) continue
                uniforms.pushArray(JavaOnlyArray.of(name, size[0], type[0], GLES30.glGetUniformLocation(program, name)))
            }
            GLES30.glGetProgramiv(program, GLES30.GL_ACTIVE_ATTRIBUTES, counts, 0)
            for (i in 0 until counts[0]) {
                val name = GLES30.glGetActiveAttrib(program, i, size, 0, type, 0) ?: continue
                if (name.startsWith("gl_")) continue
                attributes.pushArray(JavaOnlyArray.of(name, size[0], type[0], GLES30.glGetAttribLocation(program, name)))
            }
            GLES30.glGetProgramiv(program, GLES30.GL_ACTIVE_UNIFORM_BLOCKS, counts, 0)
            GLES30.glGetProgramiv(program, GLES30.GL_TRANSFORM_FEEDBACK_VARYINGS, counts, 1)
        } else {
            counts[0] = 0
        }
        return JavaOnlyMap().apply {
            putBoolean("linked", linked)
            putString("log", programLog(program))
            putArray("uniforms", uniforms)
            putArray("attributes", attributes)
            putInt("uniformBlocks", if (linked) counts[0] else 0)
            putInt("transformFeedbackVaryings", if (linked) counts[1] else 0)
        }
    }

    private fun parameter(pname: Int): Any? {
        return when (pname) {
            WEBGL_UNMASKED_VENDOR -> GLES30.glGetString(GLES30.GL_VENDOR)
            WEBGL_UNMASKED_RENDERER -> GLES30.glGetString(GLES30.GL_RENDERER)
            GLES30.GL_VENDOR, GLES30.GL_RENDERER, GLES30.GL_VERSION, GLES30.GL_SHADING_LANGUAGE_VERSION ->
                GLES30.glGetString(pname)
            GLES30.GL_ALIASED_LINE_WIDTH_RANGE, GLES30.GL_ALIASED_POINT_SIZE_RANGE, GLES30.GL_DEPTH_RANGE ->
                floatArrayResult(FloatArray(2).also { GLES30.glGetFloatv(pname, it, 0) })
            GLES30.GL_COLOR_CLEAR_VALUE, GLES30.GL_BLEND_COLOR ->
                floatArrayResult(FloatArray(4).also { GLES30.glGetFloatv(pname, it, 0) })
            GLES30.GL_MAX_VIEWPORT_DIMS -> intArrayResult(IntArray(2).also { GLES30.glGetIntegerv(pname, it, 0) })
            GLES30.GL_SCISSOR_BOX, GLES30.GL_VIEWPORT -> intArrayResult(IntArray(4).also { GLES30.glGetIntegerv(pname, it, 0) })
            GLES30.GL_COLOR_WRITEMASK -> {
                val values = BooleanArray(4).also { GLES30.glGetBooleanv(pname, it, 0) }
                JavaOnlyArray().apply { values.forEach { pushBoolean(it) } }
            }
            GLES30.GL_COMPRESSED_TEXTURE_FORMATS -> {
                val count = IntArray(1).also { GLES30.glGetIntegerv(GLES30.GL_NUM_COMPRESSED_TEXTURE_FORMATS, it, 0) }[0]
                intArrayResult(IntArray(maxOf(count, 1)).also { GLES30.glGetIntegerv(pname, it, 0) }, count)
            }
            GLES30.GL_DEPTH_CLEAR_VALUE, GLES30.GL_LINE_WIDTH, GLES30.GL_POLYGON_OFFSET_FACTOR,
            GLES30.GL_POLYGON_OFFSET_UNITS, GLES30.GL_SAMPLE_COVERAGE_VALUE, GLES30.GL_MAX_TEXTURE_LOD_BIAS,
            MAX_TEXTURE_MAX_ANISOTROPY -> FloatArray(1).also { GLES30.glGetFloatv(pname, it, 0) }[0]
            GLES30.GL_MAX_ELEMENT_INDEX, GLES30.GL_MAX_SERVER_WAIT_TIMEOUT, GLES30.GL_MAX_UNIFORM_BLOCK_SIZE,
            GLES30.GL_MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS, GLES30.GL_MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS ->
                LongArray(1).also { GLES30.glGetInteger64v(pname, it, 0) }[0]
            GLES30.GL_BLEND, GLES30.GL_CULL_FACE, GLES30.GL_DEPTH_TEST, GLES30.GL_DITHER, GLES30.GL_POLYGON_OFFSET_FILL,
            GLES30.GL_RASTERIZER_DISCARD, GLES30.GL_SAMPLE_ALPHA_TO_COVERAGE, GLES30.GL_SAMPLE_COVERAGE,
            GLES30.GL_SCISSOR_TEST, GLES30.GL_STENCIL_TEST -> GLES30.glIsEnabled(pname)
            GLES30.GL_DEPTH_WRITEMASK, GLES30.GL_SAMPLE_COVERAGE_INVERT, GLES30.GL_TRANSFORM_FEEDBACK_ACTIVE,
            GLES30.GL_TRANSFORM_FEEDBACK_PAUSED -> BooleanArray(1).also { GLES30.glGetBooleanv(pname, it, 0) }[0]
            GLES30.GL_STENCIL_VALUE_MASK, GLES30.GL_STENCIL_WRITEMASK, GLES30.GL_STENCIL_BACK_VALUE_MASK,
            GLES30.GL_STENCIL_BACK_WRITEMASK ->
                IntArray(1).also { GLES30.glGetIntegerv(pname, it, 0) }[0].toLong() and 0xffffffffL
            else -> IntArray(1).also { GLES30.glGetIntegerv(pname, it, 0) }[0]
        }
    }

    private fun uniformComponents(type: Int): Int = when (type) {
        GLES30.GL_FLOAT_VEC2, GLES30.GL_INT_VEC2, GLES30.GL_UNSIGNED_INT_VEC2, GLES30.GL_BOOL_VEC2 -> 2
        GLES30.GL_FLOAT_VEC3, GLES30.GL_INT_VEC3, GLES30.GL_UNSIGNED_INT_VEC3, GLES30.GL_BOOL_VEC3 -> 3
        GLES30.GL_FLOAT_VEC4, GLES30.GL_INT_VEC4, GLES30.GL_UNSIGNED_INT_VEC4, GLES30.GL_BOOL_VEC4,
        GLES30.GL_FLOAT_MAT2 -> 4
        GLES30.GL_FLOAT_MAT2x3, GLES30.GL_FLOAT_MAT3x2 -> 6
        GLES30.GL_FLOAT_MAT2x4, GLES30.GL_FLOAT_MAT4x2 -> 8
        GLES30.GL_FLOAT_MAT3 -> 9
        GLES30.GL_FLOAT_MAT3x4, GLES30.GL_FLOAT_MAT4x3 -> 12
        GLES30.GL_FLOAT_MAT4 -> 16
        else -> 1
    }

    private fun isFloatUniform(type: Int): Boolean = type in setOf(
        GLES30.GL_FLOAT, GLES30.GL_FLOAT_VEC2, GLES30.GL_FLOAT_VEC3, GLES30.GL_FLOAT_VEC4,
        GLES30.GL_FLOAT_MAT2, GLES30.GL_FLOAT_MAT3, GLES30.GL_FLOAT_MAT4, GLES30.GL_FLOAT_MAT2x3,
        GLES30.GL_FLOAT_MAT3x2, GLES30.GL_FLOAT_MAT2x4, GLES30.GL_FLOAT_MAT4x2, GLES30.GL_FLOAT_MAT3x4,
        GLES30.GL_FLOAT_MAT4x3,
    )

    private fun query(op: Int, r: Reader): Any? {
        return when (op) {
            WebGLOps.GET_PARAMETER -> parameter(r.int())
            WebGLOps.GET_ERROR -> GLES30.glGetError()
            WebGLOps.SHADER_INFO -> {
                val shader = nameOf(r.int())
                val status = IntArray(1).also { GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, it, 0) }
                JavaOnlyMap().apply {
                    putBoolean("compiled", status[0] == GLES30.GL_TRUE)
                    putString("log", shaderLog(shader))
                }
            }
            WebGLOps.PROGRAM_INFO -> programInfo(nameOf(r.int()))
            WebGLOps.GET_UNIFORM_LOCATION -> {
                val program = nameOf(r.int())
                GLES30.glGetUniformLocation(program, r.string())
            }
            WebGLOps.GET_ATTRIB_LOCATION -> {
                val program = nameOf(r.int())
                GLES30.glGetAttribLocation(program, r.string())
            }
            WebGLOps.CHECK_FRAMEBUFFER_STATUS -> GLES30.glCheckFramebufferStatus(r.int())
            WebGLOps.GET_BUFFER_PARAMETER -> {
                val target = r.int()
                val pname = r.int()
                if (pname == GLES30.GL_BUFFER_SIZE) {
                    LongArray(1).also { GLES30.glGetBufferParameteri64v(target, pname, it, 0) }[0]
                } else {
                    IntArray(1).also { GLES30.glGetBufferParameteriv(target, pname, it, 0) }[0]
                }
            }
            WebGLOps.GET_FRAMEBUFFER_ATTACHMENT_PARAMETER -> {
                val target = r.int()
                val attachment = attachmentFor(r.int(), target)
                IntArray(1).also { GLES30.glGetFramebufferAttachmentParameteriv(target, attachment, r.int(), it, 0) }[0]
            }
            WebGLOps.GET_RENDERBUFFER_PARAMETER -> {
                val target = r.int()
                IntArray(1).also { GLES30.glGetRenderbufferParameteriv(target, r.int(), it, 0) }[0]
            }
            WebGLOps.GET_TEX_PARAMETER -> {
                val target = r.int()
                val pname = r.int()
                if (pname == GLES30.GL_TEXTURE_MAX_LOD || pname == GLES30.GL_TEXTURE_MIN_LOD || pname == TEXTURE_MAX_ANISOTROPY) {
                    FloatArray(1).also { GLES30.glGetTexParameterfv(target, pname, it, 0) }[0]
                } else {
                    IntArray(1).also { GLES30.glGetTexParameteriv(target, pname, it, 0) }[0]
                }
            }
            WebGLOps.GET_SAMPLER_PARAMETER -> {
                val sampler = nameOf(r.int())
                val pname = r.int()
                if (pname == GLES30.GL_TEXTURE_MAX_LOD || pname == GLES30.GL_TEXTURE_MIN_LOD) {
                    FloatArray(1).also { GLES30.glGetSamplerParameterfv(sampler, pname, it, 0) }[0]
                } else {
                    IntArray(1).also { GLES30.glGetSamplerParameteriv(sampler, pname, it, 0) }[0]
                }
            }
            WebGLOps.GET_VERTEX_ATTRIB -> {
                val index = r.int()
                val pname = r.int()
                if (pname == GLES30.GL_CURRENT_VERTEX_ATTRIB) {
                    floatArrayResult(FloatArray(4).also { GLES30.glGetVertexAttribfv(index, pname, it, 0) })
                } else {
                    IntArray(1).also { GLES30.glGetVertexAttribiv(index, pname, it, 0) }[0]
                }
            }
            WebGLOps.GET_VERTEX_ATTRIB_OFFSET -> {
                // Android's GLES has no glGetVertexAttribPointerv.
                r.skip(); r.skip()
                0
            }
            WebGLOps.GET_INDEXED_PARAMETER -> {
                val target = r.int()
                val index = r.int()
                when (target) {
                    GLES30.GL_UNIFORM_BUFFER_START, GLES30.GL_UNIFORM_BUFFER_SIZE,
                    GLES30.GL_TRANSFORM_FEEDBACK_BUFFER_START, GLES30.GL_TRANSFORM_FEEDBACK_BUFFER_SIZE ->
                        LongArray(1).also { GLES30.glGetInteger64i_v(target, index, it, 0) }[0]
                    else -> IntArray(1).also { GLES30.glGetIntegeri_v(target, index, it, 0) }[0]
                }
            }
            WebGLOps.GET_INTERNALFORMAT_PARAMETER -> {
                val target = r.int(); val internalformat = r.int(); val pname = r.int()
                val count = IntArray(1).also {
                    GLES30.glGetInternalformativ(target, internalformat, GLES30.GL_NUM_SAMPLE_COUNTS, 1, it, 0)
                }[0]
                val values = IntArray(maxOf(count, 1))
                GLES30.glGetInternalformativ(target, internalformat, pname, count, values, 0)
                intArrayResult(values, count)
            }
            WebGLOps.GET_QUERY_PARAMETER -> {
                val query = nameOf(r.int())
                IntArray(1).also { GLES30.glGetQueryObjectuiv(query, r.int(), it, 0) }[0].toLong() and 0xffffffffL
            }
            WebGLOps.GET_SYNC_PARAMETER -> {
                val sync = syncs[r.int()]
                val pname = r.int()
                if (sync == null) null else IntArray(1).also { GLES30.glGetSynciv(sync, pname, 1, null, 0, it, 0) }[0]
            }
            WebGLOps.CLIENT_WAIT_SYNC -> {
                val sync = syncs[r.int()]
                val flags = r.int()
                val timeout = maxOf(0L, r.long())
                if (sync == null) GLES30.GL_WAIT_FAILED else GLES30.glClientWaitSync(sync, flags, timeout)
            }
            WebGLOps.GET_UNIFORM -> {
                val program = nameOf(r.int())
                val location = r.int()
                val type = r.int()
                val count = uniformComponents(type)
                if (isFloatUniform(type)) {
                    floatArrayResult(FloatArray(16).also { GLES30.glGetUniformfv(program, location, it, 0) }, count)
                } else if (type == GLES30.GL_UNSIGNED_INT || type == GLES30.GL_UNSIGNED_INT_VEC2 ||
                    type == GLES30.GL_UNSIGNED_INT_VEC3 || type == GLES30.GL_UNSIGNED_INT_VEC4
                ) {
                    val values = IntArray(4).also { GLES30.glGetUniformuiv(program, location, it, 0) }
                    JavaOnlyArray().apply { for (i in 0 until count) pushDouble((values[i].toLong() and 0xffffffffL).toDouble()) }
                } else {
                    intArrayResult(IntArray(4).also { GLES30.glGetUniformiv(program, location, it, 0) }, count)
                }
            }
            WebGLOps.GET_UNIFORM_BLOCK_INDEX -> {
                val program = nameOf(r.int())
                GLES30.glGetUniformBlockIndex(program, r.string()).toLong() and 0xffffffffL
            }
            WebGLOps.GET_ACTIVE_UNIFORM_BLOCK_NAME -> {
                val program = nameOf(r.int())
                GLES30.glGetActiveUniformBlockName(program, r.int())
            }
            WebGLOps.GET_ACTIVE_UNIFORM_BLOCK_PARAMETER -> {
                val program = nameOf(r.int())
                val index = r.int()
                val pname = r.int()
                if (pname == GLES30.GL_UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES) {
                    val count = IntArray(1).also {
                        GLES30.glGetActiveUniformBlockiv(program, index, GLES30.GL_UNIFORM_BLOCK_ACTIVE_UNIFORMS, it, 0)
                    }[0]
                    val values = IntArray(maxOf(count, 1))
                    GLES30.glGetActiveUniformBlockiv(program, index, pname, values, 0)
                    intArrayResult(values, count)
                } else {
                    IntArray(1).also { GLES30.glGetActiveUniformBlockiv(program, index, pname, it, 0) }[0]
                }
            }
            WebGLOps.GET_ACTIVE_UNIFORMS -> {
                val program = nameOf(r.int())
                val indices = ints(r.array())
                val pname = r.int()
                val values = IntArray(maxOf(indices.size, 1))
                GLES30.glGetActiveUniformsiv(program, indices.size, indices, 0, pname, values, 0)
                intArrayResult(values, indices.size)
            }
            WebGLOps.GET_UNIFORM_INDICES -> {
                val program = nameOf(r.int())
                val names = r.array()
                val array = Array(names.size()) { names.getString(it) }
                val indices = IntArray(maxOf(array.size, 1))
                GLES30.glGetUniformIndices(program, array, indices, 0)
                JavaOnlyArray().apply {
                    for (i in array.indices) pushDouble((indices[i].toLong() and 0xffffffffL).toDouble())
                }
            }
            WebGLOps.GET_FRAG_DATA_LOCATION -> {
                val program = nameOf(r.int())
                GLES30.glGetFragDataLocation(program, r.string())
            }
            WebGLOps.GET_TRANSFORM_FEEDBACK_VARYING -> {
                val program = nameOf(r.int())
                val index = r.int()
                val size = IntArray(1)
                val type = IntArray(1)
                val name = GLES30.glGetTransformFeedbackVarying(program, index, size, 0, type, 0) ?: ""
                JavaOnlyArray.of(name, size[0], type[0])
            }
            WebGLOps.READ_PIXELS -> {
                val x = r.int(); val y = r.int(); val width = r.int(); val height = r.int()
                val format = r.int(); val type = r.int()
                val length = maxOf(0, r.int())
                val buffer = ByteBuffer.allocateDirect((length + 3) / 4 * 4).order(ByteOrder.nativeOrder())
                reading { GLES30.glReadPixels(x, y, width, height, format, type, buffer) }
                wordsFromBytes(buffer, length)
            }
            WebGLOps.GET_BUFFER_SUB_DATA -> {
                val target = r.int()
                val offset = r.int()
                val length = r.int()
                if (length <= 0) {
                    wordsFromBytes(ByteBuffer.allocateDirect(0), 0)
                } else {
                    val mapped = GLES30.glMapBufferRange(target, offset, length, GLES30.GL_MAP_READ_BIT) as? ByteBuffer
                    if (mapped == null) {
                        null
                    } else {
                        val result = wordsFromBytes(mapped, length)
                        GLES30.glUnmapBuffer(target)
                        result
                    }
                }
            }
            WebGLOps.IS_ENABLED -> GLES30.glIsEnabled(r.int())
            WebGLOps.GET_SHADER_PRECISION_FORMAT -> {
                val shaderType = r.int()
                val precisionType = r.int()
                val range = IntArray(2)
                val precision = IntArray(1)
                GLES30.glGetShaderPrecisionFormat(shaderType, precisionType, range, 0, precision, 0)
                JavaOnlyArray.of(range[0], range[1], precision[0])
            }
            WebGLOps.GET_SUPPORTED_EXTENSIONS -> {
                val count = IntArray(1).also { GLES30.glGetIntegerv(GLES30.GL_NUM_EXTENSIONS, it, 0) }[0]
                JavaOnlyArray().apply {
                    for (i in 0 until count) GLES30.glGetStringi(GLES30.GL_EXTENSIONS, i)?.let { pushString(it) }
                }
            }
            WebGLOps.GET_PROGRAM_PARAMETER -> {
                val program = nameOf(r.int())
                IntArray(1).also { GLES30.glGetProgramiv(program, r.int(), it, 0) }[0]
            }
            else -> {
                Log.w(TAG, "Unknown query $op")
                r.index = r.size
                null
            }
        }
    }

    companion object {
        private const val TAG = "AngularLynxWebGL"
    }
}

private fun ReadableMap?.flag(key: String, default: Boolean): Boolean {
    if (this == null || !hasKey(key)) return default
    return when (getType(key)) {
        ReadableType.Boolean -> getBoolean(key)
        in NUMBER_TYPES -> getDouble(key) != 0.0
        else -> default
    }
}
