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

The build target's Angular options (`browser`, `tsConfig`, `polyfills`, `styles`, `fileReplacements`, ...) configure the compile, as Angular CLI resolves them: `ng build -c development` and command-line overrides apply. `ng build --platform ios|android|all` also builds the native app; its options (`appId`, `appName`, `icon`, ...) live in the same target. Each platform's app goes in its own folder of the output path (`ios`, `android`): a platform's build replaces only its folder, and `ng build` and `ng serve` keep both.

- **`optimization` picks a production or development build.** There is no `mode` option: as in Angular, a build that optimizes scripts is a production build, and one that doesn't is a development build with dev mode on.
- **`budgets` are enforced** against the Lynx bundle (each entry's bundle is its own `initial` budget) and each component stylesheet, with `ng build`'s messages. A Lynx bundle holds Angular twice (once per thread), so a new app's bundle is about 1 MB; `ng add` raises `ng new`'s `initial` budget to 2 MB / 5 MB.
- **`ng build --watch`** rebuilds the bundle on every change. It can't be combined with `--platform`.

Like Angular's own dev server, `ng serve` builds its `buildTarget` (by default the build target's `development` configuration), so `ng serve -c production` serves a production build. It also takes `--port` and `--host`, and prints the QR code Lynx Explorer scans.

`ng test` takes the options of Angular's unit-test builder. It finds `*.spec.ts` and `*.test.ts` files, compiles them ahead of time like the app, and loads `@blotch/angular-lynx-testing-library`'s setup when the project has it. Templates are checked strictly, so a component using Lynx elements imports `LYNX_ELEMENTS`. The testing library's `fireEvent` sends an event the way a device does: a touch event goes down from the page through the `capture-bind` and `capture-catch` handlers, then back up through the `bind` and `catch` ones, and a `catch` handler stops it. An event that doesn't bubble, such as `input`, runs only the target's own handler.

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

# From the monorepo root
npm run demo              # Runs ng serve for the kitchen-sink-app
```

## Dev Workflow

1. Run `ng serve` — starts dev server, prints QR code
2. Open **Lynx Explorer** app on your device
3. Scan QR code — loads your app on-device
4. Edit code — hot reload updates the app
5. Check terminal for logs from `LynxLogger`

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
