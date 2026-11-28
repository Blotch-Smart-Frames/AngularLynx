# Build Configuration

## Overview

AngularLynx apps build, serve and test with the Angular CLI. `ng build` and `ng serve` run the `@blotch/angular-lynx-build` builders, which run [RSpeedy](https://lynxjs.org/rspeedy) (Lynx's build tool based on Rsbuild) with the `@blotch/rsbuild-plugin-angular-lynx` plugin that adds Angular compilation. `ng test` runs Angular's own unit-test builder (Vitest), set up for Lynx.

`ng add @blotch/angular-lynx` sets all of this up. The build config lives in `angular.json`, as in any Angular app.

## angular.json

```json
{
  "projects": {
    "my-app": {
      "projectType": "application",
      "root": "",
      "sourceRoot": "src",
      "architect": {
        "build": {
          "builder": "@blotch/angular-lynx-build:application",
          "options": {
            "browser": "src/main.ts",
            "tsConfig": "tsconfig.app.json",
            "styles": ["src/styles.css"]
          },
          "configurations": {
            "production": {
              "budgets": [
                {
                  "type": "initial",
                  "maximumWarning": "2MB",
                  "maximumError": "5MB"
                },
                {
                  "type": "anyComponentStyle",
                  "maximumWarning": "4kB",
                  "maximumError": "8kB"
                }
              ],
              "outputHashing": "all"
            },
            "development": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true
            }
          },
          "defaultConfiguration": "production"
        },
        "serve": {
          "builder": "@blotch/angular-lynx-build:dev-server",
          "configurations": {
            "production": { "buildTarget": "my-app:build:production" },
            "development": { "buildTarget": "my-app:build:development" }
          },
          "defaultConfiguration": "development"
        },
        "test": {
          "builder": "@blotch/angular-lynx-build:unit-test"
        },
        "extract-i18n": {
          "builder": "@blotch/angular-lynx-build:extract-i18n"
        }
      }
    }
  }
}
```

The build target's Angular options (`browser`, `tsConfig`, `polyfills`, `styles`, `fileReplacements`, ...) configure the compile, as Angular CLI resolves them: `ng build -c development` and command-line overrides apply. `ng build --platform ios|android|all` also builds the native app; its options (`appId`, `appName`, `icon`, `permissions`, ...) live in the same target. `permissions.camera` is the reason iOS shows before the camera opens, and it also turns on `LynxBarcodeScanner`: without it the shells leave the scanner's code out. `permissions.savePhotos` is the reason iOS shows before the share sheet's Save Image adds to Photos; it has a default. `permissions.localNetwork` is the reason iOS (14+) shows before the app first connects to a device or server on the local network, such as `http://192.168.1.20:8080` (iOS lets plain HTTP to an IP address through without an ATS exception); without it a release app has no `NSLocalNetworkUsageDescription`, only the `ng serve --platform` development app does. `permissions.biometrics` is the reason iOS shows the first time the app uses Face ID, and the biometric prompt's default text; only an app with it gets the biometrics module behind `LynxBiometrics` and `LynxSecureStorage`'s `requireBiometrics` (on Android, with AndroidX Biometric). `icon` is one 1024×1024 PNG without transparency: iOS uses it as it is, and Android gets it resized for each density, round, and as an adaptive icon scaled to fit inside the launcher's mask. To give the Android adaptive icon its own layers, set `android.adaptiveIcon: { foreground, background }`: `foreground` a 1024×1024 PNG with transparency whose content stays inside the middle 66 of 108 dp, `background` a color (`#111111`) or a 1024×1024 PNG. `splash: { image, imageWidth, backgroundColor, dark: { image, backgroundColor } }` is the splash screen: a PNG with transparency drawn centered at `imageWidth` points/dp (needed with `image`; give it 3× the pixels), on a hex color (`#09090B`) the shells also paint behind the app, with dark mode taking the light values it leaves out. iOS gets a launch screen, Android the AndroidX splash screen on every version; Android shows the image inside a 192 dp circle, so a wide logo is drawn smaller there and the build warns with the widest `imageWidth` that fits. The shells keep the splash up until Angular's first frame, or with `provideSplashScreen()` in the app config until the router's first navigation ends (`{ hide: 'afterFirstNavigation' }`, the default, which throws without `provideRouter()`) or the app calls `inject(LynxSplashScreen).hide()` (`{ hide: 'manual' }`), then fade it out; they drop it after 5 s regardless. iOS caches launch screens: reinstall the app to see a change. To time startup, call `reportFullyDrawn()` (from `@blotch/angular-lynx`) once the first screen is complete (e.g. in an `effect()` when its first page of data has rendered): after the next flush the shells call Android's `Activity.reportFullyDrawn()` (logcat's `Fully drawn`, Macrobenchmark's time to full display) or emit an iOS `os_signpost` event `Fully Drawn` in the Points of Interest category (Instruments' App Launch template plus Points of Interest). Only the first call counts; it does nothing in Lynx Explorer, the web preview and tests. The apps draw the page edge to edge, under the status bar and the home indicator, with `env(safe-area-inset-*)` giving the insets; `"edgeToEdge": false` keeps the page inside the safe area (see "Safe Area" in [styling-and-css.md](styling-and-css.md)). The apps' text follows the phone's text size (Dynamic Type, Android's font size) through `rem`; `"textScaling": false` keeps it at the default size, and `"textScaling": { "max": 1.6 }` caps the scale (at least 1). See "Text follows the phone's text size" in [lynx-gotchas.md](lynx-gotchas.md). Each platform's app goes in its own folder of the output path (`ios`, `android`): a platform's build replaces only its folder, and `ng build` and `ng serve` keep both.

- **`optimization` picks a production or development build.** There is no `mode` option: as in Angular, a build that optimizes scripts is a production build, and one that doesn't is a development build with dev mode on. Either way, `ng build`'s bundles ask for their imported images and lazy bundles where they're deployed (each environment's `output.assetPrefix`, `/` by default), so a development build with `--platform` draws its images from inside the app. Only `ng serve` points them at its dev server.
- **`budgets` are enforced** against the Lynx bundle (each entry's bundle is its own `initial` budget) and each component stylesheet, with `ng build`'s messages. A new app's Lynx bundle is about 720 kB (300 kB gzipped; Angular is in it once, on the main thread), so `ng add` raises `ng new`'s `initial` budget to 2 MB / 5 MB.
- **`intl`** adds the `Intl` APIs it lists, which Lynx lacks, to the Lynx bundle (`"intl": ["NumberFormat", "Collator"]`), with data for `i18n.sourceLocale` and `i18n.locales`. The app installs the FormatJS packages the build names. See "No `Intl`" in [lynx-gotchas.md](lynx-gotchas.md).
- **`sourceMap`** maps the scripts back to what they were built from, as in Angular CLI: `true` (or `scripts: true`) the app's own TypeScript, and `{ "scripts": true, "vendor": true }` libraries' code too (Angular, AngularLynx, rxjs), through the maps they publish to their TypeScript. Without `vendor`, a library's code maps to its published `.mjs`.
- **`ng build --watch`** rebuilds the bundle on every change. It can't be combined with `--platform`.
- **`fileReplacements`** swap files as on the web, in everything the build makes: both threads' code, the web preview and the `--platform` apps. Paths are relative to the workspace and can lead out of it (`../shared/environment.prod.ts`). `ng generate environments` warns that the build target uses a third-party builder; the replacement it adds works.
- **`multiTouch`** (`"multiTouch": true`) makes touch events carry every finger, for a pinch of your own: Lynx's `enableMultiTouch` page config, off by default, written into the bundle. `pluginAngularLynx({ multiTouch })` sets it for an app whose build target isn't AngularLynx's, and wins. See "Two fingers" in [events-and-interactions.md](events-and-interactions.md).
- **`backgroundTreeShaking`** (`"backgroundTreeShaking": "aggressive"`, default `"safe"`) drops the app's own module-level values that nothing on the background thread reads from the background thread's script (kitchen-sink's: 101 KB to 56 KB; the main thread's is unchanged). The cost: a top-level declaration whose value nothing there reads no longer runs there, even when its initializer does something on purpose, such as `const sub = lynx.getJSModule('GlobalEventEmitter').addListener(...)`. Statements that aren't declarations still run, and other packages' code is never trimmed. `pluginAngularLynx({ backgroundTreeShaking })` sets it for an app whose build target isn't AngularLynx's, and wins. See [threading-model.md](threading-model.md).
- **`eagerImports`** (`"eagerImports": true`, default `false`) compiles the app's own `import()`s on the main thread (a lazy route's `loadComponent`/`loadChildren`) as static imports. Without lazy bundles every route is in the main-thread script anyway, and an `import()` keeps rspack from concatenating the modules a lazy route shares with the rest of the app (Angular, rxjs, the runtime, shared app files), so the script carries their glue code: the benchmark app's script goes from 635 KB to 612 KB. The cost: each module an `import()` loads runs at launch, before the module importing it, so its top-level code runs even when the route is never shown. And an import cycle through the routes file (a lazy screen importing `routes` from the file that loads it), which the `import()` broke, can make a top-level read throw a used-before-defined `ReferenceError`. So can a read in a class's static field or static block, which run as the class is defined; a read in a function or method called later is fine. `@defer` blocks' imports stay lazy, and so do other packages' and non-literal ones. It does nothing with `experimental_isLazyBundle`. `pluginAngularLynx({ eagerImports })` sets it for an app whose build target isn't AngularLynx's, and wins.
- **`baseHref`** (`ng build --base-href=/shop/`) prefixes the web bundle's asset URLs: rspeedy's `output.assetPrefix` for the `web` environment. Lynx for Web resolves a bundle's imported images against the page that shows the `<lynx-view>`, not against the bundle, so a web bundle served under a path needs it (see "Bundled images need `baseHref` on the web" in [lynx-gotchas.md](lynx-gotchas.md)). The Lynx bundle resolves them against itself and is left alone. A prefix `lynx.config.ts` sets for the environment wins.
- **The Android release app is shrunk with R8**, as `ng build --platform android` builds it (the `.apk` and `.aab`; `ng serve --platform android`'s debug build isn't). Its Java and Kotlin classes are renamed, so a Java stack trace from it needs R8's mapping file to read: Google Play reads it from the `.aab` by itself. Lynx's own keep rules and the shell's cover Lynx, XElement and the shell's modules (any `LynxModule` subclass keeps its methods); native code added to an ejected project that is reached by reflection needs R8 keep rules of its own, in the ejected `android/app` folder's rules file.
- **An Android build signed with `android.signing` (the Google Play upload) holds only the ARM ABIs** (`arm64-v8a`, `armeabi-v7a`). Play rejects an app whose 64-bit native libraries can't load with 16 KB memory pages, and the `x86_64` libraries of the Fresco version Lynx's image service needs are aligned for 4 KB pages, so Play doesn't offer the app to x86 devices (emulators, a few Chromebooks). A build signed with the debug key keeps all four ABIs, so its `.apk` still runs on an `x86_64` emulator.
- **The Android app declares both screen orientations optional** (`android.hardware.screen.portrait` and `.landscape`, `required="false"`), so a fixed `screenOrientation` doesn't make Google Play hide it from devices that report neither, such as some Chromebooks.

