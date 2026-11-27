package dev.angularlynx.shell

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * The 2D context's `filter`, which the runtime parses into steps
 * (packages/runtime/src/lib/canvas/css-filter.ts): a Gaussian blur, a color
 * matrix, or a drop shadow, applied in order to the layer what's drawn went
 * into, after its alpha and before its shadow and compositing, as the canvas
 * spec has it.
 *
 * They work on the layer's bytes as `copyPixelsToBuffer` gives them,
 * premultiplied RGBA, in sRGB, which is where the spec has filter functions
 * work. Android's own effects don't fit: `RenderEffect` needs Android 12 and
 * a hardware canvas, and `BlurMaskFilter` blurs only a shape's coverage, not
 * its colors. The iOS shell runs the same steps the same way
 * (AngularLynxCanvas2DContext.m), so the two draw alike.
 */
internal object CanvasFilter {
    /** The steps' kinds, as css-filter.ts's FILTER_STEP numbers them. */
    private const val BLUR = 0
    private const val MATRIX = 1
    private const val DROP_SHADOW = 2

    /** A step of the filter: its kind (as css-filter.ts's FILTER_STEP numbers them) and its numbers. */
    class Step(val kind: Int, val values: DoubleArray) {
        val isBlur: Boolean get() = kind == BLUR

        /** Whether it's a drop shadow moved by an offset. */
        val isMovedShadow: Boolean get() = kind == DROP_SHADOW && (values[0] != 0.0 || values[1] != 0.0)

        /** Its deviation, for a blur or a drop shadow; 0 for a color matrix. */
        val sigma: Double get() = when (kind) {
            BLUR -> values[0]
            DROP_SHADOW -> values[2]
            else -> 0.0
        }

        /**
         * How far it can move what's drawn, in the canvas's pixels, as
         * css-filter.ts counts a step's padding: three deviations, and a
         * drop shadow's offset. Uncapped, unlike the padding the runtime
         * sends, which stops at 256.
         */
        val reach: Double get() = when (kind) {
            BLUR -> ceil(values[0] * 3)
            DROP_SHADOW -> ceil(values[2] * 3) + ceil(maxOf(abs(values[0]), abs(values[1])))
            else -> 0.0
        }

        companion object {
            /** A blur of deviation `sigma`, as blur() makes. */
            fun blur(sigma: Double): Step = Step(BLUR, doubleArrayOf(sigma))
        }
    }

    /** The filter's steps, as the runtime sends them. */
    fun parse(steps: DoubleArray): List<Step> {
        val parsed = ArrayList<Step>()
        var i = 0
        while (i < steps.size) {
            val kind = steps[i++].toInt()
            val arity = when (kind) {
                BLUR -> 1
                MATRIX -> 20
                DROP_SHADOW -> 7
                else -> 0
            }
            // A step it doesn't know, or one cut short, ends the list: what's
            // after it would be read as the wrong numbers.
            if (arity == 0 || i + arity > steps.size) break
            parsed.add(Step(kind, steps.copyOfRange(i, i + arity)))
            i += arity
        }
        return parsed
    }

    /**
     * One step on a layer's bytes, in a layer `scale` of whose pixels make a
     * canvas pixel: its lengths (a deviation, an offset) are in the canvas's
     * pixels, so they're scaled to the layer's.
     */
    fun applyStep(bytes: ByteArray, width: Int, height: Int, step: Step, scale: Double) {
        val v = step.values
        when (step.kind) {
            BLUR -> gaussianBlur(bytes, width, height, v[0] * scale)
            MATRIX -> colorMatrix(bytes, v)
            else -> {
                val shadow = shadowOf(bytes, width, height, v[0] * scale, v[1] * scale, v[2] * scale, v[3], v[4], v[5], v[6])
                under(bytes, shadow)
            }
        }
    }

    /** globalAlpha on a layer's bytes, which are premultiplied, so every channel scales. */
    fun scaleAlpha(bytes: ByteArray, alpha: Double) {
        if (alpha >= 1) return
        for (i in bytes.indices) bytes[i] = clampByte(bytes.at(i) * alpha)
    }

    private fun clampByte(value: Double): Byte = when {
        value <= 0 -> 0.toByte()
        value >= 255 -> 255.toByte()
        else -> (value + 0.5).toInt().toByte()
    }

    private fun clampUnit(value: Double): Double = value.coerceIn(0.0, 1.0)

    private fun ByteArray.at(index: Int): Int = this[index].toInt() and 0xff

