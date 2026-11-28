package dev.angularlynx.shell

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.provider.CalendarContract
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.lynx.react.bridge.ReadableType
import java.util.Calendar
import java.util.TimeZone

/**
 * The native module behind the runtime's `LynxCalendar`, which calls it as
 * `NativeModules.AngularLynxCalendar` (from the background thread, where
 * NativeModules lives). MainActivity registers it with its [Host] as the
 * param, which opens the calendar app.
 *
 * `addEvent` sends `ACTION_INSERT` on `CalendarContract.Events`, filled in
 * with the app's event, so the person's calendar app opens its own editor
 * and saves the event itself: the app needs no calendar permission. It calls
 * back once, when the person comes back, with `{ result: "saved" }` if the
 * calendar app answered `RESULT_OK` and `{ result: "unknown" }` otherwise.
 * Calendar apps aren't asked to answer, and Google Calendar answers
 * `RESULT_CANCELED` whether or not the event was saved, so anything but
 * `RESULT_OK` says nothing. With no calendar app on the phone it calls back
 * `{ error: "unavailable" }`.
 *
 * The generator leaves this file and the lines in MainActivity that register
 * it out of an app whose angular.json doesn't set `calendar`.
 */
class CalendarModule(context: Context, param: Any?) : LynxModule(context, param) {
    /** Opens the calendar app's editor from the activity. */
    interface Host {
        /**
         * Starts [intent] for a result and calls [done] once, on the main
         * thread, with the activity's result code. Returns false, without
         * starting it, while an editor is already open. Throws
         * `ActivityNotFoundException` when no app takes the intent. Must be
         * called on the main thread.
         */
        fun openCalendarEditor(intent: Intent, done: (Int) -> Unit): Boolean
    }

    private val host = param as Host
    private val main = Handler(Looper.getMainLooper())

    /**
     * Opens the editor with [event]: `{ title, start, end, allDay, location?,
     * notes? }`, with the times in milliseconds since 1970.
     */
    @LynxMethod
    fun addEvent(event: ReadableMap, callback: Callback) {
        val title = event.text("title")
        val start = event.time("start")
        val end = event.time("end")
        if (title == null || start == null || end == null) {
            callback.invoke(error("failed", "The event needs a title, a start and an end."))
            return
        }
        val allDay = event.hasKey("allDay") && event.getType("allDay") == ReadableType.Boolean &&
            event.getBoolean("allDay")
        val intent = Intent(Intent.ACTION_INSERT)
            .setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, title)
            // Calendar apps read an all-day event's times as UTC midnights,
            // as the calendar provider stores them, with the end the
            // midnight after the last day. The runtime sends the instants the
            // app gave, whose days are the phone's: east of UTC, local
            // midnight is the day before in UTC.
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, if (allDay) utcMidnightOfDay(start) else start)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, if (allDay) utcMidnightOfDay(end, 1) else end)
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, allDay)
        event.text("location")?.let { intent.putExtra(CalendarContract.Events.EVENT_LOCATION, it) }
        event.text("notes")?.let { intent.putExtra(CalendarContract.Events.DESCRIPTION, it) }
        // Lynx calls modules off the main thread, and activities start from it.
        main.post {
            try {
                val opened = host.openCalendarEditor(intent) { code ->
                    val result = if (code == Activity.RESULT_OK) "saved" else "unknown"
                    callback.invoke(JavaOnlyMap().apply { putString("result", result) })
                }
                if (!opened) {
                    callback.invoke(error("failed", "The event editor is already open."))
                }
            } catch (_: android.content.ActivityNotFoundException) {
                callback.invoke(error("unavailable", "There's no calendar app on this phone to add the event to."))
            }
        }
    }

    /**
     * UTC midnight on the phone's day of [time], [daysLater] days on: the
     * calendar provider's form of an all-day event's day.
     */
    private fun utcMidnightOfDay(time: Long, daysLater: Int = 0): Long {
        val local = Calendar.getInstance().apply { timeInMillis = time }
        return Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            clear()
            // Calendar rolls a day past the month's end over into the next.
            set(local.get(Calendar.YEAR), local.get(Calendar.MONTH), local.get(Calendar.DAY_OF_MONTH) + daysLater)
        }.timeInMillis
    }

    private fun ReadableMap.text(name: String): String? =
        if (hasKey(name) && getType(name) == ReadableType.String) getString(name) else null

    // The runtime sends the times as numbers, which arrive as whichever of
    // Lynx's number types fits them.
    private fun ReadableMap.time(name: String): Long? =
        if (hasKey(name) && getType(name) in NUMBERS) getDouble(name).toLong() else null

    private fun error(code: String, message: String) = JavaOnlyMap().apply {
        putString("error", code)
        putString("message", message)
    }

    companion object {
        const val NAME = "AngularLynxCalendar"
        private val NUMBERS = setOf(ReadableType.Int, ReadableType.Long, ReadableType.Number)
    }
}
