// Generated from packages/runtime/src/lib/canvas/canvas-2d-ops.ts by
// packages/native/scripts/webgl-ops.ts: run `npm run generate:webgl-ops -w
// packages/native` rather than editing it.

package dev.angularlynx.shell

/**
 * The commands of the 2D context's bridge, as `<canvas>`'s 2D context in
 * the runtime records them: below 200 they return nothing, from 200 each
 * answers one query.
 */
internal object Canvas2DOps {
    const val SAVE = 1
    const val RESTORE = 2
    const val RESET = 3
    const val RESIZE = 4
    const val PRESENT = 5
    const val SET_TRANSFORM = 10
    const val SET_GLOBAL_ALPHA = 11
    const val SET_COMPOSITE_OPERATION = 12
    const val SET_FILL_COLOR = 13
    const val SET_FILL_GRADIENT = 14
    const val SET_FILL_PATTERN = 15
    const val SET_STROKE_COLOR = 16
    const val SET_STROKE_GRADIENT = 17
    const val SET_STROKE_PATTERN = 18
    const val SET_LINE_WIDTH = 19
    const val SET_LINE_CAP = 20
    const val SET_LINE_JOIN = 21
    const val SET_MITER_LIMIT = 22
    const val SET_LINE_DASH = 23
    const val SET_SHADOW = 24
    const val SET_FONT = 25
    const val SET_TEXT_ALIGN = 26
    const val SET_TEXT_BASELINE = 27
    const val SET_DIRECTION = 28
    const val SET_LETTER_SPACING = 29
    const val SET_IMAGE_SMOOTHING = 30
    const val CREATE_PATTERN = 44
    const val RELEASE_OBJECT = 46
    const val CLEAR_PATH = 50
    const val FILL = 51
    const val STROKE = 52
    const val CLIP = 53
    const val FILL_TEXT = 54
    const val STROKE_TEXT = 55
    const val DRAW_IMAGE = 56
    const val PUT_IMAGE_DATA = 57
    const val MEASURE_TEXT = 200
    const val GET_IMAGE_DATA = 201
    const val IS_POINT_IN_PATH = 202
    const val IS_POINT_IN_STROKE = 203
}

/** The segments of a path, each followed by its points. */
internal object Canvas2DPathOps {
    const val MOVE_TO = 0
    const val LINE_TO = 1
    const val QUAD_TO = 2
    const val CUBIC_TO = 3
    const val CLOSE = 4
}
