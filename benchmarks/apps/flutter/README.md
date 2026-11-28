# Flutter benchmark app

Software Mansion's [launchperf-poke-rn](https://github.com/software-mansion-labs/launchperf-poke-rn)
(MIT, the app in `../react-native`), ported screen for screen to [Flutter](https://flutter.dev),
for the launch benchmark in issue #285 (#849). Flutter isn't Angular, but it's the comparison
people ask for when they choose a cross-platform framework. [`../../SPEC.md`](../../SPEC.md) says
what every app in the benchmark does.

It's an app as a user makes one:

```sh
flutter create --org com.angularlynx.bench --project-name launchperf_flutter \
  --platforms ios --ios-language swift flutter
```

then the screens in `lib/`, the dependencies below, and the signposts in
`ios/Runner/AppDelegate.swift`. iOS only: the Android benchmark runs only the two Lynx apps so far.

## Versions

Every dependency is pinned to an exact version in `pubspec.yaml`, and `pubspec.lock` holds the
rest of the tree.

| Package                                                                                                                     | Version                                              |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Flutter (stable), Impeller                                                                                                  | 3.50.1 (framework `ae9b586f34`, engine `4d35714800`) |
| Dart                                                                                                                        | 3.14.0                                               |
| `material_ui`, `cupertino_ui` (Flutter's Material and Cupertino widgets, packages since `flutter create` began adding them) | 1.11.1, 1.1.7                                        |
| `http`                                                                                                                      | 1.6.0                                                |
| `shared_preferences` (`shared_preferences_foundation` on iOS)                                                               | 2.5.6 (2.6.2)                                        |
| `flutter_svg`                                                                                                               | 2.5.1                                                |

The plugins come in through Swift Package Manager, Flutter's default now, so there's no
CocoaPods step.

## How it maps onto the reference

Flutter draws every pixel itself, with its Impeller renderer, into one Metal view: none of this
app's screens are UIKit's views, where the React Native and Lynx apps' are. So each row below
names the Flutter widget that stands in for the reference's native one, and whether it's
Material's look or Cupertino's (iOS's, redrawn by Flutter).

| Reference (React Native)                                                 | Here (Flutter)                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| expo-router `Stack`                                                      | `MaterialApp`'s `Navigator`, a route per screen (`lib/main.dart`)                                                                                                                                                                                                    |
| expo-router `Tabs` (React Navigation's bottom tabs)                      | `TabsScreen` (`lib/screens/tabs.dart`): an `IndexedStack` that builds a tab the first time it's shown and keeps it, over Cupertino's `CupertinoTabBar` with the reference's SVG icons, tint colors and 12px labels                                                   |
| `FlatList`, `onEndReachedThreshold` 0.5                                  | `ListView.builder` (`lib/widgets/pokemon_list.dart`), which builds rows as they near the screen, and a scroll listener that loads the next page when the end comes within half a screen                                                                              |
| `PokemonItem`, `TouchableOpacity`                                        | `PokemonItem` (same file): a `GestureDetector` that fades the row to 0.2 while pressed, as `TouchableOpacity` does                                                                                                                                                   |
| React Query (`useInfiniteQuery`, `useQuery`; stale after 5 min, retry 2) | `PokedexScreen`'s own paging state (`lib/screens/pokedex.dart`) and `PokemonDetails` (`lib/data/pokemon_api.dart`): each id's detail fetched once and shared, stale after 5 minutes, every request retried twice after 1 s and 2 s                                   |
| axios, 10 s timeout                                                      | `package:http`'s default client (`dart:io`'s `HttpClient` on iOS, not `NSURLSession`), same timeout                                                                                                                                                                  |
| `pokemon/[id]` as an iOS form sheet, detent 0.75, radius 16              | `showModalBottomSheet` at 75% of the screen, radius 16 (`lib/screens/pokemon_sheet.dart`): Material's sheet. It slides up over a scrim and drags down to close, but the screen behind it doesn't shrink back as it does behind UIKit's form sheet                    |
| zustand + AsyncStorage `persist`                                         | `Favourites` (`lib/data/favourites.dart`), a `ChangeNotifier` kept in `shared_preferences` (`NSUserDefaults`) under the key `favourites`, read when the app starts                                                                                                   |
| expo-image, with the Pokéball placeholder                                | `Image.network` with the same placeholder until the first frame of the image (`lib/widgets/common.dart`). Flutter caches decoded images in memory only, where expo-image also keeps a disk cache, so each launch downloads the sprites again from the fixture server |
| `ActivityIndicator`                                                      | Cupertino's `CupertinoActivityIndicator`, which draws iOS's spinner                                                                                                                                                                                                  |
| react-native-svg icons                                                   | `flutter_svg` drawing the same SVG files (`assets/icons`)                                                                                                                                                                                                            |
| `modules/app-startup-module`                                             | `launch_perf_report_mark` in `ios/Runner/AppDelegate.swift`, called through `dart:ffi` (`lib/startup.dart`)                                                                                                                                                          |

The favourite buttons have no hit slop: in Flutter a widget only takes touches inside its own box,
so the reference's 8px slop would need a bigger box, which would move the layout. Their size is
the reference's.

## Marks

Signposts are `os_signpost` events in the `PointsOfInterest` category, subsystem
`com.angularlynx.bench.flutter`, each emitted once per process by `launch_perf_report_mark`, a
C-callable Swift function in `ios/Runner/AppDelegate.swift`. Dart can't emit one itself, so
`lib/startup.dart` calls it through `dart:ffi`, which runs it there and then.

Not a method channel, though that's the usual way from Dart to Swift: Flutter runs Dart on iOS's
main thread, and that thread's run loop handles a channel's message only once the Dart code
running has returned. A `MountStart` sent as the mount screen starts building was emitted after
the whole first frame, in the same millisecond as `MountEnd` (on the Simulator; through
`dart:ffi`, 124 ms apart for 1,500 views in a Debug build). React Native's module is called
synchronously too, through JSI.

| Name         | When                                                                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TTFD`       | The first page of the list has arrived and the frame that builds, lays out and paints its rows has ended (`WidgetsBinding.instance.addPostFrameCallback`, added with the `setState` that gives the list the page); or the mount screen's first frame has ended |
| `MountStart` | The mount screen's `initState`, before it builds its elements                                                                                                                                                                                                  |
| `MountEnd`   | The end of the mount screen's first frame, which has every element                                                                                                                                                                                             |

A post-frame callback runs once Flutter has built, laid out and painted the frame on its UI thread
and handed it to the raster thread: the counterpart of the reference's `requestAnimationFrame`
after the commit that renders the rows. Each page's rows' details are fetched as the page arrives,
as in the AngularLynx app (#856): `ListView.builder` builds rows only as they near the screen, so
otherwise each row would fetch its types while the list scrolls.

Watch the marks on the Simulator with
`xcrun simctl spawn booted log stream --signpost --predicate 'subsystem == "com.angularlynx.bench.flutter"'`.

## Build-time settings

Both are compiled in with `--dart-define` (`lib/config.dart`): Instruments launches the app
without arguments.

| Variable         | Default                 | What it sets                                                                                                                                                                                             |
| ---------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIXTURE_ORIGIN` | `http://localhost:8787` | The fixture server (`node ../../fixtures/server.mjs`); `API` is `{origin}/api/v2`, `SPRITES` `{origin}/sprites/pokemon`. The Simulator reaches the Mac at localhost; a phone needs the Mac's LAN address |
| `BENCH_SCREEN`   | empty                   | A screen to launch straight into, such as `mount?kind=view&count=1500` (`kind` is `view`, `text` or `image`). The tabs, the list and its requests never exist in that build                              |

The bundle ID is `BENCH_BUNDLE_ID` in the Xcode project (`com.angularlynx.bench.flutter`), which
only the app's target reads, so it can be set on the `xcodebuild` command line without renaming
the plugins' resource bundles as `PRODUCT_BUNDLE_IDENTIFIER` would. The URL scheme is
`launchperfflutter`, so the mount screen also opens by link:
`launchperfflutter://bench/mount?kind=view&count=1500`. A link that launches the app builds the
tabs first and opens the screen over them (Flutter starts on `/` and pushes the link's route), so
the harness builds with `BENCH_SCREEN` instead.

`NSLocalNetworkUsageDescription` is in `ios/Runner/Info.plist`: the phone asks for local network
access the first time the app reaches the Mac, which needs a tap on Allow.

## Build

Needs Flutter 3.50.1 (`flutter` on the PATH) and Xcode 27. `harness/build_ios_app.sh flutter
<bundle id> [screen]` runs the commands below and prints the `.app`.

`flutter build ios` can't take a bundle ID, so it only writes the settings
(`--config-only`: the build mode and the dart-defines, into `ios/Flutter/Generated.xcconfig`),
and `xcodebuild` builds the app; its build phase compiles the Dart with those settings.

### For a phone (Release, development signing)

```sh
flutter build ios --release --config-only \
  --dart-define=FIXTURE_ORIGIN=http://192.168.1.231:8787 --dart-define=BENCH_SCREEN=
xcodebuild build -workspace ios/Runner.xcworkspace -scheme Runner -configuration Release \
  -sdk iphoneos -destination generic/platform=iOS -derivedDataPath build/ios-device \
  BENCH_BUNDLE_ID=com.angularlynx.bench.rival DEVELOPMENT_TEAM=F64LTK85F6 \
  CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates
# → build/ios-device/Build/Products/Release-iphoneos/Runner.app
```

Release compiles the Dart ahead of time into `App.framework`, as an App Store build does.

### For the Simulator (Debug only)

Flutter builds Release and Profile for phones only (`flutter build ios --simulator --release`
stops with "Release mode is not supported for simulators"). On the Simulator the Dart runs in the
debug VM, compiled just in time, with the framework's debug checks on, so a Simulator launch
checks that the app works and reports its marks, and **its timings say nothing about Flutter's**:
don't compare them with the other apps' Simulator runs. `build_ios_app.sh --simulator flutter`
warns about this.

```sh
flutter build ios --simulator --debug --config-only --dart-define=BENCH_SCREEN=
xcodebuild build -workspace ios/Runner.xcworkspace -scheme Runner -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/ios-simulator CODE_SIGNING_ALLOWED=NO
xcrun simctl install booted build/ios-simulator/Build/Products/Debug-iphonesimulator/Runner.app
xcrun simctl launch booted com.angularlynx.bench.flutter
```

A debug build launched from the home screen runs on the Simulator, but not on a phone, where iOS
stops a debug Flutter app that no debugger started.

## Checks

```sh
flutter analyze
flutter test
dart format --output=none --set-exit-if-changed lib test
```