Like Angular's own dev server, `ng serve` builds its `buildTarget` (by default the build target's `development` configuration), so `ng serve -c production` serves a production build. It also takes `--port` and `--host`, and prints the QR code Lynx Explorer scans.

`ng serve --platform ios|android` (with `--device` as for `--run`) also builds a development build of the app from the build target's native options and opens it on a simulator, emulator or phone. It loads the bundle from the dev server and updates on every save, as Lynx Explorer does, but it's the app itself, with the native modules Lynx Explorer lacks (`LynxSecureStorage`, `LynxWebAuthSession`, `LynxShare`, WebGL `<canvas>`...). Develop an app that needs them this way. The native build is cached: the next `ng serve --platform` with the same native options reinstalls it without Xcode or Gradle. On Android the app reaches the server at `localhost` through `adb reverse`; a real iPhone loads from the Mac's address on the local network, so it needs the same Wi-Fi even over USB, and the person must tap Allow when iOS asks about the local network (Settings > Privacy & Security > Local Network turns it back on). Only the development build has `NSLocalNetworkUsageDescription`; an ejected project adds its own. When the server can't be reached, the app says so and retries. It's a Debug/debug build that has no bundle inside it: never ship it, `ng build --platform` builds the store app. `"configurations": { "ios": { "platform": "ios" } }` in the `serve` target gives `ng serve -c ios`.

