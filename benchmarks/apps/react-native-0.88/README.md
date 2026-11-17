# React Native (Expo SDK 58, React Native 0.88)

`apps/react-native` (Software Mansion's
[`launchperf-poke-rn`](https://github.com/software-mansion-labs/launchperf-poke-rn),
MIT, see `LICENSE`) upgraded to Expo SDK 58 / React Native 0.88, the base
Angular Native uses, so the benchmark has a React Native row on the same
engine as Angular Native and a current one beside Software Mansion's. It's the
same app, screen for screen (`benchmarks/SPEC.md`), with the same benchmark
changes as `apps/react-native` (its README lists them): the fixture server's
origin, `NSLocalNetworkUsageDescription`, a configurable bundle ID and team,
the `bench/mount` screen and the `BENCH_SCREEN` variant.

## Versions

| Package      | Version                                                      |
| ------------ | ------------------------------------------------------------ |
| expo         | 58.0.25                                                      |
| react-native | 0.88.1 (New Architecture, bridgeless)                        |
| react        | 19.3.0                                                       |
| Hermes       | Hermes V1, `hermes-engine` / `hermes-compiler` 260318099.0.5 |
| expo-router  | 58.0.31                                                      |

Every dependency is pinned to an exact version.

## How it was upgraded

Starting from a copy of `apps/react-native`:

```sh
npm install expo@58.0.25
npx expo install --fix   # the SDK 58 version of every package it knows
```

then each version was pinned to what the lockfile resolved. `expo install
--check` and `expo-doctor` pass.

## What differs from `apps/react-native`, and why

1. **Versions** (`package.json`), as `expo install --fix` set them:

   | Package                        | 0.81 app | This app |
   | ------------------------------ | -------- | -------- |
   | expo                           | 54.0.33  | 58.0.25  |
   | expo-build-properties          | 1.0.10   | 58.0.12  |
   | expo-constants                 | 18.0.13  | 58.0.16  |
   | expo-dev-client                | 6.0.20   | 58.0.20  |
   | expo-font                      | 14.0.11  | 58.0.12  |
   | expo-haptics                   | 15.0.8   | 58.0.8   |
   | expo-image                     | 3.0.11   | 58.0.18  |
   | expo-linking                   | 8.0.11   | 58.0.17  |
   | expo-router                    | 6.0.23   | 58.0.31  |
   | expo-splash-screen             | 31.0.13  | 58.0.14  |
   | expo-status-bar                | 3.0.9    | 58.0.5   |
   | expo-symbols                   | 1.0.8    | 58.0.5   |
   | expo-system-ui                 | 6.0.9    | 58.0.7   |
   | expo-web-browser               | 15.0.10  | 58.0.8   |
   | react / react-dom              | 19.1.0   | 19.3.0   |
   | react-native                   | 0.81.5   | 0.88.1   |
   | react-native-gesture-handler   | 2.28.0   | 3.3.0    |
   | react-native-reanimated        | 4.1.6    | 4.7.1    |
   | react-native-safe-area-context | 5.6.2    | 5.11.1   |
   | react-native-screens           | 4.16.0   | 4.30.1   |
   | react-native-svg               | 15.12.1  | 15.16.0  |
   | react-native-web               | 0.21.2   | 0.21.4   |
   | react-native-worklets          | 0.5.1    | 0.13.0   |
   | @types/react                   | 19.1.17  | 19.3.0   |
   | eslint-config-expo             | 10.0.0   | 58.0.4   |
   | typescript                     | 5.9.3    | 6.0.3    |

   The rest (React Query, axios, Zustand, AsyncStorage 2.2.0, `@expo/vector-icons`,
   the SVG transformer, ESLint, Prettier) is unchanged. `@react-navigation/*`
   stays at 7.x and unused: expo-router 58 carries its own copy of React
   Navigation, so the app's imports (all from `expo-router`) no longer reach
   it, and Metro leaves it out of the bundle.

2. **`components/SVGIcon.tsx`** takes a `ColorValue`, not a `string`:
   expo-router 58 types the tab bar's icon color as a `ColorValue`, and the
   icon only passes it on to `react-native-svg`'s `fill`, which takes one.
3. **`components/PokemonList.tsx`** gives `ListFooterComponent` `undefined`
   rather than `null` while no page is loading: React Native 0.88's `FlatList`
   types no longer accept `null` there. Nothing renders either way.
4. **`app.json`** drops `android.edgeToEdgeEnabled` and `newArchEnabled`,
   which SDK 58's schema no longer has (`expo-doctor` fails on them): Android
   apps are always edge to edge now, and the New Architecture is the only one
   React Native 0.88 has. Neither changes the iOS build.
5. **Its own identity**, so it installs beside the 0.81 app: name
   `LaunchPerfRN088` (so the Xcode project and scheme are `LaunchPerfRN088`),
   URL scheme `launchperfrn088`, bundle ID
   `com.angularlynx.bench.reactnative088`.
6. **No scene-life-cycle plugin.** The 0.81 app needs
   `plugins/withSceneLifecycle.js` to launch on iOS 27; Expo 58's template
   already generates a `SceneDelegate` (Expo's `ExpoAppSceneDelegate`).
7. **No deployment-target override.** Expo 58's minimum is iOS 16.4 and its
   pods all build with Xcode 27, so xcodebuild needs no
   `IPHONEOS_DEPLOYMENT_TARGET`.

SDK 58's own defaults come with it and were left as they are: Hermes V1 and
Expo's precompiled modules (`EXPO_USE_PRECOMPILED_MODULES` in
`ios/Podfile.properties.json`).

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

### For the Simulator (Release)

```sh
xcodebuild -workspace ios/LaunchPerfRN088.xcworkspace -scheme LaunchPerfRN088 \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData build
xcrun simctl install booted ios/DerivedData/Build/Products/Release-iphonesimulator/LaunchPerfRN088.app
xcrun simctl launch booted com.angularlynx.bench.reactnative088
```

If the build stops at "Scanning for @ExpoModule classes didn't complete …
timed out after 5000 ms", the Mac was too busy for Expo's module scan: run the
same command again.

### For a phone (Release, development signing)

The fixture origin must be the Mac's LAN address, and the bundle ID one the
team already has a provisioning profile for (the command doesn't register App
IDs):

```sh
BENCH_BUNDLE_ID=com.example.bench.reactnative088 BENCH_APPLE_TEAM_ID=F64LTK85F6 \
  npx expo prebuild --platform ios --clean
EXPO_PUBLIC_FIXTURE_ORIGIN=http://192.168.1.231:8787 \
xcodebuild -workspace ios/LaunchPerfRN088.xcworkspace -scheme LaunchPerfRN088 \
  -configuration Release -destination generic/platform=iOS \
  -derivedDataPath ios/DerivedData DEVELOPMENT_TEAM=F64LTK85F6 CODE_SIGN_STYLE=Automatic build
# → ios/DerivedData/Build/Products/Release-iphoneos/LaunchPerfRN088.app
```

The bundle ID goes in at prebuild rather than as
`PRODUCT_BUNDLE_IDENTIFIER=…` on xcodebuild, which would also give each pod's
resource bundle the app's ID.

### The mount variant

```sh
EXPO_PUBLIC_BENCH_SCREEN='mount?kind=view&count=1500' \
xcodebuild -workspace ios/LaunchPerfRN088.xcworkspace -scheme LaunchPerfRN088 \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData-mount build
```

`kind` is `view`, `text` or `image`; `count` is any positive number. The
deep link `launchperfrn088://bench/mount?kind=…&count=…` works in every build.

## Marks

The same as `apps/react-native` (its README has the details, and the commands
to watch them): `TTID`, `TTFD`, `MountStart` and `MountEnd` signposts in the
`PointsOfInterest` category, subsystem `com.swmansion.launchperfrn.LaunchPerfRN`,
each once per process. `TTFD` comes from the list's first page or, in a mount
build, from the mount screen.
