package dev.angularlynx.shell

import android.graphics.Bitmap
import android.graphics.BlendMode
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Region
import android.graphics.Shader
import android.graphics.SweepGradient
import android.graphics.Typeface
import android.graphics.BitmapShader
import android.graphics.SurfaceTexture
import android.os.Build
import android.util.Log
import android.view.Surface
import androidx.annotation.RequiresApi
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.ReadableArray
import com.lynx.react.bridge.ReadableMap
import com.lynx.react.bridge.ReadableType
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.WeakHashMap
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * `<canvas>`'s 2D context for the AngularLynx runtime: the bitmap the
 * runtime's CanvasRenderingContext2D (packages/runtime/src/lib/canvas/
 * canvas-2d-context.ts) draws on, with `android.graphics.Canvas`, which is
 * Skia, the engine Chrome's canvas draws with. The runtime sends its calls in
 * batches, as the WebGL context does, through WebGLModule's `run2D`.
 *
 * The runtime keeps the state its getters answer and builds paths itself, in
 * the canvas's pixels (arcs and rounded rectangles arrive as Bézier curves),
 * so this side draws what it's told: a path filled or stroked with the
 * current style, text, an image. Everything is drawn into one ARGB_8888
 * bitmap the canvas's `width` by `height`, which is copied into the canvas's
 * TextureView after each task that drew.
 *
 * What the canvas spec has that Android's canvas doesn't is made here:
 * compositing that clears what the shape doesn't cover (source-in and the
 * like) draws the shape in a layer the canvas's size first; shadows, whose
 * offset and blur are the canvas's pixels whatever the transform, are
 * undone through the transform where a shape is drawn under it; and a
 * filter draws the shape in a layer whose pixels it then works on
 * (CanvasFilter).
 *
 * Lynx calls `run` on its engine thread; the view's surface comes and goes
 * on the UI thread, which shows the bitmap again then. The context's lock
 * keeps the two apart.
 */
