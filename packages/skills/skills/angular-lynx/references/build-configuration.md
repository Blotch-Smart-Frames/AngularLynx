# Build Configuration

## Overview

AngularLynx apps are built with [RSpeedy](https://lynxjs.org/rspeedy) (Lynx's build tool based on Rsbuild) plus the `@blotch/rsbuild-plugin-angular-lynx` plugin that adds Angular compilation.

## Config File: `lynx.config.ts`

```typescript
import { pluginAngularLynx } from '@blotch/rsbuild-plugin-angular-lynx';
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  source: {
    entry: './src/main.ts',
  },
  plugins: [
    pluginQRCode(), // Dev convenience: shows QR code in terminal
    pluginAngularLynx(), // Angular compilation + Lynx-specific bundling
  ],
});
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
├── lynx.config.ts          # Build configuration
├── angular.json            # Angular workspace config (needed for compilation)
├── tsconfig.json           # TypeScript config
├── package.json
└── src/
    ├── main.ts             # Entry point (bootstrapApplication)
    └── app/
        ├── app.config.ts   # Angular app config
        ├── app.routes.ts   # Route definitions
        └── app.component.ts
```

## Commands

```bash
# Development (starts dev server, shows QR code for Lynx Explorer)
npx rspeedy dev

# Production build
npx rspeedy build

# From the monorepo root
npm run demo              # Runs rspeedy dev for the kitchen-sink-app
```

## Dev Workflow

1. Run `npx rspeedy dev` — starts dev server, prints QR code
2. Open **Lynx Explorer** app on your device
3. Scan QR code — loads your app on-device
4. Edit code — hot reload updates the app
5. Check terminal for logs from `LynxLogger`

## Dependencies

```json
{
  "dependencies": {
    "@angular/core": "^19.0.0",
    "@angular/router": "^19.0.0",
    "@blotch/angular-lynx": "^0.0.1"
  },
  "devDependencies": {
    "@blotch/rsbuild-plugin-angular-lynx": "^0.0.1",
    "@lynx-js/rspeedy": "^0.8.0",
    "@lynx-js/qrcode-rsbuild-plugin": "^0.8.0"
  }
}
```

## angular.json

Minimal `angular.json` is required for Angular compilation:

```json
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "projects": {
    "my-app": {
      "root": "",
      "sourceRoot": "src",
      "projectType": "application"
    }
  }
}
```

## Tailwind CSS

If a `tailwind.config.js` or `tailwind.config.ts` is present, the plugin auto-configures Tailwind processing. No additional setup needed.
