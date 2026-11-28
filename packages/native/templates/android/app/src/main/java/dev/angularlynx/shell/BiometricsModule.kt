package dev.angularlynx.shell

import android.app.KeyguardManager
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/**
 * The native module behind the runtime's `LynxBiometrics`, and the values
 * `LynxSecureStorage` keeps behind a fingerprint or a face
 * (`requireBiometrics`). The runtime calls it as
 * `NativeModules.AngularLynxBiometrics`, from the background thread, where
 * NativeModules lives. MainActivity registers it with itself as the param:
 * AndroidX's BiometricPrompt shows over a FragmentActivity.
 *
 * Only an app with `permissions.biometrics` in angular.json has this file,
 * AndroidX Biometric, and MainActivity's lines that register it: the
 * generator takes them out of the others.
 *
 * It counts only strong (Class 3) biometrics, the ones that can unlock a
 * Keystore key, so `authenticate()` and the guarded values agree on what
 * confirms the person.
 *
 * A guarded value is sealed with AES-GCM under a key of its own, and that key
 * with RSA-OAEP under a Keystore key pair whose private key needs a
 * biometric for each use. The public key needs none, so storing a value
 * doesn't prompt, and reading one does, through BiometricPrompt's
 * CryptoObject. Enrolling a new fingerprint or face invalidates the pair,
 * and with it every guarded value, which then reads as none, as on iOS.
 *
 * Each method calls back once with `{}`, `{ value }`, the availability, or
 * `{ error, message }`, where `error` is one of the runtime's
 * BiometricsErrorCode values.
 */
class BiometricsModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val activity = param as FragmentActivity
    private val main = Handler(Looper.getMainLooper())
    private val preferences: SharedPreferences =
        activity.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    // Whether a prompt is open: BiometricPrompt shows one at a time. Read
    // and written on the main thread only.
    private var prompting = false

    /** `{ type, enrolled, deviceCredential }`. */
    @LynxMethod
    fun availability(callback: Callback) {
        val status = BiometricManager.from(activity).canAuthenticate(BIOMETRIC_STRONG)
        val packages = activity.packageManager
        val type =
            when {
                status == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "none"
                packages.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT) -> "fingerprint"
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                    packages.hasSystemFeature(PackageManager.FEATURE_FACE) -> "face"
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                    packages.hasSystemFeature(PackageManager.FEATURE_IRIS) -> "iris"
                status == BiometricManager.BIOMETRIC_SUCCESS ||
                    status == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "fingerprint"
                else -> "none"
            }
        val keyguard = activity.getSystemService(KeyguardManager::class.java)
        callback.invoke(
            JavaOnlyMap.from(
                mapOf(
                    "type" to type,
                    "enrolled" to (status == BiometricManager.BIOMETRIC_SUCCESS),
                    "deviceCredential" to (keyguard?.isDeviceSecure == true),
                ),
            ),
        )
    }

    /**
     * Shows the prompt with `{ reason, allowDeviceCredential, title,
     * cancelLabel }`, and calls back with `{}` once the person is confirmed.
     */
    @LynxMethod
    fun authenticate(options: ReadableMap, callback: Callback) {
        val reason = options.string("reason") ?: defaultReason()
        val allowDeviceCredential =
            options.hasKey("allowDeviceCredential") && options.getBoolean("allowDeviceCredential")
        // Android 9 and 10 take the device credential only beside a weak
        // biometric; the strong ones and a credential arrived together in 11.
        val authenticators =
            when {
                !allowDeviceCredential -> BIOMETRIC_STRONG
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> BIOMETRIC_STRONG or DEVICE_CREDENTIAL
                else -> BIOMETRIC_WEAK or DEVICE_CREDENTIAL
            }
        val status = BiometricManager.from(activity).canAuthenticate(authenticators)
        if (status != BiometricManager.BIOMETRIC_SUCCESS) {
            callback.invoke(unavailable(status))
            return
        }
        val info =
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(options.string("title") ?: appName())
                .setSubtitle(reason)
                .setAllowedAuthenticators(authenticators)
                .apply {
                    // A prompt that offers the device credential has its own
                    // way out, and Android refuses a cancel button beside it.
                    if (!allowDeviceCredential) {
                        setNegativeButtonText(options.string("cancelLabel") ?: "Cancel")
                    }
                }
                .build()
        prompt(info, null, callback) { callback.invoke(JavaOnlyMap()) }
    }

    /**
     * The value stored under `key`, once the person confirms, as `{ value }`,
     * or `{}` without prompting when there's none.
     */
    @LynxMethod
    fun getItem(key: String, reason: String, callback: Callback) {
        worker.execute {
            val stored = preferences.getString(key, null)
            if (stored == null) {
                callback.invoke(JavaOnlyMap())
                return@execute
            }
            val cipher =
                try {
                    rsaCipher().apply { init(Cipher.DECRYPT_MODE, privateKey(), OAEP) }
                } catch (e: KeyPermanentlyInvalidatedException) {
                    // A fingerprint or face enrolled since: nothing stored
                    // under the old pair can be read again.
                    forgetEverything()
                    callback.invoke(JavaOnlyMap())
                    return@execute
                } catch (e: Exception) {
                    callback.invoke(failed(e))
                    return@execute
                }
            val info =
                BiometricPrompt.PromptInfo.Builder()
                    .setTitle(appName())
                    .setSubtitle(reason.ifEmpty { defaultReason() })
                    .setAllowedAuthenticators(BIOMETRIC_STRONG)
                    .setNegativeButtonText("Cancel")
                    .build()
            main.post {
                prompt(info, BiometricPrompt.CryptoObject(cipher), callback) { result ->
                    val unlocked = result.cryptoObject?.cipher ?: return@prompt callback.invoke(failed(null))
                    worker.execute {
                        callback.invoke(
                            try {
                                JavaOnlyMap.from(mapOf("value" to open(key, stored, unlocked)))
                            } catch (e: Exception) {
                                failed(e)
                            },
                        )
                    }
                }
            }
        }
    }

    /** Stores `value` under `key`, in place of what was there. Doesn't prompt. */
    @LynxMethod
    fun setItem(key: String, value: String, callback: Callback) {
        worker.execute {
            callback.invoke(
                try {
                    val status = BiometricManager.from(activity).canAuthenticate(BIOMETRIC_STRONG)
                    if (activity.getSystemService(KeyguardManager::class.java)?.isDeviceSecure != true) {
                        // The Keystore makes no biometric key without a lock
                        // screen.
                        error("unavailable", "Set a screen lock to keep values behind biometrics.")
                    } else if (status != BiometricManager.BIOMETRIC_SUCCESS) {
                        // Nor without a strong biometric enrolled: a value
                        // nobody can unlock is no use.
                        unavailable(status)
                    } else {
                        val sealed = seal(key, value)
                        if (preferences.edit().putString(key, sealed).commit()) {
                            JavaOnlyMap()
                        } else {
                            error("failed", "The value couldn't be written to disk.")
                        }
                    }
                } catch (e: Exception) {
                    failed(e)
                },
            )
        }
    }

    @LynxMethod
    fun removeItem(key: String, callback: Callback) {
        worker.execute { callback.invoke(committed(preferences.edit().remove(key).commit())) }
    }

    @LynxMethod
    fun clear(callback: Callback) {
        worker.execute { callback.invoke(committed(preferences.edit().clear().commit())) }
    }

    /**
     * `{}` once a removal is on disk, or why not: one that stayed in memory
     * only would bring the value back when the app next starts.
     */
    private fun committed(onDisk: Boolean) =
        if (onDisk) JavaOnlyMap() else error("failed", "The removal couldn't be written to disk.")

    /**
     * Shows a prompt on the main thread, and calls [succeeded] once the person
     * is confirmed, or back with why not.
     */
    private fun prompt(
        info: BiometricPrompt.PromptInfo,
        crypto: BiometricPrompt.CryptoObject?,
        callback: Callback,
        succeeded: (BiometricPrompt.AuthenticationResult) -> Unit,
    ) {
        main.post {
            if (prompting) {
                callback.invoke(error("failed", "A biometric prompt is already open."))
                return@post
            }
            prompting = true
            val prompt =
                BiometricPrompt(
                    activity,
                    ContextCompat.getMainExecutor(activity),
                    object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                            prompting = false
                            succeeded(result)
                        }

                        // A finger that didn't match leaves the prompt open
                        // for another try, so onAuthenticationFailed has
                        // nothing to report.
                        override fun onAuthenticationError(code: Int, message: CharSequence) {
                            prompting = false
                            callback.invoke(error(errorCode(code), message.toString()))
                        }
                    },
                )
            try {
                if (crypto == null) prompt.authenticate(info) else prompt.authenticate(info, crypto)
            } catch (e: Exception) {
                // Such as an activity that's already saved its state.
                prompting = false
                callback.invoke(failed(e))
            }
        }
    }

    private fun seal(key: String, value: String): String {
        val dataKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val aes = Cipher.getInstance(AES)
        aes.init(Cipher.ENCRYPT_MODE, dataKey)
        aes.updateAAD(key.toByteArray())
        val sealedValue = aes.iv + aes.doFinal(value.toByteArray())
        val rsa = rsaCipher()
        rsa.init(Cipher.ENCRYPT_MODE, publicKey(), OAEP)
        val wrapped = rsa.doFinal(dataKey.encoded)
        return Base64.encodeToString(wrapped + sealedValue, Base64.NO_WRAP)
    }

    private fun open(key: String, stored: String, unlocked: Cipher): String {
        val sealed = Base64.decode(stored, Base64.NO_WRAP)
        val dataKey = SecretKeySpec(unlocked.doFinal(sealed, 0, WRAPPED_BYTES), "AES")
        val aes = Cipher.getInstance(AES)
        aes.init(Cipher.DECRYPT_MODE, dataKey, GCMParameterSpec(TAG_BITS, sealed, WRAPPED_BYTES, IV_BYTES))
        aes.updateAAD(key.toByteArray())
        val start = WRAPPED_BYTES + IV_BYTES
        return String(aes.doFinal(sealed, start, sealed.size - start))
    }

    private fun keyStore() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun privateKey(): PrivateKey =
        keyStore().getKey(KEY_ALIAS, null) as? PrivateKey
            ?: throw KeyPermanentlyInvalidatedException("The key is gone.")

    /**
     * The pair's public key, made the first time a value is stored, as a
     * plain key outside the Keystore: the Keystore's own copy refuses OAEP's
     * SHA-1 mask on some versions, and a public key needs no protecting.
     *
     * A fingerprint or face enrolled since invalidates the private key but
     * not the public one, which would still seal a value nobody could open:
     * the pair is checked first, and an invalid one is replaced, with the
     * values it sealed, before the new value is sealed.
     */
    private fun publicKey(): PublicKey {
        if (keyStore().containsAlias(KEY_ALIAS)) {
            try {
                // Needs no biometric: only using the key does.
                rsaCipher().init(Cipher.DECRYPT_MODE, privateKey(), OAEP)
            } catch (_: KeyPermanentlyInvalidatedException) {
                forgetEverything()
            }
        }
        val stored =
            keyStore().getCertificate(KEY_ALIAS)?.publicKey
                ?: KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, KEYSTORE)
                    .apply {
                        initialize(
                            KeyGenParameterSpec.Builder(
                                KEY_ALIAS,
                                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                            )
                                .setKeySize(2048)
                                .setDigests(KeyProperties.DIGEST_SHA256)
                                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                                .setUserAuthenticationRequired(true)
                                .setInvalidatedByBiometricEnrollment(true)
                                .apply {
                                    // Each use, with a strong biometric only.
                                    // Older versions do that by default.
                                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                                        setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                                    }
                                }
                                .build(),
                        )
                    }
                    .generateKeyPair()
                    .public
        return KeyFactory.getInstance(stored.algorithm).generatePublic(X509EncodedKeySpec(stored.encoded))
    }

    private fun forgetEverything() {
        preferences.edit().clear().commit()
        try {
            keyStore().deleteEntry(KEY_ALIAS)
        } catch (_: Exception) {
            // Already gone.
        }
    }

    private fun appName(): String = activity.applicationInfo.loadLabel(activity.packageManager).toString()

    /** angular.json's `permissions.biometrics`, from res/values/biometrics.xml. */
    private fun defaultReason(): String = activity.getString(R.string.angular_lynx_biometrics_reason)

    private fun ReadableMap.string(name: String): String? =
        if (hasKey(name)) getString(name)?.takeIf { it.isNotEmpty() } else null

    private fun error(code: String, message: String) =
        JavaOnlyMap.from(mapOf("error" to code, "message" to message))

    private fun failed(e: Exception?) =
        error("failed", e?.message ?: "The person couldn't be confirmed.")

    private fun unavailable(status: Int) =
        when (status) {
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ->
                error("notEnrolled", "No fingerprint or face is set up on this phone.")
            else -> error("unavailable", "This phone can't confirm the person with biometrics.")
        }

    private fun errorCode(code: Int) =
        when (code) {
            BiometricPrompt.ERROR_USER_CANCELED,
            BiometricPrompt.ERROR_NEGATIVE_BUTTON,
            BiometricPrompt.ERROR_CANCELED,
            -> "canceled"
            BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "lockout"
            BiometricPrompt.ERROR_NO_BIOMETRICS -> "notEnrolled"
            BiometricPrompt.ERROR_HW_NOT_PRESENT,
            BiometricPrompt.ERROR_HW_UNAVAILABLE,
            BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL,
            BiometricPrompt.ERROR_SECURITY_UPDATE_REQUIRED,
            -> "unavailable"
            else -> "failed"
        }

    companion object {
        const val NAME = "AngularLynxBiometrics"
        /** Also named in res/xml/backup_rules.xml and data_extraction_rules.xml. */
        const val FILE = "angular_lynx_biometric_storage"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "angular_lynx_biometric_storage"
        private const val RSA = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
        private const val AES = "AES/GCM/NoPadding"
        /** A 2048-bit RSA key's output. */
        private const val WRAPPED_BYTES = 256
        private const val IV_BYTES = 12
        private const val TAG_BITS = 128

        /**
         * OAEP with SHA-256, and SHA-1 for its mask, which is the only one
         * the Keystore takes on every version: the same on both sides.
         */
        private val OAEP =
            OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT)

        private fun rsaCipher(): Cipher = Cipher.getInstance(RSA)

        /** One thread for every LynxView's module, so calls run in order. */
        private val worker = Executors.newSingleThreadExecutor()
    }
}
