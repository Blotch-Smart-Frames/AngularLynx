package dev.angularlynx.shell

import android.app.Activity
import android.app.Application
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import com.lynx.jsbridge.LynxContextModule
import com.lynx.jsbridge.LynxMethod
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.tasm.behavior.LynxContext

/**
 * The native module behind the runtime's `LynxMotion`, which calls it as
 * `NativeModules.AngularLynxMotion` (from the background thread, where
 * NativeModules lives). MainActivity registers it with itself as the param,
 * so the sensors stop while the activity is paused.
 *
 * `start(sensor, interval)` runs a sensor, sampling every `interval`
 * milliseconds, or changes how often; `stop(sensor)` stops it; and
 * `availability` calls back with which sensors the phone has. The sensors
 * are `acceleration` (`TYPE_ACCELEROMETER`, in m/s² with gravity), `rotation`
 * (`TYPE_GYROSCOPE`, in rad/s), `orientation` (`TYPE_GAME_ROTATION_VECTOR`,
 * which leaves the magnetometer out, as a rotation matrix), `heading`
 * (`TYPE_ROTATION_VECTOR`'s azimuth, which uses it) and `shake`, which this
 * module hears from the accelerometer itself, so a shake costs the runtime
 * one event rather than 50 samples a second. None needs a permission: the
 * runtime asks for no more than 200 Hz, past which Android 12 wants
 * HIGH_SAMPLING_RATE_SENSORS.
 *
 * The samples go to the runtime in the `angularLynxMotion` global event, one
 * map with a flat array of numbers for each sensor that sampled (see
 * `MotionBatch` in the runtime's motion.ts), at most once every 16 ms: each
 * event is work for Lynx's engine thread, where Angular runs.
 *
 * The generator leaves this file, and the lines in MainActivity that
 * register it, out of an app whose angular.json doesn't set `motion`.
 */
class MotionModule : LynxContextModule {
    // Lynx creates a module through whichever of its constructors it finds.
    constructor(context: LynxContext) : super(context) {
        activity = null
        watchLifecycle()
    }

    constructor(context: LynxContext, param: Any?) : super(context, param) {
        activity = param as? Activity
        watchLifecycle()
    }

    private val activity: Activity?

    /** Everything below belongs to this thread, where the sensors call back. */
    private val thread = HandlerThread("AngularLynxMotion").apply { start() }
    private val handler = Handler(thread.looper)
    private val sensors = mLynxContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    /** The interval each running sensor was started at, in microseconds. */
    private val requested = HashMap<String, Int>()
    /** The rate each piece of hardware was registered at, to change it only on a change. */
    private val registered = HashMap<Int, Int>()
    /** When each sensor's last sample was kept, in milliseconds. */
    private val lastSample = HashMap<String, Double>()
    private val batch = HashMap<String, MutableList<Double>>()
    private var flushScheduled = false
    private var lastFlush = 0L
    private var paused = false
    private val shakes = ShakeDetector()
    private val rotation = FloatArray(9)
    private val angles = FloatArray(3)

