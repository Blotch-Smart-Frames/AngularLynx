package expo.modules.appstartupmodule

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AppStartupModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppStartupModule")

    // Android's own fully drawn mark: logcat's "Fully drawn" line and Macrobenchmark read it.
    Function("reportFullyDrawn") {
      appContext.currentActivity?.reportFullyDrawn()
    }

    // The first frame comes from `am start -W`, so there is nothing to report.
    Function("reportInitiallyDrawn") {}

    // Android has no signpost; a tagged log line is what a script can find in logcat.
    Function("reportMountStart") {
      Log.i("LaunchPerf", "MountStart")
    }

    Function("reportMountEnd") {
      Log.i("LaunchPerf", "MountEnd")
    }
  }
}
