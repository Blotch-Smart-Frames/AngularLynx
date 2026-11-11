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

The build target's Angular options (`browser`, `tsConfig`, `polyfills`, `styles`, `fileReplacements`, ...) configure the compile, as Angular CLI resolves them: `ng build -c development` and command-line overrides apply. `ng build --platform ios|android|all` also builds the native app; its options (`appId`, `appName`, `icon`, `permissions`, ...) live in the same target. `permissions.savePhotos` is the reason iOS shows before the share sheet's Save Image adds to Photos; it has a default. `icon` is one 1024×1024 PNG without transparency: iOS uses it as it is, and Android gets it resized for each density, round, and as an adaptive icon scaled to fit inside the launcher's mask. To give the Android adaptive icon its own layers, set `android.adaptiveIcon: { foreground, background }`: `foreground` a 1024×1024 PNG with transparency whose content stays inside the middle 66 of 108 dp, `background` a color (`#111111`) or a 1024×1024 PNG. The apps draw the page edge to edge, under the status bar and the home indicator, with `env(safe-area-inset-*)` giving the insets; `"edgeToEdge": false` keeps the page inside the safe area (see "Safe Area" in [styling-and-css.md](styling-and-css.md)). Each platform's app goes in its own folder of the output path (`ios`, `android`): a platform's build replaces only its folder, and `ng build` and `ng serve` keep both.

- **`optimization` picks a production or development build.** There is no `mode` option: as in Angular, a build that optimizes scripts is a production build, and one that doesn't is a development build with dev mode on.
- **`budgets` are enforced** against the Lynx bundle (each entry's bundle is its own `initial` budget) and each component stylesheet, with `ng build`'s messages. A Lynx bundle holds Angular twice (once per thread), so a new app's bundle is about 1 MB; `ng add` raises `ng new`'s `initial` budget to 2 MB / 5 MB.
- **`intl`** adds the `Intl` APIs it lists, which Lynx lacks, to the Lynx bundle (`"intl": ["NumberFormat", "Collator"]`), with data for `i18n.sourceLocale` and `i18n.locales`. The app installs the FormatJS packages the build names. See "No `Intl`" in [lynx-gotchas.md](lynx-gotchas.md).
- **`ng build --watch`** rebuilds the bundle on every change. It can't be combined with `--platform`.
- **`fileReplacements`** swap files as on the web, in everything the build makes: both threads' code, the web preview and the `--platform` apps. Paths are relative to the workspace and can lead out of it (`../shared/environment.prod.ts`). `ng generate environments` warns that the build target uses a third-party builder; the replacement it adds works.
- **`baseHref`** (`ng build --base-href=/shop/`) prefixes the web bundle's asset URLs: rspeedy's `output.assetPrefix` for the `web` environment. Lynx for Web resolves a bundle's imported images against the page that shows the `<lynx-view>`, not against the bundle, so a web bundle served under a path needs it (see "Bundled images need `baseHref` on the web" in [lynx-gotchas.md](lynx-gotchas.md)). The Lynx bundle resolves them against itself and is left alone. A prefix `lynx.config.ts` sets for the environment wins.

Like Angular's own dev server, `ng serve` builds its `buildTarget` (by default the build target's `development` configuration), so `ng serve -c production` serves a production build. It also takes `--port` and `--host`, and prints the QR code Lynx Explorer scans.

`ng serve --platform ios|android` (with `--device` as for `--run`) also builds a development build of the app from the build target's native options and opens it on a simulator, emulator or phone. It loads the bundle from the dev server and updates on every save, as Lynx Explorer does, but it's the app itself, with the native modules Lynx Explorer lacks (`LynxSecureStorage`, `LynxWebAuthSession`, `LynxShare`, WebGL `<canvas>`...). Develop an app that needs them this way. The native build is cached: the next `ng serve --platform` with the same native options reinstalls it without Xcode or Gradle. On Android the app reaches the server at `localhost` through `adb reverse`; a real iPhone needs the Mac's Wi-Fi network. When the server can't be reached, the app says so and retries. It's a Debug/debug build that has no bundle inside it: never ship it, `ng build --platform` builds the store app. `"configurations": { "ios": { "platform": "ios" } }` in the `serve` target gives `ng serve -c ios`.

