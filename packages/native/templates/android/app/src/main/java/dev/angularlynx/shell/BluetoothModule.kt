package dev.angularlynx.shell

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattConnectionSettings
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.util.forEach
import com.lynx.jsbridge.LynxContextModule
import com.lynx.jsbridge.LynxMethod
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.lynx.tasm.behavior.LynxContext
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The native module behind the runtime's `LynxBluetooth`, which calls it as
 * `NativeModules.AngularLynxBluetooth` (from the background thread, where
 * NativeModules lives): a Bluetooth LE central, which scans for peripherals,
 * connects to them, and reads, writes and subscribes to their
 * characteristics while the app is open.
 *
 * Only an app whose angular.json sets `permissions.bluetooth` has this file.
 * The generator deletes it from every other app, whose manifest then declares
 * no Bluetooth permission either, and MainActivity registers it by name only
 * when it's there, so nothing else may name the class.
 *
 * Each method calls back once: with its result, or with `{ error, message }`,
 * as the iOS module does. The rest arrives as `angularLynxBluetooth` global
 * events, each an object with a `type`: the adapter's `state`, a scanned
 * `device` and a `scanStopped`, each with the `scan` id startScan's options
 * gave it, a `disconnected` the app didn't ask for, and a
 * characteristic's `value` notifications. UUIDs travel as lowercase 128-bit
 * strings (how Java's UUID prints them), bytes as base64, and a device's id
 * is its address, as Android gives it.
 *
 * Android runs one GATT operation at a time on a connection: one started
 * before the last one's callback is refused (the call returns false). So each
 * connection queues its operations, those of connecting included, and starts
 * the next as the last one answers.
 */
// Lint's MissingPermission check wants every Bluetooth call next to a
// permission check it can see. Here that check is whenReady(), which each
// method that scans or connects goes through first (asking for the
// permissions when they're missing), and lint can't follow it through the
// callbacks and queued operations that make the calls. A permission revoked
// anyway surfaces as a SecurityException, which is answered `unauthorized`.
@SuppressLint("MissingPermission")
class BluetoothModule : LynxContextModule {
    // Lynx creates a module through whichever of its constructors it finds.
    constructor(context: LynxContext) : super(context)
    constructor(context: LynxContext, param: Any?) : super(context, param)

    private val appContext: Context = mContext.applicationContext
    private val adapter: BluetoothAdapter? =
        appContext.getSystemService(BluetoothManager::class.java)?.adapter
    private val supported =
        adapter != null && appContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)

    // Every field below is read and written on this one thread. The methods
    // (which Lynx calls from its JavaScript thread), Android's GATT and scan
    // callbacks (from binder threads) and the adapter's broadcasts all post
    // to it, so nothing needs a lock and a callback can't race the call that
    // queued its operation. It's a thread of its own rather than the UI
    // thread, so a fast stream of notifications can't take frames from it.
    private val thread = HandlerThread(TAG).apply { start() }
    private val bluetooth = Handler(thread.looper)

    // The activity's permission prompt runs on the UI thread.
    private val main = Handler(Looper.getMainLooper())

    // Set once Lynx destroys the module: nothing is posted or sent after it.
    @Volatile
    private var destroyed = false

    // What scanning and connecting need at this API level. Android 12 gave
    // Bluetooth permissions of its own; before it, a scan's results counted
    // as the phone's location, so they needed ACCESS_FINE_LOCATION.
    private val permissions: Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }

    // Whether the person refused the permissions when requestPermission (or
    // a scan or connection) asked. Android can't tell an app whether a
    // permission it doesn't hold was ever asked for, so until this module has
    // asked, the state is `unknown` rather than `unauthorized`, which tells the
    // app that asking may still work.
    private var refused = false

    // Who's waiting for the permission prompt this module has open, so a
    // second scan or connection joins it instead of opening another.
    private val askers = mutableListOf<(Answer) -> Unit>()

    // The state the app last heard, so a `state` event goes out only when it
    // changes.
    private var reportedState: String? = null

    // The running scan (stopScan, or a new startScan, replaces it), when each
    // device it found was last reported, and the names they advertised, which
    // connect() reports when Android has no name of its own for the device.
    private var scan: ScanListener? = null

    // The id of the newest startScan. A start still waiting for the
    // permission prompt when a newer one arrives doesn't start: the runtime
    // has replaced its scan already, and the newer one may be running.
    private var newestScan = 0
    private val sightings = HashMap<String, Long>()
    private val advertisedNames = HashMap<String, String>()

    private val connections = HashMap<String, Connection>()

    // The adapter turning on and off. It's registered with the module's
    // thread, so it arrives there.
    private val adapterStates = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            guarded {
                when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
                    BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> poweredOff()
                }
                stateChanged()
            }
        }
    }

    init {
        post {
            reportedState = state()
            // A broadcast only the system sends needs neither
            // RECEIVER_EXPORTED nor RECEIVER_NOT_EXPORTED, which apps
            // targeting Android 14 must otherwise choose between.
            appContext.registerReceiver(
                adapterStates,
                IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
                null,
                bluetooth,
            )
        }
    }

    /** `{ state }`, without asking for anything. */
    @LynxMethod
    fun getState(callback: Callback) = serve(callback) { reply ->
        stateChanged()
        reply.ok(stateResult())
    }

    /**
     * Asks for the permissions this API level needs, unless they're granted,
     * and answers `{ state }` once the person has chosen.
     */
    @LynxMethod
    fun requestPermission(callback: Callback) = serve(callback) { reply ->
        if (!supported || permitted()) {
            stateChanged()
            return@serve reply.ok(stateResult())
        }
        ask { answer ->
            when (answer) {
                Answer.ANSWERED -> reply.ok(stateResult())
                Answer.BUSY -> reply.fail(BUSY, PROMPT_OPEN)
                Answer.CLOSED -> reply.fail(FAILED, PAGE_CLOSED)
            }
        }
    }

    /**
     * Scans for peripherals advertising any of `options.services`, or every
     * one when it's empty, and answers `{}` once the scan runs. Its events
     * carry `options.scan`, so the runtime can tell them from those of the
     * scan it replaced. A scan already running ends first, without a
     * `scanStopped` event, even when this one can't start: the runtime has
     * let go of it. A start that waited for the permission prompt answers
     * `{}` without scanning when a newer one came in meanwhile.
     */
    @LynxMethod
    fun startScan(options: ReadableMap?, callback: Callback) = serve(callback) { reply ->
        stopScanning()
        val id = options?.getDouble("scan", 0.0)?.toInt() ?: 0
        newestScan = id
        val services = try {
            uuids(options?.getArray("services", null)?.let { list -> (0 until list.size()).map { list.getString(it) } })
        } catch (_: IllegalArgumentException) {
            return@serve reply.fail(FAILED, "A service to scan for isn't a UUID.")
        }
        whenReady(reply) { adapter ->
            if (id != newestScan) return@whenReady reply.ok()
            if (locationOff()) return@whenReady reply.fail(FAILED, LOCATION_OFF)
            // Null while the adapter is off, which whenReady() just ruled out,
            // but it can be turning off.
            val scanner = adapter.bluetoothLeScanner ?: return@whenReady reply.fail(POWERED_OFF, POWERED_OFF_MESSAGE)
            // One filter per service, which Android matches in the radio's
            // firmware where it can, so the app isn't woken for the rest.
            val filters = services.map { ScanFilter.Builder().setServiceUuid(ParcelUuid(it)).build() }
            // Low latency: the app scans while the person waits for a device
            // to appear, and only while it's open.
            val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
            val listener = ScanListener(id)
            // Android lets an app start about five scans in 30 seconds and
            // silently returns nothing from the ones after that: there's no
            // error to report.
            scanner.startScan(filters.ifEmpty { null }, settings, listener)
            scan = listener
            sightings.clear()
            reply.ok()
        }
    }

    /** Ends the scan, and answers `{}` whether one was running or not. */
    @LynxMethod
    fun stopScan(callback: Callback) = serve(callback) { reply ->
        stopScanning()
        reply.ok()
    }

    /**
     * Connects to the device [id], requests the largest MTU, discovers its
     * services and characteristics, and answers with them (see [describe]).
     * `options.timeout` (ms) covers all of it; past it, the connection is
     * canceled and the answer is `timeout`. A device already connected, or
     * connecting, answers when that connection is ready, without a second one.
     */
    @LynxMethod
    fun connect(id: String, options: ReadableMap?, callback: Callback) = serve(callback) { reply ->
        val timeout = options?.getDouble("timeout", 0.0)?.toLong()?.takeIf { it > 0 } ?: DEFAULT_CONNECT_TIMEOUT_MS
        whenReady(reply) { adapter ->
            connections[id]?.let { existing ->
                if (!existing.disconnecting) {
                    if (existing.ready) reply.ok(describe(existing)) else existing.connecting += reply
                    return@whenReady
                }
                // disconnect() is still waiting for Android to confirm: end
                // that connection now, and start afresh.
                drop(existing, null)
            }
            if (!BluetoothAdapter.checkBluetoothAddress(id)) {
                return@whenReady reply.fail(NOT_FOUND, "There's no Bluetooth device with the id $id.")
            }
            val device = adapter.getRemoteDevice(id)
            val connection = Connection(id, device)
            connection.connecting += reply
            connections[id] = connection
            connection.deadline = later(timeout) {
                drop(connection, Failure(TIMEOUT, "The device didn't connect in time."))
            }
            val gatt = try {
                openGatt(device, GattListener(connection))
            } catch (_: SecurityException) {
                return@whenReady drop(connection, Failure(UNAUTHORIZED, UNAUTHORIZED_MESSAGE))
            }
            if (gatt == null) return@whenReady drop(connection, Failure(FAILED, "Android couldn't start connecting."))
            connection.gatt = gatt
        }
    }

    /**
     * Ends the connection to [id], answering `{}` once Android says it's
     * closed, or at once when there's none. It sends no `disconnected` event.
     */
    @LynxMethod
    fun disconnect(id: String, callback: Callback) = serve(callback) { reply ->
        val connection = connections[id] ?: return@serve reply.ok()
        connection.disconnects += reply
        if (connection.disconnecting) return@serve
        connection.disconnecting = true
        val gatt = connection.gatt
        // Android may never call back for a connection it hadn't made yet,
        // so that one closes at once.
        if (gatt == null || !connection.linked) return@serve drop(connection, null)
        try {
            gatt.disconnect()
        } catch (_: SecurityException) {
            return@serve drop(connection, null)
        }
        // Closing a GATT client before its disconnection is confirmed can
        // leave the link up for a while, and a reconnection soon after
        // fails. But Android doesn't always confirm, so it doesn't wait long.
        connection.deadline?.let(bluetooth::removeCallbacks)
        connection.deadline = later(DISCONNECT_TIMEOUT_MS) { drop(connection, null) }
    }

    /** Reads a characteristic and answers `{ value }`. */
    @LynxMethod
    fun read(id: String, service: String, characteristic: String, callback: Callback) = serve(callback) { reply ->
        val (connection, target) = find(id, service, characteristic, reply) ?: return@serve
        if (target.properties and BluetoothGattCharacteristic.PROPERTY_READ == 0) {
            return@serve reply.fail(FAILED, "The characteristic $characteristic can't be read.")
        }
        enqueue(
            connection,
            Op(
                OpKind.READ,
                start = { gatt -> if (gatt.readCharacteristic(target)) null else notStarted("the read") },
                finish = { failure, value ->
                    if (failure != null) {
                        reply.fail(failure)
                    } else {
                        reply.ok(JavaOnlyMap().apply { putString("value", base64(value ?: ByteArray(0))) })
                    }
                },
            ),
        )
    }

    /**
     * Writes [value] (base64) to a characteristic, and answers `{}` once the
     * device confirms it ([withResponse]) or once Android has sent it.
     */
    @LynxMethod
    fun write(
        id: String,
        service: String,
        characteristic: String,
        value: String,
        withResponse: Boolean,
        callback: Callback,
    ) = serve(callback) { reply ->
        val bytes = try {
            Base64.decode(value, Base64.DEFAULT)
        } catch (_: IllegalArgumentException) {
            return@serve reply.fail(FAILED, "The value to write isn't base64.")
        }
        val (connection, target) = find(id, service, characteristic, reply) ?: return@serve
        val property = if (withResponse) {
            BluetoothGattCharacteristic.PROPERTY_WRITE
        } else {
            BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE
        }
        if (target.properties and property == 0) {
            val kind = if (withResponse) "writes with a response" else "writes without a response"
            return@serve reply.fail(FAILED, "The characteristic $characteristic doesn't take $kind.")
        }
        // A write with a response can be long (Android splits it), up to an
        // attribute's largest value; one without has to fit in a packet. A
        // longer one would be cut short without a word.
        val limit = if (withResponse) MAX_ATTRIBUTE_LENGTH else maxWriteLength(connection)
        if (bytes.size > limit) {
            return@serve reply.fail(FAILED, "The value is ${bytes.size} bytes, and this write takes at most $limit.")
        }
        val type = if (withResponse) {
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        } else {
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        }
        enqueue(
            connection,
            Op(
                OpKind.WRITE,
                start = { gatt -> writeCharacteristic(gatt, target, bytes, type) },
                finish = { failure, _ -> reply.done(failure) },
            ),
        )
    }

    /**
     * Subscribes to a characteristic's notifications, or its indications when
     * it has only those, or ends the subscription, and answers `{}` once the
     * device has the new setting. Each one then arrives as a `value` event.
     */
    @LynxMethod
    fun setNotifications(
        id: String,
        service: String,
        characteristic: String,
        enabled: Boolean,
        callback: Callback,
    ) = serve(callback) { reply ->
        val (connection, target) = find(id, service, characteristic, reply) ?: return@serve
        val notifies = target.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0
        val indicates = target.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0
        if (!notifies && !indicates) {
            return@serve reply.fail(FAILED, "The characteristic $characteristic sends no notifications.")
        }
        // The device sends them once its Client Characteristic Configuration
        // descriptor says so. A device that breaks the spec and has none may
        // send them anyway: Android then only needs to pass them on.
        val descriptor = target.getDescriptor(CLIENT_CONFIGURATION)
        if (descriptor == null) {
            val gatt = connection.gatt ?: return@serve reply.fail(NOT_CONNECTED, "The device $id isn't connected.")
            if (!gatt.setCharacteristicNotification(target, enabled)) {
                return@serve reply.fail(notStarted("the subscription"))
            }
            return@serve reply.ok()
        }
        val setting = when {
            !enabled -> BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            notifies -> BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            else -> BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
        }
        enqueue(
            connection,
            Op(
                OpKind.DESCRIPTOR,
                start = { gatt ->
                    // Android passes the characteristic's notifications on only
                    // once it's told to, which isn't a GATT operation.
                    if (gatt.setCharacteristicNotification(target, enabled)) {
                        writeDescriptor(gatt, descriptor, setting)
                    } else {
                        notStarted("the subscription")
                    }
                },
                finish = { failure, _ -> reply.done(failure) },
            ),
        )
    }

    // Lynx destroys the module with its page (and the debug build's reload):
    // the scan ends, every connection closes, and the thread goes. Nobody's
    // left to hear about it, so there are no events.
    override fun destroy() {
        destroyed = true
        bluetooth.post {
            guarded {
                try {
                    appContext.unregisterReceiver(adapterStates)
                } catch (_: IllegalArgumentException) {
                    // It wasn't registered: the module went before it started.
                }
                stopScanning()
                connections.values.toList().forEach {
                    it.disconnecting = true
                    drop(it, Failure(FAILED, PAGE_CLOSED))
                }
                askers.toList().also { askers.clear() }.forEach { it(Answer.CLOSED) }
            }
        }
        // Runs what's posted before it, the teardown above included.
        thread.quitSafely()
        super.destroy()
    }

    // State

    private fun permitted() = permissions.all {
        ContextCompat.checkSelfPermission(appContext, it) == PackageManager.PERMISSION_GRANTED
    }

    private fun state(): String {
        val adapter = adapter
        if (!supported || adapter == null) return "unsupported"
        if (!permitted()) return if (refused) "unauthorized" else "unknown"
        return try {
            // TURNING_ON and TURNING_OFF are off: nothing can scan or connect
            // until it's on.
            if (adapter.state == BluetoothAdapter.STATE_ON) "poweredOn" else "poweredOff"
        } catch (_: SecurityException) {
            "unauthorized"
        }
    }

    private fun stateResult() = JavaOnlyMap().apply { putString("state", state()) }

    /** Sends a `state` event when the state isn't what the app last heard. */
    private fun stateChanged() {
        val state = state()
        if (state == reportedState) return
        reportedState = state
        emit("state") { putString("state", state) }
    }

    /**
     * Runs [action] once the app can scan and connect: on a device with
     * Bluetooth LE, with the permissions granted (asked for first when
     * they're missing), and with the adapter on. Otherwise [reply] answers
     * why not.
     */
    private fun whenReady(reply: Reply, action: (BluetoothAdapter) -> Unit) {
        val adapter = adapter
        if (!supported || adapter == null) return reply.fail(UNSUPPORTED, "This device has no Bluetooth LE.")
        if (!permitted()) {
            return ask { answer ->
                when {
                    answer == Answer.BUSY -> reply.fail(BUSY, PROMPT_OPEN)
                    answer == Answer.CLOSED -> reply.fail(FAILED, PAGE_CLOSED)
                    permitted() -> whenReady(reply, action)
                    else -> reply.fail(UNAUTHORIZED, UNAUTHORIZED_MESSAGE)
                }
            }
        }
        val on = try {
            adapter.isEnabled
        } catch (_: SecurityException) {
            return reply.fail(UNAUTHORIZED, UNAUTHORIZED_MESSAGE)
        }
        if (!on) return reply.fail(POWERED_OFF, POWERED_OFF_MESSAGE)
        action(adapter)
    }

    /**
     * Shows Android's permission prompt through the activity, and calls
     * [done] on the module's thread once it's answered. While this module's
     * prompt is open, a second call waits for the same answer.
     */
    private fun ask(done: (Answer) -> Unit) {
        askers += done
        if (askers.size > 1) return
        val host = mParam as? PermissionHost
        main.post {
            // The page can close first, unregistering the activity's
            // launcher, which then throws: destroy() has answered the calls
            // waiting already.
            if (destroyed) return@post
            val asked = host?.requestPermissions(permissions) { post { answered(Answer.ANSWERED) } } ?: false
            // No host can't ask, which is as good as refused; another
            // module's prompt being open is only for now.
            if (!asked) post { answered(if (host == null) Answer.ANSWERED else Answer.BUSY) }
        }
    }

    private fun answered(answer: Answer) {
        if (answer == Answer.ANSWERED) refused = !permitted()
        val waiting = askers.toList()
        askers.clear()
        stateChanged()
        waiting.forEach { it(answer) }
    }

    // Android 6 to 11 return no scan results while Location is off, and
    // don't say so: the scan just finds nothing. Android 12's BLUETOOTH_SCAN,
    // which the manifest declares as never used for location, ended that.
    private fun locationOff(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return false
        val manager = appContext.getSystemService(LocationManager::class.java) ?: return false
        return !LocationManagerCompat.isLocationEnabled(manager)
    }

    /** The adapter is going off: the scan and every connection end with it. */
    private fun poweredOff() {
        val failure = Failure(POWERED_OFF, "Bluetooth was turned off.")
        scan?.let { listener ->
            stopScanning()
            emit("scanStopped") {
                putInt("scan", listener.id)
                putString("error", failure.code)
                putString("message", failure.message)
            }
        }
        // Android usually reports each connection closing as the adapter goes
        // off, but not on every version, so they end here.
        connections.values.toList().forEach { drop(it, failure) }
    }

    // Scanning

    private fun stopScanning() {
        val listener = scan ?: return
        scan = null
        try {
            // Null once the adapter is off, which has ended the scan already.
            adapter?.bluetoothLeScanner?.stopScan(listener)
        } catch (_: SecurityException) {
        } catch (_: IllegalStateException) {
            // The adapter went off just now, taking the scan with it.
        }
    }

    /** A scan's callback, and the id the runtime gave the scan. */
    private inner class ScanListener(val id: Int) : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) = post {
            if (scan === this) sighted(result, id)
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>) = post {
            if (scan === this) results.forEach { sighted(it, id) }
        }

        override fun onScanFailed(errorCode: Int) = post {
            if (scan !== this) return@post
            scan = null
            emit("scanStopped") {
                putInt("scan", id)
                putString("error", FAILED)
                putString("message", scanFailure(errorCode))
            }
        }
    }

    /**
     * Sends a `device` event for [result]: the first time the scan sees the
     * device, then at most once per [SIGHTING_INTERVAL_MS]. A device
     * advertises many times a second, and the app needs only its latest
     * signal strength and data. [scan] is the id of the scan that saw it.
     */
    private fun sighted(result: ScanResult, scan: Int) {
        val device = result.device
        val id = device.address
        val now = SystemClock.elapsedRealtime()
        val last = sightings[id]
        if (last != null && now - last < SIGHTING_INTERVAL_MS) return
        sightings[id] = now
        val record = result.scanRecord
        val name = record?.deviceName ?: deviceName(device)
        if (name != null) advertisedNames[id] = name
        val sighting = JavaOnlyMap().apply {
            putString("id", id)
            putNullableString("name", name)
            putInt("rssi", result.rssi)
            putArray(
                "services",
                JavaOnlyArray().apply { record?.serviceUuids?.forEach { pushString(it.uuid.toString()) } },
            )
            putMap(
                "serviceData",
                JavaOnlyMap().apply {
                    record?.serviceData?.forEach { (uuid, bytes) ->
                        putString(uuid.uuid.toString(), base64(bytes ?: ByteArray(0)))
                    }
                },
            )
            // Keyed by the company's Bluetooth SIG id, which Android has
            // already split off the front of the data.
            putMap(
                "manufacturerData",
                JavaOnlyMap().apply {
                    record?.manufacturerSpecificData?.forEach { company, bytes ->
                        putString(company.toString(), base64(bytes ?: ByteArray(0)))
                    }
                },
            )
        }
        emit("device") {
            putInt("scan", scan)
            putMap("device", sighting)
        }
    }

    // Connections

    private inner class Connection(val id: String, val device: BluetoothDevice) {
        var gatt: BluetoothGatt? = null

        // Android reported the link up; services may still be undiscovered.
        var linked = false

        // Services discovered: connect() has answered, and the app can use it.
        var ready = false

        // disconnect() asked for it to end.
        var disconnecting = false

        // Ended: nothing it posts afterwards counts.
        var closed = false

        // The ATT MTU, which the default stays at until requestMtu() raises it.
        var mtu = DEFAULT_MTU

        val connecting = mutableListOf<Reply>()
        val disconnects = mutableListOf<Reply>()

        // The GATT operation Android is running, and those waiting for it.
        var current: Op? = null
        val queue = ArrayDeque<Op>()

        // connect()'s timeout, then disconnect()'s, and the running
        // operation's.
        var deadline: Runnable? = null
        var watchdog: Runnable? = null
    }

    private inner class GattListener(private val connection: Connection) : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) = post {
            linkChanged(connection, status, newState)
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) = post {
            // The device can start an exchange of its own too, which also
            // lands here.
            if (status == BluetoothGatt.GATT_SUCCESS) connection.mtu = mtu
            // A failed exchange leaves the default MTU, which still works.
            finished(connection, OpKind.MTU, null, null)
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) = post {
            finished(connection, OpKind.DISCOVER, gattFailure(status), null)
        }

        // Android 13 and later: the value comes with the callback.
        override fun onCharacteristicRead(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
            status: Int,
        ) = post {
            finished(connection, OpKind.READ, gattFailure(status), value)
        }

        // Before Android 13, the value is on the characteristic, which the
        // next read or notification overwrites: copied here, on the binder
        // thread, before anything else can arrive.
        @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
        override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return
            val value = characteristic.value?.copyOf()
            post { finished(connection, OpKind.READ, gattFailure(status), value) }
        }

        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) =
            post { finished(connection, OpKind.WRITE, gattFailure(status), null) }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) =
            post { finished(connection, OpKind.DESCRIPTOR, gattFailure(status), null) }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) = post {
            notified(connection, characteristic, value)
        }

        @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return
            val value = characteristic.value?.copyOf() ?: return
            post { notified(connection, characteristic, value) }
        }
    }

    private fun linkChanged(connection: Connection, status: Int, newState: Int) {
        if (connection.closed) return
        if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
            if (connection.linked) return
            connection.linked = true
            setUp(connection)
            return
        }
        if (newState == BluetoothProfile.STATE_CONNECTED) {
            // Up, but with an error: Android won't use it.
            return drop(connection, linkFailure(status))
        }
        if (newState != BluetoothProfile.STATE_DISCONNECTED) return
        // A clean disconnection (status 0) the app didn't ask for has no
        // error: another app or the system ended it.
        drop(connection, if (status == BluetoothGatt.GATT_SUCCESS) null else linkFailure(status))
    }

    /**
     * The link is up: requests the largest MTU, so a write without a
     * response carries more than 20 bytes, then discovers the services,
     * through the queue like any other operation.
     */
    private fun setUp(connection: Connection) {
        enqueue(
            connection,
            Op(
                OpKind.MTU,
                start = { gatt -> if (gatt.requestMtu(MAX_MTU)) null else notStarted("the MTU request") },
                // The default MTU still works, only in smaller packets.
                finish = { _, _ -> },
            ),
        )
        enqueue(
            connection,
            Op(
                OpKind.DISCOVER,
                start = { gatt -> if (gatt.discoverServices()) null else notStarted("service discovery") },
                finish = discovered@{ failure, _ ->
                    if (connection.closed) return@discovered
                    if (failure != null) return@discovered drop(connection, failure)
                    connection.ready = true
                    connection.deadline?.let(bluetooth::removeCallbacks)
                    connection.deadline = null
                    val waiting = connection.connecting.toList()
                    connection.connecting.clear()
                    waiting.forEach { it.ok(describe(connection)) }
                },
            ),
        )
    }

    /**
     * Ends [connection]: closes its GATT client (Android allows each app a
     * few, and keeps one open until it's closed, even once its link is
     * gone), fails everything waiting on it, answers disconnect(), and sends
     * a `disconnected` event when connect() had answered and disconnect()
     * didn't ask. [reason] is why it ended, null when nothing went wrong.
     */
    private fun drop(connection: Connection, reason: Failure?) {
        if (connection.closed) return
        connection.closed = true
        if (connections[connection.id] === connection) connections.remove(connection.id)
        connection.deadline?.let(bluetooth::removeCallbacks)
        connection.watchdog?.let(bluetooth::removeCallbacks)
        connection.gatt?.let { gatt ->
            // Separately, so a refused disconnect() still closes the client.
            try {
                gatt.disconnect()
            } catch (_: SecurityException) {
            }
            try {
                gatt.close()
            } catch (_: SecurityException) {
            }
        }
        val operations = listOfNotNull(connection.current) + connection.queue
        connection.current = null
        connection.queue.clear()
        val gone = Failure(NOT_CONNECTED, reason?.message ?: "The device disconnected.")
        operations.forEach { it.finish(gone, null) }
        val unfinished = when {
            reason != null -> reason
            connection.disconnecting -> Failure(FAILED, "disconnect() ended the connection before it was ready.")
            else -> Failure(FAILED, "The device disconnected before it was ready.")
        }
        connection.connecting.forEach { it.fail(unfinished) }
        connection.disconnects.forEach { it.ok() }
        if (connection.ready && !connection.disconnecting) {
            emit("disconnected") {
                putString("id", connection.id)
                if (reason != null) {
                    putString("error", reason.code)
                    putString("message", reason.message)
                }
            }
        }
    }

    /**
     * The most bytes a write without response carries: what fits in a packet
     * at the connection's MTU, but never more than an attribute holds, which
     * a large MTU would otherwise allow.
     */
    private fun maxWriteLength(connection: Connection) =
        minOf(connection.mtu - ATT_HEADER_LENGTH, MAX_ATTRIBUTE_LENGTH)

    /**
     * connect()'s answer: `{ id, name, maxWriteLength, services }`, each
     * service with its characteristics and what each one can do.
     */
    private fun describe(connection: Connection) = JavaOnlyMap().apply {
        putString("id", connection.id)
        // What the scan saw it advertise, as on iOS, else the name Android
        // keeps for the device.
        putNullableString("name", advertisedNames[connection.id] ?: deviceName(connection.device))
        putInt("maxWriteLength", maxWriteLength(connection))
        putArray(
            "services",
            JavaOnlyArray().apply {
                connection.gatt?.services?.forEach { service ->
                    pushMap(
                        JavaOnlyMap().apply {
                            putString("uuid", service.uuid.toString())
                            putArray(
                                "characteristics",
                                JavaOnlyArray().apply {
                                    service.characteristics.forEach { characteristic ->
                                        pushMap(
                                            JavaOnlyMap().apply {
                                                putString("uuid", characteristic.uuid.toString())
                                                putArray("properties", properties(characteristic.properties))
                                            },
                                        )
                                    }
                                },
                            )
                        },
                    )
                }
            },
        )
    }

    /**
     * The connection and characteristic a read, write or subscription is
     * for, or null once [reply] has answered why there's none.
     */
    private fun find(
        id: String,
        service: String,
        characteristic: String,
        reply: Reply,
    ): Pair<Connection, BluetoothGattCharacteristic>? {
        val connection = connections[id]?.takeIf { it.ready && !it.disconnecting }
        if (connection == null) {
            reply.fail(NOT_CONNECTED, "The device $id isn't connected.")
            return null
        }
        val (serviceUuid, characteristicUuid) = try {
            UUID.fromString(service) to UUID.fromString(characteristic)
        } catch (_: IllegalArgumentException) {
            reply.fail(FAILED, "$service or $characteristic isn't a UUID.")
            return null
        }
        val found = connection.gatt?.getService(serviceUuid)?.getCharacteristic(characteristicUuid)
        if (found == null) {
            reply.fail(NOT_FOUND, "The device has no characteristic $characteristic in service $service.")
            return null
        }
        return connection to found
    }

    private fun notified(connection: Connection, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
        if (connection.closed) return
        emit("value") {
            putString("id", connection.id)
            putString("service", characteristic.service?.uuid?.toString() ?: "")
            putString("characteristic", characteristic.uuid.toString())
            putString("value", base64(value))
        }
    }

    // The GATT queue

    private enum class OpKind { MTU, DISCOVER, READ, WRITE, DESCRIPTOR }

    /**
     * A GATT operation: [start] hands it to Android, returning null once
     * Android has it or why it was refused, and [finish] is called once,
     * with what came back or why nothing did.
     */
    private class Op(
        val kind: OpKind,
        val start: (BluetoothGatt) -> Failure?,
        val finish: (Failure?, ByteArray?) -> Unit,
    )

    private fun enqueue(connection: Connection, op: Op) {
        connection.queue.addLast(op)
        next(connection)
    }

    /**
     * Starts the next queued operation, unless one is running or the
     * connection is ending: drop() answers those still queued.
     */
    private fun next(connection: Connection) {
        while (!connection.closed && !connection.disconnecting && connection.current == null) {
            val op = connection.queue.removeFirstOrNull() ?: return
            val gatt = connection.gatt ?: return op.finish(Failure(NOT_CONNECTED, "The device isn't connected."), null)
            val rejected = try {
                op.start(gatt)
            } catch (_: SecurityException) {
                Failure(UNAUTHORIZED, UNAUTHORIZED_MESSAGE)
            }
            if (rejected == null) {
                connection.current = op
                connection.watchdog = later(OPERATION_TIMEOUT_MS) {
                    if (connection.current === op) {
                        // The stuck operation answers `timeout`; the rest,
                        // which never started, `notConnected`.
                        val failure = Failure(TIMEOUT, "The device stopped answering.")
                        connection.current = null
                        op.finish(failure, null)
                        drop(connection, failure)
                    }
                }
                return
            }
            // Refused before it began: the next one can start.
            op.finish(rejected, null)
        }
    }

    /**
     * Android answered the running operation, if it's of [kind]: one of
     * another kind is a callback nothing here asked for, such as an MTU
     * exchange the device started.
     */
    private fun finished(connection: Connection, kind: OpKind, failure: Failure?, value: ByteArray?) {
        if (connection.closed) return
        val op = connection.current ?: return
        if (op.kind != kind) return
        connection.current = null
        connection.watchdog?.let(bluetooth::removeCallbacks)
        connection.watchdog = null
        op.finish(failure, value)
        next(connection)
    }

    /**
     * Starts connecting to [device]. Not autoConnect, which waits for the
     * device indefinitely and connects slowly: the app is waiting on this
     * one. LE transport, as a dual-mode device would otherwise get a classic
     * link.
     */
    @Suppress("DEPRECATION")
    private fun openGatt(device: BluetoothDevice, listener: BluetoothGattCallback): BluetoothGatt? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.CINNAMON_BUN) {
            // Android 17's settings would also start an MTU exchange of their
            // own; the queue's requestMtu() is the only one, so its answer is
            // the one it waits for. Callbacks run where Android delivers
            // them, as before Android 17, and the listener posts them on.
            val settings = BluetoothGattConnectionSettings.Builder()
                .setAutoConnectEnabled(false)
                .setTransport(BluetoothDevice.TRANSPORT_LE)
                .setAutomaticMtuEnabled(false)
                .build()
            return device.connectGatt(settings, Runnable::run, listener)
        }
        return device.connectGatt(appContext, false, listener, BluetoothDevice.TRANSPORT_LE)
    }

    // Android 13 replaced the calls that took the value through the
    // characteristic or descriptor, which another thread could change in
    // between, with ones that take it as an argument and say why they refused.
    @Suppress("DEPRECATION")
    private fun writeCharacteristic(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
        type: Int,
    ): Failure? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return statusFailure(gatt.writeCharacteristic(characteristic, value, type), "the write")
        }
        characteristic.writeType = type
        characteristic.setValue(value)
        return if (gatt.writeCharacteristic(characteristic)) null else notStarted("the write")
    }

    @Suppress("DEPRECATION")
    private fun writeDescriptor(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, value: ByteArray): Failure? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return statusFailure(gatt.writeDescriptor(descriptor, value), "the subscription")
        }
        descriptor.setValue(value)
        return if (gatt.writeDescriptor(descriptor)) null else notStarted("the subscription")
    }

    // Threads and events

    private fun post(work: () -> Unit) {
        if (!destroyed) bluetooth.post { guarded(work) }
    }

    private fun later(delayMs: Long, work: () -> Unit): Runnable =
        Runnable { guarded(work) }.also { bluetooth.postDelayed(it, delayMs) }

    /**
     * Runs [work], logging what it throws instead: an exception on the
     * module's thread would otherwise end the app.
     */
    private fun guarded(work: () -> Unit) {
        try {
            work()
        } catch (error: RuntimeException) {
            Log.w(TAG, "Bluetooth failed", error)
        }
    }

    /**
     * Runs a method's [work] on the module's thread, with its callback
     * wrapped so it answers once whatever happens: an exception the work
     * didn't expect answers `failed` (or `unauthorized`, for a permission
     * Android says is missing) rather than ending the app.
     */
    private fun serve(callback: Callback, work: (Reply) -> Unit) {
        val reply = Reply(callback)
        val posted = !destroyed && bluetooth.post {
            try {
                work(reply)
            } catch (_: SecurityException) {
                reply.fail(UNAUTHORIZED, UNAUTHORIZED_MESSAGE)
            } catch (error: RuntimeException) {
                Log.w(TAG, "Bluetooth failed", error)
                reply.fail(FAILED, error.message ?: "Bluetooth failed.")
            }
        }
        if (!posted) reply.fail(FAILED, PAGE_CLOSED)
    }

    private fun emit(type: String, fill: JavaOnlyMap.() -> Unit) {
        if (destroyed) return
        val payload = JavaOnlyMap().apply {
            putString("type", type)
            fill()
        }
        mLynxContext.sendGlobalEvent(EVENT, JavaOnlyArray().apply { pushMap(payload) })
    }

    // The name Android keeps for a device, which needs BLUETOOTH_CONNECT
    // from Android 12.
    private fun deviceName(device: BluetoothDevice): String? =
        try {
            device.name
        } catch (_: SecurityException) {
            null
        }

    /** A method's callback, which answers once: a second answer is dropped. */
    private class Reply(private val callback: Callback) {
        private val answered = AtomicBoolean(false)

        fun ok(result: JavaOnlyMap = JavaOnlyMap()) {
            if (answered.compareAndSet(false, true)) callback.invoke(result)
        }

        fun fail(failure: Failure) {
            if (answered.compareAndSet(false, true)) {
                callback.invoke(
                    JavaOnlyMap().apply {
                        putString("error", failure.code)
                        putString("message", failure.message)
                    },
                )
            }
        }

        fun fail(code: String, message: String) = fail(Failure(code, message))

        fun done(failure: Failure?) = if (failure == null) ok() else fail(failure)
    }

    /** One of the contract's error codes, and a sentence for the person. */
    private class Failure(val code: String, val message: String)

    /** How a permission prompt ended. */
    private enum class Answer {
        /** The person chose (or Android chose for them). */
        ANSWERED,

        /** Another module's prompt is open. */
        BUSY,

        /** The module was destroyed first. */
        CLOSED,
    }

    companion object {
        const val NAME = "AngularLynxBluetooth"

        private const val TAG = "AngularLynxBluetooth"

        /** The one global event, whose payload's `type` says what happened. */
        private const val EVENT = "angularLynxBluetooth"

        // The contract's error codes.
        private const val UNSUPPORTED = "unsupported"
        private const val UNAUTHORIZED = "unauthorized"
        private const val POWERED_OFF = "poweredOff"
        private const val NOT_FOUND = "notFound"
        private const val NOT_CONNECTED = "notConnected"
        private const val TIMEOUT = "timeout"
        private const val BUSY = "busy"
        private const val FAILED = "failed"

        private const val UNAUTHORIZED_MESSAGE = "The app isn't allowed to use Bluetooth."
        private const val POWERED_OFF_MESSAGE = "Bluetooth is turned off."
        private const val PROMPT_OPEN = "Another permission prompt is open."
        private const val PAGE_CLOSED = "The page closed."
        private const val LOCATION_OFF = "Location is turned off, and this Android version finds no Bluetooth devices without it."

        /** For a connect() without a timeout, which the runtime always gives. */
        private const val DEFAULT_CONNECT_TIMEOUT_MS = 10_000L

        /** How long disconnect() waits for Android to confirm before closing anyway. */
        private const val DISCONNECT_TIMEOUT_MS = 2_000L

        /**
         * The longest a GATT operation may go unanswered before the
         * connection is given up. Longer than ATT's own transaction timeout,
         * on which Android drops the link and says why, so this only fires
         * when Android never answers at all.
         */
        private const val OPERATION_TIMEOUT_MS = 35_000L

        /** How often a scan reports a device it has already reported. */
        private const val SIGHTING_INTERVAL_MS = 1_000L

        // ATT's MTU before an exchange, and the largest Android negotiates
        // (an attribute's largest value plus a write's header). A write
        // without a response carries the MTU less its header.
        private const val DEFAULT_MTU = 23
        private const val MAX_MTU = 517
        private const val ATT_HEADER_LENGTH = 3
        private const val MAX_ATTRIBUTE_LENGTH = 512

        // The connection statuses Android reports as a link ends, from the
        // Bluetooth spec's HCI error codes and Android's own.
        private const val LINK_SUPERVISION_TIMEOUT = 0x08
        private const val REMOTE_USER_TERMINATED = 0x13
        private const val LOCAL_HOST_TERMINATED = 0x16
        private const val FAILED_TO_ESTABLISH = 0x3E
        private const val GATT_ERROR = 0x85
        private const val GATT_CONNECTION_TIMEOUT = 0x93

        // ATT's error codes for an operation the device refused.
        private const val INSUFFICIENT_AUTHORIZATION = 0x08

        // The Client Characteristic Configuration Descriptor, which turns a
        // characteristic's notifications and indications on and off.
        private val CLIENT_CONFIGURATION: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        private fun uuids(strings: List<String>?): List<UUID> = strings.orEmpty().map(UUID::fromString)

        private fun base64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

        private fun JavaOnlyMap.putNullableString(key: String, value: String?) {
            if (value != null) putString(key, value) else putNull(key)
        }

        private fun properties(bits: Int) = JavaOnlyArray().apply {
            if (bits and BluetoothGattCharacteristic.PROPERTY_READ != 0) pushString("read")
            if (bits and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) pushString("write")
            if (bits and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0) pushString("writeWithoutResponse")
            if (bits and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) pushString("notify")
            if (bits and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0) pushString("indicate")
        }

        private fun notStarted(what: String) = Failure(FAILED, "Android refused to start $what.")

        // What an Android 13 write says when it refuses, in place of false.
        @RequiresApi(Build.VERSION_CODES.TIRAMISU)
        private fun statusFailure(code: Int, what: String): Failure? = when (code) {
            BluetoothStatusCodes.SUCCESS -> null
            BluetoothStatusCodes.ERROR_MISSING_BLUETOOTH_CONNECT_PERMISSION -> Failure(UNAUTHORIZED, UNAUTHORIZED_MESSAGE)
            BluetoothStatusCodes.ERROR_BLUETOOTH_NOT_ENABLED -> Failure(POWERED_OFF, POWERED_OFF_MESSAGE)
            else -> Failure(FAILED, "Android refused to start $what (status $code).")
        }

        /** Why a link ended or never came up. */
        private fun linkFailure(status: Int) = when (status) {
            LINK_SUPERVISION_TIMEOUT ->
                Failure(TIMEOUT, "The connection timed out: the device went out of range or stopped answering.")
            GATT_CONNECTION_TIMEOUT -> Failure(TIMEOUT, "The device didn't answer the connection.")
            REMOTE_USER_TERMINATED -> Failure(FAILED, "The device ended the connection.")
            LOCAL_HOST_TERMINATED -> Failure(FAILED, "Android ended the connection.")
            FAILED_TO_ESTABLISH -> Failure(FAILED, "The connection couldn't be set up.")
            GATT_ERROR -> Failure(FAILED, "Android couldn't connect to the device (GATT error 133).")
            else -> Failure(FAILED, "The connection failed (status $status).")
        }

        /** Why the device refused a GATT operation, or null when it didn't. */
        private fun gattFailure(status: Int): Failure? = when (status) {
            BluetoothGatt.GATT_SUCCESS -> null
            BluetoothGatt.GATT_READ_NOT_PERMITTED -> Failure(FAILED, "The device doesn't allow reading it.")
            BluetoothGatt.GATT_WRITE_NOT_PERMITTED -> Failure(FAILED, "The device doesn't allow writing it.")
            BluetoothGatt.GATT_INSUFFICIENT_AUTHENTICATION, BluetoothGatt.GATT_INSUFFICIENT_ENCRYPTION ->
                Failure(FAILED, "The device has to be paired first, and pairing didn't succeed.")
            INSUFFICIENT_AUTHORIZATION -> Failure(FAILED, "The device didn't authorize it.")
            BluetoothGatt.GATT_INVALID_ATTRIBUTE_LENGTH -> Failure(FAILED, "The device refused a value of that length.")
            BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED -> Failure(FAILED, "The device doesn't support it.")
            else -> Failure(FAILED, "The device answered with GATT status $status.")
        }

        private fun scanFailure(code: Int) = when (code) {
            ScanCallback.SCAN_FAILED_ALREADY_STARTED -> "A scan was already running."
            ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED ->
                "Android couldn't register the scan, which happens when an app starts too many in a short time."
            ScanCallback.SCAN_FAILED_FEATURE_UNSUPPORTED -> "This device can't run that scan."
            ScanCallback.SCAN_FAILED_INTERNAL_ERROR -> "The scan failed inside Android."
            else -> "The scan failed (error $code)."
        }
    }
}
