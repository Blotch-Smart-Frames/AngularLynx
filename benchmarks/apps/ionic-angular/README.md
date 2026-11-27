# Ionic Angular benchmark app

Software Mansion's [launchperf-poke-rn](https://github.com/software-mansion-labs/launchperf-poke-rn)
(MIT, the app in `../react-native`), ported screen for screen to
[Ionic Angular](https://ionicframework.com/docs/angular/overview) on
[Capacitor](https://capacitorjs.com): an Angular web app, drawn with Ionic's components in a
WKWebView, inside Capacitor's native iOS app. It is one of the apps of the launch-performance
benchmark (issues #285 and #588); `../../SPEC.md` says what every app does.

Created with `npx @ionic/cli@7.2.1 start LaunchPerfIonic tabs --type=angular-standalone --capacitor`
(Ionic 9, Angular 22.3, zoneless, standalone components), then `npx cap add ios`, then ported. The
template's ESLint, Prettier and Playwright setup is dropped, and so are the Capacitor plugins it
installs but the app doesn't use (`@capacitor/app`, `@capacitor/haptics`, `@capacitor/keyboard`):
each one is native code in the app.

## Versions

Every dependency is pinned to an exact version in `package.json`, and `package-lock.json` holds
the rest; `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` pins
Capacitor's Swift package. The ones that matter:

| Package | Version |
| --- | --- |
| `@ionic/angular`, `@ionic/core` | 9.0.14 |
| `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli`, `capacitor-swift-pm` | 8.6.3 |
| `@capacitor/preferences` | 8.0.1 |
| `@capacitor/status-bar` | 8.0.4 |
| `@angular/core`, `@angular/common`, `@angular/router`, `@angular/cdk`, `@angular/build` | 22.3.0 |
| `@tanstack/angular-query-experimental` | 5.107.2 |
| `ionicons` | 8.1.1 |

## How it maps onto the reference

| Reference (React Native) | Here (Ionic Angular) |
| --- | --- |
| expo-router `Stack` | `<ion-router-outlet>` (`src/app/app.component.ts`), Ionic's stack of pages |
| expo-router `Tabs` | the template's `<ion-tabs>` and `<ion-tab-bar>` (`src/app/pages/tabs.ts`), drawn in the web view in Ionic's iOS look |
| `pokemon/[id]` as a `formSheet`, detent 0.75, radius 16 | a sheet modal, `ModalController.create()` with breakpoints `[0, 0.75]` and 16px corners (`src/app/pages/pokemon-sheet.ts`) |
| `FlatList`, `onEndReachedThreshold` 0.5 | the Angular CDK's `<cdk-virtual-scroll-viewport>` inside `<ion-content>`, as Ionic's docs show since Ionic removed its own virtual scroll, with the next page asked for when the end is within half the viewport (`src/app/components/pokemon-list.ts`) |
| React Query (`useInfiniteQuery`, `useQuery`; stale 5 min, retry 2, no refetch on focus) | TanStack Query's Angular adapter (`injectInfiniteQuery`, `injectQuery`) with the same client options (`src/main.ts`, `src/app/data/pokemon-api.ts`), as the Angular Native port |
| axios | Angular's `HttpClient`, on the web view's XMLHttpRequest, as axios is in a browser; same 10 s timeout |
| zustand + AsyncStorage `persist` | `@capacitor/preferences` (UserDefaults) holding the favourites as JSON, in a signal (`src/app/data/favourites.ts`) |
| expo-image with the Pokéball placeholder | an `<img>`, the logo shown until it fires `load` (`src/app/components/pokemon-image.ts`) |
| SVG icons through react-native-svg-transformer | the same SVGs (`src/assets/icons`), through `<ion-icon [src]>`, which fills them with the text color |
| `modules/app-startup-module` | a Capacitor plugin in the app (`ios/App/App/AppStartupPlugin.swift`), registered by the app's bridge view controller (`ios/App/App/ViewController.swift`, which `SceneDelegate.swift` makes the window's root) and called through `registerPlugin()` (`src/app/startup/app-startup.ts`) |

## Marks

- **`TTFD`** (fully drawn): `src/app/pages/pokedex.ts`. The virtual scroll viewport builds its
  rows in a change detection pass of its own once it has measured itself, so an `effect()` waits
  for the first page's query to succeed and for the rows to exist (each row tells the list when it's created), then
  `afterNextRender` + `requestAnimationFrame` waits a frame, as the reference's `useEffect` +
  `requestAnimationFrame` does. The plugin method returns nothing (`CAPPluginReturnNone`): the web
  view posts the call to native, which emits the `os_signpost` event in the `PointsOfInterest`
  category, once per process. The mark lands when native receives the message, a little after
  the JavaScript sends it.
- No **`TTID`**: the harness takes the first frame from Instruments' App Launch.
- **Mount screen** (`src/app/pages/mount.ts`): `MountStart` from its constructor, then `MountEnd`
  and `TTFD` a frame after the pass that puts all `count` elements in the DOM.

## Configuration

All at build time, by `scripts/build.mjs`, which runs `ng build` with each as a `--define` and
then `cap sync ios`:

| Variable | Default | What it sets |
| --- | --- | --- |
| `FIXTURE_ORIGIN` | `http://localhost:8787` | The fixture server; `API` is `{origin}/api/v2`, `SPRITES` `{origin}/sprites/pokemon`. |
| `BENCH_SCREEN` | unset | A screen under `bench/` to launch straight into, such as `mount?kind=view&count=1500`. The tabs, the list and its requests never exist in that build. |

The bundle ID in the Xcode project is `com.angularlynx.bench.ionic` (`cap add ios` took it from
`capacitor.config.ts`); `xcodebuild` takes another as `PRODUCT_BUNDLE_IDENTIFIER`.

`NSLocalNetworkUsageDescription` and `NSAllowsLocalNetworking` are in `ios/App/App/Info.plist`,
for the phone's local network prompt. The fixture server sends `Access-Control-Allow-Origin: *`,
which the web view's requests from `capacitor://localhost` need.

`ios/` is tracked, as Capacitor intends: it's the app's native project, with the plugin and the
view controller added to it. `www/`, `ios/App/App/public` (`cap sync`'s copy of it) and the
`xcodebuild` output are not.

## Build

```sh
npm ci
node ../../fixtures/server.mjs   # in another terminal: the fixture server, port 8787
```

### Release, iOS Simulator

This is the build that was verified (Xcode 27.2, the iOS 27 simulator):

```sh
node scripts/build.mjs
xcodebuild build -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/DerivedData
xcrun simctl install <udid> ios/DerivedData/Build/Products/Release-iphonesimulator/App.app
xcrun simctl launch <udid> com.angularlynx.bench.ionic
```

`ng build` builds for production (`ng build --configuration production`, minified, no source
maps), and the web app is in the `.app`: nothing loads from a dev server.

### Release, iPhone

The team is a Personal Team, which cannot export Ad Hoc, so the build is development-signed
`Release` for `generic/platform=iOS` (what `../../harness/build_ios_app.sh ionic-angular <bundle id>`
runs):

```sh
FIXTURE_ORIGIN=http://192.168.1.231:8787 node scripts/build.mjs
xcodebuild build -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -sdk iphoneos -destination generic/platform=iOS -derivedDataPath ios/DerivedData-device \
  DEVELOPMENT_TEAM=F64LTK85F6 CODE_SIGN_STYLE=Automatic PRODUCT_BUNDLE_IDENTIFIER=com.angularlynx.bench.rival \
  -allowProvisioningUpdates
xcrun devicectl device install app --device <device UDID> \
  ios/DerivedData-device/Build/Products/Release-iphoneos/App.app
```

### The mount-screen variant

`BENCH_SCREEN` set when the web app is built, such as
`BENCH_SCREEN='mount?kind=view&count=1500' node scripts/build.mjs`, then the same `xcodebuild`.
`kind` is `view`, `text` or `image`, and `count` any number (the benchmark uses 1500 and 5000).

### Android

`npx cap add android`, then a release build in Android Studio. The benchmark doesn't run Android
yet, and this app has no Android project.

## Differences from the reference, and why

- **Everything on screen is HTML in a WKWebView**, Ionic's components drawn by WebKit, where the
  reference's are UIKit views. That is what Ionic on Capacitor is.
- **The tab bar is Ionic's `<ion-tab-bar>`**, in its iOS look (white, a hairline on top, 12px
  labels), with the reference's SVG icons, black selected and `#424242` not, solid while
  selected.
- **The list is the Angular CDK's virtual scroll viewport, not FlatList.** Ionic removed its own
  virtual scroll in Ionic 7, and its docs point to the CDK's, inside `<ion-content>`. It builds the
  rows on screen and 900px either side (Ionic's docs' `minBufferPx`), where FlatList renders 10 at
  first and then windows 21 screens; rows are given their fixed height (106px: the 98px card and
  its 8px margin) instead of being measured.
- **The detail is Ionic's sheet modal**, drawn in the web view, at the reference's 75% with 16px
  corners, not UIKit's form sheet. It dims what's behind it as Ionic's sheet does, and it draws the
  reference's own handle (Ionic's is off).
- **Images are `<img>`**, cached by WebKit for the fixture server's `max-age=300`; expo-image keeps
  its own memory and disk cache.
- **Persistence**: favourites are a JSON object of ids under the `@capacitor/preferences` key
  `favourites`; zustand's `persist` wraps the same object in `{ state, version }` in AsyncStorage.
- **Rows dim when pressed** through Ionic's `ion-activatable` (opacity 0.2), as
  `TouchableOpacity` does.
- **Launch screen**: Capacitor's template's, a white storyboard with its splash image; the app
  has no `@capacitor/splash-screen`, so it goes as soon as the web view is on screen, blank until
  the page has loaded.
- **The marks are a Capacitor plugin in the app**, not a module: JavaScript can reach native only
  through Capacitor's bridge, a message from the web view to native.
- **Mount screen and `BENCH_SCREEN`** are the benchmark's own additions (SPEC.md): a wrapping
  `<div>` in `<ion-content>`, white, with `view` boxes in `#6390F0`, `text` at 12px and `image` as
  `<img>`, the same image element as the list.

## Tests

```sh
npm test   # ng test (Vitest), the data mappers
```
