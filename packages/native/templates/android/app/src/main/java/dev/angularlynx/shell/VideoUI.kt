package dev.angularlynx.shell

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.ui.PlayerView
import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxProp
import com.lynx.tasm.behavior.ui.LynxUI
import com.lynx.xelement.video.LynxUIVideo
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/**
 * The `video` element: XElement's, with frames the canvas contexts can read,
 * so a 2D canvas can draw a video (`drawImage()`, `createPattern()`) and a
 * WebGL canvas upload it (`texImage2D()`, three.js's VideoTexture), as a
 * browser's HTMLVideoElement can. See
 * packages/runtime/src/lib/canvas/video-element.ts.
 *
 * XElement's player (media3's ExoPlayer) draws its frames into its
 * PlayerView's SurfaceView, whose pixels the app can't read directly. So the
 * element registers itself in the canvas registry under its `video-id`,
 * which the runtime sets, as a canvas's context is registered, and its
 * snapshot copies the frame showing now out of the surface with PixelCopy.
 * The contexts then read a video as they read another canvas, by its id
 * (`{ canvas: id }`), so the pixels never travel through JavaScript.
 *
 * The surface is there while the video is laid out with a size: a video with
 * `display: none` has none, and draws nothing, as before its first frame. One
 * that's only out of sight (behind other elements, or `opacity: 0`) still
 * draws.
 */
class VideoUI(context: LynxContext) : LynxUIVideo(context), CanvasContext {
    private var videoId: String? = null

    // The player's frame, as its listener tells it on the UI thread, read on
    // Lynx's engine thread.
    @Volatile
    private var frameWidth = 0

    @Volatile
    private var frameHeight = 0

    @Volatile
    private var hasFrame = false

    private val mainHandler = Handler(Looper.getMainLooper())

    private val listener = object : Player.Listener {
        override fun onVideoSizeChanged(videoSize: VideoSize) {
            // The size the frame is shown at: its pixels stretched by their
            // aspect ratio, and turned as the player turns them.
            val ratio = if (videoSize.pixelWidthHeightRatio > 0f) videoSize.pixelWidthHeightRatio else 1f
            var width = (videoSize.width * ratio).roundToInt()
            var height = videoSize.height
            if (videoSize.unappliedRotationDegrees % 180 != 0) {
                width = height.also { height = width }
            }
            frameWidth = width
            frameHeight = height
        }

        override fun onRenderedFirstFrame() {
            hasFrame = true
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            // A new source has nothing to draw until its first frame, as in a
            // browser.
            hasFrame = false
        }
    }

    override fun createView(context: Context): View {
        val view = super.createView(context)
        // XElement's view gives its PlayerView its player on the UI thread,
        // in a post when this isn't it, so the listener goes on after.
        mainHandler.post { (view as? PlayerView)?.player?.addListener(listener) }
        return view
    }

    override val canvasId: String
        get() = videoId ?: ""

    /** A video shows itself in its own view: there's nothing to attach. */
    override fun attachView(canvas: CanvasUI?) {}

    override fun surfaceChanged() {}

    /**
     * The size of the frame showing now, in pixels, or 0 by 0 before the
     * first: the runtime's `videoWidth` and `videoHeight` (the module's
     * `videoSize`), and the size the snapshot is copied at.
     */
    fun frameSize(): Pair<Int, Int> {
        val width = frameWidth
        val height = frameHeight
        return if (hasFrame && width > 0 && height > 0) width to height else 0 to 0
    }

    /** The frame showing now, as RGBA rows top to bottom, or null without one. */
    override fun snapshot(): DecodedImage? {
        val (width, height) = frameSize()
        if (width == 0) return null
        val surfaceView = (view as? PlayerView)?.videoSurfaceView as? SurfaceView ?: return null
        if (!surfaceView.holder.surface.isValid) return null
        val bitmap = try {
            Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        } catch (_: OutOfMemoryError) {
            return null
        }
        // PixelCopy answers on a thread of the copy's own: the engine thread,
        // which waits for it here, can't take the answer, and the UI thread
        // may be waiting on the engine thread.
        val done = CountDownLatch(1)
        var result = PixelCopy.ERROR_UNKNOWN
        try {
            PixelCopy.request(surfaceView, bitmap, { copied ->
                result = copied
                done.countDown()
            }, copyHandler)
        } catch (_: IllegalArgumentException) {
            // The surface went between the check and the copy.
            bitmap.recycle()
            return null
        }
        if (!done.await(COPY_TIMEOUT_MS, TimeUnit.MILLISECONDS) || result != PixelCopy.SUCCESS) {
            bitmap.recycle()
            return null
        }
        val pixels = ByteBuffer.allocateDirect(width * height * 4).order(ByteOrder.nativeOrder())
        // ARGB_8888 is R, G, B, A in memory; a video frame is opaque, so
        // premultiplied or not, its colors are the same.
        bitmap.copyPixelsToBuffer(pixels)
        bitmap.recycle()
        pixels.rewind()
        return DecodedImage(pixels, width, height, true)
    }

    @LynxProp(name = "video-id")
    fun setVideoId(value: String?) {
        if (value == videoId) return
        videoId?.let { old -> if (CanvasRegistry.context(old) === this) CanvasRegistry.setContext(old, null) }
        videoId = value
        value?.let { CanvasRegistry.setContext(it, this) }
    }

    override fun destroy() {
        videoId?.let { id -> if (CanvasRegistry.context(id) === this) CanvasRegistry.setContext(id, null) }
        val player = (view as? PlayerView)?.player
        mainHandler.post { player?.removeListener(listener) }
        super.destroy()
    }

    companion object {
        /** How long a snapshot waits for its copy: a frame and a half at 60 Hz, then some. */
        private const val COPY_TIMEOUT_MS = 100L

        private val copyHandler: Handler by lazy {
            Handler(HandlerThread("AngularLynxVideoCopy").apply { start() }.looper)
        }

        /**
         * Replaces XElement's `video` behavior: MainActivity adds it after
         * XElement's, and the last behavior added for a tag wins.
         */
        fun behavior(): Behavior = object : Behavior("video") {
            override fun createUI(context: LynxContext): LynxUI<*> = VideoUI(context)
        }
    }
}
