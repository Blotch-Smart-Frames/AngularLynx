package dev.angularlynx.shell

import com.lynx.jsbridge.LynxContextModule
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableArray
import com.lynx.react.bridge.ReadableMap
import com.lynx.tasm.behavior.LynxContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/*
 * The two native modules rspeedy's live reload needs, in the debug build
 * only (see DevServer.kt). Lynx Explorer has them from Lynx DevTool, which
 * the shell doesn't include: the dev server's client, which rspeedy puts in
 * every development bundle, talks to the server over
 * `NativeModules.LynxWebSocketModule` (through @lynx-js/websocket) and
 * reloads the page with `NativeModules.LynxDevToolSetModule.invokeCdp`, a
 * DevTool protocol `Page.reload`. These answer to the same names and calls,
 * so the bundle runs here as it does in Lynx Explorer.
 */

/**
 * `NativeModules.LynxWebSocketModule`, as Lynx DevTool's
 * (LynxWebSocket.java): `connect`, `send`, `ping` and `close`, each with the
 * socket's ID, and the `websocketOpen`, `websocketMessage`, `websocketClosed`
 * and `websocketFailed` global events @lynx-js/websocket listens for.
 */
class DevWebSocketModule : LynxContextModule {
    // Lynx creates a module through whichever of its constructors it finds.
    constructor(context: LynxContext) : super(context)
    constructor(context: LynxContext, param: Any?) : super(context, param)

    private val sockets = ConcurrentHashMap<Int, WebSocket>()

    // No read timeout: the dev server only writes when there's a new build.
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    @LynxMethod
    fun connect(url: String, protocols: ReadableArray?, options: ReadableMap?, socketID: Double) {
        val id = socketID.toInt()
        val request = Request.Builder()
            // The address the bundle was built with reaches this device's
            // localhost through adb reverse.
            .url(DevServer.remoteUrl(url) ?: url)
            .apply {
                val names = (0 until (protocols?.size() ?: 0)).mapNotNull { protocols?.getString(it)?.trim() }
                    .filter { it.isNotEmpty() && !it.contains(',') }
                if (names.isNotEmpty()) addHeader("Sec-WebSocket-Protocol", names.joinToString(","))
            }
            .build()
        client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                sockets[id] = webSocket
                emit("websocketOpen", "id" to id, "protocol" to (response.header("Sec-WebSocket-Protocol") ?: ""))
            }

            override fun onMessage(webSocket: WebSocket, text: String) =
                emit("websocketMessage", "id" to id, "type" to "text", "data" to text)

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) =
                emit("websocketMessage", "id" to id, "type" to "binary", "data" to bytes.base64())

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                sockets.remove(id)
                emit("websocketClosed", "id" to id, "code" to code, "reason" to reason)
            }

            // The connection failed or dropped (the server stopped): the dev
            // server's client then tries again, with a growing delay.
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                sockets.remove(id)
                emit("websocketFailed", "id" to id, "message" to (t.message ?: t.toString()))
                emit("websocketClosed", "id" to id, "code" to 1006, "reason" to (t.message ?: ""))
            }
        })
    }

    @LynxMethod
    fun send(message: String, socketID: Double) {
        sockets[socketID.toInt()]?.send(message)
    }

    @LynxMethod
    fun ping(socketID: Double) {
        sockets[socketID.toInt()]?.send(ByteString.EMPTY)
    }

    @LynxMethod
    fun close(code: Double, reason: String, socketID: Double) {
        sockets.remove(socketID.toInt())?.close(code.toInt(), reason)
    }

    override fun destroy() {
        sockets.values.forEach { it.close(1001, "The page closed") }
        sockets.clear()
        super.destroy()
    }

    private fun emit(event: String, vararg params: Pair<String, Any>) {
        val map = JavaOnlyMap()
        for ((key, value) in params) {
            when (value) {
                is Int -> map.putInt(key, value)
                else -> map.putString(key, value.toString())
            }
        }
        mLynxContext.sendGlobalEvent(event, JavaOnlyArray().apply { pushMap(map) })
    }

    companion object {
        const val NAME = "LynxWebSocketModule"
    }
}

/**
 * `NativeModules.LynxDevToolSetModule`, as far as rspeedy's live reload uses
 * Lynx DevTool's: `invokeCdp` with a `Page.reload`, which renders the bundle
 * from the dev server again, as Lynx DevTool's page reload does. It answers
 * any other DevTool method with an error.
 */
class DevReloadModule(context: android.content.Context, param: Any?) : LynxModule(context, param) {
    @LynxMethod
    fun invokeCdp(message: String, callback: Callback?) {
        val request = runCatching { JSONObject(message) }.getOrDefault(JSONObject())
        val id = request.opt("id") ?: 0
        val method = request.optString("method")
        val reply = JSONObject().put("id", id)
        if (method == "Page.reload") {
            DevServer.reloadBundle()
            reply.put("result", JSONObject())
        } else {
            reply.put(
                "error",
                JSONObject()
                    .put("code", -32601)
                    .put("message", "$method needs Lynx DevTool, which this app doesn't have."),
            )
        }
        callback?.invoke(reply.toString())
    }

    companion object {
        const val NAME = "LynxDevToolSetModule"
    }
}
