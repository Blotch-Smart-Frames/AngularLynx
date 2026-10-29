# Android shell template

The Android app that `ng build --platform android` builds. The generator copies this folder into `.angular/cache/<Angular version>/<project>/lynx-native/android`, fills in the few files below, and runs Gradle. Everything else is static: it's code we own and test, not something users edit (they can `eject` to get a copy they own).

The app is one activity holding one full-screen `LynxView` that runs `main.lynx.bundle`. Angular Router does all navigation inside it.

## What the generator changes

| What            | Where                                                         | Notes                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The bundle      | `app/src/main/assets/`                                        | The whole `dist/` folder (`main.lynx.bundle`, `static/…`), copied after emptying the folder. Bundled files are read from here.                                                                                                                                                                                                                      |
| App identity    | `angular-lynx.properties`                                     | Keys: `applicationId`, `versionName`, `versionCode`, `appName`, `screenOrientation` (`portrait`, `sensorLandscape` or `unspecified`). Read by `app/build.gradle.kts`. The committed file holds defaults.                                                                                                                                            |
| Permissions     | `AndroidManifest.xml`, at `<!-- angular-lynx:permissions -->` | `<uses-permission>` lines. `INTERNET` is always declared.                                                                                                                                                                                                                                                                                           |
| Deep links      | `AndroidManifest.xml`, at `<!-- angular-lynx:deep-links -->`  | `<intent-filter>`s inside the main activity.                                                                                                                                                                                                                                                                                                        |
| SDK location    | `local.properties`                                            | `sdk.dir=…`, unless `ANDROID_HOME` is set.                                                                                                                                                                                                                                                                                                          |
| Release signing | Gradle properties, from the environment                       | `ORG_GRADLE_PROJECT_angularLynxStoreFile`, `…StorePassword`, `…KeyAlias`, `…KeyPassword` (no dots: dash, `/bin/sh` on Debian and Ubuntu, drops variables whose names aren't shell identifiers before `gradlew` starts Gradle). Never written to disk. Without all four, release builds are signed with the debug key (installable, not uploadable). |

Build commands and outputs (no flavors, so the names are fixed):

```sh
./gradlew :app:assembleDebug                      # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease :app:bundleRelease # app/build/outputs/apk/release/app-release.apk
                                                  # app/build/outputs/bundle/release/app-release.aab
```

## How the shell loads the app

- **Bundles** come from `assets/` (`ResourceFetchers.kt`, `BundleAssets.kt`). A URL without a scheme (`/static/…`, `static/…`), `asset:///…` and `file:///android_asset/…` all mean "the file at that path in `assets/`", so the bundle works with Rspeedy's default asset prefix (`/`) and doesn't need a platform-specific one. Absolute `http(s)` URLs are fetched with OkHttp.
- **`fetch()` and `XMLHttpRequest`** go through Lynx's HTTP service (`LynxHttpService`, registered in `ShellApplication.kt`), which uses OkHttp. Plain HTTP is allowed to `localhost` and `127.0.0.1` only (`res/xml/network_security_config.xml`), for a server on the device or one on your machine through `adb reverse`; every other host needs HTTPS, Android's default.
- **Images** are loaded by Fresco. The media fetcher rewrites bundled image URLs to `asset:///…`, which Fresco reads from the APK.
- **Lazy routes** need nothing extra: the build plugin keeps each lazy chunk inside `main.lynx.bundle` (see `split-chunks.ts` in the build plugin). Bundles requested by URL at runtime still go through the template resource fetcher.

## Back button

Back is off by default, so it leaves the app like any root screen. The runtime turns it on while the Router has history by calling `NativeModules.AngularLynxShell.setBackHandlerEnabled(true)`, and off again on the first screen (`LynxBackButton` in `packages/runtime/src/lib/router/lynx-back-button.ts`, which `provideRouter()` starts; the call goes through the background thread, where `NativeModules` lives). While it's on, a back press sends the global event `angularLynxBack` instead, which the runtime turns into `Location.back()`. The app has to say beforehand because Android decides synchronously, at the start of the gesture, whether an app handles back (predictive back animates differently). Layer 6's `native/back-button.yaml` checks both ends.

## Global props

`MainActivity.globalProps()` sends what the runtime reads and Lynx has no API for (see the package README), again on every configuration change and accessibility setting change.

- **Dynamic color.** On Android 12 and later, `dynamicColors` carries the wallpaper's colors as Material 3's color roles, light and dark, as hex colors such as `#6750a4` (`DynamicColors.kt`, read by `LynxTheme.dynamicColors`). Android 14 has a color resource for most roles, which follows its contrast setting; on Android 12 and 13 each role takes its tone from the five tonal palettes, as Material Components does (a palette's own shade, or tone 40 moved to the tone with `ColorStateList.withLStar`). On the Android 14 emulator the two agree to within a few levels on the surfaces and exactly elsewhere.
- **A new wallpaper doesn't restart the activity.** Android applies the new colors as a configuration change, which `onConfigurationChanged` handles like a dark mode switch, so the running app restyles with its state intact.
- **The window follows dark mode by hand.** `configChanges` keeps the activity through a dark mode switch, so the window keeps the theme it started with. `onConfigurationChanged` sets its background (`@color/window_background`, which shows behind the system bars) and the bars' icons (`enableEdgeToEdge()`) again.

## Versions

Pinned in `app/build.gradle.kts`, `build.gradle.kts` and `gradle/wrapper/gradle-wrapper.properties`:

- Lynx 4.1.0 and PrimJS 4.1.1 (Maven Central), Fresco 2.3.0 (the version Lynx's image service is built against), OkHttp 4.12.
- Lynx's XElement 4.1.0 (`<input>`, `<textarea>`, `<overlay>`, `<svg>`, `<blur-view>`, `<viewpager>`, `<refresh>`, the `<scroll-coordinator>` family, `<webview>`, `<video>`), without its AnimaX and Markdown modules, which the runtime doesn't support. `MainActivity` registers the elements with `XElementBehaviors`. XElement depends on appcompat and material 1.0.0, whose vectordrawable libraries share a namespace that AGP 9 rejects, so appcompat 1.7.1 and material 1.12.0 are pinned.
- AGP 9.4.1 with its built-in Kotlin, Gradle 9.6.1 (AGP 9.4's minimum), JDK 17 or newer.
- `compileSdk` and `targetSdk` 36, `minSdk` 24. Google Play raises its target API requirement every August; bump `targetSdk` with it.
