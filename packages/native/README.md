# @blotch/angular-lynx-native

Builds AngularLynx apps into iOS and Android binaries. You don't call it directly: `ng build --platform ios|android|all` (the `@blotch/angular-lynx:application` builder) loads it after building the Lynx bundle. `ng add @blotch/angular-lynx` installs it.

User documentation: [Publishing your App](../website/docs/guide/building-for-production.mdx). The design and its reasoning: [`investigations/native-app-builds.md`](../../investigations/native-app-builds.md).

## What it does

1. **Generates** the native project from `templates/ios` or `templates/android` into `.angular-lynx/native/<platform>`, writing the app options from `angular.json` into the few files the templates mark for it. It regenerates only when a hash of its inputs changes (this package's version, the template, the options, the icon), so Xcode and Gradle keep their incremental state.
2. **Copies** `dist/` (without the web bundle) into the project.
3. **Builds** it with `xcodebuild` or Gradle and copies the binaries to `dist/<platform>/`.

An ejected project (`ios/` or `android/` with a `.angular-lynx-ejected` marker, written by `ng generate @blotch/angular-lynx:eject`) is built as it is and never regenerated.

## The shells

Both are one full-screen `LynxView` running `main.lynx.bundle`; Angular Router does all navigation inside it. Bundles and assets load from inside the app, so RSpeedy's default asset prefix (`/static/...`) works with no configuration. See [`templates/android/README.md`](templates/android/README.md) for the Android shell's details.

|                  | iOS                                             | Android                                                  |
| ---------------- | ----------------------------------------------- | -------------------------------------------------------- |
| Language         | Swift, scene lifecycle                          | Kotlin                                                   |
| Lynx             | 4.1.0, prebuilt XCFrameworks (below)            | 4.1.0 AARs from Maven Central                            |
| Toolchain        | Xcode 27, iOS 15+                               | AGP 9.4, Gradle 9.6, JDK 17+, SDK 36, minSdk 24          |
| Generated config | `Config/App.xcconfig`, `App/Info.plist` markers | `angular-lynx.properties`, `AndroidManifest.xml` markers |

## Lynx for iOS

Lynx publishes iOS only as source pods, which take minutes to compile and need CocoaPods (and so Ruby). `scripts/build-lynx-ios-frameworks.sh` compiles them once into XCFrameworks (about 24 MB zipped, with debug symbols in a separate zip). The builder downloads the zip pinned in `src/ios/frameworks.ts` (URL and SHA-256) on first use and caches it in `~/.cache/angular-lynx/lynx-ios/<version>`.

The zip for Lynx 4.1.0 is the [`lynx-ios-4.1.0` release](https://github.com/Blotch-Smart-Frames/AngularLynx/releases/tag/lynx-ios-4.1.0). For a new Lynx version, bump the versions in the script, run the **Lynx iOS frameworks** workflow with `publish` (or the script locally), and pin the new zip's URL and SHA-256. To test a locally built folder before publishing it:

```sh
npm run build:lynx-ios-frameworks -w packages/native   # needs Xcode, and Ruby >= 2.7 with Bundler for CocoaPods
export ANGULAR_LYNX_IOS_FRAMEWORKS=$PWD/packages/native/.lynx-ios-build/out/LynxFrameworks
```

## Changing a template

- **iOS:** `App/` is a synchronized folder, so adding or removing a Swift file needs no project change. For anything else (a build setting, a framework, a resource folder), edit `APP_PROJECT` in `scripts/generate-ios-project.ts`. `App.xcodeproj` isn't in git: `npm run build` (and the tests' setup) renders it with [`@bacons/xcode`](https://github.com/EvanBacon/xcode), which needs only Node, and the npm package ships the result. Run `npm run generate:ios-project -w packages/native` to render it without the TypeScript build, e.g. to open the template in Xcode.
- **Both:** run `npm run e2e -- --ios --shell` (and Layer 6 for Android, see the [E2E README](../e2e/README.md)) to build and tap through a fresh app on each platform.
