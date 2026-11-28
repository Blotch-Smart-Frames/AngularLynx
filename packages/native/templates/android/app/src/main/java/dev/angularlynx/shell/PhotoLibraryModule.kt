package dev.angularlynx.shell

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import java.io.IOException
import java.util.concurrent.Executors

/**
 * The native module behind the runtime's `LynxPhotoLibrary`, which calls it
 * as `NativeModules.AngularLynxPhotoLibrary` (from the background thread,
 * where NativeModules lives).
 *
 * Only an app with `permissions.savePhotos` in angular.json has this file
 * and the lines in MainActivity that register it: the generator deletes them
 * from the others (@blotch/angular-lynx-native's android/project.ts).
 *
 * A photo goes into MediaStore's images, in `Pictures/<app name>`, and a
 * video into its videos, in `Movies/<app name>`, where the gallery and
 * Google Photos find them. From Android 10 an app may add its own media
 * there without any permission, so the app declares none. Before Android 10
 * it would need WRITE_EXTERNAL_STORAGE, asked for while it runs, which the
 * shell has no way to ask for yet, so `save` answers `unavailable` there
 * (and `permission` says `unsupported`). Each method calls back once with
 * `{ permission }`, `{ id, permission }` or `{ error, message, permission }`,
 * where `error` is one of the runtime's PhotoLibraryErrorCode values.
 */
class PhotoLibraryModule(context: Context, param: Any?) : LynxModule(context, param) {
    private val resolver = context.applicationContext.contentResolver
    private val appName =
        context.applicationInfo.loadLabel(context.packageManager).toString()

    /** `{ permission }`: whether the app may add to the library. */
    @LynxMethod
    fun permission(callback: Callback) {
        callback.invoke(JavaOnlyMap.from(mapOf("permission" to permissionName())))
    }

    /**
     * Adds [request]'s file (`{ base64, name, type }`) to the library, and
     * calls back with its `content://` URI.
     */
    @LynxMethod
    fun save(request: ReadableMap, callback: Callback) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            callback.invoke(
                failure(
                    "unavailable",
                    "Saving to the photo library needs Android 10 or later.",
                ),
            )
            return
        }
        // Decoding and writing a video takes a moment: off the JavaScript
        // thread, one at a time.
        worker.execute {
            callback.invoke(
                try {
                    JavaOnlyMap.from(
                        mapOf("id" to insert(request).toString(), "permission" to permissionName()),
                    )
                } catch (error: UnsupportedType) {
                    failure("unsupported-type", error.message ?: "Only images and videos can be saved.")
                } catch (error: IllegalArgumentException) {
                    failure("failed", "The file's bytes couldn't be read.")
                } catch (error: IOException) {
                    failure("failed", "The file couldn't be saved to the photo library: ${error.message}")
                } catch (error: SecurityException) {
                    failure("permission-denied", "The app isn't allowed to add to the photo library.")
                },
            )
        }
    }

    private fun insert(request: ReadableMap): Uri {
        val base64 = if (request.hasKey("base64")) request.getString("base64") else null
        val bytes = Base64.decode(base64 ?: throw IllegalArgumentException(), Base64.DEFAULT)
        val type = if (request.hasKey("type")) request.getString("type") ?: "" else ""
        val isVideo = type.startsWith("video/")
        if (!isVideo && !type.startsWith("image/")) {
            throw UnsupportedType("$type isn't an image or a video.")
        }
        val name = (if (request.hasKey("name")) request.getString("name") else null)
            ?.replace('/', '_')
            ?.takeIf { it.isNotBlank() }
            ?: if (isVideo) "Video.mp4" else "Photo.jpg"
        val collection =
            if (isVideo) {
                MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            } else {
                MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            }
        val folder = if (isVideo) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, type)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "$folder/${folderName()}")
            // Hidden from the gallery until it's all written, so nobody sees
            // half a photo, and taken out again if writing fails.
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = try {
            resolver.insert(collection, values)
        } catch (error: IllegalArgumentException) {
            // MediaStore refuses a type its collection doesn't hold, such as
            // an image type it doesn't know.
            throw UnsupportedType("The photo library doesn't take $type files.")
        } ?: throw IOException("MediaStore didn't make an entry for it.")
        try {
            resolver.openOutputStream(uri)?.use { it.write(bytes) }
                ?: throw IOException("The new entry couldn't be opened.")
            resolver.update(
                uri,
                ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) },
                null,
                null,
            )
        } catch (error: Exception) {
            resolver.delete(uri, null, null)
            throw error
        }
        return uri
    }

    /** The app's name as a folder, without what a path can't hold. */
    private fun folderName(): String =
        appName.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim().ifEmpty { "Pictures" }

    private fun permissionName(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) "granted" else "unsupported"

    private fun failure(code: String, message: String) =
        JavaOnlyMap.from(mapOf("error" to code, "message" to message, "permission" to permissionName()))

    private class UnsupportedType(message: String) : Exception(message)

    companion object {
        const val NAME = "AngularLynxPhotoLibrary"

        // One thread, so saves happen in the order the app made them.
        private val worker = Executors.newSingleThreadExecutor()
    }
}
