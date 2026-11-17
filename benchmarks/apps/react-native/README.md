# React Native (Expo 54, React Native 0.81)

Software Mansion's [`launchperf-poke-rn`](https://github.com/software-mansion-labs/launchperf-poke-rn)
(MIT, see `LICENSE`), the app their
[KMP vs React Native study](https://swmansion.com/blog/we-built-the-same-app-in-kmp-and-react-native-here-s-what-we-found)
measured, and the reference every other app in `benchmarks/apps/` copies
(`benchmarks/SPEC.md`). It's a Pokédex list with two tabs, a detail sheet and
favourites, built with Expo Router, React Query, `FlatList`, `expo-image` and
Zustand. Its `modules/app-startup-module` emits the `TTID` and `TTFD`
signposts the harness reads.

`apps/react-native-0.88` is the same app on Expo SDK 58 / React Native 0.88.

## Versions

Every dependency is pinned to the exact version the original lockfile
resolved, so the lockfile's tree is the original one.

| Package      | Version                               |
| ------------ | ------------------------------------- |
| expo         | 54.0.33                               |
| react-native | 0.81.5 (New Architecture, bridgeless) |
| react        | 19.1.0                                |
| Hermes       | `hermes-engine` 0.81.5 (bytecode v96) |
| expo-router  | 6.0.23                                |

## What differs from the original, and why

Only what the benchmark needs, or what today's toolchain forces:

1. **Data from the fixture server** (`lib/fixtureOrigin.ts`, used by
   `lib/apiClient.ts` and `lib/mappers/pokemon.ts`). The original reads
   `https://pokeapi.co/api/v2/` and GitHub's sprite CDN; this reads
   `{origin}/api/v2/` and `{origin}/sprites/pokemon`, so network time stays out
   of "fully drawn". The origin is `EXPO_PUBLIC_FIXTURE_ORIGIN`, inlined when
   the bundle is built (default `http://localhost:8787`, which the Simulator
   reaches). `SPRITE_BASE` is now exported, for the mount screen.
2. **`NSLocalNetworkUsageDescription`** in `app.json`'s `ios.infoPlist`: a
   phone asks for local network access before it reaches the Mac.
3. **No Software Mansion account**: `app.json` drops `ios.appleTeamId`,
   `owner` and `extra.eas.projectId`, and the bundle ID is
   `com.angularlynx.bench.reactnative`. `app.config.js` lets `expo prebuild`
   take another bundle ID and team from `BENCH_BUNDLE_ID` and
   `BENCH_APPLE_TEAM_ID`. The Android package is unchanged.
4. **The mount screen** (`app/bench/mount.tsx`, SPEC "Benchmark screens"):
   `count` views (10×10, `#1a1a1a`), texts (`"{i}"`) or `expo-image` sprites
   (24×24) in a wrapping, non-virtualized `ScrollView`. It emits `MountStart`
   while it renders, and `MountEnd` and `TTFD` after the commit, in a
   `requestAnimationFrame`, as the list reports `TTFD`. The root `Stack`
   (`app/_layout.tsx`) hides its header. The startup module gains
   `reportMountStart()` / `reportMountEnd()` (Swift and TypeScript; iOS only,
   as `reportInitiallyDrawn()` is).
5. **The `BENCH_SCREEN` variant** (`app/+native-intent.ts`). Instruments
   launches an app with no URL, so for the mount benchmark the screen is chosen
   at build time: with `EXPO_PUBLIC_BENCH_SCREEN=mount?kind=view&count=1500`,
   expo-router's launch path becomes `/bench/mount?kind=view&count=1500`
   before anything renders, so the tabs never mount and the list never
   fetches. The deep link `launchperfrn://bench/mount?kind=…&count=…` works in
   every build.
6. **The scene life cycle** (`plugins/withSceneLifecycle.js`,
   `plugins/scene-lifecycle/SceneDelegate.swift`). iOS 27 stops an app built
   with the iOS 27 SDK (Xcode 27) at launch, in UIKit's
   `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, unless it
   adopts scenes, and Expo 54's template makes its window in the
   `AppDelegate`. The plugin adds the scene manifest and a `SceneDelegate` that
   starts React Native exactly as the template's `AppDelegate` did, and
   forwards launch and warm URLs to the `AppDelegate` so expo-router still sees
   them. Expo 58's template ships the same thing (`ExpoAppSceneDelegate`).
7. **Exact versions** in `package.json` (the original used `^`/`~` ranges).

The original `README.md` (Expo's `create-expo-app` boilerplate) is replaced by
this one. Everything else, including `TTID`/`TTFD`, is the original. That
includes `expo-dev-client`: its launcher and menu are debug-only pods, which
the Release build's module provider leaves out, so there's no dev menu and no
Metro.

## Build

`ios/` and `android/` are generated (Expo's Continuous Native Generation) and
git-ignored. Needs Node 20+, Xcode 27 and CocoaPods.

```sh
npm ci
# Writes ios/ and runs pod install. Add BENCH_BUNDLE_ID=… BENCH_APPLE_TEAM_ID=…
# to sign it as someone else (see "For a phone").
npx expo prebuild --platform ios --clean
```

Start the fixture server in another terminal: `node ../../fixtures/server.mjs`.

`IPHONEOS_DEPLOYMENT_TARGET=15.1` on the command line below is the app's own
target (Expo 54's minimum). Passing it lifts the pods that still declare iOS
9–13.4 (SDWebImage, RNSVG's and AsyncStorage's resource bundles), which Xcode
27 refuses to build.

### For the Simulator (Release)

```sh
xcodebuild -workspace ios/LaunchPerfRN.xcworkspace -scheme LaunchPerfRN \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData IPHONEOS_DEPLOYMENT_TARGET=15.1 build
xcrun simctl install booted ios/DerivedData/Build/Products/Release-iphonesimulator/LaunchPerfRN.app
xcrun simctl launch booted com.angularlynx.bench.reactnative
```

### For a phone (Release, development signing)

The fixture origin must be the Mac's LAN address, and the bundle ID one the
team already has a provisioning profile for (the command doesn't register App
IDs):

```sh
BENCH_BUNDLE_ID=com.example.bench.reactnative BENCH_APPLE_TEAM_ID=F64LTK85F6 \
  npx expo prebuild --platform ios --clean
EXPO_PUBLIC_FIXTURE_ORIGIN=http://192.168.1.231:8787 \
xcodebuild -workspace ios/LaunchPerfRN.xcworkspace -scheme LaunchPerfRN \
  -configuration Release -destination generic/platform=iOS \
  -derivedDataPath ios/DerivedData IPHONEOS_DEPLOYMENT_TARGET=15.1 \
  DEVELOPMENT_TEAM=F64LTK85F6 CODE_SIGN_STYLE=Automatic build
# → ios/DerivedData/Build/Products/Release-iphoneos/LaunchPerfRN.app
```

The bundle ID goes in at prebuild rather than as
`PRODUCT_BUNDLE_IDENTIFIER=…` on xcodebuild: a command-line build setting
applies to every target, so it would also give each pod's resource bundle
(`SDWebImage.bundle`, `RNCAsyncStorage_resources.bundle`, …) the app's ID.
`DEVELOPMENT_TEAM` on the command line is fine, and covers those bundles if
they need signing.

### The mount variant

Add the screen to the bundle step's environment (a separate `-derivedDataPath`
keeps the plain build):

```sh
EXPO_PUBLIC_BENCH_SCREEN='mount?kind=view&count=1500' \
xcodebuild -workspace ios/LaunchPerfRN.xcworkspace -scheme LaunchPerfRN \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData-mount IPHONEOS_DEPLOYMENT_TARGET=15.1 build
```

`kind` is `view`, `text` or `image`; `count` is any positive number (1500 or
5000 in the benchmark). Both `EXPO_PUBLIC_*` variables are read by the "Bundle
React Native code and images" build phase, which xcodebuild runs with its own
environment.

## Marks

The signposts are `os_signpost` events in the `PointsOfInterest` category,
subsystem `com.swmansion.launchperfrn.LaunchPerfRN`, each emitted once per
process:

| Name         | When                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `TTID`       | The root layout's first commit, next frame                                                        |
| `TTFD`       | The list's first page committed, next frame; or the mount screen's elements committed, next frame |
| `MountStart` | The mount screen starts rendering                                                                 |
| `MountEnd`   | The mount screen's elements committed, next frame                                                 |

In a mount build, `MountEnd`, `TTFD` and the root layout's `TTID` land in the
same frame (React runs the screen's effect before its parent's). Watch them on
the Simulator with
`xcrun simctl spawn booted log stream --signpost --predicate 'category == "PointsOfInterest"'`
(without `--signpost`, `log` leaves them out), or afterwards with
`log show --signpost --last 5m` and the same predicate.

On the iOS 27 Simulator, `xcrun simctl openurl` can stop at an "Open in
“LaunchPerfRN”?" alert that waits for a tap (Maestro's `openLink` followed by
an optional `tapOn: "Open"` gets past it); the `BENCH_SCREEN` build needs no
link at all.
