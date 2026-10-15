# Native App Builds — Design

Status: **Phases 0, 1 and 3 implemented; Phase 2 partly** (2026-10-15). See [Implementation status](#implementation-status) for what was built, measured and changed from this plan.

## Goal

An AngularLynx developer runs one Angular CLI command and gets a store-ready binary in `dist/`:

```sh
ng build --platform ios       # → dist/ios/MyApp.ipa
ng build --platform android   # → dist/android/my-app.aab
```

They never see, edit, or commit an Xcode or Gradle project. The native shell is an implementation detail, owned and tested by us, in the same way Angular hides webpack/esbuild today. When someone really does need the native projects, an explicit `eject` hands them over.

---

## Background

### How a Lynx app becomes a binary

Lynx never compiles Angular to Swift or Kotlin. A store binary is an ordinary native app that links the Lynx engine (C++ core plus the PrimJS JavaScript engine) and carries our `main.lynx.bundle` as a data file. On launch the app starts Lynx, a _template provider_ hands it the bundle bytes, and a `LynxView` renders it. The bundle is the same file on every platform; only the shell differs.

So "build a binary" means: build the bundle (`rspeedy build`, already done by `@blotch/rsbuild-plugin-angular-lynx`), put it inside a native shell, compile and sign the shell. See Lynx's [Integrate with Existing Apps](https://lynxjs.org/guide/start/integrate-with-existing-apps) for the minimal shell on each platform.

### What we learned from Sparkling (2026-10-14)

[Sparkling](https://tiktok.github.io/sparkling/) is TikTok's app framework on top of Lynx (roughly Lynx's Expo), and the Lynx docs point new apps to it. We ran an AngularLynx app inside a stock Sparkling 2.0.1 shell on the iOS 27 Simulator and an Android API 34 emulator. It works: rendering, taps, lazy routes, and native page push/close between two Angular bundles. Getting there surfaced the problems this design has to avoid:

- **Sparkling owns the Lynx version.** Its podspecs pin `Lynx/Framework (= 3.6.0)` exactly (the 2.1 RC pins 3.9.0), so iOS can't move to Lynx 4.1, which our E2E tests use. On Android a Gradle `resolutionStrategy` override to 4.1.0 worked.
- **Its toolchain lags the platforms.** On Xcode 27, pods target iOS 9–12 (below the iOS 15 minimum, [tiktok/sparkling#142](https://github.com/tiktok/sparkling/issues/142)) and its Swift `@_section` service registrations no longer compile. The Android template needs JDK 11, AGP 7.4, and `targetSdk 34`, which is below Google Play's current requirement.
- **CocoaPods brings Ruby.** macOS ships Ruby 2.6, which the template's Gemfile rejects. That's one more tool users must install and keep working.
- **Its navigation model is one bundle per native screen**, each a separate JS runtime. That's a separate Angular app per screen, with no shared DI, services or Router. AngularLynx's goal is a single Angular app where Router does the navigation.
- **Angular-specific fixes it exposed** (now done or documented): `runOnBackground` was broken on native (fixed in `packages/runtime/src/lib/global-callbacks.ts`), and native modules can only be called from the background thread (see the `NativeModules` entry in `lynx-vs-web-differences.md`).

Conclusion: Sparkling stays a supported option, but the default path should be a shell we own, so we control the Lynx version, toolchain compatibility, and app shape.

### Lynx distribution facts that shape the design

- **Android:** Lynx publishes prebuilt AARs to Maven (`org.lynxsdk.lynx:lynx`, `primjs`, `lynx-service-*`). A shell build is a normal Gradle build of a little Kotlin.
- **iOS:** Lynx does **not** publish prebuilt binaries. The per-pod zips on the [4.1.0 release](https://github.com/lynx-family/lynx/releases/tag/4.1.0) (`Lynx-4.1.0.zip`, `LynxBase-4.1.0.zip`, ...) contain source and podspecs. A CocoaPods install compiles Lynx's C++ from source on the first build, which took about 20 minutes in the Sparkling test.

---

## Decisions

| Question                  | Decision                                                                        | Why                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command surface           | **Angular CLI builders** (`ng build`, `ng serve`)                               | Angular developers already know `ng build`/`ng serve`, `angular.json` options, and `configurations`; the tool stays invisible.                                               |
| How binaries are produced | **Generate hidden native projects**, then build them with `xcodebuild` / Gradle | Expo's proven "Continuous Native Generation" model. Robust, supports permissions and eject. Repackaging a prebuilt app was rejected as brittle and closed to native changes. |
| v1 native customization   | **Config + eject**                                                              | Config covers common needs (permissions, deep links, icons). Eject unblocks anyone else on day one. A public plugin API waits until the internal modifiers are proven.       |
| Platform order            | **Both in parallel**                                                            | One config schema and generator core serve both shells, so they're developed together.                                                                                       |
| Navigation model          | **One `LynxView`, Angular Router navigates**                                    | Keeps the "one Angular app" model. Native multi-screen navigation (Sparkling-style) can be added later as an opt-in.                                                         |

---

## User experience

`ng add @blotch/angular-lynx` points the project's `build` and `serve` targets at our builders and sets the package.json scripts back to `ng build` / `ng serve` (today they run `rspeedy build` / `rspeedy dev` directly).

```sh
ng build                                  # bundle only → dist/main.lynx.bundle (today's behavior)
ng build --platform ios                   # → dist/ios/MyApp.ipa + dist/ios/MyApp-simulator.app
ng build --platform android               # → dist/android/my-app.aab + dist/android/my-app.apk
ng build --platform all
ng build --platform ios --configuration staging

ng serve                                  # dev server, as today (Lynx Explorer / web preview)
ng serve --platform ios                   # dev server + debug shell on a simulator, live reload
ng serve --platform android --device <id>

ng generate @blotch/angular-lynx:eject    # write ios/ + android/ into the repo (one-way)
```

Output:

```
dist/
  main.lynx.bundle
  static/…                     # images referenced by the bundle
  ios/
    MyApp.ipa                  # signed for App Store / TestFlight (when signing is configured)
    MyApp-simulator.app
  android/
    my-app.aab                 # signed with the upload key, for Google Play
    my-app.apk                 # for emulators and sideloading
```

### Configuration

App identity lives in `angular.json` as builder options. The builder's JSON schema validates it, so editors autocomplete it, and Angular `configurations` give per-environment overrides. Secrets are never stored in `angular.json`: options name environment variables, and the builder reads them.

The options are flat rather than nested under `app`: Angular merges a configuration into the base options one key deep, so a `"staging": { "app": { "id": ... } }` override would have dropped every other `app` field. The build target also keeps the Angular compiler options `ng new` wrote (`browser`, `tsConfig`, `polyfills`, `styles`, ...), because `@blotch/rsbuild-plugin-angular-lynx` and `ng test` read them from it.

```jsonc
"build": {
  "builder": "@blotch/angular-lynx:application",
  "options": {
    "browser": "src/main.ts",                // Angular options, as ng new wrote them
    "tsConfig": "tsconfig.app.json",
    "appName": "My App",
    "appId": "com.example.myapp",             // iOS bundle ID and Android applicationId
    "version": "1.2.0",
    "buildNumber": 42,                        // CFBundleVersion / versionCode
    "icon": "src/assets/icon.png",            // one 1024×1024 PNG
    "orientation": "portrait",
    "permissions": { "camera": "Scan receipts" },  // NSCameraUsageDescription + CAMERA
    "deepLinkSchemes": ["myapp"],
    "ios": {
      "teamId": "ABCDE12345",
      "signing": { "keyIdEnv": "ASC_KEY_ID", "issuerIdEnv": "ASC_ISSUER_ID", "keyPathEnv": "ASC_KEY_PATH" }
    },
    "android": {
      "signing": { "storeFileEnv": "UPLOAD_KEYSTORE", "storePasswordEnv": "UPLOAD_STORE_PASSWORD", "keyAlias": "upload", "keyPasswordEnv": "UPLOAD_KEY_PASSWORD" }
    }
  },
  "configurations": {
    "production": { "mode": "production" },
    "staging": { "appId": "com.example.myapp.staging", "appName": "My App (Staging)" }
  }
}
```

The principle: anything a store listing or OS needs is an option; nothing requires opening a native file.

---

## Architecture

```
ng build --platform ios
   │
   ├─ 1. Bundle      rspeedy (JS API) + pluginAngularLynx  → dist/main.lynx.bundle, lazy bundles, static/
   │
   ├─ 2. Generate    template(@blotch/angular-lynx-native) + angular.json options
   │                 → .angular-lynx/native/ios   (gitignored, cached by input hash)
   │
   ├─ 3. Build       xcodebuild archive + export  |  ./gradlew bundleRelease assembleRelease
   │
   └─ 4. Collect     → dist/ios/*.ipa, *.app      |  → dist/android/*.aab, *.apk
```

### 1. Builders (`packages/runtime`, alongside the schematics)

- `@blotch/angular-lynx:application`: `ng build`. Without `--platform`, it only builds the bundle (equivalent to today's `rspeedy build`).
- `@blotch/angular-lynx:dev-server`: `ng serve`. Hosts the rspeedy dev server; with `--platform`, also builds and launches the debug shell.
- Both drive rspeedy through its JavaScript API rather than spawning the CLI, so errors and progress go through the Angular builder context and look like a normal `ng build`.
- Users never configure asset paths: the shells resolve RSpeedy's default `/static/...` URLs against the bundled files (see the shell section below).

### 2. Native shell templates (new package `@blotch/angular-lynx-native`)

Swift and Kotlin source we own, versioned and released with the runtime, pinned to one Lynx version (4.1 at the start) and covered by E2E. Both shells implement the same features:

| Feature                    | Notes                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Lynx startup               | `LynxEnv` init in `AppDelegate` / `Application.onCreate`, plus image, log and HTTP services.                     |
| Bundle loading             | A template provider that serves `main.lynx.bundle` and lazy-route bundles (`lazy-bundle/…`) from inside the app. |
| Static assets              | Bundle image paths (`/static/...`) resolve to files inside the app, so images work without a dev server.         |
| One full-screen `LynxView` | Safe-area aware. Angular Router does all navigation inside it.                                                   |
| Android back button        | Sent to the app as an event the runtime turns into Router back navigation; exits when there's no history.        |
| Deep links                 | Custom schemes (and later universal/app links) delivered as init data / an event, for Router to handle.          |
| Lifecycle                  | Foreground/background events exposed to Angular.                                                                 |
| Debug features             | Lynx DevTool and the dev-server connection in debug builds only, stripped from release builds.                   |

### 3. Generator (shared core)

- Copies the template into `.angular-lynx/native/<platform>`, then applies typed modifiers driven by the config:
  - iOS: `Info.plist`, entitlements, asset catalog (icons and splash generated from the source images), project build settings (bundle ID, version, team).
  - Android: `AndroidManifest.xml`, `build.gradle` (applicationId, versionCode, signing), resources (icons, splash, app name).
- The same inputs always generate the same output. A hash of (template version, Lynx version, options, icon/splash files) decides whether to regenerate; otherwise the cache is reused, so incremental native builds stay fast.
- The modifiers are internal in v1. They become the public plugin API in a later phase, which native-module libraries use to declare their native setup.

### 4. Native builds

**iOS** (requires macOS and Xcode; Apple requires App Store builds to come from Xcode):

- Link Lynx as **prebuilt XCFrameworks that we produce** for each Lynx version (built from Lynx's source pods in our CI, published as release assets, downloaded and cached by checksum). The template's Xcode project references them directly, through a `Frameworks` symlink to the cache, rather than through Swift Package Manager: nothing to resolve, and it works offline once cached. This removes CocoaPods and Ruby from the user's machine and avoids compiling Lynx's C++ on the first build.
- Simulator: `xcodebuild -sdk iphonesimulator` → `.app`.
- Release: `xcodebuild archive` then `-exportArchive` with a generated `ExportOptions.plist` → `.ipa`. Signing is headless with an App Store Connect API key (`-allowProvisioningUpdates` with `-authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID`), so users never open Xcode to manage certificates or profiles.
- The deployment target follows Xcode's current minimum (iOS 15 on Xcode 27), set in the template rather than left to dependencies.

**Android:**

- Gradle wrapper (downloads Gradle itself). On macOS, when `JAVA_HOME` isn't set, the builder asks `java_home` for JDK 17 or newer. It passes the SDK to Gradle as `ANDROID_HOME` (from the environment or Android Studio's default location), so the project never stores a machine path. Android SDK packages are installed with `sdkmanager` after the user accepts the licenses.
- `assembleRelease` + `bundleRelease` → `.apk` (emulators, sideloading) and `.aab` (Google Play). The upload key reaches Gradle as `ORG_GRADLE_PROJECT_angularLynx.*` environment variables, never on the command line or in a file; without it, the release build is signed with the debug key.
- `targetSdk` follows Google Play's current requirement. We own bumping it each year.

### 5. Doctor

`ng run <project>:doctor` (or run automatically when a native build fails early) checks Xcode and the simulator runtimes, the JDK, the Android SDK and emulators, and the signing inputs. For each problem it prints the exact command to fix it. It sets up anything safe to automate by itself, and asks before anything that installs software or accepts licenses.

### 6. Eject

`ng generate @blotch/angular-lynx:eject` runs the generator one last time into `ios/` and `android/` at the project root. The builder checks for those folders first; if they exist, it builds them as they are and never regenerates. Ejecting is one-way: after it, native upgrades (Lynx versions, Xcode/Play requirements) are the user's job, as in Expo's bare workflow. The docs and the schematic's output need to say so plainly.

---

## Testing

- **Unit:** the generator (config → modified plist/manifest/gradle, input-hash caching), the builders (option handling, step ordering) and the schematics, all with Vitest like the rest of the repo.
- **E2E Layer 6** switches from Lynx Explorer to our generated shells: CI builds a simulator `.app` and an emulator `.apk` from the fresh scaffolded app, installs them, and runs the existing Maestro flows (counter, lazy route). This also tests the bundle-loading, lazy-bundle and asset paths that Explorer currently hides.
- **Release artifacts:** CI builds a signed `.ipa` and `.aab` with test credentials and inspects them (bundle ID, version, embedded `main.lynx.bundle`, icons present, `targetSdk`). Uploading to stores stays manual until a `submit` command exists.

---

## Phases

| Phase                          | Scope                                                                                                                                                                                                                                                                                                    | Done when                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **0. Spikes** (both platforms) | Build Lynx 4.1 + PrimJS as XCFrameworks and measure a shell build that uses them without CocoaPods. Minimal Swift and Kotlin shells render the E2E fixture app, including lazy routes and images. Headless iOS signing with an App Store Connect API key. A builder prototype wrapping rspeedy's JS API. | Each risk below has a yes/no answer with evidence, and the fallback is chosen where the answer is no.              |
| **1. Core**                    | Config schema, generator with caching, `application` builder, simulator `.app` and emulator `.apk`. `ng add` updated. E2E Layer 6 moved off Explorer.                                                                                                                                                    | A fresh `npm create angular-lynx` app runs `ng build --platform all` and the Maestro flows pass on both platforms. |
| **2. Release binaries**        | Signed `.ipa` and `.aab`. Icons, splash, permissions, deep links, version and build numbers.                                                                                                                                                                                                             | Both binaries upload successfully to TestFlight and a Play internal testing track.                                 |
| **3. Eject**                   | Eject schematic; builder uses `ios/`/`android/` when present.                                                                                                                                                                                                                                            | An ejected app builds with the same command, and a native edit in `ios/` shows up in the binary.                   |
| **4. Dev loop**                | `dev-server` builder with `--platform`: debug shells load from the dev server, with live reload.                                                                                                                                                                                                         | Editing a component reloads the app on a simulator and an emulator without Lynx Explorer.                          |
| **5. Later**                   | Public plugin API + autolinking for native-module libraries; `submit` (App Store Connect and Play APIs); cloud builds (iOS without a Mac); HarmonyOS; opt-in native multi-screen navigation.                                                                                                             | Planned separately.                                                                                                |

---

## Risks and fallbacks

| Risk                                                                                                        | Fallback if the Phase 0 spike fails                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lynx's iOS source pods don't build cleanly into XCFrameworks outside CocoaPods.                             | Keep CocoaPods inside the generated project and cache the compiled Lynx between builds (keyed by Lynx version). Users then need Ruby, which the doctor installs or explains. |
| rspeedy's JS API isn't stable or complete enough to wrap in a builder, or can't share `ng serve`'s process. | The builders spawn the `rspeedy` CLI and parse its output; the dev server runs as a child process.                                                                           |
| Headless signing still needs a one-time Xcode login or manual profile setup.                                | Document a one-time setup step, keep later builds headless, and make the doctor detect a missing setup.                                                                      |
| Store requirements change (minimum Xcode SDK, Play target API, privacy manifests).                          | Not avoidable: a yearly template update, caught early by CI running on the newest Xcode and Android images.                                                                  |
| Users need native code before the plugin API exists.                                                        | Eject (v1).                                                                                                                                                                  |

---

## Implementation status

As of 2026-10-15. Verified on Xcode 27 with the iOS 27 Simulator, and on an API 34 Android emulator, with the E2E fixture app (counter, lazy route) plus a bundled image.

### What exists

| Piece                                                                      | Where                                                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `application` and `dev-server` builders                                    | `packages/runtime/builders/` (`builders.json` in the runtime's package.json)                        |
| Generator, signing, xcodebuild/Gradle runners, eject renderer              | `packages/native/src/` (`@blotch/angular-lynx-native`)                                              |
| Swift shell, XcodeGen spec and generated `App.xcodeproj`                   | `packages/native/templates/ios/`                                                                    |
| Kotlin shell, Gradle wrapper                                               | `packages/native/templates/android/` (its README documents the generator contract)                  |
| XCFramework build                                                          | `packages/native/scripts/build-lynx-ios-frameworks.sh`, `.github/workflows/lynx-ios-frameworks.yml` |
| `ng add` switches `build`/`serve` to the builders, adds the native package | `packages/runtime/schematics/ng-add/`                                                               |
| Eject schematic                                                            | `packages/runtime/schematics/eject/`                                                                |
| Layer 6 against the app's own build                                        | `run-native.ts --app <app>`, `npm run e2e -- --ios --shell`                                         |

### Phase results

- **Phase 0, every risk answered yes.**
  - Lynx 4.1's source pods build into XCFrameworks with CocoaPods 1.16 (`use_frameworks! :linkage => :dynamic`, `inhibit_all_warnings!`, deployment targets raised to 15). `build-lynx-ios-frameworks.sh` takes 6.5 minutes from scratch on an 18-core Apple silicon Mac (pod install, both compiles, packaging). The frameworks are 82 MB unzipped and 24 MB zipped; debug symbols (800 MB, almost all Lynx) go in a separate zip.
  - Both shells render the fixture app.
  - rspeedy's JS API (`loadConfig`, `createRspeedy`, `build`, `startDevServer`, all `@public` in its API report) is enough; `ng serve` keeps the QR code output and live reload.
  - Headless iOS signing is implemented (archive, then `-exportArchive` with the API key flags) but **not yet verified**: it needs an Apple Developer account. An unsigned device archive builds.
- **Phase 1, done** except moving CI's Layer 6 off Explorer (below). A fresh `npm create angular-lynx` app from the local registry passes the Maestro flows on both platforms through `ng build --platform`. Layers 1–3 pass with the builders in place.
- **Phase 2, partly.** Permissions, deep links, orientation, version and build numbers, and the iOS icon are generated. Android release signing works with a real keystore. Not done: the Android icon and splash (placeholders now), uploading to TestFlight and Play.
- **Phase 3, done.** An ejected project builds with the same command, and a native edit in `ios/` appears in the app.
- **Phases 4–5, not started.**

### Measured

|                                                 | iOS                      | Android                                              |
| ----------------------------------------------- | ------------------------ | ---------------------------------------------------- |
| `ng build --platform`, first build on a machine | 13 s (frameworks cached) | about 8 min, mostly downloading Gradle, AGP and AARs |
| Same, nothing changed                           | 5 s (bundle included)    | 9 s with a warm Gradle cache                         |
| Output                                          | 41 MB simulator `.app`   | 52 MB universal `.apk`, 23 MB `.aab`                 |

### Changes from the plan above

- **Flat builder options** instead of an `app` object, because of Angular's one-level configuration merge (see [Configuration](#configuration)).
- **The build target keeps Angular's compiler options**, read by the build plugin and `ng test`. Side effect: `ng test` warns on every run that its `buildTarget` uses a builder it doesn't know ("Unexpected behavior or build failures may occur"). Tests still pass. Accepted (2026-10-15): removing the warning would mean a second target holding the same compiler options, which can drift.
- **No asset scheme needed.** RSpeedy's default asset prefix (`/static/...`) works: both shells resolve URLs without a scheme against the bundled `dist/` (iOS through a `LynxMediaResourceFetcher`, Android by rewriting to `asset:///`). Images render on both, unlike Sparkling's `asset:///` on iOS.
- **XCFrameworks referenced directly** rather than through Swift Package Manager (see Native builds).
- **Android toolchain:** AGP 9.4.1 (built-in Kotlin), Gradle 9.6.1, compile/target SDK 36, minSdk 24, Fresco 2.3.0 (what Lynx's image service is built against). R8 is off until Lynx's keep rules are verified, and XElement isn't included (its Android artifact is all-or-nothing).
- **Back button:** the Android shell sends `angularLynxBack` once the app opts in through `NativeModules.AngularLynxShell.setBackHandlerEnabled(true)`. The runtime doesn't call it from Router state yet.

### Next

1. ~~Publish the iOS frameworks zip.~~ Done: the [`lynx-ios-4.1.0` release](https://github.com/Blotch-Smart-Frames/AngularLynx/releases/tag/lynx-ios-4.1.0), pinned in `packages/native/src/ios/frameworks.ts`. Built locally with Xcode 27 by the same script the workflow runs (the workflow can only be dispatched once it is on `master`). A clean machine downloads and verifies it on its first iOS build.
2. **Move CI's Layer 6 to the shells.** The Android job can build the APK on Linux; the iOS job needs the published frameworks.
3. **Verify headless iOS signing** with an App Store Connect API key, and upload to TestFlight and a Play internal track.
4. Router-driven Android back navigation in the runtime; Android icon and splash generation; a `doctor` target.
5. Phase 4 (debug shells loading from the dev server, with Lynx DevTool).
6. **Before the next release tag:** `@blotch/angular-lynx-native` has never been published, and `publish.yml` uses npm trusted publishing, which is configured per package on npmjs.com and needs the package to exist. Publish it once by hand (`npm publish --access public` from `packages/native`), then add this repository and `publish.yml` as its trusted publisher. Otherwise the release stops at this package, after the build plugin is published and before the runtime is.

---

## Non-goals (for now)

- Hiding the need for macOS + Xcode to build iOS binaries. Only a cloud build service removes that.
- Managing signing identities for users (creating certificates, keystores or store listings). We consume credentials; we don't create them silently.
- Replacing Sparkling. Apps that want Sparkling keep working: build with `pluginAngularLynx` in Sparkling's `app.config.ts`, add `"type": "module"` to `package.json`, and call its bridge through `runOnBackground`.

---

## References

- Lynx: [Integrate with Existing Apps](https://lynxjs.org/guide/start/integrate-with-existing-apps), [Build with an App Framework](https://lynxjs.org/guide/start/build-with-app-framework), [4.1.0 release assets](https://github.com/lynx-family/lynx/releases/tag/4.1.0)
- Sparkling: [docs](https://tiktok.github.io/sparkling/), [repo](https://github.com/tiktok/sparkling), [Xcode 27 issue #142](https://github.com/tiktok/sparkling/issues/142), [Callstack walkthrough](https://www.callstack.com/blog/sparkling-the-missing-app-layer-for-lynx-js)
- Expo's Continuous Native Generation (the model this design follows): native projects are generated from config and treated as build output
- In this repo: `packages/e2e/src/native/` (current Explorer-based native E2E), `investigations/lynx-native-navigation.md` (why one bundle with Angular Router), `investigations/lynx-vs-web-differences.md` (`NativeModules` / `runOnBackground` entry)
