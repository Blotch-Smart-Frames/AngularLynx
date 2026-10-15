package dev.angularlynx.shell

import android.app.Application
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.core.ImagePipelineConfig
import com.facebook.imagepipeline.memory.PoolConfig
import com.facebook.imagepipeline.memory.PoolFactory
import com.lynx.service.http.LynxHttpService
import com.lynx.service.image.LynxImageService
import com.lynx.service.log.LynxLogService
import com.lynx.tasm.LynxEnv
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
    }
}
