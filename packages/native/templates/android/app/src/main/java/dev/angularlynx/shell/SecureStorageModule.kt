package dev.angularlynx.shell

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The native module behind the runtime's `LynxSecureStorage`, which calls it
 * as `NativeModules.AngularLynxSecureStorage` (from the background thread,
 * where NativeModules lives).
 *
 * Values are strings (the runtime stores JSON), each encrypted with AES-GCM
 * by a key the Android Keystore holds and never lets out, and kept in a
 * SharedPreferences file of their own. The value's key is the cipher's
 * associated data, so a value copied to another key won't decrypt. Android's
 * EncryptedSharedPreferences did the same, but its library is deprecated.
 *
 * Auto Backup leaves the file out (res/xml/backup_rules.xml and
 * data_extraction_rules.xml): the Keystore key never leaves the device, so a
 * restored copy couldn't be read. Each method calls back once with
 * `{ value }`, `{}` or `{ error }`, as the iOS module does.
 */
class SecureStorageModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    @LynxMethod
    fun getItem(key: String, callback: Callback) = respond(callback) {
        val stored = preferences.getString(key, null) ?: return@respond null
        try {
            decrypt(key, stored)
        } catch (e: Exception) {
            // A value that won't decrypt, as when the Keystore lost the key,
            // can never be read, so it's as good as none.
            if (e !is GeneralSecurityException && e !is IllegalArgumentException) throw e
            preferences.edit().remove(key).commit()
            null
        }
    }

    @LynxMethod
    fun setItem(key: String, value: String, callback: Callback) = respond(callback) {
        write { putString(key, encrypt(key, value)) }
    }

    @LynxMethod
    fun removeItem(key: String, callback: Callback) = respond(callback) {
        write { remove(key) }
    }

    @LynxMethod
    fun clear(callback: Callback) = respond(callback) {
        write { clear() }
    }

    /**
     * Runs [work] off the JavaScript thread, since the Keystore can be slow,
     * and calls back with the value it returns, or with why it failed.
     */
    private fun respond(callback: Callback, work: () -> String?) {
        executor.execute {
            val result = try {
                work()?.let { mapOf("value" to it) } ?: emptyMap()
            } catch (e: Exception) {
                mapOf("error" to (e.message ?: e.toString()))
            }
            callback.invoke(JavaOnlyMap.from(result))
        }
    }

    /** Commits an edit, so the callback only says it's stored once it's on disk. */
    private fun write(edit: SharedPreferences.Editor.() -> Unit): String? {
        val editor = preferences.edit()
        editor.edit()
        if (!editor.commit()) {
            error("The value couldn't be written to disk.")
        }
        return null
    }

    private fun encrypt(key: String, value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        // The Keystore picks a random IV for each value.
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        cipher.updateAAD(key.toByteArray())
        val sealed = cipher.iv + cipher.doFinal(value.toByteArray())
        return Base64.encodeToString(sealed, Base64.NO_WRAP)
    }

    private fun decrypt(key: String, stored: String): String {
        val sealed = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            secretKey(),
            GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES),
        )
        cipher.updateAAD(key.toByteArray())
        return String(cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES))
    }

    /** The Keystore's key, made the first time a value is stored. */
    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    companion object {
        const val NAME = "AngularLynxSecureStorage"
        /** Also named in res/xml/backup_rules.xml and data_extraction_rules.xml. */
        const val FILE = "angular_lynx_secure_storage"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "angular_lynx_secure_storage"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_BYTES = 12
        private const val TAG_BITS = 128

        /**
         * One thread for every LynxView's module, so calls run in the order
         * they were made (a read sees the writes before it) and two can't
         * both make the key.
         */
        private val executor = Executors.newSingleThreadExecutor()
    }
}
