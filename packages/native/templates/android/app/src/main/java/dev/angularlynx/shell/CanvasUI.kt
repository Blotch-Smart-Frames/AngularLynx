package dev.angularlynx.shell

import android.content.Context
import android.graphics.SurfaceTexture
import android.view.TextureView
import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxProp
import com.lynx.tasm.behavior.ui.LynxUI

/**
 * The `canvas` element: a TextureView its WebGL context (WebGLContext) copies
 * each finished frame into. Its `canvas-id` attribute, which the runtime
 * sets, pairs it with the context the runtime made for it.
 *
 * A TextureView composites with the views around it, so a canvas can sit
 * under or over other elements and take their rounded corners and opacity.
 */
class CanvasUI(context: LynxContext) : LynxUI<TextureView>(context) {
    private var canvasId: String? = null

    /** The view's surface, while it has one. */
    var surface: SurfaceTexture? = null
        private set

    override fun createView(context: Context): TextureView =
        TextureView(context).apply {
            isOpaque = false
            surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
                    surface = texture
                    contextOrNull()?.surfaceChanged()
                }

                override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {
                    contextOrNull()?.surfaceChanged()
                }

                override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
                    // The context lets go of its EGL surface first.
                    surface = null
                    contextOrNull()?.surfaceChanged()
                    return true
                }

                override fun onSurfaceTextureUpdated(texture: SurfaceTexture) {}
            }
        }

    private fun contextOrNull(): WebGLContext? = canvasId?.let { CanvasRegistry.context(it) }

    /** Whether the frames can be shown see-through, as the context's `alpha` asks. */
    fun setOpaque(opaque: Boolean) {
        view.isOpaque = opaque
    }

    @LynxProp(name = "canvas-id")
    fun setCanvasId(value: String?) {
        if (value == canvasId) return
        canvasId?.let { old -> if (CanvasRegistry.view(old) === this) CanvasRegistry.setView(old, null) }
        canvasId = value
        value?.let { CanvasRegistry.setView(it, this) }
    }

    override fun destroy() {
        canvasId?.let { id -> if (CanvasRegistry.view(id) === this) CanvasRegistry.setView(id, null) }
        super.destroy()
    }

    companion object {
        /** Registers the element under `canvas`, which Lynx's core doesn't have. */
        fun behavior(): Behavior = object : Behavior("canvas") {
            override fun createUI(context: LynxContext): LynxUI<*> = CanvasUI(context)
        }
    }
}
