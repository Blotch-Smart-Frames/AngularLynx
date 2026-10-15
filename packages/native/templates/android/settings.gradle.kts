// The Android shell that AngularLynx generates into .angular-lynx/native/android.
// See README.md for what the generator changes; everything else is static.
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        // Lynx publishes its Android AARs (org.lynxsdk.lynx) to Maven Central.
        mavenCentral()
    }
}

rootProject.name = "AngularLynxShell"
include(":app")