`ng test` takes the options of Angular's unit-test builder. It finds `*.spec.ts` and `*.test.ts` files, compiles them ahead of time like the app, and loads `@blotch/angular-lynx-testing-library`'s setup when the project has it. Templates are checked strictly, so a component using Lynx elements imports `LYNX_ELEMENTS`. A TestBed spec renders through Angular's DOM renderer, where a Lynx element is an element like any other: `fixture.nativeElement.querySelector('text')` finds a `<text>`. `ng add` gives a new app one for its root component (`src/app/app.spec.ts`), so `ng test` has a test to run from the start. The testing library's `fireEvent` sends an event the way a device does: first every `global-bind` handler for it, anywhere in the page; then a touch event goes down from the page through the `capture-bind` and `capture-catch` handlers, then back up through the `bind` and `catch` ones, and a `catch` handler stops it. An event that doesn't bubble, such as `input`, runs only the target's own handler. `document:` and `window:` listeners run after the elements' handlers; for an event a `catch` handler stopped, on the next timer (`await waitForUpdate()`). `$event.target` is `{ uid }`, the element's unique id, as on a device.

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

For an event without a method, fire one whose type is the handler's kind and the event name: `fireEvent(pager, new CustomEvent('bindEvent:change', { detail }))` runs `(bindchange)` with that `detail`.

To render a component with inputs, pass them to `render()` instead of writing a host component: `await render(Greeting, { inputs: { name: 'Lynx' } })`. They're set before the first change detection, as a parent template binds them, so a required input has its value and `ngOnInit` sees it. Key each by the name a template binds (an aliased input takes its alias, such as `class`). `await rerender({ inputs: { name: 'Angular' } })` changes them and keeps the component, but only inputs `render()` set: a component whose inputs are bound takes no other inputs, nor `componentRef.setInput()`. So give `render()` a starting value for any input the test changes later.

A spec has none of the app's native modules, as in Lynx Explorer: `LynxNativeModule.call()` resolves `undefined`, a native module's methods reject, `LynxLocalStorage` and `LynxSecureStorage` keep values in memory, and `LynxImagePicker.pick()` and `LynxShare.share()` reject with `unavailable` (provide stand-ins that resolve with what the test needs). `LynxLinking` is the exception: the testing library gives it a module that records each URL, which `openedURLs()` returns (`[{ url, inApp }]`, reset after each test), so `openURL()` and `openInApp()` resolve and `canOpenURL()` resolves `true`. The test environment answers the calls AngularLynx relays to the background thread, but a relayed call that needs a Lynx API the environment lacks, such as `LynxAccessibility.announce()`, rejects, and `runOnBackground()` gets no answer, since `backgroundFn()`s don't run there. Provide fakes for these.

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

## What `pluginAngularLynx()` Does

1. **Angular compilation** — Uses `JavaScriptTransformer` + `createAngularCompilation` for AOT template compilation
2. **Entry splitting** — Creates two bundles: main-thread (ES2019) and background-thread (ES2015)
3. **Thread banners** — Injects `globalThis["__MAIN_THREAD__"]=true/false` into each bundle
4. **CSS handling** — Processes component styles and global CSS
5. **Chunk splitting** — Optimizes code splitting for lazy-loaded routes
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

## Dependencies

```json
{
  "dependencies": {
    "@angular/core": "^22.2.0",
    "@angular/router": "^22.2.0",
    "@blotch/angular-lynx": "^22.2.0"
  },
  "devDependencies": {
    "@blotch/angular-lynx-build": "^22.2.0"
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

New apps use **Tailwind CSS 4**, set up as Angular CLI does: `.postcssrc.json` runs `@tailwindcss/postcss`, and the global stylesheet imports Tailwind's theme and utilities, without Preflight:

```css
@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
```

Tailwind 4 writes CSS Lynx drops (cascade layers, `oklch()`, `color-mix()`, `padding-inline`, the `translate`/`rotate`/`scale` properties, `@property`). The plugin rewrites every stylesheet `@tailwindcss/postcss` compiled into CSS with the same meaning that Lynx reads, for the native and the web bundle, and leaves out properties and keywords Lynx doesn't have. Nothing to configure. Tailwind 4 finds classes in the project's files itself; add `@source` for a folder outside it.

**Tailwind CSS 3** still works: if a `tailwind.config.js` or `tailwind.config.ts` is present, the plugin runs the app's Tailwind 3 as a PostCSS plugin, with `@lynx-js/tailwind-preset` in the config. Tailwind 3 generates CSS for the classes in the files its `content` globs match, so keep `./src/**/*.{html,ts}` there: classes in an `.html` template the glob misses get no CSS.

The `@blotch/ui` theme maps its colors to utilities with `tailwind.css` (import it after Tailwind) on Tailwind 4, and with `tailwind-plugin.ts` on Tailwind 3. After moving an app from one version to the other, run `npx dolan update`: it copies the file the new version takes and deletes the other one (asking first if it was edited). `npx dolan doctor` warns about one left behind.
