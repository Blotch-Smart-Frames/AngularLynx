package dev.angularlynx.shell

import android.graphics.Bitmap
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.view.PixelCopy
import android.view.SurfaceView
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

    /** A frame's size, published whole, so a reader never mixes two frames'. */
    private data class FrameSize(val width: Int, val height: Int)

    // The player's frame, as its listener tells it on the UI thread, read on
    // Lynx's engine thread.
    @Volatile
    private var frame = FrameSize(0, 0)

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
            frame = FrameSize(width, height)
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            // A new source has nothing to draw until its first frame, as in a
            // browser.
            hasFrame = false
        }
    }

    init {
        // Here rather than in createView(), which LynxBaseUI's constructor
        // calls before this class's properties are set. XElement's view gives
        // its PlayerView its player on the UI thread, in a post when this
        // isn't it, so the listener goes on after.
        val playerView = view as? PlayerView
        mainHandler.post { playerView?.player?.addListener(listener) }
    }

    /**
     * The player drew its first frame: XElement's element sends
     * `bindfirstframe` from here, so the frame is there for a canvas before
     * the app hears of it.
     */
    override fun onFirstFrame(durationMs: Long) {
        hasFrame = true
        super.onFirstFrame(durationMs)
    }

    override val canvasId: String
        get() = videoId ?: ""

    /** A video shows itself in its own view: there's nothing to attach. */
    override fun attachView(canvas: CanvasUI?) {}

    override fun surfaceChanged() {}

    /** Only an OffscreenCanvas is transferred: a video has nothing to clear. */
    override fun clearForTransfer() {}

    /**
     * The size of the frame showing now, in pixels, or 0 by 0 before the
     * first: the runtime's `videoWidth` and `videoHeight` (the module's
     * `videoSize`), and the size the snapshot is copied at.
     */
    fun frameSize(): Pair<Int, Int> {
        val (width, height) = frame
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
        if (!done.await(COPY_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
            // The copy is still queued on the RenderThread, which writes into
            // the bitmap when it gets to it: recycling it now aborts the app
            // there ("cannot access an invalid/free'd bitmap"), as CI's
            // software-rendered emulator showed. It's left for the garbage
            // collector, once the copy has let go of it.
            return null
        }
        if (result != PixelCopy.SUCCESS) {
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
        /**
         * How long a snapshot waits for its copy. A copy takes a few
         * milliseconds on a phone, but waits behind whatever the RenderThread
         * is drawing, which takes far longer on an emulator drawing in
         * software. A copy that doesn't come in time draws nothing.
         */
        private const val COPY_TIMEOUT_MS = 250L

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
