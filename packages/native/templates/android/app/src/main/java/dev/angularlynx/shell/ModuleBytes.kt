package dev.angularlynx.shell

import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.ReadableArray
import java.nio.ByteBuffer
import java.nio.ByteOrder

// How bytes cross a module call, both ways: the WebGL module's buffers and
// images, and the files AssetsModule reads. Here, not in WebGLModule.kt, as
// an app that never draws on a canvas is built without that file
// (@blotch/angular-lynx-native's features.ts) and still has AssetsModule.

/**
 * The bytes the runtime sends as 32-bit words, with the byte count last (see
 * toWords in webgl-bridge.ts). Android runs little-endian, so the words land
 * in memory as the bytes were.
 */
internal fun bytesFromWords(words: ReadableArray): ByteBuffer {
    val count = words.size()
    if (count == 0) return ByteBuffer.allocateDirect(0)
    val byteLength = words.getDouble(count - 1).toLong().toInt()
    val buffer = ByteBuffer.allocateDirect((count - 1) * 4).order(ByteOrder.LITTLE_ENDIAN)
    for (i in 0 until count - 1) buffer.putInt(words.getDouble(i).toLong().toInt())
    buffer.rewind()
    buffer.limit(minOf(byteLength, (count - 1) * 4))
    return buffer
}

/** Bytes as words for the trip back, the byte count last. */
internal fun wordsFromBytes(bytes: ByteBuffer, length: Int): JavaOnlyArray {
    val words = JavaOnlyArray()
    val source = bytes.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    source.rewind()
    val wordCount = (length + 3) / 4
    for (i in 0 until wordCount) {
        var word = 0L
        for (b in 0 until 4) {
            val index = i * 4 + b
            if (index < length) word = word or ((source.get(index).toLong() and 0xff) shl (8 * b))
        }
        words.pushDouble(word.toDouble())
    }
    words.pushInt(length)
    return words
}

internal fun flipRows(pixels: ByteBuffer, stride: Int, height: Int) {
    val top = ByteArray(stride)
    val bottom = ByteArray(stride)
    for (row in 0 until height / 2) {
        val other = height - 1 - row
        pixels.position(row * stride); pixels.get(top)
        pixels.position(other * stride); pixels.get(bottom)
        pixels.position(row * stride); pixels.put(bottom)
        pixels.position(other * stride); pixels.put(top)
    }
    pixels.rewind()
}