    private val listener =
        object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) = sample(event)

            override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit
        }

    private val lifecycle =
        object : Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(resumed: Activity) {
                if (resumed === activity) handler.post { paused = false; apply() }
            }

            override fun onActivityPaused(paused: Activity) {
                if (paused === activity) handler.post { this@MotionModule.paused = true; apply() }
            }

            override fun onActivityCreated(created: Activity, state: Bundle?) = Unit

            override fun onActivityStarted(started: Activity) = Unit

            override fun onActivityStopped(stopped: Activity) = Unit

            override fun onActivitySaveInstanceState(saved: Activity, state: Bundle) = Unit

            override fun onActivityDestroyed(destroyed: Activity) = Unit
        }

    /**
     * Stops the sensors while the activity is paused, where Lynx pauses the
     * runtime and nobody sees what they'd measure, and the battery would pay
     * for them.
     */
    private fun watchLifecycle() {
        (mLynxContext.applicationContext as? Application)?.registerActivityLifecycleCallbacks(lifecycle)
    }

    @LynxMethod
    fun start(sensor: String, interval: Double) {
        handler.post {
            requested[sensor] = (maxOf(interval, 5.0) * 1000).toInt()
            apply()
        }
    }

    @LynxMethod
    fun stop(sensor: String) {
        handler.post {
            requested.remove(sensor)
            lastSample.remove(sensor)
            apply()
        }
    }

    /** Calls back with which sensors the phone has. */
    @LynxMethod
    fun availability(callback: Callback) {
        callback.invoke(
            JavaOnlyMap().apply {
                putBoolean("acceleration", sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null)
                putBoolean("rotation", sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null)
                putBoolean("orientation", sensors.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR) != null)
                putBoolean("heading", sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) != null)
            },
        )
    }

    override fun destroy() {
        (mLynxContext.applicationContext as? Application)?.unregisterActivityLifecycleCallbacks(lifecycle)
        handler.post {
            requested.clear()
            apply()
            thread.quitSafely()
        }
        super.destroy()
    }

    /** Registers each sensor at the shortest interval anything asks of it, or not at all. */
    private fun apply() {
        val wanted = if (paused) emptyMap() else requested
        // The accelerometer serves the acceleration and the shakes.
        val accelerometer =
            listOfNotNull(wanted["acceleration"], wanted["shake"]?.let { SHAKE_INTERVAL_US }).minOrNull()
        set(Sensor.TYPE_ACCELEROMETER, accelerometer)
        set(Sensor.TYPE_GYROSCOPE, wanted["rotation"])
        set(Sensor.TYPE_GAME_ROTATION_VECTOR, wanted["orientation"])
        set(Sensor.TYPE_ROTATION_VECTOR, wanted["heading"])
    }

    private fun set(type: Int, interval: Int?) {
        if (registered[type] == interval) return
        val sensor = sensors.getDefaultSensor(type) ?: return
        if (registered.containsKey(type)) {
            sensors.unregisterListener(listener, sensor)
            registered.remove(type)
        }
        if (interval == null) return
        // The interval is a hint: Android may sample faster, which keep()
        // throttles.
        sensors.registerListener(listener, sensor, interval, handler)
        registered[type] = interval
    }

    private fun sample(event: SensorEvent) {
        val t = milliseconds(event.timestamp)
        val v = event.values
        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> {
                val (x, y, z) = Triple(v[0].toDouble(), v[1].toDouble(), v[2].toDouble())
                if (keep("acceleration", t)) add("acceleration", t, x, y, z)
                if (requested.containsKey("shake") && shakes.add(t, x, y, z)) add("shake", t)
            }
            Sensor.TYPE_GYROSCOPE ->
                if (keep("rotation", t)) add("rotation", t, v[0].toDouble(), v[1].toDouble(), v[2].toDouble())
            Sensor.TYPE_GAME_ROTATION_VECTOR ->
                if (keep("orientation", t)) {
                    // Turns a vector in the phone's frame into the earth's,
                    // row by row: the matrix the runtime reads.
                    SensorManager.getRotationMatrixFromVector(rotation, v)
                    add("orientation", t, *rotation.map { it.toDouble() }.toDoubleArray())
                }
            Sensor.TYPE_ROTATION_VECTOR ->
                if (keep("heading", t)) {
                    SensorManager.getRotationMatrixFromVector(rotation, v)
                    SensorManager.getOrientation(rotation, angles)
                    // The azimuth: where the top of the phone points, in
                    // radians clockwise from magnetic north (π/2 when it
                    // points east), from -π to π, as degrees from 0 to 360.
                    val heading = (Math.toDegrees(angles[0].toDouble()) + 360) % 360
                    // The estimated accuracy, in radians, where the sensor
                    // gives one, and -1 where it doesn't. Android has no true
                    // north without the phone's location, so that's -1.
                    val accuracy = if (v.size > 4 && v[4] >= 0) Math.toDegrees(v[4].toDouble()) else -1.0
                    add("heading", t, heading, -1.0, accuracy)
                }
        }
    }

    /**
     * Whether a sensor's sample at `t` is due, by the interval it was started
     * at, allowing a little early for the sensor's jitter. Marks it kept.
     */
    private fun keep(sensor: String, t: Double): Boolean {
        val interval = requested[sensor] ?: return false
        val last = lastSample[sensor]
        if (last != null && t - last < interval / 1000.0 * 0.75) return false
        lastSample[sensor] = t
        return true
    }

    /** Adds a sample to the next event, which goes at most every 16 ms. */
    private fun add(sensor: String, vararg values: Double) {
        batch.getOrPut(sensor) { ArrayList() }.addAll(values.toList())
        if (flushScheduled) return
        flushScheduled = true
        val wait = maxOf(0L, lastFlush + FLUSH_INTERVAL_MS - SystemClock.uptimeMillis())
        handler.postDelayed({ flush() }, wait)
    }

    private fun flush() {
        flushScheduled = false
        lastFlush = SystemClock.uptimeMillis()
        if (batch.isEmpty()) return
        val map = JavaOnlyMap()
        for ((sensor, values) in batch) {
            map.putArray(sensor, JavaOnlyArray().apply { values.forEach { pushDouble(it) } })
        }
        batch.clear()
        mLynxContext.sendGlobalEvent(EVENT, JavaOnlyArray().apply { pushMap(map) })
    }

    /**
     * A sensor event's time (nanoseconds since the phone started, on
     * elapsedRealtimeNanos' clock) in milliseconds since the epoch, as the
     * runtime's `Date.now()` counts.
     */
    private fun milliseconds(timestamp: Long): Double =
        System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - timestamp) / 1_000_000.0

    companion object {
        const val NAME = "AngularLynxMotion"
        const val EVENT = "angularLynxMotion"

        /** The least time between events, about a frame. */
        private const val FLUSH_INTERVAL_MS = 16L

        /** How often the accelerometer samples for shakes: the runtime's `SHAKE.intervalMs`. */
        private const val SHAKE_INTERVAL_US = 20_000
    }
}

/**
 * Hears a shake in accelerometer samples: the runtime's `ShakeDetector`
 * (`motion/motion-math.ts`), after Square's Seismic. A sample accelerates
 * past 13 m/s², and the phone is shaking when three quarters of the samples
 * of the last half second do, over a quarter of a second or more.
 */
private class ShakeDetector {
    private val times = ArrayDeque<Double>()
    private val fast = ArrayDeque<Boolean>()
    private var accelerating = 0
    private var quietUntil = Double.NEGATIVE_INFINITY

    fun add(t: Double, x: Double, y: Double, z: Double): Boolean {
        val accelerates = x * x + y * y + z * z > 13.0 * 13.0
        times.addLast(t)
        fast.addLast(accelerates)
        if (accelerates) accelerating++
        while (times.isNotEmpty() && times.first() < t - 500) {
            times.removeFirst()
            if (fast.removeFirst()) accelerating--
        }
        if (t < quietUntil) return false
        if (times.size < 4 || t - times.first() < 250 || accelerating * 4 < times.size * 3) return false
        times.clear()
        fast.clear()
        accelerating = 0
        quietUntil = t + 750
        return true
    }
}
