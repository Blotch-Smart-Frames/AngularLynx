# launchperf-poke, ReactLynx

Software Mansion's [`launchperf-poke-rn`](https://github.com/software-mansion-labs/launchperf-poke-rn) (MIT, see `LICENSE`), the reference in `../react-native`, ported screen for screen to [ReactLynx](https://lynxjs.org/react/) (`@lynx-js/react`, built with rspeedy). `../../SPEC.md` says what every app in the benchmark does.

It runs in **the native shell AngularLynx apps run in**: the Swift project `@blotch/angular-lynx-native` generates for `ng build --platform ios` (`packages/native/templates/ios`), with the same Lynx 4.1 frameworks, thread strategy (`MostOnTASM`), modules, splash and build settings. On Android it's the Kotlin project `ng build --platform android` generates (`packages/native/templates/android`), with the same Lynx 4.1 AARs and the same settings. So this app and the AngularLynx one differ only in the JavaScript bundle the shell loads, which separates what Lynx costs from what Angular costs.

## Build

Needs Node 22.12+, Xcode, and the repository's packages built (`npm install && npm run build` at the root): the shell comes from `packages/native` itself (`file:../../../packages/native`), so the build follows the template on master rather than a release.

```sh
npm ci

# Release app for the iOS Simulator, against the fixture server on localhost:8787
npm run build:ios
# → build/ios/com.angularlynx.bench.reactlynx/LaunchPerfReactLynx-simulator.app

# Install and open it (simulator)
xcrun simctl install <udid> build/ios/com.angularlynx.bench.reactlynx/LaunchPerfReactLynx-simulator.app
xcrun simctl launch <udid> com.angularlynx.bench.reactlynx
```

