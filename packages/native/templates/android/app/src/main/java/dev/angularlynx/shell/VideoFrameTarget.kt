package dev.angularlynx.shell

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLContext
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Somewhere for a `<video>`'s player to draw while its view has no surface,
 * so a canvas can still read the video (issue #726).
 *
 * The player draws into its PlayerView's SurfaceView, which has a surface
 * only while it's laid out with a size: with `display: none` it has none,
 * and the player drops every frame rather than draw it, so there's nothing
 * to copy. A browser decodes a hidden video all the same, and code that only
 * reads one (three.js's VideoTexture, thumbnails, filters) often hides it.
 * So while the view has no surface, VideoUI gives the player this target's
 * surface instead: a SurfaceTexture the shell owns, which takes the
 * decoder's frames whatever their format, as a TextureView's does, and keeps
 * the latest one as a texture. A snapshot draws that texture into a
 * framebuffer the frame's size and reads its pixels back.
 *
 * Every target lives on one thread of its own, with one EGL context that's
 * always current there: SurfaceTexture must be latched on the thread whose
 * context made its texture, and a context of the canvases' (WebGLContext) is
 * made current on Lynx's engine thread, which this mustn't disturb. Nothing
 * on the thread waits on another, so the engine thread, which waits on it
 * for a snapshot, can't deadlock with it. The UI thread never waits on it: a
 * target is made there and handed back.
 */
class VideoFrameTarget private constructor(
    private val texture: Int,
    private val surfaceTexture: SurfaceTexture,
) {
    /** The surface the player draws into. */
    val surface = Surface(surfaceTexture)

    // Whether the latest frame is current: set on the target's thread, read
    // on the engine thread (`videoWidth` asks), and cleared by a reset on
    // the UI thread, under the lock so a latch can't set it back after.
    private val readiness = Any()
    @Volatile
    private var hasImage = false
    /**
     * Resets that haven't reached the target's thread yet: a count, so the
     * first of two can't clear the second's while a frame from between them
     * is latched.
     */
    private var resetsPending = 0
    /** The timestamp of the frame the last reset forgot, which a latch with nothing new keeps. */
    private var staleTimestamp = 0L
    private var released = false

    /**
     * Told on the target's thread each time a frame becomes current: the
     * first one, or the first after a reset. The player saying it drew a
     * frame doesn't mean one came (see VideoUI's frame check), so VideoUI
     * waits for this before the app hears of it.
     */
    @Volatile
    var onFrame: (() -> Unit)? = null

    private var framebuffer = 0
    private var colorTexture = 0
    private var framebufferWidth = 0
    private var framebufferHeight = 0

    init {
        surfaceTexture.setOnFrameAvailableListener({ latch() }, handler)
    }

    /**
     * Forgets the frame it has: the player is about to draw here after
     * drawing somewhere else, or a new source starts, and until its next
     * frame comes there's nothing current to copy.
     */
    fun reset() {
        // Not current from here on, though the thread may be busy: a latch
        // it runs before the post below takes a frame from before the reset.
        synchronized(readiness) {
            resetsPending++
            hasImage = false
        }
        handler.post {
            synchronized(readiness) {
                staleTimestamp = surfaceTexture.timestamp
                resetsPending--
            }
        }
    }

    /**
     * Whether a frame has come since the last reset, as far as the target's
     * thread has latched: for the UI thread, which mustn't wait for it.
     */
    fun frameIsCurrent(): Boolean = hasImage

    /**
     * Whether a frame has come since the last reset. A frame the player
     * rendered may not have been latched yet (the listener's post can come
     * after `bindfirstframe` reaches the app), so without one it latches
     * whatever's queued, waiting a moment for the thread.
     */
    fun hasFrame(): Boolean {
        if (hasImage) return true
        return onThread { latch(); hasImage } ?: false
    }

    /**
     * The latest frame, drawn at `width` by `height` (the size the frame is
     * shown at, stretched by its pixel aspect ratio), as RGBA rows top to
     * bottom, or null without one.
     */
    fun read(width: Int, height: Int): DecodedImage? = onThread { readNow(width, height) }

    /** Lets go of the texture and the surface, once the player has let go of it. */
    fun release() {
        handler.post {
            if (released) return@post
            released = true
            onFrame = null
            surfaceTexture.setOnFrameAvailableListener(null)
            surface.release()
            surfaceTexture.release()
            GLES20.glDeleteTextures(1, intArrayOf(texture), 0)
            if (framebuffer != 0) {
                GLES20.glDeleteFramebuffers(1, intArrayOf(framebuffer), 0)
                GLES20.glDeleteTextures(1, intArrayOf(colorTexture), 0)
            }
        }
    }

    /** Takes the newest queued frame as the texture, on the target's thread. */
    private fun latch() {
        if (released) return
        try {
            surfaceTexture.updateTexImage()
        } catch (_: RuntimeException) {
            // The SurfaceTexture was abandoned (its producer went away badly):
            // the last frame it latched, if any, is still the texture.
            return
        }
        // A latch with nothing queued keeps the frame it had: it's current
        // only if it came after the last reset. The player stamps each frame
        // with the time it's released to be shown, so two never share one.
        val timestamp = surfaceTexture.timestamp
        val arrived = synchronized(readiness) {
            val current = resetsPending == 0 && timestamp != 0L && timestamp != staleTimestamp
            (current && !hasImage).also { if (current) hasImage = true }
        }
        if (arrived) onFrame?.invoke()
    }

    private fun readNow(width: Int, height: Int): DecodedImage? {
        if (released || width <= 0 || height <= 0) return null
        latch()
        if (!hasImage) return null
        // Errors an earlier call left would read as this one's.
        for (i in 0 until 8) if (GLES20.glGetError() == GLES20.GL_NO_ERROR) break
        if (!sizeFramebuffer(width, height)) return null
        val matrix = FloatArray(16)
        // The texture's transform: the decoder's crop, and the rotation it
        // applies (a portrait recording), which a SurfaceView applies too.
        surfaceTexture.getTransformMatrix(matrix)
        val program = program()
        if (program == 0) return null
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, framebuffer)
        GLES20.glViewport(0, 0, width, height)
        GLES20.glUseProgram(program)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texture)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(program, "frame"), 0)
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(program, "transform"), 1, false, matrix, 0)
        val position = GLES20.glGetAttribLocation(program, "position")
        val coord = GLES20.glGetAttribLocation(program, "coord")
        quad.position(0)
        GLES20.glVertexAttribPointer(position, 2, GLES20.GL_FLOAT, false, 16, quad)
        quad.position(2)
        GLES20.glVertexAttribPointer(coord, 2, GLES20.GL_FLOAT, false, 16, quad)
        GLES20.glEnableVertexAttribArray(position)
        GLES20.glEnableVertexAttribArray(coord)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(position)
        GLES20.glDisableVertexAttribArray(coord)
        val pixels = try {
            ByteBuffer.allocateDirect(width * height * 4).order(ByteOrder.nativeOrder())
        } catch (_: OutOfMemoryError) {
            return null
        }
        // The quad puts the frame's top in the framebuffer's first row, which
        // glReadPixels returns first, so the rows come top to bottom.
        GLES20.glReadPixels(0, 0, width, height, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, pixels)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        if (GLES20.glGetError() != GLES20.GL_NO_ERROR) return null
        pixels.rewind()
        // A video frame is opaque, so premultiplied or not, its colors are the same.
        return DecodedImage(pixels, width, height, true)
    }

    /** Makes the framebuffer the snapshot's size, keeping it while that holds. */
    private fun sizeFramebuffer(width: Int, height: Int): Boolean {
        if (framebuffer != 0 && width == framebufferWidth && height == framebufferHeight) return true
        if (framebuffer == 0) {
            val names = IntArray(1)
            GLES20.glGenFramebuffers(1, names, 0)
            framebuffer = names[0]
            GLES20.glGenTextures(1, names, 0)
            colorTexture = names[0]
        }
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, colorTexture)
        GLES20.glTexImage2D(
            GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, width, height, 0,
            GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null,
        )
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, framebuffer)
        GLES20.glFramebufferTexture2D(
            GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, colorTexture, 0,
        )
        val complete = GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER) == GLES20.GL_FRAMEBUFFER_COMPLETE
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        // A size the device can't make (past its largest texture) is tried
        // again next time, rather than kept.
        framebufferWidth = if (complete) width else 0
        framebufferHeight = if (complete) height else 0
        return complete
    }

    companion object {
        /**
         * How long the engine thread waits for the target's thread. A latch
         * and a read take a few milliseconds; one that doesn't come in time
         * reads nothing, as PixelCopy's does in VideoUI.
         */
        private const val WAIT_MS = 250L

        private val handler: Handler by lazy {
            Handler(HandlerThread("AngularLynxVideoFrames").apply { start() }.looper)
        }

        /**
         * The thread's EGL context, made on it the first time a target is and
         * current there from then on, with the 1x1 pbuffer it needs.
         */
        private var context: EGLContext = EGL14.EGL_NO_CONTEXT
        private var programName = 0

        /**
         * A full-framebuffer strip: x, y, then the texture's u, v, with the
         * frame's top (v = 1 in a SurfaceTexture's coordinates) at y = -1,
         * the framebuffer's first row.
         */
        private val quad: FloatBuffer = ByteBuffer.allocateDirect(16 * 4).order(ByteOrder.nativeOrder())
            .asFloatBuffer().apply {
                put(floatArrayOf(-1f, -1f, 0f, 1f, 1f, -1f, 1f, 1f, -1f, 1f, 0f, 0f, 1f, 1f, 1f, 0f))
            }

        private const val VERTEX_SHADER = """
            attribute vec2 position;
            attribute vec2 coord;
            uniform mat4 transform;
            varying vec2 texCoord;
            void main() {
                gl_Position = vec4(position, 0.0, 1.0);
                texCoord = (transform * vec4(coord, 0.0, 1.0)).xy;
            }
        """

        // High precision, so a wide frame's texture coordinates land on their
        // own pixels: every GPU with OpenGL ES 3.0, which the shell's WebGL
        // needs already, has it in fragment shaders.
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision highp float;
            uniform samplerExternalOES frame;
            varying vec2 texCoord;
            void main() {
                gl_FragColor = texture2D(frame, texCoord);
            }
        """

        /**
         * Makes a new target on its thread and hands it to `made` there, or
         * null when the device has no OpenGL ES 2.0 to make one with (the
         * video then draws nothing while it's hidden, as before). The first
         * also starts EGL, which the UI thread shouldn't wait for.
         */
        fun create(made: (VideoFrameTarget?) -> Unit) {
            handler.post {
                made(
                    try {
                        makeTarget()
                    } catch (_: RuntimeException) {
                        null
                    },
                )
            }
        }

        private fun makeTarget(): VideoFrameTarget? {
            if (!makeContext()) return null
            val names = IntArray(1)
            GLES20.glGenTextures(1, names, 0)
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, names[0])
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            return VideoFrameTarget(names[0], SurfaceTexture(names[0]))
        }

        /** Runs `block` on the targets' thread and returns what it does, or null if it took too long. */
        private fun <T> onThread(block: () -> T?): T? {
            if (handler.looper.isCurrentThread) return block()
            val done = CountDownLatch(1)
            var result: T? = null
            handler.post {
                result = try {
                    block()
                } catch (_: RuntimeException) {
                    null
                }
                done.countDown()
            }
            return if (done.await(WAIT_MS, TimeUnit.MILLISECONDS)) result else null
        }

        /** Makes the thread's context current, the first time; false if EGL can't. */
        private fun makeContext(): Boolean {
            if (context != EGL14.EGL_NO_CONTEXT) return true
            val eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            val version = IntArray(2)
            if (!EGL14.eglInitialize(eglDisplay, version, 0, version, 1)) return false
            val configs = arrayOfNulls<android.opengl.EGLConfig>(1)
            val count = IntArray(1)
            val attributes = intArrayOf(
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
                EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
                EGL14.EGL_RED_SIZE, 8,
                EGL14.EGL_GREEN_SIZE, 8,
                EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_NONE,
            )
            if (!EGL14.eglChooseConfig(eglDisplay, attributes, 0, configs, 0, 1, count, 0) || count[0] == 0) return false
            val config = configs[0] ?: return false
            val eglContext = EGL14.eglCreateContext(
                eglDisplay, config, EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0,
            )
            if (eglContext == EGL14.EGL_NO_CONTEXT) return false
            // A context needs a surface to be current on; nothing draws to it.
            val surface = EGL14.eglCreatePbufferSurface(
                eglDisplay, config, intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0,
            )
            if (surface == EGL14.EGL_NO_SURFACE || !EGL14.eglMakeCurrent(eglDisplay, surface, surface, eglContext)) {
                if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(eglDisplay, surface)
                EGL14.eglDestroyContext(eglDisplay, eglContext)
                return false
            }
            context = eglContext
            return true
        }

        /** The program that draws a frame, compiled the first time; 0 if it can't be. */
        private fun program(): Int {
            if (programName != 0) return programName
            val vertex = shader(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER)
            val fragment = shader(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER)
            if (vertex == 0 || fragment == 0) return 0
            val program = GLES20.glCreateProgram()
            GLES20.glAttachShader(program, vertex)
            GLES20.glAttachShader(program, fragment)
            GLES20.glLinkProgram(program)
            GLES20.glDeleteShader(vertex)
            GLES20.glDeleteShader(fragment)
            val linked = IntArray(1)
            GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, linked, 0)
            if (linked[0] == 0) {
                GLES20.glDeleteProgram(program)
                return 0
            }
            programName = program
            return program
        }

        private fun shader(type: Int, source: String): Int {
            val shader = GLES20.glCreateShader(type)
            GLES20.glShaderSource(shader, source.trimIndent())
            GLES20.glCompileShader(shader)
            val compiled = IntArray(1)
            GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compiled, 0)
            if (compiled[0] == 0) {
                GLES20.glDeleteShader(shader)
                return 0
            }
            return shader
        }
    }
}