`ng test` takes the options of Angular's unit-test builder. It finds `*.spec.ts` and `*.test.ts` files, compiles them ahead of time like the app, and loads `@blotch/angular-lynx-testing-library`'s setup when the project has it. The tests load the build target's `polyfills`, then that setup. `polyfills` on the `test` target (Angular 22.3's option) replaces the app's list for the tests, `[]` included, and the setup still loads after it; a local file such as `src/polyfills.ts` works in either list. Templates are checked strictly, so a component using Lynx elements imports `LYNX_ELEMENTS`. A TestBed spec renders through Angular's DOM renderer, where a Lynx element is an element like any other: `fixture.nativeElement.querySelector('text')` finds a `<text>`. `ng add` gives a new app one for its root component (`src/app/app.spec.ts`), so `ng test` has a test to run from the start. The testing library's `fireEvent` sends an event the way a device does: first every `global-bind` handler for it, anywhere in the page; then a touch event goes down from the page through the `capture-bind` and `capture-catch` handlers, then back up through the `bind` and `catch` ones, and a `catch` handler stops it. An event that doesn't bubble, such as `input`, runs only the target's own handler. `document:` and `window:` listeners run after the elements' handlers; for an event a `catch` handler stopped, on the next timer (`await waitForUpdate()`). `$event.target` is `{ uid }`, the element's unique id, as on a device.

