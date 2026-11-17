package expo.modules.appstartupmodule

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AppStartupModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppStartupModule")

    Function("reportFullyDrawn") {
      appContext.currentActivity?.reportFullyDrawn()
    }

    Function("reportInitiallyDrawn") {}
  }
}