`scripts/build-ios.mjs` runs `rspeedy build` (→ `dist/main.lynx.bundle`), renders the shell project into `build/native/ios`, and builds it with `buildNativeApp()`, the function the AngularLynx builder calls (details in the script's header). It renders the project without the canvas, WebGL and video frame code and ANGLE's frameworks (`renderEjectedProject()`'s `features`), which the AngularLynx app's shell leaves out because it draws on no canvas (issue #837): `buildNativeApp()` builds an ejected project as it is, so it wouldn't leave them out itself (issue #858). Environment variables:

| Variable         | Default                            | What it sets                                                                 |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| `FIXTURE_ORIGIN` | `http://localhost:8787`            | The fixture server, inlined into the bundle (`lynx.config.ts`)               |
| `BENCH_SCREEN`   | (empty: the Pokédex)               | A benchmark screen to open on instead of the tabs (below)                    |
| `APP_ID`         | `com.angularlynx.bench.reactlynx`  | The bundle ID                                                                |
| `APP_NAME`       | `LaunchPerfReactLynx`              | The name under the icon, and the `.app`'s name                               |
| `TEAM_ID`        |                                    | `DEVELOPMENT_TEAM` in the generated project, for a phone build               |

### The mount benchmark variant

Instruments launches an app without a URL, so the mount screen (`SPEC.md`, "Benchmark screens") is a build variant: with `BENCH_SCREEN` set, the app opens on that screen and never renders the tabs or fetches the list.

```sh
BENCH_SCREEN='mount?kind=view&count=1500' APP_ID=com.angularlynx.bench.reactlynx.mount npm run build:ios
```

`kind` is `view`, `text` or `image`, `count` any number (the SPEC uses 1500 and 5000). The screen marks `Fully Drawn` after the commit that shows all `count` elements. A different `APP_ID` per variant lets them sit beside the Pokédex build on one device.

### For the phone

The phone reaches the fixture server at the Mac's LAN address. Build the bundle and render the project, then build it with Xcode's development signing for team `F64LTK85F6`, as the harness signs every app:

```sh
FIXTURE_ORIGIN=http://192.168.1.231:8787 TEAM_ID=F64LTK85F6 node scripts/build-ios.mjs --project-only

xcodebuild build -project build/native/ios/App.xcodeproj -scheme App \
  -configuration Release -destination generic/platform=iOS \
  -derivedDataPath build/work/build/ios-device \
  DEVELOPMENT_TEAM=F64LTK85F6
# → build/work/build/ios-device/Build/Products/Release-iphoneos/LaunchPerfReactLynx.app
```

`--project-only` copies the bundle into the project and skips `xcodebuild`, whose simulator build isn't needed. The xcodebuild line needs a provisioning profile for the bundle ID already on the Mac: add `-allowProvisioningUpdates` only when you mean Xcode to create one (a Personal Team registers an App ID for it, against its weekly quota). The `Frameworks` link in the project points at the Lynx XCFrameworks in `~/.cache/angular-lynx/lynx-ios/`, which the first `npm run build:ios` downloads.

### For Android

```sh
# Release .apk (and .aab), against the fixture server on localhost:8787
npm run build:android
# → build/android/com.angularlynx.bench.reactlynx/launchperfreactlynx.apk

# Install it on a booted emulator (or a phone over USB), point the device's
# localhost:8787 at the Mac's, and open it
adb install -r build/android/com.angularlynx.bench.reactlynx/launchperfreactlynx.apk
adb reverse tcp:8787 tcp:8787
adb shell am start -n com.angularlynx.bench.reactlynx/dev.angularlynx.shell.MainActivity
```

`scripts/build-android.mjs` runs `rspeedy build` and hands `dist/` to `buildNativeApp()`, which generates the shell project into `build/work/android` and builds the release `.apk` with Gradle, R8 and the debug key, as `ng build --platform android` does for an AngularLynx app without `android.signing`. It takes the same `FIXTURE_ORIGIN`, `BENCH_SCREEN`, `APP_ID` and `APP_NAME` (not `TEAM_ID`), and `--skip-bundle`. Needs the Android SDK and JDK 17+, as `ng build --platform android` does.

Two things differ from the iOS script:

- **No ejected project.** The iOS script renders and ejects the project only to add `NSLocalNetworkUsageDescription`. Android has no such key, and the release shell already lets plain HTTP reach `localhost` (its `network_security_config.xml`), so the default `FIXTURE_ORIGIN` works on an emulator and on a phone over USB once `adb reverse` forwards the port. A LAN address would be refused as cleartext.
- **The features file says the shell leaves out the canvas.** The AngularLynx build plugin writes `.angular-lynx-native.json` beside the bundle, saying the app draws on no canvas, and the builder then leaves the canvas, WebGL and video frame code out of the project it generates (issue #837). rspeedy with ReactLynx's plugin writes no such file, and without one the builder keeps it all, so the script writes the file (`canvas: false`): neither app draws on a canvas, and both shells are built from the same code. The iOS script, whose project is ejected, passes the same to `renderEjectedProject()` instead.

## What it marks

- **`Fully Drawn`** (an `os_signpost` event in Points of Interest, which the harness reads like the original's `TTFD`; on Android, `Activity.reportFullyDrawn()`, which the system logs as `Fully drawn`): `NativeModules.AngularLynxShell.reportFullyDrawn()`, from the background thread, once per process. The original reports `TTFD` in a `useEffect` on the list query's `isSuccess`, inside `requestAnimationFrame`. Here the same effect calls `lib/fullyDrawn.ts`: ReactLynx runs effects on the background thread once a commit's patch is *sent* to the main thread, so it first runs an empty main-thread function with `runOnMainThread()`, whose call queues behind the patch and resolves once the main thread has applied and flushed it to native, then calls the shell's module. That's the moment AngularLynx's `reportFullyDrawn()` marks too (after the flush carrying the rows). In the mount variant, the mount screen does the same after its first commit.
- The shell's splash: the shell keeps a copy of the launch screen over the app until it's told the first screen is drawn (`hideSplashScreen`), as AngularLynx's `LynxSplashScreen` does after Angular's first flush. ReactLynx draws its first screen on the main thread before the background thread runs, so the root component's first effect calls it.

## Differences from the original, and why

Behavior and data:

- **No axios.** It needs `XMLHttpRequest`, or `fetch` with the `Request`/`Response` constructors; Lynx's background thread has only `fetch`. `lib/apiClient.ts` does what the app used axios for: base URL, query params, a 10 s timeout, and rejecting on a non-2xx status (so React Query retries as before). TanStack Query and zustand are unchanged, on the background thread where ReactLynx runs hooks and effects.
- **Favourites persist through the shell's `AngularLynxLocalStorage` module** (a `UserDefaults` suite), behind zustand's `persist` like the original's AsyncStorage. Lynx itself only has session storage. It's the store AngularLynx's `LynxLocalStorage` uses, so both Lynx apps persist the same way.
- **No router.** ReactLynx has no navigator; `navigation.ts` holds the tab and the open detail in a zustand store. As React Navigation's tabs do, Favourites mounts the first time it's shown and stays mounted after, hidden.
- **The list is Lynx's `<list>`**, its native virtualized list, for FlatList. FlatList's `onEndReachedThreshold={0.5}` (half the visible length) becomes `lower-threshold-item-count`, which counts rows: the list's height (screen minus insets and tab bar) over 2, divided by the 106 pt row height, rounded up (4 rows on a 874 pt iPhone). Every row is the same height, so it's the same distance to within a row. FlatList renders rows in batches of 10 as they near the screen; ReactLynx renders every row's component on the background thread when the page arrives (the main thread creates elements only for rows native asks for), so all 50 rows' detail queries start at once. FlatList's window (21 screens) also covers all 50 rows, so both fetch all 50 details for the first page; the order and batching differ.
- **The empty/loading state** (spinner, "No favourite Pokémon saved") is drawn as a plain view with the list's padding and header, not inside `<list>`: a list item takes its content's height, where FlatList's empty component grows to fill the list.
- **The detail sheet** is drawn, not presented: Lynx has no native sheet or modal screen. A fixed layer dims the page (black at 50%, measured from the original on iOS 27), and a white sheet, 75% of the screen tall with 16 radius top corners, slides up (0.35 s ease-out). It closes on a tap on the dimmed page, or by dragging its header down more than 100 pt, which a main-thread touch handler follows frame by frame (ReactLynx's way of doing gestures). The original's `formSheet` is UIKit's `UISheetPresentationController`: its dimming, spring, and drag from anywhere in the sheet (when the content is scrolled to the top) aren't reproduced exactly. Its content (handle, 30 pt heart, 200 pt artwork, rows) matches.
- **`ActivityIndicator`** (UIKit's `UIActivityIndicatorView`) is a gray ring a CSS animation turns, 37 pt (large) or 20 pt (small): Lynx has no spinner element.
- **Press feedback**: TouchableOpacity's dimming to 0.2 while pressed is set from touch events on the row (a state change on the background thread), without its fade.
- **Tab bar**: React Navigation's iOS tab bar drawn in Lynx with its metrics (49 pt plus the bottom inset, white, a 0.33 pt `rgb(216,216,216)` top line, 25 pt icons in a 31×28 box, 12/16 labels in weight 500, black and `#424242`), without its icon cross-fade.
- **Icons** are the original's SVG files, drawn by Lynx's `<svg>` element (XElement, which the shell registers) with the color written into the markup.
- **Safe-area insets** come from the shell's `safeAreaTop`/`safeAreaBottom` global props (Lynx's `env(safe-area-inset-*)` is 0 in the shell), read with `useGlobalProps()`. The shell sends them once the view is in its window, a moment after the first props, so the first frame may be laid out without them.
- **Text** uses the system font at the original's sizes, weights and line heights. React Native's `lineHeight`-less text and Lynx's both take the font's own line height.
- **Not ported**: the original's `TTID` mark (the harness takes the first frame from Instruments' App Launch), the Android-only bits, web, `expo-haptics` (imported nowhere), the dev client, and the `bench/mount` deep link: the shell registers URL schemes but doesn't pass the URL that opened the app to the page, and the harness uses the `BENCH_SCREEN` build instead.

Build and page config:

- ReactLynx's own build defaults (`pluginReactLynx()` with no options), plus two page-config flags the AngularLynx build plugin writes into every bundle for this shell (`lynx.config.ts`): `preferredFps: 'high'` (the shell allows 120 fps; Lynx asks for it only with this) and `enableElementInvokeUIMethodPendingTask` (needed off the UI thread; this app sends no UI methods). The AngularLynx plugin's other settings are Angular's own (CSS inline variables for its theme, exposure in the background), so ReactLynx keeps its defaults.
- Only the Lynx environment is built (no web preview bundle).
- The shell project is the generated one with one addition: `NSLocalNetworkUsageDescription`, which the release template leaves out (only `ng serve --platform`'s development app has it) and the phone needs to reach the fixture server.
- No app icon or splash image: the template's defaults (a white launch screen), as in an AngularLynx app without `icon`/`splash` in angular.json.

## Versions

Exact, with `package-lock.json`: `@lynx-js/react` 0.129.4, `@lynx-js/rspeedy` 0.19.0, `@lynx-js/react-rsbuild-plugin` 0.22.4, `@lynx-js/template-webpack-plugin` 0.16.9 (the one the React plugin uses, for the page-config hook), `@lynx-js/types` 4.4.2, `@tanstack/react-query` 5.108.4, `zustand` 5.1.0, `typescript` 6.0.3. The shell is `@blotch/angular-lynx-native` from this repository (Lynx 4.1.0 XCFrameworks, `lynx-ios-4.1.0-3`, and Lynx 4.1.0 AARs from Maven Central on Android).
