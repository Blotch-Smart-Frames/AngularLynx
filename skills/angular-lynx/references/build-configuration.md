# Build Configuration

## Overview

AngularLynx apps build with the Angular CLI. `ng build` and `ng serve` run the `@blotch/angular-lynx-build` builders, which run [RSpeedy](https://lynxjs.org/rspeedy) (Lynx's build tool based on Rsbuild) with the `@blotch/rsbuild-plugin-angular-lynx` plugin that adds Angular compilation.

`ng add @blotch/angular-lynx` sets all of this up.

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
            "production": { "mode": "production" },
            "development": { "mode": "development" }
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
        }
      }
    }
  }
}
```

The build target's Angular options (`browser`, `tsConfig`, `polyfills`, `styles`, `fileReplacements`, ...) configure the compile, as Angular CLI resolves them: `ng build -c development` and command-line overrides apply. `ng build --platform ios|android|all` also builds the native app; its options (`appId`, `appName`, `icon`, ...) live in the same target.

Like Angular's own dev server, `ng serve` builds its `buildTarget` (by default the build target's `development` configuration), so `ng serve -c production` serves a production build. It also takes `--port` and `--host`.

## Config File: `lynx.config.ts`

RSpeedy's own settings. The builders add `pluginAngularLynx()` to it:

```typescript
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  environments: {
    lynx: {}, // the bundle Lynx Explorer and native apps load
    web: {}, // the bundle for the browser preview
  },
  source: {
    entry: './src/main.ts',
  },
  plugins: [
    pluginQRCode(), // Dev convenience: shows QR code in terminal
  ],
});
```

To pass the plugin options, list it yourself. The builders then use your instance instead of adding one:

```typescript
import { pluginAngularLynx } from '@blotch/angular-lynx-build';

// ...
  plugins: [pluginAngularLynx({ enableSSR: true })],
```

## What `pluginAngularLynx()` Does

1. **Angular compilation** — Uses `JavaScriptTransformer` + `createAngularCompilation` for AOT template compilation
2. **Entry splitting** — Creates two bundles: main-thread (ES2019) and background-thread (ES2015)
3. **Thread banners** — Injects `globalThis["__MAIN_THREAD__"]=true/false` into each bundle
4. **CSS handling** — Processes component styles and global CSS
5. **Chunk splitting** — Optimizes code splitting for lazy-loaded routes
6. **Tailwind detection** — Auto-configures Tailwind CSS if detected in the project

## Project Files

Minimal project structure:

```
my-app/
├── angular.json            # Angular workspace config: builders + compiler options
├── lynx.config.ts          # RSpeedy configuration
├── tsconfig.json           # TypeScript config
├── package.json
└── src/
    ├── main.ts             # Entry point (bootstrapApplication)
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

# Native apps
ng build --platform ios       # or android, or all

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
    "@blotch/angular-lynx-build": "^22.2.0",
    "@lynx-js/rspeedy": "^0.18.0",
    "@lynx-js/qrcode-rsbuild-plugin": "^0.7.3"
  }
}
```

`@blotch/angular-lynx-build` brings `@blotch/rsbuild-plugin-angular-lynx` and `@blotch/angular-lynx-native` (the iOS and Android app builder) with it.

## Tailwind CSS

If a `tailwind.config.js` or `tailwind.config.ts` is present, the plugin auto-configures Tailwind processing. No additional setup needed.
