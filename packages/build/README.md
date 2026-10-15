# @blotch/angular-lynx-build

The Angular CLI builders for [AngularLynx](https://github.com/Blotch-Smart-Frames/AngularLynx): `ng build` and `ng serve` for Lynx, and `ng build --platform ios|android|all` for native apps.

```bash
ng add @blotch/angular-lynx   # installs this package and sets up angular.json
```

## Builders

```jsonc
// angular.json, as `ng add` writes it
"build": {
  "builder": "@blotch/angular-lynx-build:application",
  "options": { "browser": "src/main.ts", "tsConfig": "tsconfig.app.json" /* ... */ },
  "configurations": {
    "production": { "mode": "production" /* ... */ },
    "development": { "mode": "development" /* ... */ }
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
```

| Builder       | Command                   | What it does                                                                                                 |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `application` | `ng build`                | Builds the Lynx bundle (and the web preview bundle) into `dist/` with [rspeedy](https://lynxjs.org/rspeedy/) |
|               | `ng build --platform ios` | Then builds the iOS app (`--platform android` or `all` for the others) into `dist/<platform>/`               |
| `dev-server`  | `ng serve`                | Runs rspeedy's dev server for Lynx Explorer and the web preview                                              |

They behave like Angular's own builders:

- **Configurations and overrides apply.** The build target's options reach the compiler as Angular CLI resolved them, so `ng build -c development` and flags like `--optimization=false` work.
- **`ng serve` builds its `buildTarget`**, by default the build target's `development` configuration. `ng serve -c production` serves a production build, and `--port` / `--host` override `server` in lynx.config.ts.

The options are in [`builders/application/schema.json`](builders/application/schema.json) and [`builders/dev-server/schema.json`](builders/dev-server/schema.json).

## lynx.config.ts

The builders run rspeedy with your `lynx.config.ts` and add [`@blotch/rsbuild-plugin-angular-lynx`](../rsbuild-plugin-angular-lynx), which compiles Angular. List the plugin yourself only to pass it options; import it from this package, which depends on it:

```ts
import { pluginAngularLynx } from '@blotch/angular-lynx-build';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  source: { entry: './src/main.ts' },
  plugins: [pluginAngularLynx({ enableSSR: true })],
});
```

## How it's put together

This package is the Angular CLI layer. The work happens in two others, both its dependencies:

- **[`@blotch/rsbuild-plugin-angular-lynx`](../rsbuild-plugin-angular-lynx)** compiles Angular inside rspeedy. It also works on its own, for projects that run rspeedy directly.
- **[`@blotch/angular-lynx-native`](../native)** turns the Lynx bundle into iOS and Android apps.

rspeedy itself comes from your project, so `ng build` runs the version your `package.json` pins.
