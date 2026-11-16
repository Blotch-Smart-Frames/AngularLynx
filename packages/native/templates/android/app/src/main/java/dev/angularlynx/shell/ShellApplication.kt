package dev.angularlynx.shell

import android.app.Application
import android.content.ComponentCallbacks2
import android.content.pm.ApplicationInfo
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.core.ImagePipelineConfig
import com.facebook.imagepipeline.memory.PoolConfig
import com.facebook.imagepipeline.memory.PoolFactory
import com.lynx.service.http.LynxHttpService
import com.lynx.service.image.LynxImageService
import com.lynx.service.log.LynxLogService
import com.lynx.tasm.LynxEnv
import com.lynx.tasm.base.LLog
import com.lynx.tasm.service.LynxServiceCenter

/**
 * Starts Lynx once per process. Lynx requires its services and LynxEnv to be
 * set up before the first LynxView is built, and Application.onCreate is the
 * one place guaranteed to run first.
 */
class ShellApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        // LynxImageService draws <image> through Fresco, which must be
        // initialized first. Fresco also understands asset:/// URIs natively,
        // which is how bundled images are loaded (see AssetMediaResourceFetcher).
        val pools = PoolFactory(PoolConfig.newBuilder().build())
        Fresco.initialize(
            this,
            ImagePipelineConfig.newBuilder(this).setPoolFactory(pools).build(),
        )
        LynxServiceCenter.inst().registerService(LynxImageService.getInstance())
        LynxServiceCenter.inst().registerService(LynxLogService)
        LynxServiceCenter.inst().registerService(LynxHttpService)

        // No global template provider or custom elements: MainActivity passes
        // its loaders to the LynxView it builds.
        LynxEnv.inst().init(this, null, null, null)

        // Lynx's libraries are built for release, where Lynx logs at INFO: a
        // line for every touch, flush, layout, event listener and main-thread
        // module call, each a call from native code back into Java and an
        // android.util.Log write on the thread that logged it, mostly the
        // engine thread Angular runs on. A release app keeps Lynx's warnings
        // and errors, which carry the app's JavaScript errors; the debuggable
        // build `ng serve --platform android` installs keeps every line for
        // debugging. After init, which loads Lynx's native library: before
        // it, the call does nothing.
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) == 0) {
            LLog.setMinimumLoggingLevel(LLog.WARN)
        }
    }

    // Lynx leaves it to the host app to report memory pressure. Either level
    // runs a full collection of each LynxView's main-thread JavaScript heap;
    // critical also empties Lynx's text layout cache. Leaving the screen is
    // reported too: out of sight, a collection's pause can't show, and the
    // memory it frees makes the app less likely to be ended in the background.
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        val pressure =
            if (level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL ||
                level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE
            ) {
                ShellModule.MEMORY_PRESSURE_CRITICAL
            } else {
                ShellModule.MEMORY_PRESSURE_MODERATE
            }
        LynxEnv.inst().trimMemory(pressure)
    }

    override fun onLowMemory() {
        super.onLowMemory()
        LynxEnv.inst().trimMemory(ShellModule.MEMORY_PRESSURE_CRITICAL)
    }
}
