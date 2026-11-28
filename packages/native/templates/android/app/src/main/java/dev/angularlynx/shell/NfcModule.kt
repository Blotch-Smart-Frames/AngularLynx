package dev.angularlynx.shell

import android.app.Activity
import android.content.Context
import android.nfc.FormatException
import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.nfc.tech.NdefFormatable
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.lynx.react.bridge.ReadableType
import java.io.IOException

/**
 * The native module behind the runtime's `LynxNfc`, which calls it as
 * `NativeModules.AngularLynxNfc` (from the background thread, where
 * NativeModules lives). MainActivity registers it with itself as the param,
 * the activity reader mode runs in. iOS's shell has one of the same name and
 * methods (NfcModule.swift), which say what each answers.
 *
 * A session is `NfcAdapter.enableReaderMode`, which hands each tag that comes
 * near the phone to this module rather than to other apps, while the activity
 * is in the foreground: Android pauses it with the activity and starts it
 * again when the app comes back. There's no system sheet, so `alertMessage`
 * and the messages `stop` takes are iOS's alone.
 *
 * The generator leaves this file and the lines in MainActivity that register
 * it out of an app whose angular.json doesn't set `permissions.nfc`, which
 * also declares the NFC permission and the (not required) NFC feature.
 */
class NfcModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val activity = param as Activity
    private val adapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(context)
    private val main = Handler(Looper.getMainLooper())

    /** A tag that couldn't be read or written, with the runtime's code. */
    private class TagError(val code: String, message: String) : Exception(message)

    // Guarded by `this`: Lynx calls the methods on a thread of its own, and
    // reader mode hands over tags on a binder thread.
    private var open = false
    private var multiple = false
    private var message: NdefMessage? = null
    private var waiting: Callback? = null
    private val answers = ArrayDeque<JavaOnlyMap>()

    @LynxMethod
    fun state(callback: Callback) {
        callback.invoke(JavaOnlyMap().apply { putString("state", currentState()) })
    }

    private fun currentState(): String = when {
        adapter == null -> "unsupported"
        !adapter.isEnabled -> "disabled"
        else -> "ready"
    }

    @LynxMethod
    fun start(options: ReadableMap, callback: Callback) {
        when (currentState()) {
            "unsupported" -> return callback.invoke(error("unsupported", "This phone has no NFC reader."))
            "disabled" -> return callback.invoke(error("disabled", "NFC is turned off in the phone's settings."))
        }
        val records = if (options.hasKey("write") && options.getType("write") == ReadableType.Array) {
            try {
                NdefMessage(records(options.getArray("write")!!))
            } catch (_: IllegalArgumentException) {
                return callback.invoke(error("failed", "The records to write aren't valid NDEF records."))
            }
        } else {
            null
        }
        synchronized(this) {
            if (open) return callback.invoke(error("busy", "Another NFC read or write is still open."))
            open = true
            multiple = options.hasKey("multiple") && options.getType("multiple") == ReadableType.Boolean &&
                options.getBoolean("multiple")
            message = records
            answers.clear()
        }
        // Reader mode starts from the main thread, with the activity in the
        // foreground.
        main.post {
            try {
                adapter!!.enableReaderMode(activity, ::onTag, READER_FLAGS, null)
                callback.invoke(JavaOnlyMap())
            } catch (exception: IllegalStateException) {
                synchronized(this) { open = false }
                callback.invoke(error("failed", "NFC couldn't start: ${exception.message}"))
            }
        }
    }

    @LynxMethod
    fun next(callback: Callback) {
        synchronized(this) {
            when {
                answers.isNotEmpty() -> callback.invoke(answers.removeFirst())
                !open -> callback.invoke(error("stopped", "The NFC session has ended."))
                waiting != null -> callback.invoke(error("busy", "The module is already waiting for a tag."))
                else -> waiting = callback
            }
        }
    }

    @LynxMethod
    fun stop(@Suppress("UNUSED_PARAMETER") options: ReadableMap, callback: Callback) {
        val waiter = synchronized(this) {
            val wasOpen = open
            open = false
            val waiter = waiting
            waiting = null
            if (wasOpen) main.post { adapter?.disableReaderMode(activity) }
            waiter
        }
        waiter?.invoke(error("stopped", "The NFC session has ended."))
        callback.invoke(JavaOnlyMap())
    }

    /** Reader mode's callback, on a binder thread, for each tag it finds. */
    private fun onTag(tag: Tag) {
        val write = synchronized(this) { if (open) message else return }
        val answer = try {
            JavaOnlyMap().apply { putMap("tag", if (write != null) write(write, tag) else read(tag)) }
        } catch (exception: TagError) {
            error(exception.code, exception.message ?: "")
        } catch (exception: IOException) {
            error("failed", "The tag moved away before it could be read: ${exception.message}")
        } catch (exception: FormatException) {
            error("failed", "The tag's NDEF message is damaged: ${exception.message}")
        }
        val waiter = synchronized(this) {
            // A scan skips a tag it couldn't read; there's no sheet to say so,
            // and the next tap tries again.
            if (!open || (multiple && answer.hasKey("error"))) return
            val waiter = waiting
            waiting = null
            if (waiter == null) answers.addLast(answer)
            waiter
        }
        waiter?.invoke(answer)
    }

    private fun read(tag: Tag): JavaOnlyMap {
        Ndef.get(tag)?.let { ndef ->
            ndef.connect()
            try {
                // Null on a tag formatted for NDEF with no message yet.
                val message = ndef.ndefMessage
                return tagMap(message?.records ?: emptyArray(), ndef.isWritable, ndef.maxSize, tag)
            } finally {
                ndef.close()
            }
        }
        // A blank tag that can take NDEF once it's formatted, which a write
        // does.
        if (NdefFormatable.get(tag) != null) return tagMap(emptyArray(), true, 0, tag)
        throw TagError("tagNotNdef", "This tag doesn't hold NDEF records.")
    }

    private fun write(message: NdefMessage, tag: Tag): JavaOnlyMap {
        Ndef.get(tag)?.let { ndef ->
            ndef.connect()
            try {
                if (!ndef.isWritable) throw TagError("readOnly", "This tag is locked, so it can't be written to.")
                if (message.byteArrayLength > ndef.maxSize) {
                    throw TagError(
                        "tooLarge",
                        "The records take ${message.byteArrayLength} bytes, and this tag holds ${ndef.maxSize}.",
                    )
                }
                ndef.writeNdefMessage(message)
                return tagMap(message.records, true, ndef.maxSize, tag)
            } finally {
                ndef.close()
            }
        }
        NdefFormatable.get(tag)?.let { blank ->
            blank.connect()
            try {
                blank.format(message)
                return tagMap(message.records, true, 0, tag)
            } finally {
                blank.close()
            }
        }
        throw TagError("tagNotNdef", "This tag can't hold NDEF records.")
    }

    private fun tagMap(records: Array<NdefRecord>, writable: Boolean, capacity: Int, tag: Tag) =
        JavaOnlyMap().apply {
            putArray(
                "records",
                JavaOnlyArray().apply {
                    for (record in records) {
                        pushMap(
                            JavaOnlyMap().apply {
                                putInt("tnf", record.tnf.toInt())
                                putString("type", base64(record.type))
                                putString("id", base64(record.id))
                                putString("payload", base64(record.payload))
                            },
                        )
                    }
                },
            )
            putBoolean("writable", writable)
            putInt("capacity", capacity)
            putString("id", tag.id.joinToString("") { "%02x".format(it) })
        }

    /** The runtime's records, which NdefRecord checks: it throws for a bad one. */
    private fun records(list: com.lynx.react.bridge.ReadableArray): Array<NdefRecord> =
        Array(list.size()) { index ->
            val record = list.getMap(index) ?: throw IllegalArgumentException("Not a record")
            if (record.getType("tnf") !in NUMBERS) throw IllegalArgumentException("No tnf")
            NdefRecord(
                record.getDouble("tnf").toInt().toShort(),
                bytes(record, "type"),
                bytes(record, "id"),
                bytes(record, "payload"),
            )
        }

    private fun bytes(record: ReadableMap, name: String): ByteArray =
        if (record.hasKey(name) && record.getType(name) == ReadableType.String) {
            Base64.decode(record.getString(name), Base64.DEFAULT)
        } else {
            ByteArray(0)
        }

    private fun base64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun error(code: String, message: String) = JavaOnlyMap().apply {
        putString("error", code)
        putString("message", message)
    }

    companion object {
        const val NAME = "AngularLynxNfc"
        private val NUMBERS = setOf(ReadableType.Int, ReadableType.Long, ReadableType.Number)

        /** Every kind of tag that can hold NDEF. */
        private const val READER_FLAGS = NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V
    }
}
