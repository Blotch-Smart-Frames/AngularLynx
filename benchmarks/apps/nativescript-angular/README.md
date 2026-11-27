# NativeScript Angular benchmark app

Software Mansion's [launchperf-poke-rn](https://github.com/software-mansion-labs/launchperf-poke-rn)
(MIT, the app in `../react-native`), ported screen for screen to
[NativeScript](https://nativescript.org) with [NativeScript Angular](https://docs.nativescript.org/guide/frameworks/angular):
Angular components rendered to UIKit views by NativeScript's renderer, with the JavaScript running
on V8 on the UI thread. It is one of the apps of the launch-performance benchmark (issues #285 and
#588); `../../SPEC.md` says what every app does.

Created with `npx nativescript@9.1.2 create LaunchPerfNS --template @nativescript/template-blank-ng@9.1.1`
(NativeScript 9.1, Angular 22.0, zoneless), then ported. The template's Angular `~22.0.0` is moved
to 22.3.0, the version every other app is on, and its Tailwind setup is dropped: the screens style
themselves.

## Versions

Every dependency is pinned to an exact version in `package.json`, and `package-lock.json` holds
the rest. The ones that matter:

| Package | Version |
| --- | --- |
| `@nativescript/core` | 9.1.4 |
| `@nativescript/ios` (the iOS runtime, V8) | 9.1.1 |
| `@nativescript/angular` | 22.0.2 |
| `@nativescript/webpack` | 5.0.42 |
| `nativescript` (the CLI) | 9.1.2 |
| `@angular/core`, `@angular/common`, `@angular/router`, `@angular/compiler-cli` | 22.3.0 |
| `@tanstack/angular-query-experimental` | 5.107.2 |

## How it maps onto the reference

| Reference (React Native) | Here (NativeScript Angular) |
| --- | --- |
| expo-router `Stack` | `<page-router-outlet>` (`src/app/app.ts`): a UINavigationController, the tabs its first page |
| expo-router `Tabs` | `<TabView>` with `*tabItem` (`src/app/pages/tabs.ts`): a UITabBarController |
| `pokemon/[id]` as a `formSheet`, detent 0.75, radius 16 | `ModalDialogService.showModal()` as a page sheet, its `UISheetPresentationController` given one custom detent at 75% and 16pt corners before it's presented (`src/app/pages/pokemon-sheet.ts`) |
| `FlatList`, `onEndReachedThreshold` 0.5 | `<ListView>` (a UITableView) with a template per kind of row, and the next page asked for when a row within half a screen of the end loads (`src/app/components/pokemon-list.ts`) |
| React Query (`useInfiniteQuery`, `useQuery`; stale 5 min, retry 2, no refetch on focus) | TanStack Query's Angular adapter (`injectInfiniteQuery`, `injectQuery`) with the same client options (`src/main.ts`, `src/app/data/pokemon-api.ts`), as the Angular Native port |
| axios | Angular's `HttpClient` through `provideNativeScriptHttpClient()`, on NativeScript's Http module (NSURLSession); same 10 s timeout |
| zustand + AsyncStorage `persist` | `ApplicationSettings` (NSUserDefaults) holding the favourites as JSON, in a signal (`src/app/data/favourites.ts`) |
| expo-image with the Pokéball placeholder | NativeScript's `<Image>` with `loadMode="async"`, the logo under it until `isLoading` turns false (`src/app/components/pokemon-image.ts`) |
| SVG icons through react-native-svg-transformer | the same SVGs in the asset catalog (`App_Resources/iOS/Assets.xcassets`), as template images, which the tab bar and the heart's `tintColor` color |
| `modules/app-startup-module` | a Swift class in the app (`App_Resources/iOS/src/AppStartup.swift`), which NativeScript compiles in and JavaScript calls directly (`src/app/startup/app-startup.ts`) |

## Marks

- **`TTFD`** (fully drawn): `src/app/pages/pokedex.ts`. An `effect()` sees the first page's query
  succeed in the change detection pass that hands the rows to the ListView, and
  `afterNextRender` + `requestAnimationFrame` waits a frame, as the reference's `useEffect` +
  `requestAnimationFrame` does. UITableView builds its visible cells, and NativeScript Angular
  each row's view, in the layout pass at the end of that run loop turn, so the frame after it
  shows them. The Swift class emits it once per process as an `os_signpost` event in the
  `PointsOfInterest` category; on Android, `Activity.reportFullyDrawn()`.
- No **`TTID`**: the harness takes the first frame from Instruments' App Launch.
- **Mount screen** (`src/app/pages/mount.ts`): `MountStart` from its constructor, then `MountEnd`
  and `TTFD` a frame after the pass that creates all `count` views.

## Configuration

All at build time:

| Variable | Default | What it sets |
| --- | --- | --- |
| `FIXTURE_ORIGIN` | `http://localhost:8787` | The fixture server; `API` is `{origin}/api/v2`, `SPRITES` `{origin}/sprites/pokemon`. Inlined into the bundle by webpack (`webpack.config.js`). |
| `BENCH_SCREEN` | unset | A screen under `bench/` to launch straight into, such as `mount?kind=view&count=1500`. The tabs, the list and its requests never exist in that build. |
| `BUNDLE_ID` | `com.angularlynx.bench.nativescript` | iOS bundle ID and Android package (`nativescript.config.ts`). Read when the app is prepared. |

`NSLocalNetworkUsageDescription` and `NSAllowsLocalNetworking` are in
`App_Resources/iOS/Info.plist`, for the phone's local network prompt.

`platforms/`, `hooks/` and `build/` are generated (by the NativeScript CLI and `xcodebuild`) and
are not tracked.

## Build

```sh
npm ci
node ../../fixtures/server.mjs   # in another terminal: the fixture server, port 8787
```

The NativeScript CLI edits the Xcode project with Ruby's `xcodeproj` gem. If `ruby -e 'require
"xcodeproj"'` fails, point Ruby at the copy Homebrew's CocoaPods carries rather than installing
it: `export GEM_PATH="$(ls -d "$(brew --prefix)"/Cellar/cocoapods/*/libexec | tail -1)"`.

### Release, iOS Simulator

This is the build that was verified (Xcode 27.2, the iOS 27 simulator):

```sh
npx ns build ios --release
xcrun simctl install <udid> platforms/ios/build/Release-iphonesimulator/nativescriptangular.app
xcrun simctl launch <udid> com.angularlynx.bench.nativescript
```

`--release` bundles with webpack in production mode (minified, no source maps), with no
connection to the CLI's live sync.

### Release, iPhone

The team is a Personal Team, which cannot export Ad Hoc, so the build is development-signed
`Release` for `generic/platform=iOS`: `ns prepare` writes the Xcode project, and `xcodebuild` builds
it (what `../../harness/build_ios_app.sh nativescript-angular <bundle id>` runs).

```sh
FIXTURE_ORIGIN=http://192.168.1.231:8787 BUNDLE_ID=com.angularlynx.bench.rival \
  npx ns prepare ios --release
xcodebuild build -project platforms/ios/nativescriptangular.xcodeproj -scheme nativescriptangular \
  -configuration Release -sdk iphoneos -destination generic/platform=iOS -derivedDataPath build/ios-device \
  DEVELOPMENT_TEAM=F64LTK85F6 CODE_SIGN_STYLE=Automatic PRODUCT_BUNDLE_IDENTIFIER=com.angularlynx.bench.rival \
  -allowProvisioningUpdates
xcrun devicectl device install app --device <device UDID> \
  build/ios-device/Build/Products/Release-iphoneos/nativescriptangular.app
```

### The mount-screen variant

`BENCH_SCREEN` set when the bundle is built, such as
`BENCH_SCREEN='mount?kind=view&count=1500' npx ns build ios --release`. `kind` is `view`, `text`
or `image`, and `count` any number (the benchmark uses 1500 and 5000).

### Android

`npx ns build android --release` with a keystore. The benchmark doesn't run Android yet, and this
app hasn't been checked there.

## Differences from the reference, and why

- **NativeScript 9 and Angular 22.3**, where the reference is on Expo SDK 54 and React Native 0.81.
- **The tab bar is the platform's own** (UITabBarController), as in the Angular Native port: on
  iOS 26 and later that is the floating Liquid Glass bar, not the reference's flat white one. The
  icons are the reference's SVGs; the bar tints them, black selected and `#424242` not, with 12pt
  titles, and a tab's icon turns solid while it's selected.
- **The list is a ListView (UITableView), not FlatList.** It has no header, footer or end
  threshold of its own, so the header and spinners are rows of their own templates, and the next
  page is asked for when a row within half a screen (4 rows of 106pt on the iPhone 14 Pro) of the
  end loads. UITableView builds the rows on screen, where FlatList renders 10 at first and then
  windows 21 screens; each row's height is measured, not given.
- **The detail sheet is a UIKit page sheet** shown by NativeScript's modal service, with the
  reference's 75% detent and 16pt corners set on its sheet controller, so it is the same native
  sheet as the reference's form sheet.
- **Images.** NativeScript's `<Image>` loads a URL with NSURLSession, whose URL cache keeps each
  sprite for the fixture server's `max-age=300`; expo-image keeps its own memory and disk cache.
  The placeholder is the Pokéball logo, shown under the sprite until it has loaded.
- **Persistence**: favourites are a JSON object of ids under the `ApplicationSettings` key
  `favourites`; zustand's `persist` wraps the same object in `{ state, version }` in AsyncStorage.
- **The heart's tap is kept from the card.** NativeScript lets every gesture recognizer under a
  finger fire (its iOS delegate recognizes them all at once), so a tap on a row's heart is also a
  tap on the row. The heart notes which Pokémon's heart was tapped and when, and the row opens
  the sheet a run loop turn later unless its own heart took the tap; React Native gives the touch to the innermost touchable.
- **No pressed state on the rows.** The reference dims a row with `TouchableOpacity`; a
  NativeScript layout has no pressed state of its own.
- **The marks are a Swift class in the app** that JavaScript calls directly, not a module: the
  NativeScript runtime exposes every Objective-C-visible class to JavaScript.
- **Mount screen and `BENCH_SCREEN`** are the benchmark's own additions (SPEC.md): a
  `<WrapLayout>` under the status bar, white, with `view` boxes in `#6390F0`, `text` at 12pt and
  `image` through `<Image>`, the same image view as the list.