`fireEvent` has a method for each common event (`tap`, `input`, `scroll`, `layoutchange`, an `<image>`'s `load` and `error`, `uiappear` and `uidisappear` for an element coming into view and leaving it, …). Pass what the element would report as `detail`, and the handler gets it as `$event.detail`:

```typescript
fireEvent.load(image, { detail: { width: 240, height: 340 } });
await waitForUpdate(); // the handler ran; this lets Angular render its result
```

An `<input>` or `<textarea>` is a JSDOM input or textarea, and its `value` is the text the field shows: the `[value]` or form value it renders with or is set to, and what `fireEvent.input(field, { detail: { value: 'Ada' } })` types.

To test a component's timers, use `vi.useFakeTimers()` after `render()`. Then nothing runs on the real clock: change detection waits for the fake clock too. `waitForUpdate()` waits on a zero-delay timer, so start it, move the clock, and await it. The fake clock runs a zero-delay timer set inside another timer a millisecond later, as Node does, so move it 1 ms:

```typescript
const waitForUpdate = async () => {
  const update = nextUpdate(); // the library's waitForUpdate, imported as nextUpdate
  await vi.advanceTimersByTimeAsync(1);
  await update;
};
fireEvent.tap(button);
await vi.advanceTimersByTimeAsync(300); // the component's own 300 ms timer
await waitForUpdate();
```

`fireEvent` has a method for each event in its `eventMap`: touches, mouse (with the pointer entering and leaving an element, `fireEvent.mouseenter()` and its counterpart, which stay on it, so a spec can clear a pressed state), keys, scrolling, `uiappear`/`uidisappear`, form events with `keyboardheightchange` (`{ detail: { height } }`), `accessibilityaction` (`{ detail: { name } }`), an `<overlay>`'s `requestclose` (Android's back button), layout and loading, and transitions. For an event without a method, fire one whose type is the handler's kind and the event name: `fireEvent(pager, new CustomEvent('bindEvent:change', { detail }))` runs `(bindchange)` with that `detail`.

To render a component with inputs, pass them to `render()` instead of writing a host component: `await render(Greeting, { inputs: { name: 'Lynx' } })`. They're set before the first change detection, as a parent template binds them, so a required input has its value and `ngOnInit` sees it. Key each by the name a template binds (an aliased input takes its alias, such as `class`). `await rerender({ inputs: { name: 'Angular' } })` changes them and keeps the component, but only inputs `render()` set: a component whose inputs are bound takes no other inputs, nor `componentRef.setInput()`. So give `render()` a starting value for any input the test changes later.

