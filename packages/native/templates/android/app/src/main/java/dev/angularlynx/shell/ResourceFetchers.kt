package dev.angularlynx.shell

import android.content.Context
import com.lynx.tasm.core.LynxThreadPool
import com.lynx.tasm.provider.AbsTemplateProvider
import com.lynx.tasm.resourceprovider.LynxResourceCallback
import com.lynx.tasm.resourceprovider.LynxResourceRequest
import com.lynx.tasm.resourceprovider.LynxResourceResponse
import com.lynx.tasm.resourceprovider.generic.LynxGenericResourceFetcher
import com.lynx.tasm.resourceprovider.media.LynxMediaResourceFetcher
import com.lynx.tasm.resourceprovider.template.LynxTemplateResourceFetcher
import com.lynx.tasm.resourceprovider.template.TemplateProviderResult
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Lynx can't load anything by itself: the host app supplies loaders for
 * bundles, images and other resources. Ours read the copy of dist/ inside the
 * APK and fall back to HTTP for absolute http(s) URLs (an API, a CDN, or a dev
 * server).
 */

private val http by lazy { OkHttpClient() }

// LynxResourceResponse.onFailed is declared without a type parameter, so
// Kotlin sees a raw type; this gives it the one each callback expects.
@Suppress("UNCHECKED_CAST")
private fun <T> failed(error: Throwable): LynxResourceResponse<T> =
    LynxResourceResponse.onFailed(error) as LynxResourceResponse<T>

/** Reads [url] from assets/ or over HTTP, off the UI thread. */
private fun load(
    context: Context,
    url: String,
    onSuccess: (ByteArray) -> Unit,
    onFailure: (Throwable) -> Unit,
) {
    LynxThreadPool.getBriefIOExecutor().execute {
        try {
            val asset = BundleAssets.assetPath(url)
            val bytes = if (asset != null) {
                BundleAssets.read(context, asset)
            } else {
                http.newCall(Request.Builder().url(url).build()).execute().use { response ->
                    check(response.isSuccessful) { "HTTP ${response.code} for $url" }
                    response.body!!.bytes()
                }
            }
            onSuccess(bytes)
        } catch (error: Throwable) {
            onFailure(Exception("Couldn't load $url: ${error.message}", error))
        }
    }
}

/** Loads the bundle passed to LynxView.renderTemplateUrl (the main bundle). */
class AssetTemplateProvider(context: Context) : AbsTemplateProvider() {
    private val context = context.applicationContext

    override fun loadTemplate(url: String, callback: Callback) =
        load(context, url, callback::onSuccess) { callback.onFailed(it.message) }
}

/**
 * Loads every other bundle: lazy route chunks and dynamic components, which
 * the main bundle requests by URL at runtime.
 */
class AssetTemplateResourceFetcher(context: Context) : LynxTemplateResourceFetcher() {
    private val context = context.applicationContext

    override fun fetchTemplate(
        request: LynxResourceRequest,
        callback: LynxResourceCallback<TemplateProviderResult>,
    ) = load(
        context,
        request.url,
        { callback.onResponse(LynxResourceResponse.onSuccess(TemplateProviderResult.fromBinary(it))) },
        { callback.onResponse(failed(it)) },
    )

    // AngularLynx doesn't use Lynx's server-side rendering data.
    override fun fetchSSRData(request: LynxResourceRequest, callback: LynxResourceCallback<ByteArray>) =
        callback.onResponse(failed(UnsupportedOperationException("No SSR data")))
}

/**
 * Images: rather than loading them, Lynx asks where they live and hands the
 * answer to Fresco. Bundled images become asset:/// URIs, which Fresco reads
 * from the APK; anything else (https:, data:) passes through unchanged.
 */
class AssetMediaResourceFetcher : LynxMediaResourceFetcher() {
    override fun shouldRedirectUrl(request: LynxResourceRequest): String {
        val asset = BundleAssets.assetPath(request.url) ?: return request.url
        return "asset:///$asset"
    }
}

/** Fonts, Lottie files and other resources the bundle loads by URL. */
class AssetGenericResourceFetcher(context: Context) : LynxGenericResourceFetcher() {
    private val context = context.applicationContext

    override fun fetchResource(request: LynxResourceRequest, callback: LynxResourceCallback<ByteArray>) =
        load(
            context,
            request.url,
            { callback.onResponse(LynxResourceResponse.onSuccess(it)) },
            { callback.onResponse(failed(it)) },
        )

    // Lynx asks for a file path only for resources it hands to native code
    // that reads files; assets inside an APK have no path, so it falls back
    // to fetchResource.
    override fun fetchResourcePath(request: LynxResourceRequest, callback: LynxResourceCallback<String>) =
        callback.onResponse(failed(UnsupportedOperationException("No file paths for assets")))
}