class Canvas2DContext(
    override val canvasId: String,
    attributes: ReadableMap?,
    /**
     * The gradients and patterns of every 2D context in the LynxView, by the
     * runtime's ids, so one context's can paint in another, as on the web.
     * The module holds it.
     */
    private val objects: MutableMap<Int, Any>,
) : CanvasContext {
    private val alpha = !(attributes != null && attributes.hasKey("alpha") &&
        attributes.getType("alpha") == ReadableType.Boolean && !attributes.getBoolean("alpha"))
    private var width = 0
    private var height = 0
    private var bitmap: Bitmap? = null
    private var canvas: Canvas? = null
    private var state = State()
    private val stack = ArrayList<State>()
    private var destroyed = false

    private var view: CanvasUI? = null
    private var surface: Surface? = null
    private var surfaceTexture: SurfaceTexture? = null
    /** The bitmap was drawn on and not shown yet, waiting for a surface. */
    private var framePending = false

    /** Decoded images as bitmaps, made the first time each is drawn. */
    private val decodedBitmaps = WeakHashMap<DecodedImage, Bitmap>()

    init {
        val w = attributes.int("width", 300)
        val h = attributes.int("height", 150)
        allocate(w, h)
    }

    // --- State ---------------------------------------------------------------

    /**
     * A fill or stroke style: a color, a gradient (which crosses whole with
     * the style), or a pattern's image by id, with its transform.
     */
    private class Style(
        val kind: Int,
        val color: Int,
        val objectId: Int,
        val gradient: Gradient? = null,
        val transform: Matrix? = null,
    ) {
        companion object {
            const val COLOR = 0
            const val GRADIENT = 1
            const val PATTERN = 2
            val BLACK = Style(COLOR, Color.BLACK, 0)
        }
    }

    /** What canvas `save()` keeps. The clip is the Android canvas's, saved with it. */
    private data class State(
        var transform: FloatArray = floatArrayOf(1f, 0f, 0f, 1f, 0f, 0f),
        var globalAlpha: Float = 1f,
        var composite: Int = 0,
        var fill: Style = Style.BLACK,
        var stroke: Style = Style.BLACK,
        var lineWidth: Float = 1f,
        var lineCap: Paint.Cap = Paint.Cap.BUTT,
        var lineJoin: Paint.Join = Paint.Join.MITER,
        var miterLimit: Float = 10f,
        var lineDash: FloatArray = FloatArray(0),
        var lineDashOffset: Float = 0f,
        var shadowBlur: Float = 0f,
        var shadowColor: Int = Color.TRANSPARENT,
        var shadowOffsetX: Float = 0f,
        var shadowOffsetY: Float = 0f,
        var typeface: Typeface = Typeface.DEFAULT,
        var fontSize: Float = 10f,
        var textAlign: Int = 0,
        var textBaseline: Int = 3,
        var rtl: Boolean = false,
        var letterSpacing: Float = 0f,
        var smoothing: Boolean = true,
        /** The filter, as its steps (see CanvasFilter), and how far they reach. */
        var filterSteps: DoubleArray = DoubleArray(0),
        var filterPadding: Int = 0,
    ) {
        fun copyState(): State = copy(transform = transform.copyOf(), lineDash = lineDash.copyOf())
    }

    private class Gradient(val type: Int, val p: FloatArray) {
        /** Offsets and colors, in order. */
        val offsets = ArrayList<Float>()
        val colors = ArrayList<Int>()

        fun addStop(offset: Float, color: Int) {
            // A stop goes after the stops at the same offset, as the spec
            // has it, so two at one offset make a hard edge.
            var index = offsets.size
            while (index > 0 && offsets[index - 1] > offset) index--
            offsets.add(index, offset)
            colors.add(index, color)
        }
    }

    private class Pattern(val bitmap: Bitmap, val repetition: Int)

    // --- The bitmap ----------------------------------------------------------

    /** A new bitmap, cleared, with the state reset, as a canvas has when it's resized or reset. */
    private fun allocate(w: Int, h: Int) {
        bitmap?.recycle()
        bitmap = null
        canvas = null
        width = max(0, w)
        height = max(0, h)
        state = State()
        stack.clear()
        if (width == 0 || height == 0) return
        val created = try {
            Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        } catch (_: OutOfMemoryError) {
            null
        } catch (_: IllegalArgumentException) {
            null
        } ?: run {
            // Too big to allocate: a canvas with no pixels, as a browser's
            // that can't hold its size.
            Log.w(TAG, "The canvas's ${width}x$height bitmap is too big to allocate")
            width = 0
            height = 0
            return
        }
        bitmap = created
        canvas = Canvas(created)
        // A canvas with alpha: false is opaque black until drawn on.
        if (!alpha) created.eraseColor(Color.BLACK)
    }

    @Synchronized
    fun destroy() {
        if (destroyed) return
        destroyed = true
        releaseSurface()
        bitmap?.recycle()
        bitmap = null
        canvas = null
    }

    // --- Showing the bitmap --------------------------------------------------

    @Synchronized
    override fun attachView(canvas: CanvasUI?) {
        if (view === canvas) return
        view = canvas
        canvas?.setOpaque(!alpha)
        surfaceChanged()
    }

    @Synchronized
    override fun surfaceChanged() {
        if (destroyed) return
        val texture = view?.surface
        if (texture !== surfaceTexture) {
            releaseSurface()
            if (texture != null) {
                surface = Surface(texture)
                surfaceTexture = texture
                // A new surface shows nothing until it's drawn to.
                framePending = true
            }
        }
        if (framePending) present()
    }

    private fun releaseSurface() {
        surface?.release()
        surface = null
        surfaceTexture = null
    }

    private val presentPaint = Paint(Paint.FILTER_BITMAP_FLAG)

    /** Copies the bitmap into the view's surface, scaled to its size. */
    private fun present() {
        val target = surface
        if (target == null || !target.isValid) {
            framePending = true
            return
        }
        try {
            val c = target.lockHardwareCanvas()
            try {
                c.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
                bitmap?.let { c.drawBitmap(it, null, Rect(0, 0, c.width, c.height), presentPaint) }
            } finally {
                target.unlockCanvasAndPost(c)
            }
            framePending = false
        } catch (error: RuntimeException) {
            // The surface went as it was drawn to: it's drawn again when
            // the next one comes.
            Log.w(TAG, "Could not show the canvas: ${error.message}")
            framePending = true
        }
    }

    @Synchronized
    override fun snapshot(): DecodedImage? {
        val source = bitmap ?: return null
        val pixels = ByteBuffer.allocateDirect(width * height * 4).order(ByteOrder.nativeOrder())
        // ARGB_8888 is R, G, B, A in memory, premultiplied.
        source.copyPixelsToBuffer(pixels)
        pixels.rewind()
        return DecodedImage(pixels, width, height, true)
    }

    /**
     * After transferToImageBitmap() took the bitmap: transparent black, or
     * opaque black without alpha. eraseColor ignores the clip, and the state
     * stays.
     */
    @Synchronized
    override fun clearForTransfer() {
        val target = bitmap ?: return
        target.eraseColor(if (alpha) Color.TRANSPARENT else Color.BLACK)
        if (view != null) present()
    }

    /** The bitmap as a PNG or JPEG file, or null when it has no pixels. */
    @Synchronized
    fun encode(jpeg: Boolean, quality: Double): ByteArray? {
        val source = bitmap ?: return null
        var image = source
        if (jpeg && alpha) {
            // A JPEG has no transparency: transparent pixels come out black,
            // as in browsers.
            image = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            image.eraseColor(Color.BLACK)
            Canvas(image).drawBitmap(source, 0f, 0f, null)
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
            if (image !== source) image.recycle()
        }
    }

    // --- Running a batch -----------------------------------------------------

    private class Reader(val items: ReadableArray) {
        var index = 0
        val size = items.size()
        fun hasNext() = index < size
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
        fun float(): Float = number().toFloat()
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
        fun map(): ReadableMap? {
            if (index >= size) return null
            val i = index++
            return if (items.getType(i) == ReadableType.Map) items.getMap(i) else null
        }
    }

    @Synchronized
    fun run(commands: ReadableArray): JavaOnlyArray {
        val results = JavaOnlyArray()
        if (destroyed) return results
        val reader = Reader(commands)
        while (reader.hasNext()) {
            val op = reader.int()
            if (op >= 200) {
                when (val result = query(op, reader)) {
                    is Boolean -> results.pushBoolean(result)
                    is JavaOnlyArray -> results.pushArray(result)
                    else -> results.pushNull()
                }
            } else {
                command(op, reader)
            }
        }
        return results
    }

    private fun color(r: Reader): Int {
        val red = r.int()
        val green = r.int()
        val blue = r.int()
        val a = (r.number() * 255).roundToInt().coerceIn(0, 255)
        return Color.argb(a, red.coerceIn(0, 255), green.coerceIn(0, 255), blue.coerceIn(0, 255))
    }

    private fun command(op: Int, r: Reader) {
        val s = state
        when (op) {
            Canvas2DOps.SAVE -> {
                stack.add(s.copyState())
                canvas?.save()
            }
            Canvas2DOps.RESTORE -> {
                if (stack.isEmpty()) return
                state = stack.removeAt(stack.size - 1)
                canvas?.restore()
            }
            Canvas2DOps.RESET -> allocate(width, height)
            Canvas2DOps.RESIZE -> {
                val w = r.int()
                val h = r.int()
                allocate(w, h)
            }
            Canvas2DOps.PRESENT -> present()
            Canvas2DOps.SET_TRANSFORM -> s.transform = FloatArray(6) { r.float() }
            Canvas2DOps.SET_GLOBAL_ALPHA -> s.globalAlpha = r.float()
            Canvas2DOps.SET_COMPOSITE_OPERATION -> s.composite = r.int().coerceIn(0, COMPOSITE_COUNT - 1)
            Canvas2DOps.SET_FILL_COLOR -> s.fill = Style(Style.COLOR, color(r), 0)
            Canvas2DOps.SET_FILL_GRADIENT -> s.fill = Style(Style.GRADIENT, 0, 0, gradientFrom(r))
            Canvas2DOps.SET_FILL_PATTERN -> s.fill = patternStyle(r)
            Canvas2DOps.SET_STROKE_COLOR -> s.stroke = Style(Style.COLOR, color(r), 0)
            Canvas2DOps.SET_STROKE_GRADIENT -> s.stroke = Style(Style.GRADIENT, 0, 0, gradientFrom(r))
            Canvas2DOps.SET_STROKE_PATTERN -> s.stroke = patternStyle(r)
            Canvas2DOps.SET_LINE_WIDTH -> s.lineWidth = r.float()
            Canvas2DOps.SET_LINE_CAP -> s.lineCap = when (r.int()) {
                1 -> Paint.Cap.ROUND
                2 -> Paint.Cap.SQUARE
                else -> Paint.Cap.BUTT
            }
            Canvas2DOps.SET_LINE_JOIN -> s.lineJoin = when (r.int()) {
                1 -> Paint.Join.ROUND
                2 -> Paint.Join.BEVEL
                else -> Paint.Join.MITER
            }
            Canvas2DOps.SET_MITER_LIMIT -> s.miterLimit = r.float()
            Canvas2DOps.SET_LINE_DASH -> {
                val dash = r.array()
                s.lineDash = FloatArray(dash.size()) { dash.getDouble(it).toFloat() }
                s.lineDashOffset = r.float()
            }
            Canvas2DOps.SET_SHADOW -> {
                s.shadowBlur = r.float()
                s.shadowColor = color(r)
                s.shadowOffsetX = r.float()
                s.shadowOffsetY = r.float()
            }
            Canvas2DOps.SET_FONT -> {
                val italic = r.int() != 0
                val weight = r.int()
                val size = r.float()
                val families = r.string()
                s.typeface = typefaceFor(families, weight, italic)
                s.fontSize = size
            }
            Canvas2DOps.SET_TEXT_ALIGN -> s.textAlign = r.int()
            Canvas2DOps.SET_TEXT_BASELINE -> s.textBaseline = r.int()
            Canvas2DOps.SET_DIRECTION -> s.rtl = r.int() == 1
            Canvas2DOps.SET_LETTER_SPACING -> s.letterSpacing = r.float()
            Canvas2DOps.SET_IMAGE_SMOOTHING -> {
                s.smoothing = r.int() != 0
                r.int()
            }
            Canvas2DOps.SET_FILTER -> {
                s.filterPadding = max(0, r.int())
                val steps = r.array()
                s.filterSteps = DoubleArray(steps.size()) { steps.getDouble(it) }
            }
            Canvas2DOps.CREATE_PATTERN -> {
                val id = r.int()
                val source = r.map()
                val repetition = r.int()
                // A pattern is of the image as it is now: a copy, which a
                // canvas drawing on doesn't change.
                val image = source?.let { bitmapFrom(it) } ?: return
                objects[id] = Pattern(image.copy(Bitmap.Config.ARGB_8888, false), repetition)
            }
            Canvas2DOps.RELEASE_OBJECT -> objects.remove(r.int())
            Canvas2DOps.CLEAR_PATH -> clearPath(pathFrom(r.array()))
            Canvas2DOps.FILL -> {
                val path = pathFrom(r.array())
                path.fillType = if (r.int() == 1) Path.FillType.EVEN_ODD else Path.FillType.WINDING
                fillDevicePath(path, s.fill)
            }
            Canvas2DOps.STROKE -> strokeDevicePath(pathFrom(r.array()))
            Canvas2DOps.CLIP -> {
                val path = pathFrom(r.array())
                path.fillType = if (r.int() == 1) Path.FillType.EVEN_ODD else Path.FillType.WINDING
                val c = canvas ?: return
                // An empty path clips everything away.
                if (path.isEmpty) c.clipRect(0, 0, 0, 0) else c.clipPath(path)
            }
            Canvas2DOps.FILL_TEXT, Canvas2DOps.STROKE_TEXT -> {
                val text = r.string()
                val x = r.float()
                val y = r.float()
                val maxWidth = r.float()
                drawText(text, x, y, maxWidth, op == Canvas2DOps.STROKE_TEXT)
            }
            Canvas2DOps.DRAW_IMAGE -> {
                val source = r.map()
                val src = RectF(r.float(), r.float(), 0f, 0f).also { it.right = it.left + r.float(); it.bottom = it.top + r.float() }
                val dst = RectF(r.float(), r.float(), 0f, 0f).also { it.right = it.left + r.float(); it.bottom = it.top + r.float() }
                val image = source?.let { bitmapFrom(it) } ?: return
                drawImage(image, src, dst)
            }
            Canvas2DOps.PUT_IMAGE_DATA -> {
                val bytes = bytesFromWords(r.array())
                val w = r.int()
                val h = r.int()
                val x = r.int()
                val y = r.int()
                putPixels(bytes, w, h, x, y)
            }
            // An unknown command can't be skipped past: the rest of the
            // batch would be read as the wrong arguments.
            else -> r.index = r.size
        }
    }

    /** A gradient as the runtime sends it: its type, six numbers, and its stops. */
    private fun gradientFrom(r: Reader): Gradient {
        val type = r.int()
        val gradient = Gradient(type, FloatArray(6) { r.float() })
        val stops = r.array()
        var i = 0
        while (i + 4 < stops.size()) {
            val color = Color.argb(
                (stops.getDouble(i + 4) * 255).roundToInt().coerceIn(0, 255),
                stops.getDouble(i + 1).toInt().coerceIn(0, 255),
                stops.getDouble(i + 2).toInt().coerceIn(0, 255),
                stops.getDouble(i + 3).toInt().coerceIn(0, 255),
            )
            gradient.addStop(stops.getDouble(i).toFloat(), color)
            i += 5
        }
        return gradient
    }

    /** A pattern's image, by id, with its transform. */
    private fun patternStyle(r: Reader): Style {
        val id = r.int()
        val transform = matrixOf(FloatArray(6) { r.float() })
        return Style(Style.PATTERN, 0, id, transform = transform)
    }

    private fun query(op: Int, r: Reader): Any? = when (op) {
        Canvas2DOps.MEASURE_TEXT -> measureText(r.string())
        Canvas2DOps.GET_IMAGE_DATA -> {
            val x = r.int()
            val y = r.int()
            val w = r.int()
            val h = r.int()
            pixelsAt(x, y, w, h)
        }
        Canvas2DOps.IS_POINT_IN_PATH -> {
            val path = pathFrom(r.array())
            path.fillType = if (r.int() == 1) Path.FillType.EVEN_ODD else Path.FillType.WINDING
            contains(path, r.float(), r.float())
        }
        Canvas2DOps.IS_POINT_IN_STROKE -> {
            val outline = strokeOutline(pathFrom(r.array()))
            val x = r.float()
            val y = r.float()
            outline != null && contains(outline, x, y)
        }
        else -> {
            r.index = r.size
            null
        }
    }

    // --- Paths ---------------------------------------------------------------

    /** A path from the runtime's segments (Canvas2DPathOps), in the canvas's pixels. */
    private fun pathFrom(segments: ReadableArray): Path {
        val path = Path()
        val count = segments.size()
        var i = 0
        fun next(): Float = if (i < count) segments.getDouble(i++).toFloat() else 0f
        var empty = true
        while (i < count) {
            when (segments.getDouble(i++).toInt()) {
                Canvas2DPathOps.MOVE_TO -> {
                    path.moveTo(next(), next())
                    empty = false
                }
                Canvas2DPathOps.LINE_TO -> {
                    val x = next()
                    val y = next()
                    if (empty) path.moveTo(x, y) else path.lineTo(x, y)
                    empty = false
                }
                Canvas2DPathOps.QUAD_TO -> {
                    val cx = next(); val cy = next(); val x = next(); val y = next()
                    if (empty) path.moveTo(cx, cy)
                    path.quadTo(cx, cy, x, y)
                    empty = false
                }
                Canvas2DPathOps.CUBIC_TO -> {
                    val ax = next(); val ay = next(); val bx = next(); val by = next(); val x = next(); val y = next()
                    if (empty) path.moveTo(ax, ay)
                    path.cubicTo(ax, ay, bx, by, x, y)
                    empty = false
                }
                Canvas2DPathOps.CLOSE -> if (!empty) path.close()
                else -> i = count
            }
        }
        return path
    }

    private fun matrixOf(m: FloatArray): Matrix = Matrix().apply {
        setValues(floatArrayOf(m[0], m[2], m[4], m[1], m[3], m[5], 0f, 0f, 1f))
    }

    private fun transformMatrix(): Matrix = matrixOf(state.transform)

    private fun invertible(m: FloatArray): Boolean {
        val det = m[0] * m[3] - m[1] * m[2]
        return det != 0f && det.isFinite()
    }

    /**
     * Whether the point is in the path, to a 64th of a pixel: Region works in
     * whole pixels, so the path is moved to put the point at the origin and
     * scaled up before it's tested. A point on the edge counts as in.
     */
    private fun contains(path: Path, x: Float, y: Float): Boolean {
        val bounds = RectF()
        @Suppress("DEPRECATION")
        path.computeBounds(bounds, true)
        if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return false
        val scaled = Path(path)
        scaled.transform(Matrix().apply {
            setTranslate(-x, -y)
            postScale(POINT_SCALE, POINT_SCALE)
        })
        val region = Region()
        region.setPath(scaled, Region(-2, -2, 2, 2))
        // The four pixels round the origin: one that covers the point.
        return region.contains(0, 0) || region.contains(-1, 0) || region.contains(0, -1) || region.contains(-1, -1)
    }

    // --- Compositing ---------------------------------------------------------

    private fun shadowVisible(): Boolean {
        val s = state
        return Color.alpha(s.shadowColor) > 0 && (s.shadowBlur > 0 || s.shadowOffsetX != 0f || s.shadowOffsetY != 0f)
    }

    private fun setBlend(paint: Paint, composite: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            paint.blendMode = BlendModes.ALL[composite]
        } else {
            PORTER_DUFF_MODES[composite]?.let { paint.xfermode = PorterDuffXfermode(it) }
        }
    }

    /**
     * Draws with the state's alpha, compositing and shadow, under `matrix`
     * (the transform, for what's drawn in its space) or none (a path in the
     * canvas's pixels).
     *
     * Android draws an operation like source-in only where the shape covers;
     * the canvas spec composites the whole canvas. So for those the shape is
     * drawn into a layer, which is composited with the operation.
     */
    private fun composite(paint: Paint, matrix: Matrix?, draw: (Canvas) -> Unit) {
        val c = canvas ?: return
        val s = state
        if (s.filterSteps.isNotEmpty()) {
            compositeFiltered(c, matrix, draw)
            return
        }
        if (shadowVisible()) applyShadow(paint, matrix)
        val unbounded = s.composite in UNBOUNDED
        if (unbounded) {
            val layer = Paint()
            setBlend(layer, s.composite)
            layer.alpha = (s.globalAlpha * 255).roundToInt()
            c.saveLayer(null, layer)
        } else {
            setBlend(paint, s.composite)
            paint.alpha = (paint.alpha * s.globalAlpha).roundToInt()
        }
        c.save()
        if (matrix != null) c.concat(matrix)
        draw(c)
        c.restore()
        if (unbounded) c.restore()
        if (!alpha && s.composite in REDUCES_ALPHA) keepOpaque()
    }

    /**
     * Draws with a filter, which works on pixels: the shape is drawn into a
     * layer, bigger than the canvas by how far the filter reaches (so a shape
     * just off the canvas blurs, or casts its shadow, onto it), and the
     * filter is applied to the layer's pixels (CanvasFilter). The layer is
     * then drawn over the canvas with the alpha, the operation and the
     * shadow, inside the clip: the canvas spec filters what's drawn before
     * all of those.
     */
    private fun compositeFiltered(c: Canvas, matrix: Matrix?, draw: (Canvas) -> Unit) {
        val s = state
        val pad = layerPadding()
        val layerWidth = width + pad * 2
        val layerHeight = height + pad * 2
        var layer: Bitmap? = null
        try {
            layer = Bitmap.createBitmap(layerWidth, layerHeight, Bitmap.Config.ARGB_8888)
            val layerCanvas = Canvas(layer)
            layerCanvas.translate(pad.toFloat(), pad.toFloat())
            if (matrix != null) layerCanvas.concat(matrix)
            draw(layerCanvas)
            // The bytes as stored, premultiplied RGBA, which is what the
            // filter works on.
            val pixels = ByteBuffer.allocate(layerWidth * layerHeight * 4)
            layer.copyPixelsToBuffer(pixels)
            CanvasFilter.apply(pixels.array(), layerWidth, layerHeight, s.filterSteps)
            pixels.rewind()
            layer.copyPixelsFromBuffer(pixels)
            val paint = Paint()
            // The layer is in the canvas's pixels, so the shadow needs no matrix.
            if (shadowVisible()) applyShadow(paint, null)
            val unbounded = s.composite in UNBOUNDED
            if (unbounded) {
                val layerPaint = Paint()
                setBlend(layerPaint, s.composite)
                layerPaint.alpha = (s.globalAlpha * 255).roundToInt()
                c.saveLayer(null, layerPaint)
            } else {
                setBlend(paint, s.composite)
                paint.alpha = (s.globalAlpha * 255).roundToInt()
            }
            c.drawBitmap(layer, -pad.toFloat(), -pad.toFloat(), paint)
            if (unbounded) c.restore()
        } catch (_: OutOfMemoryError) {
            // The layer, its bytes or the filter's scratch copies didn't fit:
            // this draw is left out, and the batch goes on, as a browser's
            // canvas that can't hold its size draws nothing.
            Log.w(TAG, "The filter's ${layerWidth}x$layerHeight layer is too big to draw with")
            return
        } catch (_: IllegalArgumentException) {
            Log.w(TAG, "The filter's ${layerWidth}x$layerHeight layer is too big to allocate")
            return
        } finally {
            layer?.recycle()
        }
        if (!alpha && s.composite in REDUCES_ALPHA) keepOpaque()
    }

    /**
     * How far past the canvas, on every side, a filter's layer reaches: the
     * filter's padding, and the shadow's offset and blur (three of its
     * deviations, which are half the blur), so a shape just off the canvas
     * still blurs, or casts its shadow, onto it. Capped at 256 pixels, as
     * css-filter.ts caps the filter's, so a far shadow makes no huge layer.
     */
    private fun layerPadding(): Int {
        val s = state
        var pad = s.filterPadding.toDouble()
        if (shadowVisible()) {
            pad += ceil(max(abs(s.shadowOffsetX), abs(s.shadowOffsetY)) + s.shadowBlur * 1.5f).toDouble()
        }
        return min(pad, 256.0).toInt()
    }

    /**
     * An opaque canvas stays opaque: what an operation like copy or
     * destination-out left see-through is put over black, as a browser keeps
     * a canvas made with alpha: false. It's done on the bytes: drawing black
     * under them would be antialiased at the clip's edge, and leave those
     * pixels see-through.
     */
    private fun keepOpaque() {
        val target = bitmap ?: return
        // The stored bytes, premultiplied, which are the colors over black:
        // only the alpha changes.
        val pixels = ByteBuffer.allocateDirect(width * height * 4).order(ByteOrder.nativeOrder())
        target.copyPixelsToBuffer(pixels)
        var changed = false
        for (i in 3 until pixels.capacity() step 4) {
            if (pixels.get(i) != 0xff.toByte()) {
                pixels.put(i, 0xff.toByte())
                changed = true
            }
        }
        if (!changed) return
        pixels.rewind()
        target.copyPixelsFromBuffer(pixels)
    }

    /**
     * The canvas's shadow on the paint. Its offset and blur are in the
     * canvas's pixels, but Android's go through the matrix the shape is drawn
     * under, so they're taken back through it.
     */
    private fun applyShadow(paint: Paint, matrix: Matrix?) {
        val s = state
        var dx = s.shadowOffsetX
        var dy = s.shadowOffsetY
        // The canvas's blur is twice the Gaussian's deviation; Android's
        // radius is turned into one as radius * 0.57735 + 0.5.
        var radius = max(0.001f, (s.shadowBlur / 2f - 0.5f) / 0.57735f)
        if (matrix != null) {
            val m = s.transform
            val det = m[0] * m[3] - m[1] * m[2]
            if (det != 0f) {
                val ix = (m[3] * dx - m[2] * dy) / det
                val iy = (-m[1] * dx + m[0] * dy) / det
                dx = ix
                dy = iy
                radius /= sqrt(abs(det))
            }
        }
        paint.setShadowLayer(radius, dx, dy, s.shadowColor)
    }

    // --- Shapes --------------------------------------------------------------

    /** A paint for the style, with shaders in the space of `matrix`, or null when it paints nothing. */
    private fun paintFor(style: Style, matrix: Matrix?): Paint? {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.isFilterBitmap = state.smoothing
        when (style.kind) {
            Style.COLOR -> paint.color = style.color
            Style.GRADIENT -> {
                val gradient = style.gradient ?: return null
                val shader = shaderFor(gradient) ?: return null
                // The shader's own matrix (a conic gradient's turn), then the
                // transform's.
                val local = Matrix()
                shader.getLocalMatrix(local)
                matrix?.let { local.postConcat(it) }
                shader.setLocalMatrix(local)
                paint.shader = shader
            }
            Style.PATTERN -> {
                val pattern = objects[style.objectId] as? Pattern ?: return null
                val shader = shaderFor(pattern)
                // The shader's own matrix (a padded image's offset), then the
                // pattern's transform, then the canvas's.
                val local = Matrix()
                shader.getLocalMatrix(local)
                style.transform?.let { local.postConcat(it) }
                matrix?.let { local.postConcat(it) }
                shader.setLocalMatrix(local)
                paint.shader = shader
            }
        }
        return paint
    }

    private fun shaderFor(gradient: Gradient): Shader? {
        if (gradient.offsets.isEmpty()) return null
        val offsets = ArrayList(gradient.offsets)
        val colors = ArrayList(gradient.colors)
        if (offsets.first() > 0f) {
            offsets.add(0, 0f)
            colors.add(0, colors.first())
        }
        if (offsets.last() < 1f) {
            offsets.add(1f)
            colors.add(colors.last())
        }
        val positions = offsets.toFloatArray()
        val colorArray = colors.toIntArray()
        val p = gradient.p
        return when (gradient.type) {
            0 -> {
                // A gradient of no length paints nothing.
                if (p[0] == p[2] && p[1] == p[3]) return null
                LinearGradient(p[0], p[1], p[2], p[3], colorArray, positions, Shader.TileMode.CLAMP)
            }
            1 -> {
                if (p[0] == p[3] && p[1] == p[4] && p[2] == p[5]) return null
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    RadialGradient(
                        p[0], p[1], p[2], p[3], p[4], p[5],
                        LongArray(colorArray.size) { Color.pack(colorArray[it]) },
                        positions,
                        Shader.TileMode.CLAMP,
                    )
                } else {
                    // Before Android 12 a radial gradient is one circle: the
                    // bigger circle, with the smaller one's radius as the
                    // first stop, which is right for circles with one center.
                    // A gradient that shrinks runs its stops the other way.
                    val shrinks = p[2] > p[5]
                    val outer = max(max(p[2], p[5]), 0.0001f)
                    val start = (min(p[2], p[5]) / outer).coerceIn(0f, 1f)
                    val count = positions.size
                    val stops = FloatArray(count) {
                        val t = if (shrinks) 1 - positions[count - 1 - it] else positions[it]
                        start + t * (1 - start)
                    }
                    val stopColors = IntArray(count) { colorArray[if (shrinks) count - 1 - it else it] }
                    val cx = if (shrinks) p[0] else p[3]
                    val cy = if (shrinks) p[1] else p[4]
                    RadialGradient(cx, cy, outer, stopColors, stops, Shader.TileMode.CLAMP)
                }
            }
            else -> SweepGradient(p[1], p[2], colorArray, positions).apply {
                // Sweep gradients start at 3 o'clock, as conic ones do at
                // their start angle: it's turned by that.
                setLocalMatrix(Matrix().apply { setRotate(Math.toDegrees(p[0].toDouble()).toFloat(), p[1], p[2]) })
            }
        }
    }

    private fun shaderFor(pattern: Pattern): Shader {
        val repeatX = pattern.repetition == 0 || pattern.repetition == 1
        val repeatY = pattern.repetition == 0 || pattern.repetition == 2
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return BitmapShader(
                pattern.bitmap,
                if (repeatX) Shader.TileMode.REPEAT else Shader.TileMode.DECAL,
                if (repeatY) Shader.TileMode.REPEAT else Shader.TileMode.DECAL,
            )
        }
        if (repeatX && repeatY) {
            return BitmapShader(pattern.bitmap, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT)
        }
        // Before Android 12 there's no tiling that draws nothing past the
        // edge: a transparent pixel round the image, clamped, draws nothing.
        val padX = if (repeatX) 0 else 1
        val padY = if (repeatY) 0 else 1
        val padded = Bitmap.createBitmap(pattern.bitmap.width + padX * 2, pattern.bitmap.height + padY * 2, Bitmap.Config.ARGB_8888)
        Canvas(padded).drawBitmap(pattern.bitmap, padX.toFloat(), padY.toFloat(), null)
        return BitmapShader(
            padded,
            if (repeatX) Shader.TileMode.REPEAT else Shader.TileMode.CLAMP,
            if (repeatY) Shader.TileMode.REPEAT else Shader.TileMode.CLAMP,
        ).apply { setLocalMatrix(Matrix().apply { setTranslate(-padX.toFloat(), -padY.toFloat()) }) }
    }

    /** Fills a path in the canvas's pixels; the style is in the transform's space. */
    private fun fillDevicePath(path: Path, style: Style) {
        if (path.isEmpty) return
        val transform = transformMatrix()
        val paint = paintFor(style, transform) ?: return
        paint.style = Paint.Style.FILL
        composite(paint, null) { it.drawPath(path, paint) }
    }

    private fun strokePaint(style: Style): Paint? {
        val s = state
        val paint = paintFor(style, null) ?: return null
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = s.lineWidth
        paint.strokeCap = s.lineCap
        paint.strokeJoin = s.lineJoin
        paint.strokeMiter = s.miterLimit
        if (s.lineDash.isNotEmpty()) paint.pathEffect = DashPathEffect(s.lineDash, s.lineDashOffset)
        return paint
    }

    /** The path in the transform's space, where its line's width and dashes are. */
    private fun userPath(devicePath: Path): Path? {
        if (!invertible(state.transform)) return null
        val inverse = Matrix()
        if (!transformMatrix().invert(inverse)) return null
        return Path(devicePath).apply { transform(inverse) }
    }

    private fun strokeDevicePath(devicePath: Path) {
        if (devicePath.isEmpty) return
        val user = userPath(devicePath) ?: return
        val paint = strokePaint(state.stroke) ?: return
        composite(paint, transformMatrix()) { it.drawPath(user, paint) }
    }

    /** The outline a stroke of the path fills, in the canvas's pixels. */
    private fun strokeOutline(devicePath: Path): Path? {
        val user = userPath(devicePath) ?: return null
        val paint = strokePaint(Style.BLACK) ?: return null
        val outline = Path()
        @Suppress("DEPRECATION")
        paint.getFillPath(user, outline)
        outline.transform(transformMatrix())
        return outline
    }

    private fun clearPath(path: Path) {
        val c = canvas ?: return
        if (path.isEmpty) return
        // Not touched by alpha, compositing or shadows, as the spec has it;
        // the clip still applies.
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        if (alpha) {
            paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
        } else {
            paint.color = Color.BLACK
            paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC)
        }
        c.drawPath(path, paint)
    }

    // --- Images --------------------------------------------------------------

    /**
     * An image source (see #imageSource in canvas-2d-context.ts): a decoded
     * image by id, or a canvas by its id, as it is now.
     */
    private fun bitmapFrom(source: ReadableMap): Bitmap? {
        if (source.hasKey("blank")) {
            // A canvas without a context: a transparent image of its size.
            val w = source.int("width", 0)
            val h = source.int("height", 0)
            if (w < 1 || h < 1) return null
            return try {
                Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            } catch (_: OutOfMemoryError) {
                null
            }
        }
        if (source.hasKey("canvas") && source.getType("canvas") == ReadableType.String) {
            val id = source.getString("canvas")
            if (id == canvasId) return bitmap?.copy(Bitmap.Config.ARGB_8888, false)
            val image = CanvasRegistry.context(id)?.snapshot() ?: return null
            return bitmapOf(image)
        }
        if (!source.hasKey("image") || source.getType("image") !in NUMBER_TYPES) return null
        val image = DecodedImages.get(source.getDouble("image").toInt()) ?: return null
        return decodedBitmaps.getOrPut(image) { bitmapOf(image) }
    }

    /** Pixels as a bitmap, premultiplied, as Android's canvas draws only those. */
    private fun bitmapOf(image: DecodedImage): Bitmap {
        val pixels = image.pixels.duplicate().order(ByteOrder.nativeOrder())
        pixels.rewind()
        val bytes = if (image.premultiplied) {
            pixels
        } else {
            val copy = ByteBuffer.allocateDirect(image.width * image.height * 4).order(ByteOrder.nativeOrder())
            for (i in 0 until image.width * image.height * 4 step 4) {
                val a = pixels.get(i + 3).toInt() and 0xff
                for (c in 0 until 3) copy.put(i + c, (((pixels.get(i + c).toInt() and 0xff) * a + 127) / 255).toByte())
                copy.put(i + 3, a.toByte())
            }
            copy
        }
        bytes.rewind()
        return Bitmap.createBitmap(image.width, image.height, Bitmap.Config.ARGB_8888).apply {
            copyPixelsFromBuffer(bytes)
        }
    }

    /**
     * drawImage: the source rectangle of the image drawn in the destination
     * rectangle, in the transform's space.
     */
    private fun drawImage(image: Bitmap, src: RectF, dst: RectF) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.isFilterBitmap = state.smoothing
        // The whole image, placed so the source lands on the destination, and
        // clipped to it, so a source between pixels is drawn where it falls.
        val scaleX = dst.width() / src.width()
        val scaleY = dst.height() / src.height()
        val whole = RectF(
            dst.left - src.left * scaleX,
            dst.top - src.top * scaleY,
            dst.left - src.left * scaleX + image.width * scaleX,
            dst.top - src.top * scaleY + image.height * scaleY,
        )
        // A source on whole pixels is drawn as itself, so a shadow falls
        // outside it; one between pixels is clipped, shadow and all.
        val integral = src.left == src.left.toInt().toFloat() && src.top == src.top.toInt().toFloat() &&
            src.right == src.right.toInt().toFloat() && src.bottom == src.bottom.toInt().toFloat()
        composite(paint, transformMatrix()) {
            if (integral) {
                val crop = Rect(src.left.toInt(), src.top.toInt(), src.right.toInt(), src.bottom.toInt())
                it.drawBitmap(image, crop, dst, paint)
            } else {
                it.clipRect(dst)
                it.drawBitmap(image, null, whole, paint)
            }
        }
    }

    // --- Pixels --------------------------------------------------------------

    /** getImageData: the rectangle's pixels, not premultiplied; transparent black outside the canvas. */
    private fun pixelsAt(x: Int, y: Int, w: Int, h: Int): JavaOnlyArray {
        val out = ByteBuffer.allocate(max(0, w) * max(0, h) * 4).order(ByteOrder.LITTLE_ENDIAN)
        val source = bitmap
        if (source != null && w > 0 && h > 0) {
            val left = max(0, x)
            val top = max(0, y)
            val right = min(width, x + w)
            val bottom = min(height, y + h)
            if (right > left && bottom > top) {
                val rowWidth = right - left
                val colors = IntArray(rowWidth)
                for (row in top until bottom) {
                    // getPixels gives straight ARGB, whatever the bitmap holds.
                    source.getPixels(colors, 0, rowWidth, left, row, rowWidth, 1)
                    for (column in 0 until rowWidth) {
                        val color = colors[column]
                        val index = ((row - y) * w + (left - x + column)) * 4
                        out.put(index, Color.red(color).toByte())
                        out.put(index + 1, Color.green(color).toByte())
                        out.put(index + 2, Color.blue(color).toByte())
                        out.put(index + 3, (if (alpha) Color.alpha(color) else 255).toByte())
                    }
                }
            }
        }
        return wordsFromBytes(out, out.capacity())
    }

    /** putImageData: straight RGBA written as it is, whatever the transform, clip and compositing. */
    private fun putPixels(bytes: ByteBuffer, w: Int, h: Int, x: Int, y: Int) {
        val target = bitmap ?: return
        if (bytes.limit() < w * h * 4) return
        val left = max(0, x)
        val top = max(0, y)
        val right = min(width, x + w)
        val bottom = min(height, y + h)
        if (right <= left || bottom <= top) return
        val rowWidth = right - left
        val colors = IntArray(rowWidth)
        for (row in top until bottom) {
            for (column in 0 until rowWidth) {
                val index = ((row - y) * w + (left - x + column)) * 4
                val a = if (alpha) bytes.get(index + 3).toInt() and 0xff else 255
                colors[column] = Color.argb(
                    a,
                    bytes.get(index).toInt() and 0xff,
                    bytes.get(index + 1).toInt() and 0xff,
                    bytes.get(index + 2).toInt() and 0xff,
                )
            }
            // setPixels takes straight colors and writes them as they are.
            target.setPixels(colors, 0, rowWidth, left, row, rowWidth, 1)
        }
    }

    // --- Text ----------------------------------------------------------------

    private fun typefaceFor(families: String, weight: Int, italic: Boolean): Typeface {
        val style = when {
            weight >= 600 && italic -> Typeface.BOLD_ITALIC
            weight >= 600 -> Typeface.BOLD
            italic -> Typeface.ITALIC
            else -> Typeface.NORMAL
        }
        var base: Typeface? = null
        for (family in families.split('\n')) {
            val name = family.trim()
            if (name.isEmpty()) continue
            base = SystemFontFamilies.getTypeface(name, style)
            if (base != null) break
        }
        val found = base ?: Typeface.create(Typeface.DEFAULT, style)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Typeface.create(found, weight.coerceIn(1, 1000), italic)
        } else {
            found
        }
    }

    private fun textPaint(): Paint {
        val s = state
        return Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = s.typeface
            textSize = s.fontSize
            letterSpacing = if (s.fontSize > 0) s.letterSpacing / s.fontSize else 0f
        }
    }

    private fun alignmentOffset(width: Float): Float {
        val rtl = state.rtl
        return when (state.textAlign) {
            1 -> if (rtl) 0f else -width
            2 -> 0f
            3 -> -width
            4 -> -width / 2
            else -> if (rtl) -width else 0f
        }
    }

    /** How far above the alphabetic baseline the anchor is, for textBaseline, as Chrome works it out. */
    private fun baselineHeight(paint: Paint): Float {
        val metrics = paint.fontMetrics
        val ascent = -metrics.ascent
        val descent = metrics.descent
        return when (state.textBaseline) {
            0 -> ascent
            1 -> ascent * 0.8f
            2 -> (ascent - descent) / 2
            4, 5 -> -descent
            else -> 0f
        }
    }

    private fun drawText(text: String, x: Float, y: Float, maxWidth: Float, stroke: Boolean) {
        if (canvas == null || text.isEmpty() || state.fontSize <= 0.01f) return
        val paint = textPaint()
        val width = paint.measureText(text)
        // Text wider than maxWidth is squeezed to fit, as the spec allows.
        val scaleX = if (maxWidth > 0 && width > maxWidth) maxWidth / width else 1f
        val originX = x + alignmentOffset(width) * scaleX
        val baseline = y + baselineHeight(paint)
        val place = Matrix().apply {
            setScale(scaleX, 1f)
            postTranslate(originX, baseline)
        }
        val style = if (stroke) state.stroke else state.fill
        if (!stroke && style.kind == Style.COLOR) {
            // Drawn as glyphs, so color glyphs (emoji) draw too.
            paint.color = style.color
            val matrix = transformMatrix().apply { preConcat(place) }
            composite(paint, matrix) {
                it.drawTextRun(text, 0, text.length, 0, text.length, 0f, 0f, state.rtl, paint)
            }
            return
        }
        // The glyphs' outlines, in the canvas's pixels, filled or stroked as
        // a path is.
        val glyphs = Path()
        paint.getTextPath(text, 0, text.length, 0f, 0f, glyphs)
        glyphs.transform(place)
        glyphs.transform(transformMatrix())
        if (stroke) strokeDevicePath(glyphs) else fillDevicePath(glyphs, style)
    }

    /** measureText: TextMetrics' numbers, in order (see LynxTextMetrics), from the anchor. */
    private fun measureText(text: String): JavaOnlyArray {
        val paint = textPaint()
        val width = paint.measureText(text)
        val bounds = Rect()
        if (text.isNotEmpty()) paint.getTextBounds(text, 0, text.length, bounds)
        val metrics = paint.fontMetrics
        val ascent = -metrics.ascent
        val descent = metrics.descent
        val offset = alignmentOffset(width)
        val anchor = baselineHeight(paint)
        // Android's bounds are y down; TextMetrics' are y up from the baseline.
        val values = floatArrayOf(
            width,
            -(offset + bounds.left),
            offset + bounds.right,
            ascent - anchor,
            descent + anchor,
            -bounds.top - anchor,
            bounds.bottom + anchor,
            ascent - anchor,
            descent + anchor,
            ascent * 0.8f - anchor,
            -anchor,
            -descent - anchor,
        )
        return JavaOnlyArray().apply { for (value in values) pushDouble(value.toDouble()) }
    }

    companion object {
        private const val TAG = "AngularLynxCanvas2D"
        private const val COMPOSITE_COUNT = 26

        /** The operations that clear what the shape doesn't cover. */
        private val UNBOUNDED = setOf(1, 2, 5, 7, 9)

        /**
         * The operations that can leave a pixel less opaque than it was:
         * source-in, source-out, destination-in, destination-out,
         * destination-atop, copy and xor.
         */
        private val REDUCES_ALPHA = setOf(1, 2, 5, 6, 7, 9, 10)

        /** How finely isPointInPath() tests a point: a 64th of a pixel. */
        private const val POINT_SCALE = 64f


        /** Before Android 10, the operations PorterDuff has; the rest draw as source-over. */
        private val PORTER_DUFF_MODES: Array<PorterDuff.Mode?> = arrayOf(
            PorterDuff.Mode.SRC_OVER, PorterDuff.Mode.SRC_IN, PorterDuff.Mode.SRC_OUT, PorterDuff.Mode.SRC_ATOP,
            PorterDuff.Mode.DST_OVER, PorterDuff.Mode.DST_IN, PorterDuff.Mode.DST_OUT, PorterDuff.Mode.DST_ATOP,
            PorterDuff.Mode.ADD, PorterDuff.Mode.SRC, PorterDuff.Mode.XOR, PorterDuff.Mode.MULTIPLY,
            PorterDuff.Mode.SCREEN, PorterDuff.Mode.OVERLAY, PorterDuff.Mode.DARKEN, PorterDuff.Mode.LIGHTEN,
            null, null, null, null, null, null, null, null, null, null,
        )
    }
}

