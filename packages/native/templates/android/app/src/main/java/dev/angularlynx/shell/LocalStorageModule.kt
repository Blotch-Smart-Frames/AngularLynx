package dev.angularlynx.shell

import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap

/**
 * The native module behind the runtime's `LynxLocalStorage`, which calls it
 * as `NativeModules.AngularLynxLocalStorage` (from the background thread,
 * where NativeModules lives).
 *
 * Values are strings (the runtime stores JSON) in a SharedPreferences file of
 * their own, so `clear` removes only them. Each method calls back once with
 * `{ value }` or `{}`, as the iOS module does.
 */
class LocalStorageModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    @LynxMethod
    fun getItem(key: String, callback: Callback) {
        val value = preferences.getString(key, null)
        callback.invoke(if (value != null) JavaOnlyMap.from(mapOf("value" to value)) else JavaOnlyMap())
    }

    // apply() writes to disk in the background, and Android finishes the
    // write before the activity stops, so the app can't be closed before it.
    @LynxMethod
    fun setItem(key: String, value: String, callback: Callback) {
        preferences.edit().putString(key, value).apply()
        callback.invoke(JavaOnlyMap())
    }

    @LynxMethod
    fun removeItem(key: String, callback: Callback) {
        preferences.edit().remove(key).apply()
        callback.invoke(JavaOnlyMap())
    }

    @LynxMethod
    fun clear(callback: Callback) {
        preferences.edit().clear().apply()
        callback.invoke(JavaOnlyMap())
    }

    companion object {
        const val NAME = "AngularLynxLocalStorage"
        const val FILE = "angular_lynx_local_storage"
    }
}
