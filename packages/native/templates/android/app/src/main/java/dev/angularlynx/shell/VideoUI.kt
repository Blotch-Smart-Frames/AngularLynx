package dev.angularlynx.shell

import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.view.PixelCopy
import android.view.SurfaceHolder
import android.view.SurfaceView
import androidx.media3.common.C
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
 * The surface is there only while the video is laid out with a size. While
 * it isn't (`display: none`), the player draws into a VideoFrameTarget
 * instead, a texture the shell owns, which the snapshot reads, so a hidden
 * video is drawn as a browser's is (issue #726). When the view has a surface
 * again, the player goes back to it. One that's only out of sight (behind
 * other elements, or `opacity: 0`) keeps its surface.
 *
 * The player saying it drew a frame into the target doesn't mean the target
 * has one (issue #805), so `bindfirstframe` waits for the target's frame,
 * and a frame that doesn't come is drawn again: see checkTargetFrame.
 */
class VideoUI(context: LynxContext) : LynxUIVideo(context), CanvasContext {
    private var videoId: String? = null

    /** A frame's size, published whole, so a reader never mixes two frames'. */
    private data class FrameSize(val width: Int, val height: Int)

    // The player's frame, as its listener tells it on the UI thread, read on
    // Lynx's engine thread.
    @Volatile
    private var frame = FrameSize(0, 0)

    /** The view's surface has a frame of the player's. */
    @Volatile
    private var hasFrame = false

    /**
     * Where the snapshot reads from when it isn't the view: the target the
     * player draws into while the view has no surface, and still after it
     * goes back to the view, until the view has a frame of its own.
     */
    @Volatile
    private var readTarget: VideoFrameTarget? = null

    // The UI thread's: the target, once made, whether one is being made,
    // whether the player draws into it now, and whether the element is gone.
    private var target: VideoFrameTarget? = null
    private var makingTarget = false
    private var drawingOffscreen = false
    private var destroyed = false

    /**
     * XElement's first-frame event (its duration), held back while the
     * player draws into the target and the target has no frame yet, so the
     * app never hears of a frame it can't read.
     */
    private var heldFirstFrame: Long? = null

    /** The source the held first-frame event is for. */
    private var heldSource: Uri? = null

    /** How many times the frame was drawn again since the player last went to the target. */
    private var redraws = 0

    /** Checks the target got the frame the player says it drew: see checkTargetFrame. */
    private val frameCheck = Runnable { checkTargetFrame() }

    private val mainHandler = Handler(Looper.getMainLooper())

    private val playerView: PlayerView?
        get() = view as? PlayerView

    private val surfaceView: SurfaceView?
        get() = playerView?.videoSurfaceView as? SurfaceView

    /**
     * Follows the view's surface beside the player's own callback.
     *
     * When the surface goes, the player is given the target only after
     * every callback has run. SurfaceView calls a copy of its callback list,
     * and once drawInView() has given the player the view again, the
     * player's callback comes after this one. Were the target given here,
     * setVideoSurface() would take the player's callback off the holder but
     * not out of that copy, and it would still run, see the holder's surface
     * as the player's output (setVideoSurface() doesn't clear media3's
     * `surfaceHolderSurfaceIsVideoOutput`) and set the output to null,
     * leaving a hidden video with nowhere to draw. Posted, the target comes
     * after the player has let go of the view's surface, which it does
     * before its callback returns, so the surface is never drawn into after
     * it's gone.
     */
    private val surfaceCallback = object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) = drawInView()

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}

        override fun surfaceDestroyed(holder: SurfaceHolder) {
            mainHandler.post {
                // Unless the view was shown again in the meantime.
                if (surfaceView?.holder?.surface?.isValid != true) drawOffscreen()
            }
        }
    }

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
            target?.reset()
            // A held first-frame event is the last source's: XElement sends
            // the new one's itself (its setSrc lets it send another). XElement's
            // `stop` and `play` rebuild the same item without that, so the
            // event is kept for the same source.
            if (mediaItem?.localConfiguration?.uri != heldSource) heldFirstFrame = null
        }

        override fun onRenderedFirstFrame() {
            // The player draws a first frame again after `stop` and `play`,
            // which clear and rebuild its item, but XElement sends
            // `onFirstFrame` only once: the frame is there again from here.
            // It also tells of the first frame on each new surface, so once
            // it's back in the view, the view is read again.
            if (drawingOffscreen) expectTargetFrame() else frameRendered()
        }
    }

    init {
        // Here rather than in createView(), which LynxBaseUI's constructor
        // calls before this class's properties are set. XElement's view gives
        // its PlayerView its player on the UI thread, in a post when this
        // isn't it, so the listener goes on after.
        mainHandler.post { attachPlayer() }
    }

    /** Listens to the player and the view's surface, on the UI thread. */
    private fun attachPlayer() {
        val player = playerView?.player ?: return
        player.addListener(listener)
        val holder = surfaceView?.holder ?: return
        holder.addCallback(surfaceCallback)
        // A video laid out with no size (`display: none`) never has a surface.
        if (!holder.surface.isValid) drawOffscreen()
    }

    /**
     * Has the player draw into the target while the view has no surface: it
     * drops every frame without one, and a hidden video has a frame to read
     * in a browser.
     */
    private fun drawOffscreen() {
        val player = playerView?.player ?: return
        if (drawingOffscreen || destroyed) return
        val offscreen = target
        if (offscreen == null) {
            makeTarget()
            return
        }
        // A frame from the last time it was drawn into isn't the one showing.
        offscreen.reset()
        hasFrame = false
        readTarget = offscreen
        drawingOffscreen = true
        redraws = 0
        // The player renders the next frame here even while paused (it does
        // for each new surface), and tells of it with onRenderedFirstFrame.
        player.setVideoSurface(offscreen.surface)
    }

    /**
     * Makes the target, off the UI thread, and draws into it once it's made
     * if the view still has no surface. A video that's shown checks before
     * its first layout too, so it may make one it won't draw into; it keeps
     * it for when it's hidden.
     */
    private fun makeTarget() {
        if (makingTarget) return
        makingTarget = true
        VideoFrameTarget.create { made ->
            mainHandler.post {
                makingTarget = false
                if (destroyed) {
                    made?.release()
                    return@post
                }
                target = made ?: return@post
                made.onFrame = { mainHandler.post { targetFrameCame(made) } }
                if (surfaceView?.holder?.surface?.isValid != true) drawOffscreen()
            }
        }
    }

    /**
     * Gives the player back the view's surface: setVideoSurface() stopped
     * the player following it, and setVideoSurfaceView() follows it again.
     * The target is still read until the view has a frame.
     */
    private fun drawInView() {
        if (!drawingOffscreen) return
        val player = playerView?.player ?: return
        drawingOffscreen = false
        // The view's first frame sends a held first-frame event now, in
        // frameRendered(): the target's no longer what the app reads.
        mainHandler.removeCallbacks(frameCheck)
        player.setVideoSurfaceView(surfaceView)
    }

    /** The player drew a frame on the view's surface, or XElement says it did. */
    private fun frameRendered() {
        if (drawingOffscreen) return
        hasFrame = true
        readTarget = null
        releaseFirstFrame()
    }

    /**
     * The player says it drew a frame into the target. It may not have come:
     * see checkTargetFrame, which runs unless it does.
     */
    private fun expectTargetFrame() {
        if (target?.frameIsCurrent() == true) {
            targetFrameCame(target)
            return
        }
        mainHandler.removeCallbacks(frameCheck)
        mainHandler.postDelayed(frameCheck, FRAME_WAIT_MS)
    }

    /** The target has a frame since the player last went to it. */
    private fun targetFrameCame(from: VideoFrameTarget?) {
        // The post can come after a reset (a new source, or the player going
        // back to the target) forgot the frame it was for: the check that's
        // pending then still runs.
        if (from == null || from !== target || !from.frameIsCurrent()) return
        mainHandler.removeCallbacks(frameCheck)
        redraws = 0
        releaseFirstFrame()
    }

    /**
     * The player said it drew a frame into the target a while ago, and the
     * target still has none. The frame was lost on its way: the decoder
     * started on a surface of media3's own (the target is made off the UI
     * thread, so it can come after), and a frame it decoded there before the
     * switch fails to queue on the target (`queueBuffer failed: -32` in
     * logcat), though media3 counts it as drawn. A paused player draws
     * nothing more, so the video would have no frame until it plays (issue
     * #805). Seeking to where it is draws the frame there again, decoded
     * after the switch, as a paused player does after any seek. ExoPlayer
     * ignores a seek to the position it's at, so it seeks a millisecond away
     * first and straight back: the second is a real seek, to the frame the
     * video shows. A seek makes XElement send `bindbuffering`, which only
     * this rare case pays for.
     * After a few tries, the app hears of the first frame anyway, as it did
     * before the target.
     */
    private fun checkTargetFrame() {
        val offscreen = target
        val player = playerView?.player
        if (destroyed || !drawingOffscreen || offscreen == null || offscreen.frameIsCurrent() ||
            player == null || player.playbackState == Player.STATE_IDLE || redraws >= MAX_REDRAWS
        ) {
            releaseFirstFrame()
            return
        }
        redraws++
        val position = player.currentPosition
        val duration = player.duration
        val away = if (duration != C.TIME_UNSET && position + 1 > duration) position - 1 else position + 1
        player.seekTo(away.coerceAtLeast(0))
        player.seekTo(position)
        // In case the seek draws nothing either, it's checked again.
        mainHandler.postDelayed(frameCheck, FRAME_WAIT_MS)
    }

    /** Sends the first-frame event held back for the target's frame, if there is one. */
    private fun releaseFirstFrame() {
        val durationMs = heldFirstFrame ?: return
        heldFirstFrame = null
        if (!destroyed) super.onFirstFrame(durationMs)
    }

    /**
     * The player drew its first frame: XElement's element sends
     * `bindfirstframe` from here, so the frame is there for a canvas before
     * the app hears of it. While the player draws into the target, that
     * waits for the target to have it.
     */
    override fun onFirstFrame(durationMs: Long) {
        if (drawingOffscreen && target?.frameIsCurrent() != true) {
            heldFirstFrame = durationMs
            heldSource = playerView?.player?.currentMediaItem?.localConfiguration?.uri
            expectTargetFrame()
            return
        }
        frameRendered()
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
     * The size of the frame showing now, in pixels, or 0 by 0 while there's
     * no frame to copy (before the first, or before the first on the
     * player's new surface): the runtime's `videoWidth` and `videoHeight`
     * (the module's `videoSize`), and the size the snapshot is copied at.
     */
    fun frameSize(): Pair<Int, Int> {
        val (width, height) = frame
        if (width <= 0 || height <= 0) return 0 to 0
        val offscreen = readTarget
        val readable = if (offscreen != null) {
            offscreen.hasFrame()
        } else {
            hasFrame && surfaceView?.holder?.surface?.isValid == true
        }
        return if (readable) width to height else 0 to 0
    }

    /** The frame showing now, as RGBA rows top to bottom, or null without one. */
    override fun snapshot(): DecodedImage? {
        val (width, height) = frameSize()
        if (width == 0) return null
        readTarget?.let { return it.read(width, height) }
        val surfaceView = surfaceView ?: return null
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
        val detach = Runnable {
            val player = playerView?.player
            player?.removeListener(listener)
            surfaceView?.holder?.removeCallback(surfaceCallback)
            mainHandler.removeCallbacks(frameCheck)
            heldFirstFrame = null
            readTarget = null
            target?.let { offscreen ->
                // The player lets go of the target's surface (and waits for
                // its decoder to) before the target lets go of the texture
                // behind it.
                if (drawingOffscreen) player?.clearVideoSurface(offscreen.surface)
                offscreen.release()
            }
            target = null
            drawingOffscreen = false
            destroyed = true
        }
        // Before XElement's destroy releases the player, which it does at
        // once on the UI thread.
        if (Looper.myLooper() == Looper.getMainLooper()) detach.run() else mainHandler.post(detach)
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

        /**
         * How long after the player says it drew a frame into the target the
         * target should have it. A frame reaches it in a few milliseconds;
         * this leaves room for an emulator drawing in software, and a frame
         * that comes later only costs a redraw.
         */
        private const val FRAME_WAIT_MS = 500L

        /** How many times a frame that didn't reach the target is drawn again. */
        private const val MAX_REDRAWS = 3

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
