package dev.angularlynx.shell

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.util.Log
import android.view.Surface

/**
 * Shows a bitmap in a canvas's view, for the contexts whose pixels are an
 * `android.graphics.Bitmap`: a 2D context's (Canvas2DContext) and a
 * bitmaprenderer's ImageBitmap (BitmapRendererContext). It copies the bitmap
 * into the TextureView's surface with `lockHardwareCanvas()`, scaled to its
 * size, as a canvas's bitmap is to its CSS size, and keeps the Surface it
 * made of the view's SurfaceTexture.
 *
 * It isn't locked: its context calls it under its own lock, which keeps
 * Lynx's engine thread, which draws, apart from the UI thread, where the
 * surface comes and goes.
 */
internal class BitmapPresenter(private val tag: String) {
    /** The view frames are shown in, or null. */
    var view: CanvasUI? = null
        private set
    private var surface: Surface? = null
    private var surfaceTexture: SurfaceTexture? = null

    /** Something was to be shown and wasn't yet, waiting for a surface. */
    private var framePending = false
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)

    /**
     * Shows frames in [canvas], see-through unless [opaque]. False when it's
     * the view they're shown in already.
     */
    fun attach(canvas: CanvasUI?, opaque: Boolean): Boolean {
        if (view === canvas) return false
        view = canvas
        canvas?.setOpaque(opaque)
        return true
    }

    /**
     * The view's surface came, went or changed size. True when a frame is
     * waiting to be shown: a new surface shows nothing until it's drawn to.
     */
    fun surfaceChanged(): Boolean {
        val texture = view?.surface
        if (texture !== surfaceTexture) {
            release()
            if (texture != null) {
                surface = Surface(texture)
                surfaceTexture = texture
                framePending = true
            }
        }
        return framePending
    }

    /**
     * Copies [bitmap] into the view's surface, scaled to its size, over
     * [background] (transparent, or black for a canvas without alpha that
     * shows no bitmap). It waits for a surface when there's none.
     */
    fun present(bitmap: Bitmap?, background: Int = Color.TRANSPARENT) {
        val target = surface
        if (target == null || !target.isValid) {
            framePending = true
            return
        }
        try {
            val c = target.lockHardwareCanvas()
            try {
                c.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
                if (background != Color.TRANSPARENT) c.drawColor(background)
                bitmap?.let { c.drawBitmap(it, null, Rect(0, 0, c.width, c.height), paint) }
            } finally {
                target.unlockCanvasAndPost(c)
            }
            framePending = false
        } catch (error: RuntimeException) {
            // The surface went as it was drawn to: it's drawn again when
            // the next one comes.
            Log.w(tag, "Could not show the canvas: ${error.message}")
            framePending = true
        }
    }

    /** Lets go of the surface it made. */
    fun release() {
        surface?.release()
        surface = null
        surfaceTexture = null
    }
}