/** The canvas's composite operations as Android 10's blend modes, in order. */
@RequiresApi(Build.VERSION_CODES.Q)
private object BlendModes {
    val ALL: Array<BlendMode> = arrayOf(
        BlendMode.SRC_OVER, BlendMode.SRC_IN, BlendMode.SRC_OUT, BlendMode.SRC_ATOP,
        BlendMode.DST_OVER, BlendMode.DST_IN, BlendMode.DST_OUT, BlendMode.DST_ATOP,
        BlendMode.PLUS, BlendMode.SRC, BlendMode.XOR, BlendMode.MULTIPLY,
        BlendMode.SCREEN, BlendMode.OVERLAY, BlendMode.DARKEN, BlendMode.LIGHTEN,
        BlendMode.COLOR_DODGE, BlendMode.COLOR_BURN, BlendMode.HARD_LIGHT, BlendMode.SOFT_LIGHT,
        BlendMode.DIFFERENCE, BlendMode.EXCLUSION, BlendMode.HUE, BlendMode.SATURATION,
        BlendMode.COLOR, BlendMode.LUMINOSITY,
    )
}

private fun ReadableMap?.int(key: String, default: Int): Int =
    if (this != null && hasKey(key) && getType(key) in NUMBER_TYPES) getDouble(key).toInt() else default
