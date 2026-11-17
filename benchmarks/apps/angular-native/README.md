# Angular Native benchmark app

Software Mansion's [launchperf-poke-rn](https://github.com/software-mansion-labs/launchperf-poke-rn)
(MIT, the app in `../react-native`), ported screen for screen to
[Angular Native](https://ng-native.com): Angular components rendered on React Native's Fabric
renderer inside an Expo app, with no React in the render path. It is one of the apps of the
launch-performance benchmark in issue #285; `../../SPEC.md` says what every app does.

Created with `npx create-expo-app@5.0.0 --template @ng-native/template@0.22.2` (Expo SDK 58,
Angular 22.2), then ported. The template pins `react-native` 0.88.0, but the `expo` it resolves
(58.0.25) wants 0.88.1: with 0.88.0 a Release build dies at launch in dyld
(`Symbol not found: _OBJC_CLASS_$_RCTStatusBarAppearance`, referenced by ExpoModulesCore), so
`npx expo install react-native react-native-safe-area-context` moved both to what Expo expects.

## Versions

Every dependency is pinned to an exact version in `package.json`, and `package-lock.json` holds
the rest. The ones that matter:

| Package | Version |
| --- | --- |
| `@ng-native/*` (components, device, expo, fabric, icons, metro, platform, router) | 0.22.2 |
| `@angular/core`, `@angular/common`, `@angular/router`, `@angular/compiler-cli` | 22.2.6 |
| `@tanstack/angular-query-experimental` | 5.107.1 |
| `expo` | 58.0.25 |
| `react-native` | 0.88.1 |
| `react-native-safe-area-context` | 5.11.1 |
| `react` | 19.3.0 |
| `react-native-screens` | 4.30.1 |
| `react-native-svg` | 15.16.0 |
| `expo-image` | 58.0.18 |
| `@react-native-async-storage/async-storage` | 2.2.0 |

## How it maps onto the reference

| Reference (React Native) | Here (Angular Native) |
| --- | --- |
| expo-router `Stack` + `Tabs` | `@angular/router` with `provideNativeRouter`: `<native-stack-outlet>` at the root, `<native-tabs-outlet>` for the tabs (`src/app/app.routes.ts`, `src/app/pages/tabs.ts`) |
| `pokemon/[id]` as a `formSheet`, detent 0.75, radius 16 | `NativeNavigation.present(..., { as: 'formSheet', presentation: { sheetAllowedDetents: [0.75], sheetCornerRadius: 16 } })` (`src/app/pages/open-pokemon.ts`) |
| `FlatList`, `onEndReachedThreshold` 0.5 | `<virtual-list>` with `endReachedThreshold` 0.5 (`src/app/components/pokemon-list.ts`) |
| React Query (`useInfiniteQuery`, `useQuery`; stale 5 min, retry 2, no refetch on focus) | TanStack Query's Angular adapter (`injectInfiniteQuery`, `injectQuery`) with the same client options (`src/main.ts`, `src/app/data/pokemon-api.ts`) |
| axios | Angular's `HttpClient` through `provideNativeHttpClient()`, which uses React Native's `XMLHttpRequest`, as axios does on React Native; same 10 s timeout |
| zustand + AsyncStorage `persist` | `Storage` from `@ng-native/expo/async-storage`, a signal bound to the AsyncStorage key `favourites` (`src/app/data/favourites.ts`) |
| expo-image with the Pokéball placeholder | the same expo-image view, as `<expo-image>` (`registerExpoViews('expo-image')`) (`src/app/components/pokemon-image.ts`) |
| SVG icons through react-native-svg-transformer | the same SVGs as markup, drawn by `NgIcon` from `@ng-native/icons` on react-native-svg (`src/app/icons.ts`) |
| `modules/app-startup-module` | the same module (Swift and Kotlin), reached through an injected `AppStartup` service (`src/app/startup/app-startup.ts`) |

## Marks

- **`TTFD`** (fully drawn): `src/app/pages/pokedex.ts`. An `effect()` sees the first page's query
  succeed in the change detection pass that also renders its rows; `afterNextRender` runs after
  that pass has been committed to Fabric (Angular Native commits in the renderer factory's `end()`,
  which Angular calls before the after-render hooks), and a `requestAnimationFrame` inside it waits
  a frame, as the reference's `useEffect` + `requestAnimationFrame` does. The module emits it once
  per process, as an `os_signpost` event in the `PointsOfInterest` category on iOS and through
  `Activity.reportFullyDrawn()` on Android.
- **`TTID`**: emitted from the root component's first render + one frame, as the reference does
  from its root layout. The harness takes the first frame from Instruments' App Launch, not from
  this.
- **Mount screen** (`src/app/pages/mount.ts`): `MountStart` from its constructor, then
  `MountEnd` and `TTFD` after the commit that creates all `count` elements, plus a frame. On
  Android the mount marks are `LaunchPerf` log lines; TTFD is `reportFullyDrawn()`.

## Configuration

All at build time:

| Variable | Default | What it sets |
| --- | --- | --- |
| `EXPO_PUBLIC_FIXTURE_ORIGIN` | `http://localhost:8787` | The fixture server; `API` is `{origin}/api/v2`, `SPRITES` `{origin}/sprites/pokemon`. Inlined into the JavaScript bundle by Metro. |
| `EXPO_PUBLIC_BENCH_SCREEN` | unset | A screen under `bench/` to launch straight into, such as `mount?kind=view&count=1500`. The tabs, the list and its requests never exist in that build. |
| `BUNDLE_ID` | `com.angularlynx.bench.angularnative` | iOS bundle ID and Android package (`app.config.js`). Read at prebuild. |
| `APPLE_TEAM_ID` | `F64LTK85F6` | The iOS signing team. Read at prebuild. |

The URL scheme is `launchperfangularnative`, so the mount screen also opens by deep link:
`launchperfangularnative://bench/mount?kind=view&count=1500` (`kind` is `view`, `text` or `image`).

`NSLocalNetworkUsageDescription` is in the Info.plist (`app.json`), for the phone's local network
prompt.

`ios/`, `android/` and `build/` are generated (by `expo prebuild` and `xcodebuild`) and are not
tracked. Prebuild again after changing `app.json`, `app.config.js`, `BUNDLE_ID` or
`APPLE_TEAM_ID`. A change to an `EXPO_PUBLIC_*` variable needs only a rebuild, since the bundle
is made when Xcode builds; the variable has to be in `xcodebuild`'s environment.

## Build

```sh
npm ci
node ../../fixtures/server.mjs   # in another terminal: the fixture server, port 8787
```

### Release, iOS Simulator

This is the build that was verified (Xcode 27.2, the iOS 27.0 simulator):

```sh
npx expo prebuild --platform ios --clean
xcodebuild -workspace ios/LaunchPerfAngularNative.xcworkspace -scheme LaunchPerfAngularNative \
  -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/ios build
xcrun simctl install <udid> build/ios/Build/Products/Release-iphonesimulator/LaunchPerfAngularNative.app
xcrun simctl launch <udid> com.angularlynx.bench.angularnative
```

The Release configuration embeds the Hermes bytecode bundle (Xcode's "Bundle React Native code
and images" phase runs Metro once, at build time); there is no dev client and nothing connects to
Metro. `npx expo run:ios --configuration Release --device <udid> --no-bundler` does the same in one
step, but then opens the app with a development URL (`<bundle id>://?__expo_url=...`), which the
harness should not see.

### Release, iPhone

The phone reaches the fixture server at the Mac's LAN address. The team is a Personal Team, which
cannot export Ad Hoc, so the build is development-signed `Release` for `generic/platform=iOS`. It
needs a development provisioning profile for the bundle ID on the Mac already (one from Xcode);
creating one counts against the Personal Team's weekly App ID limit.

```sh
export EXPO_PUBLIC_FIXTURE_ORIGIN=http://192.168.1.231:8787   # the Mac's address
BUNDLE_ID=com.angularlynx.bench.angularnative APPLE_TEAM_ID=F64LTK85F6 \
  npx expo prebuild --platform ios --clean
xcodebuild -workspace ios/LaunchPerfAngularNative.xcworkspace -scheme LaunchPerfAngularNative \
  -configuration Release -destination 'generic/platform=iOS' -derivedDataPath build/ios-device \
  DEVELOPMENT_TEAM=F64LTK85F6 CODE_SIGN_STYLE=Automatic build
xcrun devicectl device install app --device <device UDID> \
  build/ios-device/Build/Products/Release-iphoneos/LaunchPerfAngularNative.app
```

### The mount-screen variant

Instruments launches an app with no URL, so the mount runs use a build that opens on the mount
screen: `EXPO_PUBLIC_BENCH_SCREEN` set when the bundle is built. The tabs, the list and its
requests never exist in that build, and the screen reports `TTFD` (and `MountEnd`) after the
commit that shows all `count` elements. Give it its own bundle ID so it installs beside the main
app:

```sh
BUNDLE_ID=com.angularlynx.bench.angularnative.mount npx expo prebuild --platform ios --clean
EXPO_PUBLIC_BENCH_SCREEN='mount?kind=view&count=1500' \
  xcodebuild -workspace ios/LaunchPerfAngularNative.xcworkspace -scheme LaunchPerfAngularNative \
  -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/ios build
xcrun simctl install <udid> build/ios/Build/Products/Release-iphonesimulator/LaunchPerfAngularNative.app
```

For the phone, the same two variables in front of the iPhone commands above. `kind` is `view`,
`text` or `image`, and `count` any number (the benchmark uses 1500 and 5000); each combination is
a build of its own, under one bundle ID or several.

### Android

```sh
npx expo run:android --variant release
```

R8 and resource shrinking are on in release builds and the app is `profileable`, as in the
reference (`expo-build-properties`, `plugins/withProfileable.js`).

## Differences from the reference, and why

- **Expo SDK 58 and React Native 0.88.1**, where the reference is on SDK 54 and React Native
  0.81.5: Angular Native 0.22 needs React Native 0.86 or later, and its template is SDK 58. Issue
  #285 also runs the reference on SDK 58 for a like-for-like comparison.
- **The tab bar is the platform's own.** The reference uses React Navigation's JavaScript tab bar;
  Angular Native's tabs are `react-native-screens`' native tabs (`UITabBarController` on iOS,
  bottom navigation on Android), and it has no JavaScript tab bar. The same SVG icons are drawn
  into images by `SvgImages` and tinted by the bar (black selected, `#424242` not, 12pt titles,
  through the bar's appearance), but the bar's height, background and layout are the system's: on
  iOS 26 and later that is the floating Liquid Glass bar, not the reference's flat white one, and
  the icons show a frame or two after the bar, once they have been drawn. The bar is forced light,
  as the reference's always is.
- **The list is `<virtual-list>`, not `FlatList`.** FlatList is a React component and cannot be
  used. Rows are given their fixed height (106pt: the 98pt card and its 8pt margin) instead of
  being measured. The list renders the visible rows plus four either side, where FlatList renders
  10 at first and then windows 21 screens; so fewer rows exist off screen. The header sits
  outside the list's padding, so it carries the 16pt itself.
- **Data fetching is TanStack Query's Angular adapter**, the same library and options as the
  reference's React Query, rather than a hand-made cache.
- **Requests use `HttpClient` instead of axios**; both go through React Native's
  `XMLHttpRequest`.
- **Rows dim when pressed on Android too.** The reference uses `TouchableOpacity` on iOS and a
  ripple `Pressable` on Android; this uses `<touchable-opacity>` on both.
- **Persistence**: favourites are a JSON object of ids under the AsyncStorage key `favourites`;
  zustand's `persist` wraps the same object in `{ state, version }`. Nothing reads one app's data
  from the other.
- **The splash screen is hidden by the app**, after the first commit (`src/app/app.ts`).
  expo-splash-screen hides itself on React Native's `RCTContentDidAppearNotification`; left to
  that, the splash stayed up about 5 s after `TTFD` on the simulator, covering rows already drawn.
- **Status bar**: always dark content, since every screen is white. The reference leaves it to
  the system appearance.
- **No `expo-dev-client`, no React Compiler, no web target**: the benchmark runs release builds
  only, and Angular Native has no web build here.
- **Mount screen and `EXPO_PUBLIC_BENCH_SCREEN`** are the benchmark's own additions (SPEC.md);
  the reference has neither. The screen is a plain wrapping view from the top of the window
  (under the status bar), white, with `view` boxes in `#6390F0`, `text` at 12pt and `image`
  through expo-image, the same image view as the list.

## Tests

```sh
npm test            # Vitest, in Node
npm run typecheck   # ngc with strict templates
```