A spec has none of the app's native modules, as in Lynx Explorer: `LynxNativeModule.call()` resolves `undefined`, a native module's methods reject, `LynxLocalStorage` and `LynxSecureStorage` keep values in memory, and `LynxImagePicker.pick()` and `LynxShare.share()` reject with `unavailable` (provide stand-ins that resolve with what the test needs). `LynxBiometrics` has a module standing for a phone with Face ID set up, which `setBiometrics()`, `queueBiometricResult()` and `biometricPrompts()` steer and read (see [lynx-gotchas.md](lynx-gotchas.md)). `LynxLinking` is the exception: the testing library gives it a module that records each URL, which `openedURLs()` returns (`[{ url, inApp }]`, reset after each test), so `openURL()` and `openInApp()` resolve and `canOpenURL()` resolves `true`. `LynxShortcuts` has one too: `runShortcut(id)` runs a shortcut as Siri or the app icon's menu does, `pressBackButton()` presses Android's back button (`LynxBackButton`'s handlers, then the router; it returns `false` when Android would leave the app), `openLink(url)` opens the app with a deep link, which the router and `LynxLinking.onURL()` handlers get, and `render()`'s `initialURL` option starts the app from one, which `getInitialURL()` returns (see [routing.md](routing.md)). `LynxBarcodeScanner.scan()` stays open until `queueBarcodeScan({ format, value })`, `cancelBarcodeScan()` or `failBarcodeScan(code)` answers it. `setAppState('background')` and `setAppState('active')` move `LynxAppState`, as leaving the app and coming back does. `LynxSplashScreen` keeps `visible()` in memory, and `render()` hides it as bootstrap does unless the providers include `provideSplashScreen()`, so a spec can check when the app lets it go. The test environment answers the calls AngularLynx relays to the background thread, but a relayed call that needs a Lynx API the environment lacks, such as `LynxAccessibility.announce()`, rejects; provide a fake for it. Module-level `backgroundFn()`s run on the environment's background thread, so `runOnBackground()` resolves with the function's result or rejects with what it throws, as on a device.

`LynxClipboard` keeps its text in memory under the testing library, one clipboard for each rendered app, so a spec reads back what was copied with `componentRef.injector.get(LynxClipboard).getString()`.

`ng extract-i18n` takes the options of Angular's extract-i18n builder. Angular CLI can't pick an extractor for the Lynx build builder by itself, so the app needs the `extract-i18n` target, which `ng add` writes. `ng generate @blotch/angular-lynx:add-i18n` sets it to write JSON to `src/locale`, the format `loadTranslations()` takes.

## Config File: `lynx.config.ts` (optional)

An app doesn't need one. Without it, the builders use `angular.json` and AngularLynx's defaults: the entry is the build target's `browser`, the environments are `lynx` (the bundle Lynx Explorer and native apps load) and `web` (the browser preview), and `ng serve` adds the QR code plugin. Each default applies only where lynx.config.ts doesn't set its own.

Add one for RSpeedy settings, or to pass the plugin options. Import `defineConfig` and `pluginAngularLynx` from `@blotch/angular-lynx-build`, which depends on RSpeedy and the plugin. The builders use your plugin instance instead of adding one:

```typescript
import { defineConfig, pluginAngularLynx } from '@blotch/angular-lynx-build';

export default defineConfig({
  plugins: [pluginAngularLynx({ enableSSR: true })],
});
```

### Code splitting: `experimental_isLazyBundle`

By default, `loadComponent()` routes and `@defer` blocks are built into the main bundle, and their `import()` only runs modules that are already there (the `eagerImports` build option, above, makes the routes' `import()`s static imports instead, for a smaller main-thread script). `pluginAngularLynx({ experimental_isLazyBundle: true })` makes each one a lazy bundle of its own (`dist/lazy-bundle/`), which the main thread downloads the first time the route or block needs it, while the router or the `@defer` block's `@loading` waits:

- It needs Lynx 3.9 or later (`lynx.fetchBundle()`). The apps `ng build --platform` makes, and Lynx Explorer 4.1, have it.
- A failed download rejects the `import()`: the navigation fails (`NavigationError`), or the `@defer` block shows its `@error`.
- The main bundle's classes (Tailwind's utilities, the theme) apply inside a lazy component, and the lazy bundle's component styles are added to the page when it loads.
- Lazy bundle URLs start with the build's `output.assetPrefix`, `/` by default, in a development `ng build` as in a production one. `ng serve` and the native apps resolve them; Lynx Explorer doesn't resolve a root-relative URL, so to open an `ng build`'s bundle from a static server in Explorer, give the `lynx` environment an absolute prefix:

```typescript
export default defineConfig({
  environments: {
    lynx: { output: { assetPrefix: 'http://192.168.1.20:8080/' } },
    web: {},
  },
  plugins: [pluginAngularLynx({ experimental_isLazyBundle: true })],
});
```

## What `pluginAngularLynx()` Does

1. **Angular compilation** — Uses `JavaScriptTransformer` + `createAngularCompilation` for AOT template compilation
2. **Entry splitting** — Creates two bundles: main-thread (ES2019) and background-thread (ES2015)
3. **Thread banners** — Injects `globalThis["__MAIN_THREAD__"]=true/false` into each bundle
4. **CSS handling** — Processes component styles and global CSS
5. **Chunk splitting** — Builds lazy routes and `@defer` blocks into the main bundle, or into lazy bundles with `experimental_isLazyBundle`
6. **Tailwind** — Runs Tailwind CSS 3 from a `tailwind.config.*`, and rewrites what Tailwind CSS 4 writes into CSS Lynx reads

## Project Files

Minimal project structure:

```
my-app/
├── angular.json            # Angular workspace config: builders + compiler options
├── tsconfig.json           # TypeScript config
├── package.json
└── src/
    ├── main.ts             # Entry point (bootstrapApplication)
    ├── rspeedy-env.d.ts    # /// <reference types="@blotch/angular-lynx-build/client" />
    └── app/
        ├── app.config.ts   # Angular app config
        ├── app.routes.ts   # Route definitions
        └── app.ts
```

## Commands

```bash
# Development (starts dev server, shows QR code for Lynx Explorer)
ng serve
ng serve --platform ios        # also opens the real app on a simulator, loading from the server
ng serve --platform android --device emulator-5554

# Production build
ng build

# Rebuild on every change
ng build --watch

# Unit tests
ng test

# Native apps
ng build --platform ios       # or android, or all
ng build --platform ios --run # then install on a simulator/emulator and open it
                              # (--device "iPhone 18 Pro", --device <AVD or adb serial>)
ng build --platform ios --run --device "Jane's iPhone"   # a paired real iPhone

# From the monorepo root
npm run demo              # Runs ng serve for the kitchen-sink-app
```

On a real iPhone, `--run` needs `"ios": { "teamId": "ABCDE12345" }` in the build options (without it, the error lists the teams this Mac can sign for), an Apple ID signed in to Xcode (a free one's Personal Team works; its apps stop opening after 7 days), Developer Mode on, and the phone unlocked while it builds. It builds only `dist/ios/MyApp-device.app`, signed for development. Without `--device`, `--run` always uses a simulator. `"ios": { "teamId": ..., "export": "release-testing" }` builds an ad hoc `.ipa` for the team's registered iPhones; `app-store-connect` is the default once `ios.signing` (an API key) is set.

## Dev Workflow

1. Run `ng serve` — starts dev server, prints QR code
2. Open **Lynx Explorer** app on your device
3. Scan QR code — loads your app on-device
4. Edit code — hot reload updates the app
5. Check terminal for logs from `LynxLogger`

Or `ng serve --platform ios|android` in place of steps 2–3, which opens your own app, native modules included, instead of Lynx Explorer.

The web preview (the **Preview** link `ng serve` prints, `/__web_preview`) can't take hot updates. It reloads the page when a rebuild finishes, so the app starts over on its first screen with its state reset. A build that fails leaves the page as it was and logs the errors in the browser's console.

## Dependencies

```json
{
  "dependencies": {
    "@angular/core": "^22.3.0",
    "@angular/router": "^22.3.0",
    "@blotch/angular-lynx": "^22.3.0"
  },
  "devDependencies": {
    "@blotch/angular-lynx-build": "^22.3.0"
  }
}
```

`@blotch/angular-lynx-build` is the only build dependency, as `@angular/build` is for a web app. It brings RSpeedy, the QR code plugin, `@blotch/rsbuild-plugin-angular-lynx` and `@blotch/angular-lynx-native` (the iOS and Android app builder) with it.

On pnpm 11 and later, `pnpm install` and `pnpm add` fail with `ERR_PNPM_IGNORED_BUILDS` while any dependency's install script is neither allowed nor denied. The four scripts in an Angular app belong to Angular's build tools, which come with prebuilt binaries, so `ng add` denies them in a pnpm app's `pnpm-workspace.yaml` (pnpm 10.26 and later). An app set up before `ng add` did this needs the same entries, or `pnpm approve-builds`:

```yaml
allowBuilds:
  '@parcel/watcher': false
  esbuild: false
  lmdb: false
  msgpackr-extract: false
```

In a pnpm monorepo, they go in the workspace root's `pnpm-workspace.yaml`: `ng add` prints them rather than giving the app a file of its own, which would split it into a separate workspace.

## Tailwind CSS

New apps use **Tailwind CSS 4**, set up as Angular CLI does: `.postcssrc.json` runs `@tailwindcss/postcss`, and the global stylesheet imports Tailwind's theme and utilities, without Preflight, then Lynx's own utilities and variants:

```css
@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
@import '@blotch/angular-lynx/tailwind.css';
```

Tailwind 4 writes CSS Lynx drops (cascade layers, `oklch()`, `color-mix()`, `padding-inline`, the `translate`/`rotate`/`scale` properties, `@property`). The plugin rewrites every stylesheet `@tailwindcss/postcss` compiled into CSS with the same meaning that Lynx reads, for the native and the web bundle, and leaves out properties and keywords Lynx doesn't have. Nothing to configure. Tailwind 4 finds classes in the project's files itself; add `@source` for a folder outside it. The variables Tailwind registers with `@property` (`--tw-shadow`, `--tw-translate-x`, …) get their starting values only on elements with a class that reads them, not on every element as Tailwind's `*` fallback does for browsers without `@property` (see styling-and-css.md for why). CSS of your own that reads one on another element gets no value: give its `var()` a fallback.

`@blotch/angular-lynx/tailwind.css` adds on Tailwind 4 what `@lynx-js/tailwind-preset` adds on Tailwind 3. An app made before it was there gets the import from `ng update @blotch/angular-lynx`.

- **Layout and direction:** `linear` (`display: linear`), `display-relative`, and `normal`, `ltr`, `rtl`, `lynx-rtl` (`direction`).
- **`solo-translate-{x,y,z}-*`, `solo-rotate-*`, `solo-scale-*`, `solo-skew-*`** (and their axes and negatives) each set `transform` to one function, without variables, for animating a transform on Lynx before 3.4. Two don't combine on one element.
- **State variants:** Lynx has no attribute selectors, so `data-[state=open]:` never matches. Bind a `ui-*` class (`[class.ui-open]="open()"`) and style with `ui-open:`, `parent-ui-open:` (direct parent), or Tailwind's `group-ui-open:`, `peer-ui-checked:` and `in-ui-busy:`. The states are `active`, `disabled`, `readonly`, `checked`, `selected`, `indeterminate`, `invalid`, `initial`, `open`, `closed`, `leaving`, `entering`, `animating`, `busy`, `focused`, `complete`, `filled`, `dragging`, `side-{left,right,top,bottom}` and `align-{start,end,center}`. For another, add `@custom-variant ui-expanded (&.ui-expanded);` after the import.

**Tailwind CSS 3** still works: if a `tailwind.config.js` or `tailwind.config.ts` is present, the plugin runs the app's Tailwind 3 as a PostCSS plugin, with `@lynx-js/tailwind-preset` in the config. Tailwind 3 generates CSS for the classes in the files its `content` globs match, so keep `./src/**/*.{html,ts}` there: classes in an `.html` template the glob misses get no CSS.

The `@blotch/ui` theme maps its colors to utilities with `tailwind.css` (import it after Tailwind) on Tailwind 4, and with `tailwind-plugin.ts` on Tailwind 3. After moving an app from one version to the other, run `npx dolan update`: it copies the file the new version takes and deletes the other one (asking first if it was edited). `npx dolan doctor` warns about one left behind.
