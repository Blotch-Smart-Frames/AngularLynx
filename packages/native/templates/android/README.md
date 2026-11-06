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

## Web sign-in

`NativeModules.AngularLynxWebAuth.start(request, callback)` (`WebAuthModule.kt`, behind the runtime's `LynxWebAuthSession`) opens `request.url` in a Custom Tab (`androidx.browser`). The page's redirect to `request.callbackScheme` comes back as a deep link: the activity is `singleTask`, so the intent reaches the open one in `onNewIntent`, which hands the URL to the callback, and starting it closes the Custom Tab above it. That's why the scheme has to be in the app's `deepLinkSchemes`. Android says nothing when a Custom Tab is closed, so the activity resuming with a session still open, after having gone behind the tab, means the person canceled. iOS's `WebAuthModule.swift` reports the same results through `ASWebAuthenticationSession`.

## Links

`NativeModules.AngularLynxLinking` (`LinkingModule.kt`, behind the runtime's `LynxLinking`) opens links outside the app. `MainActivity` registers it with itself as the param, since the module starts activities from it and watches its lifecycle.

- **`openURL(url, callback)`** starts an `ACTION_VIEW` intent, which the browser, the mail app or the app that claims the URL opens, and calls back with `{}`, or with `{ error, message }` when nothing does.
- **`openInApp(url, options, callback)`** opens an http(s) URL in a Custom Tab, with `options.toolbarColor` as its toolbar color. Android says nothing when a Custom Tab closes, so the module watches the activity's lifecycle and calls back when it resumes after pausing for the tab: the person closed the tab or came back to the app another way. It doesn't touch `WebAuthModule`'s session, which `MainActivity` tracks on its own.
- **`canOpenURL(url, callback)`** asks `resolveActivity`, which from Android 11 sees only the apps the manifest's `<queries>` names: one `VIEW` intent per scheme, which the generator writes between the `angular-lynx:queries` markers from angular.json's `canOpenURLSchemes`, after `http`, `https`, `mailto`, `tel` and `sms`. Starting an activity needs no `<queries>`.

iOS's `LinkingModule.swift` does the same with `UIApplication.open`, `SFSafariViewController` and `UIApplication.canOpenURL`, which answers only for the schemes in Info.plist's `LSApplicationQueriesSchemes`.

## Storage

`NativeModules.AngularLynxLocalStorage` and `NativeModules.AngularLynxSecureStorage` (`LocalStorageModule.kt` and `SecureStorageModule.kt`, behind the runtime's `LynxLocalStorage` and `LynxSecureStorage`) keep string values, which the runtime stores as JSON, each in a `SharedPreferences` file of its own. Each method calls back once with `{ value }`, `{}` or `{ error }`.

- **Secure values are encrypted with AES-GCM** by a key the Android Keystore makes the first time and never lets out, with the value's key as the associated data. Android's `EncryptedSharedPreferences` did the same, but `androidx.security:security-crypto` is deprecated. The secure module works on one background thread shared by every LynxView, since the Keystore can be slow, so calls run in order.
- **Auto Backup leaves out the secure file** (`res/xml/backup_rules.xml` up to Android 11, `data_extraction_rules.xml` from 12): the key can't leave the device, so a restored copy couldn't be decrypted. A value that won't decrypt anyway is removed and read as none.

iOS's `LocalStorageModule.swift` uses a `UserDefaults` suite and `SecureStorageModule.swift` the Keychain, readable after the first unlock and never moved to another device.

## Canvas and WebGL

`<canvas>` (issue #211) is the shell's: `CanvasUI.kt`, a `TextureView` registered as the `canvas` element (`addBehavior(CanvasUI.behavior())`), and `WebGLModule.kt`, the `AngularLynxWebGL` module the runtime's WebGL2 context sends its calls to. `MainActivity` turns on main-thread modules (`setEnableMTSModule(true)`), so the runtime, which runs on Lynx's main thread, calls the module synchronously with `lynx.module(name)`, on the UI thread. Each context (`WebGLContext.kt`) is an EGL context with OpenGL ES 3.0 and an offscreen default framebuffer, which `present` copies into the canvas's surface; `WebGLOps.kt` is generated from the runtime's opcodes (`npm run generate:webgl-ops -w packages/native`). `AssetsModule.kt` (`AngularLynxAssets`) reads a file the app bundles for the main thread's `fetch`, which has no page URL to resolve `/static/...` against.

Android's GLES has no 2D uploads from a `PIXEL_UNPACK_BUFFER` and no `glGetVertexAttribPointerv`, so those log a warning and answer 0.

## Global props

`MainActivity.globalProps()` sends what the runtime reads and Lynx has no API for (see the package README), again on every configuration change and accessibility setting change.

- **Dynamic color.** On Android 12 and later, `dynamicColors` carries the wallpaper's colors as Material 3's color roles, light and dark, as hex colors such as `#6750a4` (`DynamicColors.kt`, read by `LynxTheme.dynamicColors`). Android 14 has a color resource for most roles, which follows its contrast setting; on Android 12 and 13 each role takes its tone from the five tonal palettes, as Material Components does (a palette's own shade, or tone 40 moved to the tone with `ColorStateList.withLStar`). On the Android 14 emulator the two agree to within a few levels on the surfaces and exactly elsewhere.
- **A new wallpaper doesn't restart the activity.** Android applies the new colors as a configuration change, which `onConfigurationChanged` handles like a dark mode switch, so the running app restyles with its state intact.
- **The window follows dark mode by hand.** `configChanges` keeps the activity through a dark mode switch, so the window keeps the theme it started with. `onConfigurationChanged` sets its background (`@color/window_background`, which shows behind the system bars) and the bars' icons (`enableEdgeToEdge()`) again.

## Versions

Pinned in `app/build.gradle.kts`, `build.gradle.kts` and `gradle/wrapper/gradle-wrapper.properties`:

- Lynx 4.1.0 and PrimJS 4.1.1 (Maven Central), Fresco 2.3.0 (the version Lynx's image service is built against), OkHttp 4.12.
- `androidx.browser` 1.8.0, for the Custom Tabs `WebAuthModule` opens sign-in pages in and `LinkingModule` opens `openInApp()`'s pages in.
- Lynx's XElement 4.1.0 (`<input>`, `<textarea>`, `<overlay>`, `<svg>`, `<blur-view>`, `<viewpager>`, `<refresh>`, the `<scroll-coordinator>` family, `<webview>`, `<video>`), without its AnimaX and Markdown modules, which the runtime doesn't support. `MainActivity` registers the elements with `XElementBehaviors`. XElement depends on appcompat and material 1.0.0, whose vectordrawable libraries share a namespace that AGP 9 rejects, so appcompat 1.7.1 and material 1.12.0 are pinned.
- AGP 9.4.1 with its built-in Kotlin, Gradle 9.6.1 (AGP 9.4's minimum), JDK 17 or newer.
- `compileSdk` and `targetSdk` 36, `minSdk` 24. Google Play raises its target API requirement every August; bump `targetSdk` with it.
