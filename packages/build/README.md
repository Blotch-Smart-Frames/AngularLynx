# @blotch/angular-lynx-build

The Angular CLI builders for [AngularLynx](https://github.com/Blotch-Smart-Frames/AngularLynx): `ng build`, `ng serve`, `ng test` and `ng extract-i18n` for Lynx, and `ng build --platform ios|android|all` for native apps.

```bash
ng add @blotch/angular-lynx   # installs this package and sets up angular.json
```

It is the only build dependency an AngularLynx app needs, as `@angular/build` is for a web app: it brings rspeedy, the rsbuild plugin that compiles Angular, the QR code plugin and the native app builder with it.

## Builders

```jsonc
// angular.json, as `ng add` writes it
"build": {
  "builder": "@blotch/angular-lynx-build:application",
  "options": { "browser": "src/main.ts", "tsConfig": "tsconfig.app.json" /* ... */ },
  "configurations": {
    "production": { "budgets": [/* ... */], "outputHashing": "all" },
    "development": { "optimization": false, "extractLicenses": false, "sourceMap": true }
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
```

| Builder        | Command                   | What it does                                                                                                 |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `application`  | `ng build`                | Builds the Lynx bundle (and the web preview bundle) into `dist/` with [rspeedy](https://lynxjs.org/rspeedy/) |
|                | `ng build --watch`        | Rebuilds the bundle whenever a file changes                                                                  |
|                | `ng build --platform ios` | Then builds the iOS app (`--platform android` or `all` for the others) into `dist/<platform>/`               |
| `dev-server`   | `ng serve`                | Runs rspeedy's dev server for Lynx Explorer and the web preview, and prints the QR code Lynx Explorer scans  |
| `unit-test`    | `ng test`                 | Runs the unit tests with Angular's own unit-test builder (Vitest), set up for Lynx                           |
| `extract-i18n` | `ng extract-i18n`         | Extracts the i18n messages with Angular's own extract-i18n builder, set up for Lynx                          |

They behave like Angular's own builders:

- **Configurations and overrides apply.** The build target's options reach the compiler as Angular CLI resolved them, so `ng build -c development` and flags like `--optimization=false` work.
- **`optimization` decides between a production and a development build.** There is no `mode` option: as in Angular, a build that optimizes scripts is a production build, and one that doesn't is a development build with dev mode on. `ng build -c development` is a development build, and `ng serve -c production` serves a production one.
- **`ng serve` builds its `buildTarget`**, by default the build target's `development` configuration. `--port` / `--host` override `server` in lynx.config.ts.
- **Budgets are enforced.** The `budgets` in the build target are checked against the Lynx bundle and the component stylesheets, with Angular's messages; `ng add` sizes the `initial` budget for a Lynx bundle. See the plugin's [README](../rsbuild-plugin-angular-lynx/README.md#budgets).
- **`--watch` rebuilds only the bundle.** It can't be combined with `--platform`: use `ng serve` while developing, and `ng build --platform` for the app.

The options are in [`builders/application/schema.json`](builders/application/schema.json), [`builders/dev-server/schema.json`](builders/dev-server/schema.json), [`builders/unit-test/schema.json`](builders/unit-test/schema.json) and [`builders/extract-i18n/schema.json`](builders/extract-i18n/schema.json).

## ng test

The `unit-test` builder is Angular's `@angular/build:unit-test`, set up for Lynx. Its options are Angular's (`include`, `watch`, `coverage`, `setupFiles`, `providersFile`, ...): its schema is a copy of Angular's, and a test keeps the two in step. It finds `*.spec.ts` and `*.test.ts` files, and the tests compile ahead of time, like the app. On top of Angular's setup it:

- defines the compile-time flags the AngularLynx runtime reads (`__DEV__`, `__MAIN_THREAD__`, ...), through a polyfill (`@blotch/angular-lynx-build/unit-test/lynx-globals`) that loads before anything else;
- loads `@blotch/angular-lynx-testing-library`'s setup when the project has the library, so its `render()` works with no setup file or Vitest config in the app;
- hands Angular the build target as an Angular one, with only the options both builders share, so Angular neither warns about an unknown builder nor rejects the Lynx-only options;
- loads imported images, fonts and media as file URLs, as rspeedy does in the app.

Two things work as in any Angular app, and differ from a plain Vitest setup:

- **Templates are checked strictly.** A component that uses Lynx elements imports `LYNX_ELEMENTS`, as the Angular Language Service already requires (generated components do). The app build is laxer: it adds `CUSTOM_ELEMENTS_SCHEMA` to every component, which Angular's test build has no hook for.
- **Test code is type-checked**, and test files share one module graph (Angular's runner isn't isolated by default). `vi.mock` of a relative import isn't supported, and mocking `@angular/core` would leak into other test files.

## ng extract-i18n

The `extract-i18n` builder is Angular's `@angular/build:extract-i18n`, set up for Lynx. Its options are Angular's (`format`, `outputPath`, `outFile`, ...), and, as for `ng test`, its schema is a copy of Angular's that a test keeps in step. Angular CLI picks an extractor by itself only for a project built with one of Angular's builders, so an AngularLynx app needs the target: `ng add` writes it, and `add-i18n` makes it write JSON to `src/locale`, which `loadTranslations()` takes.

Angular's extractor compiles the app with Angular's application builder. As in `ng test`, it gets the build target as an Angular one, and imported images, fonts and media load as file URLs: without a loader for them, Angular's build stops at the first imported image. Without `@angular/localize`, it says to run `add-i18n` rather than Angular's `ng add @angular/localize`, which only sets up Angular's own builders.

## lynx.config.ts

An app doesn't need one. Without it, `ng build` and `ng serve` take what rspeedy needs from angular.json and the defaults an AngularLynx app wants:

- `source.entry` is the build target's `browser` option;
- the environments are `lynx` (the native bundle) and `web` (the browser preview);
- `ng serve` adds the QR code plugin, in full screen.

Add a lynx.config.ts to change any of these or set anything else rspeedy supports; each default only applies where it doesn't set its own. The builders add [`@blotch/rsbuild-plugin-angular-lynx`](../rsbuild-plugin-angular-lynx), which compiles Angular, either way. List the plugin yourself only to pass it options. Import it and `defineConfig` from this package, which depends on both:

```ts
import { defineConfig, pluginAngularLynx } from '@blotch/angular-lynx-build';

export default defineConfig({
  plugins: [pluginAngularLynx({ enableSSR: true })],
});
```

For the types of what the bundler handles (asset and CSS module imports, `import.meta.env`), reference them from here too, as `ng add` does in `src/rspeedy-env.d.ts`:

```ts
/// <reference types="@blotch/angular-lynx-build/client" />
```

## How it's put together

This package is the Angular CLI layer. The work happens in its dependencies:

- **[`@blotch/rsbuild-plugin-angular-lynx`](../rsbuild-plugin-angular-lynx)** compiles Angular inside rspeedy. It also works on its own, for projects that run rspeedy directly.
- **[`@blotch/angular-lynx-native`](../native)** turns the Lynx bundle into iOS and Android apps.
- **[rspeedy](https://lynxjs.org/rspeedy/)** and its QR code plugin. The builders always run the versions they were released and tested with, so an app doesn't install them.

`ng test` and `ng extract-i18n` run Angular's builders from the project's own `@angular/build`, which `ng new` installs: it must match the project's Angular version.