    /**
     * A color matrix (row by row: red, green, blue, alpha; each row's factors
     * and offset) on the colors not premultiplied, clamped, as feColorMatrix is.
     */
    private fun colorMatrix(bytes: ByteArray, m: DoubleArray) {
        for (p in 0 until bytes.size step 4) {
            val a = bytes.at(p + 3) / 255.0
            var r = 0.0
            var g = 0.0
            var b = 0.0
            if (a > 0) {
                r = bytes.at(p) / 255.0 / a
                g = bytes.at(p + 1) / 255.0 / a
                b = bytes.at(p + 2) / 255.0 / a
            }
            val r2 = clampUnit(m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4])
            val g2 = clampUnit(m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9])
            val b2 = clampUnit(m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14])
            val a2 = clampUnit(m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19])
            bytes[p] = clampByte(r2 * a2 * 255)
            bytes[p + 1] = clampByte(g2 * a2 * 255)
            bytes[p + 2] = clampByte(b2 * a2 * 255)
            bytes[p + 3] = clampByte(a2 * 255)
        }
    }

    /**
     * One box blur along each row (or each column), each output the mean of
     * the `lo` bytes before it, itself and the `hi` after; transparent past
     * the edges.
     */
    private fun boxPass(src: ByteArray, dst: ByteArray, width: Int, height: Int, lo: Int, hi: Int, horizontal: Boolean) {
        val lines = if (horizontal) height else width
        val length = if (horizontal) width else height
        val step = if (horizontal) 4 else width * 4
        val lineStride = if (horizontal) width * 4 else 4
        val size = lo + hi + 1
        for (line in 0 until lines) {
            val base = line * lineStride
            for (channel in 0 until 4) {
                var sum = 0
                for (i in 0..min(hi, length - 1)) sum += src.at(base + i * step + channel)
                for (x in 0 until length) {
                    dst[base + x * step + channel] = ((sum * 2 + size) / (size * 2)).toByte()
                    if (x + hi + 1 < length) sum += src.at(base + (x + hi + 1) * step + channel)
                    if (x >= lo) sum -= src.at(base + (x - lo) * step + channel)
                }
            }
        }
    }

    /** One pass of a Gaussian kernel along each row (or each column). */
    private fun kernelPass(src: ByteArray, dst: ByteArray, width: Int, height: Int, weights: DoubleArray, radius: Int, horizontal: Boolean) {
        val lines = if (horizontal) height else width
        val length = if (horizontal) width else height
        val step = if (horizontal) 4 else width * 4
        val lineStride = if (horizontal) width * 4 else 4
        val sum = DoubleArray(4)
        for (line in 0 until lines) {
            val base = line * lineStride
            for (x in 0 until length) {
                sum.fill(0.0)
                for (i in maxOf(0, x - radius)..min(length - 1, x + radius)) {
                    val weight = weights[i + radius - x]
                    val p = base + i * step
                    for (channel in 0 until 4) sum[channel] += src.at(p + channel) * weight
                }
                for (channel in 0 until 4) dst[base + x * step + channel] = clampByte(sum[channel])
            }
        }
    }

    /**
     * A Gaussian blur of deviation `sigma`, as feGaussianBlur draws it: from a
     * deviation of 2, three box blurs, which the spec gives as within 3% of
     * the Gaussian (and which cost the same whatever the deviation); below
     * it, the Gaussian's own kernel, which is small there.
     */
    private fun gaussianBlur(bytes: ByteArray, width: Int, height: Int, sigma: Double) {
        if (!(sigma > 0) || width == 0 || height == 0) return
        val scratch = ByteArray(bytes.size)
        for (horizontal in booleanArrayOf(true, false)) {
            if (sigma >= 2) {
                val d = floor(sigma * 3 * sqrt(2 * PI) / 4 + 0.5).toInt()
                if (d % 2 == 1) {
                    boxPass(bytes, scratch, width, height, d / 2, d / 2, horizontal)
                    boxPass(scratch, bytes, width, height, d / 2, d / 2, horizontal)
                    boxPass(bytes, scratch, width, height, d / 2, d / 2, horizontal)
                } else {
                    // An even box is centered between two pixels: one leans
                    // left, one right, and the third is a pixel wider and
                    // centered.
                    boxPass(bytes, scratch, width, height, d / 2, d / 2 - 1, horizontal)
                    boxPass(scratch, bytes, width, height, d / 2 - 1, d / 2, horizontal)
                    boxPass(bytes, scratch, width, height, d / 2, d / 2, horizontal)
                }
            } else {
                val radius = ceil(sigma * 3).toInt()
                val weights = DoubleArray(radius * 2 + 1) { i ->
                    val k = (i - radius).toDouble()
                    exp(-(k * k) / (2 * sigma * sigma))
                }
                val total = weights.sum()
                for (i in weights.indices) weights[i] /= total
                kernelPass(bytes, scratch, width, height, weights, radius, horizontal)
            }
            scratch.copyInto(bytes)
        }
    }

    /**
     * The shadow of what's in `bytes`: its alpha, moved by the offset (to the
     * nearest pixel), blurred by the deviation and in the color (red, green
     * and blue 0 to 255, alpha 0 to 1), as new premultiplied bytes.
     */
    fun shadowOf(
        bytes: ByteArray,
        width: Int,
        height: Int,
        dx: Double,
        dy: Double,
        sigma: Double,
        r: Double,
        g: Double,
        b: Double,
        a: Double,
    ): ByteArray {
        val offsetX = dx.roundToInt()
        val offsetY = dy.roundToInt()
        val shadow = ByteArray(bytes.size)
        if (abs(offsetX) < width && abs(offsetY) < height) {
            for (y in maxOf(0, offsetY) until min(height, height + offsetY)) {
                for (x in maxOf(0, offsetX) until min(width, width + offsetX)) {
                    shadow[(y * width + x) * 4 + 3] = bytes[((y - offsetY) * width + (x - offsetX)) * 4 + 3]
                }
            }
        }
        gaussianBlur(shadow, width, height, sigma)
        for (p in 0 until shadow.size step 4) {
            val shadowAlpha = shadow.at(p + 3) / 255.0 * a
            shadow[p] = clampByte(r * shadowAlpha)
            shadow[p + 1] = clampByte(g * shadowAlpha)
            shadow[p + 2] = clampByte(b * shadowAlpha)
            shadow[p + 3] = clampByte(255 * shadowAlpha)
        }
        return shadow
    }

    /**
     * `under` drawn under `bytes`, source-over, as drop-shadow() puts its
     * shadow under what's drawn. Both are premultiplied, the same size.
     */
    fun under(bytes: ByteArray, under: ByteArray) {
        for (p in 0 until bytes.size) {
            val uncovered = 1 - bytes.at(p - p % 4 + 3) / 255.0
            bytes[p] = clampByte(bytes.at(p) + under.at(p) * uncovered)
        }
    }

    /**
     * The bytes of a layer resampled onto another: `src`, over the canvas's
     * pixels from (srcLeft, srcTop) at `srcScale` of its pixels to a canvas
     * pixel, read with bilinear filtering at the center of each of the
     * `dstWidth` by `dstHeight` pixels of a layer from (dstLeft, dstTop) at
     * `dstScale`, moved by (shiftX, shiftY) canvas pixels. Transparent past
     * `src`'s edges. It's how a blur worked out in a smaller layer is scaled
     * up, and how a drop shadow's offset lands between two pixels, which a
     * blur that wide has no edge to show.
     */
    fun resample(
        src: ByteArray,
        srcWidth: Int,
        srcHeight: Int,
        srcLeft: Double,
        srcTop: Double,
        srcScale: Double,
        dstWidth: Int,
        dstHeight: Int,
        dstLeft: Double,
        dstTop: Double,
        dstScale: Double,
        shiftX: Double,
        shiftY: Double,
    ): ByteArray {
        val dst = ByteArray(dstWidth * dstHeight * 4)
        // Where each column's and row's center falls in src, as the pixel
        // before it and how far past that pixel's center it is. Clamped, so a
        // far shift stays an Int (and reads nothing).
        fun axis(count: Int, from: Double, shift: Double, srcFrom: Double, size: Int): Pair<IntArray, DoubleArray> {
            val index = IntArray(count)
            val fraction = DoubleArray(count)
            for (i in 0 until count) {
                val u = ((from + (i + 0.5) / dstScale - shift - srcFrom) * srcScale - 0.5).coerceIn(-2.0, size + 1.0)
                val whole = floor(u)
                index[i] = whole.toInt()
                fraction[i] = u - whole
            }
            return index to fraction
        }
        val (xs, fx) = axis(dstWidth, dstLeft, shiftX, srcLeft, srcWidth)
        val (ys, fy) = axis(dstHeight, dstTop, shiftY, srcTop, srcHeight)
        fun sample(x: Int, y: Int, channel: Int): Int =
            if (x < 0 || y < 0 || x >= srcWidth || y >= srcHeight) 0 else src.at((y * srcWidth + x) * 4 + channel)
        for (j in 0 until dstHeight) {
            val y = ys[j]
            if (y < -1 || y >= srcHeight) continue
            val wy = fy[j]
            for (i in 0 until dstWidth) {
                val x = xs[i]
                if (x < -1 || x >= srcWidth) continue
                val wx = fx[i]
                val p = (j * dstWidth + i) * 4
                for (channel in 0 until 4) {
                    val top = sample(x, y, channel) * (1 - wx) + sample(x + 1, y, channel) * wx
                    val bottom = sample(x, y + 1, channel) * (1 - wx) + sample(x + 1, y + 1, channel) * wx
                    dst[p + channel] = clampByte(top * (1 - wy) + bottom * wy)
                }
            }
        }
        return dst
    }
}
